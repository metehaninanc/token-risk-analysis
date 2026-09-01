import type { RiskProfile } from '../types/index.js';

/** One turn of the conversation. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Conversation state: the token currently in focus, its cached `RiskProfile`
 * (the sole grounding for every answer), and a short rolling chat history.
 */
export interface Session {
  /** The active token address, if one has been loaded. */
  activeAddress?: string;
  /** Cached profile that grounds all answers for the active token. */
  profile?: RiskProfile;
  /** Recent turns (most recent last), capped to keep prompts small. */
  history: ChatTurn[];
}

const MAX_HISTORY = 12;

/** A fresh, empty session. */
export function newSession(): Session {
  return { history: [] };
}

/** Return a NEW session with the user+assistant turn appended (history capped). */
export function withTurn(session: Session, userMessage: string, assistantMessage: string): Session {
  const history: ChatTurn[] = [
    ...session.history,
    { role: 'user' as const, content: userMessage },
    { role: 'assistant' as const, content: assistantMessage },
  ].slice(-MAX_HISTORY);

  const next: Session = { history };
  if (session.activeAddress !== undefined) next.activeAddress = session.activeAddress;
  if (session.profile !== undefined) next.profile = session.profile;
  return next;
}
