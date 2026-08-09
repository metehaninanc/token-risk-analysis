import type { RiskProfile, Severity } from '../types/index.js';

/** One labelled case in an evaluation corpus. */
export interface EvaluationCase {
  address: string;
  chain: string;
  /** Ground-truth label. */
  label: 'scam' | 'legit';
  /** Optional expected verdict for stricter checks. */
  expectedRisk?: Severity;
}

/** The pipeline's output for one case, paired with a pass/fail. */
export interface EvaluationResult {
  case: EvaluationCase;
  profile: RiskProfile;
  passed: boolean;
}

/**
 * Evaluation layer (contract only — implemented in a later module).
 *
 * Runs the full pipeline over a labelled corpus so results are reproducible and
 * comparable across runs. Module 0 defines the contract only — NO scoring here.
 */
export interface Evaluator {
  run(cases: EvaluationCase[]): Promise<EvaluationResult[]>;
}
