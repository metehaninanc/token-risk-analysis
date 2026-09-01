import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Collector, RawCollectorResult } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { type AppConfig, loadConfig } from '../config/index.js';
import { archiveRawResult } from '../utils/archive.js';
import { fetchVerifiedSource } from '../utils/etherscanSource.js';
import { GoPlusCollector } from './goplus.collector.js';
import { failResult, okResult } from './result.js';

/** Default LLM request timeout (LLM calls are slower than the REST collectors). */
const CODE_CHECK_TIMEOUT_MS = 60_000;

/** Default cap on source characters sent to the LLM (see `truncate`). */
const MAX_SOURCE_CHARS = 60_000;

/** The five fixed code-intent checks, in canonical order. */
const CHECK_KEYS = [
  'mint_after_deploy',
  'restrict_transfers',
  'mutable_taxes',
  'hidden_owner_privileges',
  'ownership_status',
] as const;
type CheckKey = (typeof CHECK_KEYS)[number];

const STATUSES = ['present', 'absent', 'undetermined'] as const;
type ObservationStatus = (typeof STATUSES)[number];

/** One factual, source-grounded observation. NOT a score or verdict. */
export interface CodeObservation {
  check: CheckKey;
  /** `undetermined` when the source does not clearly show it. */
  status: ObservationStatus;
  /** Function name or short factual reason; '' when there is none. */
  evidence: string;
}

/** The `raw` payload this collector produces (never a score/verdict). */
export type CodeCheckerRaw =
  | { verified: false; checks: CodeObservation[]; unavailableReason?: string }
  | { verified: true; truncated?: boolean; model: string; checks: CodeObservation[] };

/**
 * System prompt — deliberately strict and grounded. The LLM reports ONLY the
 * five properties from the given source, marks anything unclear `undetermined`,
 * and is forbidden from producing a score, verdict, or advice. All decisions are
 * made later by the deterministic orchestrator; this is just another source.
 */
const SYSTEM_PROMPT = [
  'You are a Solidity source-code auditor.',
  'You answer ONLY from the source code the user provides.',
  'Report exactly these five properties, each judged independently:',
  '- mint_after_deploy: can the owner or any privileged role mint new tokens after deployment?',
  '- restrict_transfers: can the owner pause, block, blacklist, or otherwise restrict transfers/selling?',
  '- mutable_taxes: can buy/sell taxes or fees be changed after launch?',
  '- hidden_owner_privileges: are there GENUINE backdoors — code letting a privileged party (owner OR a hardcoded address) MOVE/SEIZE USER funds, arbitrarily rewrite balances, secretly mint, or divert transfers to itself? Inspect _transfer and every function it calls for hidden owner-favouring logic (special state variables / if-blocks). Ordinary maintenance functions that only recover the CONTRACT\'S OWN tokens or ETH (manualSwap, manualSend, rescueERC20, withdrawStuckTokens, clearStuckBalance, etc.) are NOT backdoors — mark them absent unless they move USER holdings.',
  '- ownership_status: can owner/admin control be retained or reclaimed? "present" = ownership is active or can be reclaimed after renouncing; "absent" = ownership is genuinely renounced with no reclaim path in the code; "undetermined" = the code does not make this clear (e.g. the current owner is runtime state not visible in source).',
  '',
  'Rules:',
  '- status must be "present", "absent", or "undetermined".',
  '- Use "undetermined" whenever the code does not clearly show the answer. Do NOT guess or infer beyond the code.',
  '- Focus on ANOMALIES: real scams hide owner-favouring logic inside _transfer (or helpers) via special variables / if-blocks, not in obviously-named functions. Do NOT flag a risk merely because an admin function EXISTS — flag it when the code can actually harm holders.',
  '- evidence must be a function/modifier name or a short factual reason taken from the code; use "" when there is none.',
  '- Do NOT output any risk score, scam/not-scam verdict, overall judgement, recommendation, or advice. Report only these five factual properties.',
  '- Output a single JSON object exactly of the form: {"checks":[{"check":"...","status":"...","evidence":"..."}]} containing all five checks.',
].join('\n');

