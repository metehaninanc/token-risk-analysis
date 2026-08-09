import type { Severity, Signal } from './signal.js';

/**
 * The single, deterministic risk profile produced by the orchestrator after
 * merging all normalised signals. This is what the conversational layer
 * explains and what the evaluation layer scores against labels.
 *
 * No scoring/merge logic exists in Module 0 — this is only the shape.
 */
export interface RiskProfile {
  /** Token contract address the profile is for. */
  address: string;
  /** Chain id or name, e.g. 'ethereum', 'bsc'. */
  chain: string;
  /** ISO 8601 timestamp of when the profile was assembled. */
  timestamp: string;
  /** All merged signals, one per unique `key`. */
  signals: Signal[];
  /** Worst-case severity across signals (deterministic verdict). */
  overallRisk: Severity;
  /** Every source the pipeline attempted to query. */
  sourcesQueried: string[];
  /** Sources that failed, mapped to a short failure reason. */
  sourcesFailed: Record<string, string>;
}
