import type { RiskProfile } from '../types/index.js';
import { type AppConfig, loadConfig } from '../config/index.js';
import { type ChatTurn, type Session, withTurn } from './session.js';
import { type GroundedReply, buildMessages, parseGroundedReply } from './prompt.js';
import { CONVERSATION_TIMEOUT_MS, callChatModel } from './llm.js';
import { resolveProfile } from './profileSource.js';

export type { ChatTurn, Session } from './session.js';
export type { GroundedReply } from './prompt.js';
export { newSession, withTurn } from './session.js';

/**
 * CONVERSATIONAL LAYER (methodology §3.5) — grounded explanation + Q&A.
 *
 * A read-only presenter for an ALREADY-COMPUTED `RiskProfile`. The LLM has NO
 * authority over the risk judgement: it never computes, re-ranks, or alters
 * risk — it only phrases what the profile already says. Routing is plain code;
 * the model is invoked purely to word the summary/answer.
 *
 * It implements the three retrieval failure modes deliberately:
 *   1. No noisy retrieval — every answer is grounded on ONE cached profile.
 *   2. Conflicts are surfaced, not hidden — `conflict`/`conflictDetail` are
 *      passed through and the system prompt forces honest disclosure.
 *   3. Refusal over fabrication — when the profile lacks the answer, the model
 *      is instructed to say so rather than speculate.
 *
 * Reproducibility/safety: the model is never called without a profile in
 * context; every reply is grounded on `session.profile` (address + timestamp);
 * calls are time-bounded and fail into a graceful message rather than crashing.
 */

/** Legacy contract (Module 0) — retained for the package entry re-export. */
export interface Conversation {
  explain(profile: RiskProfile, question?: string): Promise<string>;
}

/** `0x` + 40 hex, not part of a longer hex run (so tx hashes don't match). */
const ADDRESS_RE = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;

/** Find the first Ethereum contract address in a message, if any. */
export function extractAddress(message: string): string | undefined {
  const match = ADDRESS_RE.exec(message);
  return match ? match[0] : undefined;
}

/**
 * Injectable dependencies — real implementations by default, overridable so the
 * router can be unit-tested with no network/LLM.
 */
export interface ConversationDeps {
  resolveProfile(address: string): Promise<RiskProfile>;
  explain(
    kind: 'summary' | 'question',
    profile: RiskProfile,
    question: string,
    history: ChatTurn[],
  ): Promise<GroundedReply>;
}

/**
 * Phrase an explanation from the profile via the grounded LLM, returning the
 * user-facing `reply` AND the machine-readable `citedKeys` it referenced
 * (temperature 0, JSON output). Exported so the evaluation layer can score the
 * SAME explanation the user receives — never a separate eval-only call.
 */
export async function explainProfile(
  kind: 'summary' | 'question',
  profile: RiskProfile,
  question: string,
  history: ChatTurn[],
  config: AppConfig,
): Promise<GroundedReply> {
  if (!config.openai.apiKey) {
    return {
      reply:
        'The language model is not configured (OPENAI_API_KEY missing), so I cannot phrase an explanation — but the structured risk profile has been loaded and is available.',
      citedKeys: [],
    };
  }
  const messages = buildMessages(kind, profile, question, history);
  const raw = await callChatModel(messages, config, CONVERSATION_TIMEOUT_MS, true);
  return parseGroundedReply(raw);
}

/** Build the default (real) dependencies from config. */
export function defaultDeps(config: AppConfig = loadConfig()): ConversationDeps {
  return {
    resolveProfile: (address) => resolveProfile(address, config),
    explain: (kind, profile, question, history) =>
      explainProfile(kind, profile, question, history, config),
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** One handled turn: the user-facing reply, the updated session, and cited keys. */
export interface HandleResult {
  reply: string;
  session: Session;
  /** Signal keys the grounded reply referenced (empty on refusal/error). */
  citedKeys: string[];
}

/**
 * Handle one user message.
 *
 * Router (plain code, not the LLM's job):
 *  • message contains an address  → NEW token: resolve its profile, cache it as
 *    the active token, and have the LLM produce an opening summary.
 *  • no address, active token set → FOLLOW-UP: answer from the cached profile.
 *  • no address, no active token  → ask for an address (the model is NOT called).
 */
export async function handleMessage(
  message: string,
  session: Session,
  deps: ConversationDeps = defaultDeps(),
): Promise<HandleResult> {
  const address = extractAddress(message);

  // NEW token.
  if (address) {
    let profile: RiskProfile;
    try {
      profile = await deps.resolveProfile(address);
    } catch (err) {
      const reply = `I couldn't build a risk profile for ${address} (${errorText(err)}). The previously active token, if any, is unchanged.`;
      return { reply, session: withTurn(session, message, reply), citedKeys: [] };
    }

    // Start a clean history for the new token so its summary isn't polluted.
    const loaded: Session = { history: [], activeAddress: profile.address, profile };
    let grounded: GroundedReply;
    try {
      grounded = await deps.explain('summary', profile, '', loaded.history);
    } catch (err) {
      grounded = {
        reply: `I loaded the risk profile for ${profile.address} (overall risk: ${profile.overallRisk}), but couldn't phrase a summary just now (${errorText(err)}). You can still ask about it.`,
        citedKeys: [],
      };
    }
    return {
      reply: grounded.reply,
      session: withTurn(loaded, message, grounded.reply),
      citedKeys: grounded.citedKeys,
    };
  }

  // FOLLOW-UP without an active token → ask for one (never call the model).
  if (!session.profile) {
    const reply =
      'No token is loaded yet. Please paste an Ethereum token contract address (0x + 40 hex) and I will analyze it.';
    return { reply, session: withTurn(session, message, reply), citedKeys: [] };
  }

  // FOLLOW-UP grounded on the cached profile.
  let grounded: GroundedReply;
  try {
    grounded = await deps.explain('question', session.profile, message, session.history);
  } catch (err) {
    grounded = {
      reply: `I couldn't generate an answer just now (${errorText(err)}). The risk profile for ${session.profile.address} is still loaded — please try again.`,
      citedKeys: [],
    };
  }
  return {
    reply: grounded.reply,
    session: withTurn(session, message, grounded.reply),
    citedKeys: grounded.citedKeys,
  };
}
