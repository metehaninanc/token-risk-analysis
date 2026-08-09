import type { RawCollectorResult, SourceName } from '../types/index.js';

/**
 * Build a successful raw result. `raw` is stored untouched for reproducibility.
 */
export function okResult(
  source: SourceName,
  address: string,
  raw: unknown,
): RawCollectorResult {
  return {
    source,
    address,
    ok: true,
    raw,
    fetchedAt: new Date().toISOString(),
  };
}

/** Build a failed raw result carrying a short error reason. */
export function failResult(
  source: SourceName,
  address: string,
  error: string,
): RawCollectorResult {
  return {
    source,
    address,
    ok: false,
    raw: null,
    error,
    fetchedAt: new Date().toISOString(),
  };
}
