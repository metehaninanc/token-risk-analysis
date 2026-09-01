import type { AppConfig } from '../config/index.js';
import type { ChatMessage } from './prompt.js';

/** Conversation LLM request timeout (chat replies can be a little slower). */
export const CONVERSATION_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAbortError(err: unknown): boolean {
  return isRecord(err) && (err as { name?: unknown }).name === 'AbortError';
}

/** Extract the assistant message text from a chat-completions response. */
function extractContent(body: unknown): string {
  if (!isRecord(body)) throw new Error('unexpected OpenAI response');
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('OpenAI response had no choices');
  }
  const first: unknown = choices[0];
  const message = isRecord(first) ? first.message : undefined;
  const content = isRecord(message) ? message.content : undefined;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('OpenAI response had empty content');
  }
  return content;
}

/** Best-effort error detail from a non-2xx OpenAI response. */
async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
      return body.error.message;
    }
  } catch {
    /* fall through to status text */
  }
  return `${response.status} ${response.statusText}`.trim();
}

/**
 * Call the OpenAI Chat Completions API with temperature 0 (deterministic,
 * reproducible). Model + key come from config; pin OPENAI_MODEL to a dated
 * snapshot for full reproducibility. Throws on any failure — callers convert
 * that into a graceful message; the model is never invoked without a profile
 * already in the messages.
 *
 * Endpoint: `POST {OPENAI_BASE_URL}/chat/completions`.
 */
export async function callChatModel(
  messages: ChatMessage[],
  config: AppConfig,
  timeoutMs: number = CONVERSATION_TIMEOUT_MS,
  jsonMode = false,
): Promise<string> {
  const { apiKey, baseUrl, model } = config.openai;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI HTTP ${response.status}: ${await readError(response)}`);
    }

    const body: unknown = await response.json();
    return extractContent(body);
  } catch (err) {
    if (isAbortError(err)) throw new Error(`request timed out after ${timeoutMs}ms`);
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
}