/** User prompt carrying the (possibly truncated) source code + renounce context. */
function buildUserPrompt(sourceCode: string, renounced: boolean | undefined): string {
  const lines = [
    'Analyze the verified Solidity source below and return the five checks as JSON.',
    'Answer each check independently and only from this code.',
  ];
  if (renounced === true) {
    lines.push(
      'CONTEXT: ownership is CURRENTLY RENOUNCED on-chain (confirmed by an independent source). Owner-only functions are therefore INERT and cannot be called — do NOT flag owner-only capabilities as active risks; instead focus on genuine backdoors that do NOT need the owner, and on whether ownership could be RECLAIMED after renouncing.',
    );
  } else if (renounced === false) {
    lines.push('CONTEXT: ownership is NOT renounced (an active owner exists), so owner-only functions can be invoked.');
  }
  lines.push('', 'SOURCE CODE:', sourceCode);
  return lines.join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** True when an unknown error is an `AbortController` timeout abort. */
function isAbortError(err: unknown): boolean {
  return isRecord(err) && (err as { name?: unknown }).name === 'AbortError';
}

/** Truncate over-long source, reporting whether truncation happened. */
function truncate(source: string, maxChars: number): { text: string; truncated: boolean } {
  if (source.length <= maxChars) return { text: source, truncated: false };
  return { text: source.slice(0, maxChars), truncated: true };
}

function coerceStatus(value: unknown): ObservationStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
    ? (value as ObservationStatus)
    : 'undetermined';
}

/** Pull the `checks` array out of the model's JSON, tolerating minor shape drift. */
function toItemArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (isRecord(parsed) && Array.isArray(parsed.checks)) return parsed.checks;
  return [];
}

/**
 * Build exactly the five canonical observations from the model output. Any check
 * the model omitted or returned malformed becomes `undetermined` — a valid
 * observation, never an invented `present`/`absent`.
 */
function buildObservations(parsed: unknown): CodeObservation[] {
  const found = new Map<CheckKey, CodeObservation>();
  for (const item of toItemArray(parsed)) {
    if (!isRecord(item)) continue;
    const check = item.check;
    if (typeof check === 'string' && (CHECK_KEYS as readonly string[]).includes(check)) {
      found.set(check as CheckKey, {
        check: check as CheckKey,
        status: coerceStatus(item.status),
        evidence: typeof item.evidence === 'string' ? item.evidence : '',
      });
    }
  }
  return CHECK_KEYS.map(
    (check) => found.get(check) ?? { check, status: 'undetermined', evidence: '' },
  );
}

/** Extract the assistant message content (a JSON string) from a chat response. */
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

/* ── renounce lookup (from SafeAnalyzer / GoPlus, NOT an on-chain owner() call) ── */

const RENOUNCED_OWNERS = new Set([
  '',
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
]);

/** Renounce reading from a GoPlus response (`result[addr].owner_address`). */
function goplusRenounce(raw: unknown): boolean | undefined {
  if (!isRecord(raw) || !isRecord(raw.result)) return undefined;
  const first: unknown = Object.values(raw.result)[0];
  if (!isRecord(first) || typeof first.owner_address !== 'string') return undefined;
  return RENOUNCED_OWNERS.has(first.owner_address.toLowerCase());
}

/** Renounce reading from a SafeAnalyzer response (`owner === "***RENOUNCED***"`). */
function safeAnalyzerRenounce(raw: unknown): boolean | undefined {
  if (!isRecord(raw) || typeof raw.owner !== 'string' || raw.owner.trim() === '') return undefined;
  return /renounced/i.test(raw.owner);
}

/** Read the `raw` field of an archived RawCollectorResult, if the file exists. */
async function readArchivedRaw(path: string): Promise<unknown> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return isRecord(parsed) ? parsed.raw : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Determine whether ownership is renounced, from an INDEPENDENT runtime source —
 * SafeAnalyzer or GoPlus (either is enough). On-chain `owner()` is intentionally
 * avoided: contracts use non-standard owner accessors, so it is unreliable.
 * Prefers archived data; falls back to a fresh (keyless) GoPlus call.
 */
async function resolveRenounce(address: string, config: AppConfig): Promise<boolean | undefined> {
  const dir = resolve(config.archiveDir, address.toLowerCase());

  const gpArchived = goplusRenounce(await readArchivedRaw(join(dir, 'goplus.json')));
  if (gpArchived !== undefined) return gpArchived;

  const saArchived = safeAnalyzerRenounce(await readArchivedRaw(join(dir, 'safeanalyzer.json')));
  if (saArchived !== undefined) return saArchived;

  try {
    const fresh = await new GoPlusCollector(config).collect(address);
    if (fresh.ok) return goplusRenounce(fresh.raw);
  } catch {
    /* renounce simply stays unknown */
  }
  return undefined;
}

