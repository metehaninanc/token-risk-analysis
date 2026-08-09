import type { SourceName } from './sources.js';

/**
 * The raw, untouched result of a single collector call.
 *
 * `raw` is kept exactly as the source returned it so every evaluation run is
 * reproducible and archivable — no normalisation happens at this layer. The
 * `ok` flag plus optional `error` capture success/failure without throwing.
 *
 * @typeParam TRaw - shape of the source's raw payload (defaults to `unknown`,
 *   never `any`, so downstream code must narrow before use).
 */
export interface RawCollectorResult<TRaw = unknown> {
  /** Which collector produced this result. */
  source: SourceName;
  /** The token contract address that was queried (as passed in). */
  address: string;
  /** True on success, false on failure. */
  ok: boolean;
  /** The untouched source response, or null when the call failed. */
  raw: TRaw | null;
  /** Present only when `ok` is false. */
  error?: string;
  /** ISO 8601 timestamp of when the call completed. */
  fetchedAt: string;
}

/**
 * The interface every one of the six collectors implements.
 * A collector takes a token contract address and returns raw data only.
 */
export interface Collector {
  /** Canonical source id — see `SOURCES`. */
  readonly name: SourceName;
  collect(address: string): Promise<RawCollectorResult>;
}
