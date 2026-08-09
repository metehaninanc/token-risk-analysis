import type { RawCollectorResult, RiskProfile } from '../types/index.js';

/** Input needed to assemble a risk profile. */
export interface OrchestratorInput {
  address: string;
  chain: string;
  results: RawCollectorResult[];
}

/**
 * Risk-profile layer (contract only — implemented in a later module).
 *
 * A DETERMINISTIC, rule-based merge of normalised signals into one
 * `RiskProfile`: deduplicates by `key`, flags cross-source conflicts, and
 * derives `overallRisk`. NO machine learning and NO scoring logic in Module 0.
 */
export interface Orchestrator {
  buildProfile(input: OrchestratorInput): RiskProfile;
}
