import type { RawCollectorResult, Signal, SourceName } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { normaliseGoPlus } from './goplus.normaliser.js';
import { normaliseHoneypotIs } from './honeypotIs.normaliser.js';
import { normaliseDexScreener } from './dexScreener.normaliser.js';
import { normaliseSafeAnalyzer } from './safeAnalyzer.normaliser.js';
import { normaliseLpLock } from './lpLock.normaliser.js';
import { normaliseCodeChecker } from './codeChecker.normaliser.js';

export * from './keys.js';
export { severityFor } from './severity.js';

/**
 * Legacy per-source contract (from Module 0). The concrete normalisers are the
 * pure functions in `NORMALISERS`; this interface is kept so the package entry
 * point's re-export stays valid.
 */
export interface Normaliser {
  readonly source: string;
  normalise(result: RawCollectorResult): Signal[];
}

/** One pure normaliser per source: raw payload → Signal[] (single source each). */
const NORMALISERS: Record<SourceName, (raw: unknown) => Signal[]> = {
  [SOURCES.goplus]: normaliseGoPlus,
  [SOURCES.honeypotIs]: normaliseHoneypotIs,
  [SOURCES.dexScreener]: normaliseDexScreener,
  [SOURCES.safeAnalyzer]: normaliseSafeAnalyzer,
  [SOURCES.lpLockReader]: normaliseLpLock,
  [SOURCES.codeLevelChecker]: normaliseCodeChecker,
};

/** Flattened signals plus provenance for `RiskProfile.sourcesQueried/Failed`. */
export interface NormalisationReport {
  signals: Signal[];
  /** Every source id seen in the input batch. */
  sourcesQueried: string[];
  /** Sources skipped because their collector failed, mapped to the reason. */
  sourcesFailed: Record<string, string>;
}

/**
 * Normalise every collector result into ONE flat `Signal[]`.
 * Does NOT merge across sources or compute overall risk — that is the
 * orchestrator. At this stage each Signal carries a single source.
 */
export function normalise(results: RawCollectorResult[]): Signal[] {
  return normaliseDetailed(results).signals;
}

/** Like `normalise`, but also reports which sources produced/were skipped. */
export function normaliseDetailed(results: RawCollectorResult[]): NormalisationReport {
  const signals: Signal[] = [];
  const sourcesQueried: string[] = [];
  const sourcesFailed: Record<string, string> = {};

  for (const result of results) {
    sourcesQueried.push(result.source);
    if (!result.ok) {
      sourcesFailed[result.source] = result.error ?? 'unknown error';
      continue; // failed collector → emit no signals
    }
    signals.push(...NORMALISERS[result.source](result.raw));
  }

  return { signals, sourcesQueried, sourcesFailed };
}
