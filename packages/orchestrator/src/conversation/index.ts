import type { RiskProfile } from '../types/index.js';

/**
 * Conversational layer (contract only — implemented in a later module).
 *
 * A grounded LLM that ONLY explains an already-computed `RiskProfile` in
 * natural language. It must never compute, alter, or add to the risk — the
 * profile is the sole source of truth it is allowed to talk about.
 *
 * Module 0 defines the contract only — NO LLM calls here.
 */
export interface Conversation {
  /** Explain the profile, optionally answering a specific user question. */
  explain(profile: RiskProfile, question?: string): Promise<string>;
}
