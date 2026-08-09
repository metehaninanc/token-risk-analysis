/**
 * The SHARED SIGNAL SCHEMA.
 *
 * Every collector's raw output is normalised into an array of `Signal` objects
 * with the exact shape defined here. This is the one contract that the
 * normaliser, orchestrator, conversation, and evaluation layers all build on,
 * so it must stay stable and fully typed.
 */

/** How dangerous a signal is. `none` means "checked and benign". */
export type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical';

/**
 * Whether the signal's condition holds.
 * `undetermined` is used when a source has no data for this key — it is NOT the
 * same as `absent` (checked and not present).
 */
export type SignalStatus = 'present' | 'absent' | 'undetermined';

/** The risk dimension a signal belongs to. */
export type SignalGroup = 'contract' | 'holder' | 'liquidity';

/** One source's disagreeing view on a signal key, kept for auditability. */
export interface ConflictDetail {
  source: string;
  value: unknown;
  severity: Severity;
}

/** A single normalised risk signal, merged across sources by `key`. */
export interface Signal {
  /** Stable signal id, e.g. 'mint_authority', 'lp_locked', 'honeypot'. */
  key: string;
  group: SignalGroup;
  /** `undetermined` when no source had data for this key. */
  status: SignalStatus;
  value: string | number | boolean | null;
  severity: Severity;
  /** Which collectors produced this signal, e.g. ['goplus','safeanalyzer']. */
  sources: string[];
  /** Function name, snippet, or short human-readable reason. */
  evidence?: string;
  /** True if sources disagreed on this key. */
  conflict?: boolean;
  /** Per-source values when `conflict` is true. */
  conflictDetail?: ConflictDetail[];
}
