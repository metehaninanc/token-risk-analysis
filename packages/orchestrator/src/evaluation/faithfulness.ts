import type { RiskProfile } from '../types/index.js';

/**
 * FAITHFULNESS INSTRUMENT (methodology 3.6).
 *
 * Faithfulness = set overlap between the keys the explanation CITED and the keys
 * actually present in the profile:
 *
 *   faithfulness = |citedKeys ∩ profileKeys| / |citedKeys|
 *
 * A cited key NOT present in the profile is an unfaithful (hallucinated) mention.
 *
 * The `citedKeys` are produced by the CONVERSATION layer itself (see
 * `explainProfile` → `GroundedReply`), so the explanation that is scored here is
 * exactly the one the user receives — this module no longer issues its own
 * separate eval-only chat call. This file is pure scoring: no LLM, no network.
 */

/** The grounded summary plus the keys the model cited (cached in eval_summary.json). */
export interface CitedSummary {
  summary: string;
  citedKeys: string[];
}

/** Per-token faithfulness outcome. */
export interface FaithfulnessCase {
  address: string;
  citedKeys: string[];
  profileKeys: string[];
  matched: string[];
  /** Cited but NOT in the profile — hallucinated mentions. */
  unfaithful: string[];
  /** matched / cited; `null` when the model cited nothing. */
  score: number | null;
}

export interface FaithfulnessReport {
  perToken: FaithfulnessCase[];
  /** Mean over tokens with a defined score. */
  meanFaithfulness: number | null;
  /** Tokens that had at least one hallucinated key, for manual inspection. */
  unfaithfulCases: Array<{ address: string; unfaithful: string[] }>;
  evaluated: number;
}

/**
 * Top-level RiskProfile fields the grounded summary legitimately references.
 * These are REAL fields of the profile (not signal keys), so citing them is
 * faithful, not a hallucination: `overallRisk` (stated up front), `conflicts`
 * (called out explicitly), and the source tallies used for attribution.
 */
const STRUCTURAL_KEYS = ['overallRisk', 'conflicts', 'sourcesQueried', 'sourcesFailed'] as const;

/** Score one token's cited keys against the keys actually in its profile. */
export function scoreFaithfulness(
  address: string,
  citedKeys: string[],
  profile: RiskProfile,
): FaithfulnessCase {
  const profileKeys = new Set<string>([
    ...profile.signals.map((s) => s.key),
    ...STRUCTURAL_KEYS,
  ]);
  const matched = citedKeys.filter((k) => profileKeys.has(k));
  const unfaithful = citedKeys.filter((k) => !profileKeys.has(k));
  const score = citedKeys.length === 0 ? null : matched.length / citedKeys.length;
  return { address, citedKeys, profileKeys: [...profileKeys], matched, unfaithful, score };
}

/** Aggregate per-token cases into the faithfulness report. */
export function aggregateFaithfulness(cases: FaithfulnessCase[]): FaithfulnessReport {
  const scored = cases.filter((c): c is FaithfulnessCase & { score: number } => c.score !== null);
  const meanFaithfulness =
    scored.length === 0 ? null : scored.reduce((sum, c) => sum + c.score, 0) / scored.length;
  const unfaithfulCases = cases
    .filter((c) => c.unfaithful.length > 0)
    .map((c) => ({ address: c.address, unfaithful: c.unfaithful }));
  return { perToken: cases, meanFaithfulness, unfaithfulCases, evaluated: cases.length };
}
