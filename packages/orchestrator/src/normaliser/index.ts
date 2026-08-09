import type { RawCollectorResult, Signal } from '../types/index.js';

/**
 * Normalisation layer (contract only — implemented in a later module).
 *
 * Turns one collector's raw, source-specific payload into zero or more signals
 * in the shared schema. It maps source fields → `Signal.key`, assigns
 * `status`/`severity`, and records provenance in `Signal.sources`.
 *
 * Module 0 defines the contract only — NO mapping logic here.
 */
export interface Normaliser {
  /** The source this normaliser understands. */
  readonly source: string;
  normalise(result: RawCollectorResult): Signal[];
}