/**
 * (6) Code-Level Checker — LLM-based.
 *
 * Reads a contract's verified source (via `fetchVerifiedSource`, Etherscan) and
 * asks an LLM a small, FIXED set of code-intent questions. The LLM produces
 * OBSERVATIONS ONLY — never a score, verdict, or advice — and those observations
 * are treated exactly like any other source signal; only the deterministic
 * orchestrator (a later module) makes decisions.
 *
 * This checker is deliberately narrow. It targets intentional malice hidden in
 * otherwise-valid, compiling code (owner mint, transfer restrictions, mutable
 * taxes, backdoors, fake renouncement) — the class of risk that generic
 * vulnerability scanners miss (see Chapter Two). It is NOT a vulnerability scanner.
 *
 * LLM call: OpenAI Chat Completions, model + key from config. temperature is 0
 * and output is forced to JSON (`response_format: json_object`); pin OPENAI_MODEL
 * to a dated snapshot for full reproducibility. The exact model the API resolved
 * is recorded in `raw.model` and archived (methodology reproducibility claim).
 *
 * Endpoint: `POST {OPENAI_BASE_URL}/chat/completions`  (default base v1).
 *
 * Contract (same as all collectors): returns a `RawCollectorResult`, never
 * throws, archives the raw result on success. An unverified/absent source is an
 * UNDETERMINED success (`ok: true`, `verified: false`, no checks), not an error.
 */
export class CodeLevelCheckerCollector implements Collector {
  readonly name = SOURCES.codeLevelChecker;

  constructor(
    private readonly config: AppConfig = loadConfig(),
    private readonly timeoutMs: number = CODE_CHECK_TIMEOUT_MS,
    private readonly maxChars: number = MAX_SOURCE_CHARS,
  ) {}

  async collect(address: string): Promise<RawCollectorResult> {
    try {
      const source = await fetchVerifiedSource(address, this.config);

      // No source available (fetch failed) → undetermined, NOT an error. The
      // reason is surfaced so it is not silently hidden.
      if (!source.ok) {
        return this.archived(address, {
          verified: false,
          checks: [],
          unavailableReason: source.error,
        });
      }

      // Unverified contracts are expected → undetermined success, no LLM call.
      if (!source.verified || source.sourceCode.trim() === '') {
        return this.archived(address, { verified: false, checks: [] });
      }

      const { apiKey } = this.config.openai;
      if (!apiKey) return failResult(this.name, address, 'OPENAI_API_KEY not configured');

      // Renounce first (from SafeAnalyzer / GoPlus), THEN the LLM — so the model
      // knows owner-only functions may be inert and can focus on real anomalies.
      const renounced = await resolveRenounce(address, this.config);
      const { text, truncated } = truncate(source.sourceCode, this.maxChars);
      const { checks, model } = await this.runChecks(text, apiKey, renounced);

      const raw: CodeCheckerRaw = truncated
        ? { verified: true, truncated: true, model, checks }
        : { verified: true, model, checks };
      return this.archived(address, raw);
    } catch (err) {
      return failResult(this.name, address, err instanceof Error ? err.message : String(err));
    }
  }

  /** Archive a successful raw payload and return the ok result. */
  private async archived(address: string, raw: CodeCheckerRaw): Promise<RawCollectorResult> {
    const result = okResult(this.name, address, raw);
    await archiveRawResult(result, this.config.archiveDir);
    return result;
  }

  /** Run the five checks through the LLM. Throws on any LLM/JSON failure. */
  private async runChecks(
    sourceCode: string,
    apiKey: string,
    renounced: boolean | undefined,
  ): Promise<{ checks: CodeObservation[]; model: string }> {
    const { baseUrl, model } = this.config.openai;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0, // deterministic — reproducibility claim
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(sourceCode, renounced) },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenAI HTTP ${response.status}: ${await readError(response)}`);
      }

      const body: unknown = await response.json();
      const parsed: unknown = JSON.parse(extractContent(body));
      // Record the model the API actually resolved (e.g. a dated snapshot).
      const resolvedModel = isRecord(body) && typeof body.model === 'string' ? body.model : model;
      return { checks: buildObservations(parsed), model: resolvedModel };
    } catch (err) {
      if (isAbortError(err)) throw new Error(`request timed out after ${this.timeoutMs}ms`);
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(timer);
    }
  }
}
