/**
 * Canonical identifiers for the six data-collection sources.
 *
 * These strings are the single source of truth for every place a source is
 * named: `Collector.name`, `RawCollectorResult.source`, `Signal.sources`, and
 * the archive path (`{address}/{source}.json`). Centralising them here keeps
 * those references from drifting apart.
 *
 * NOTE: Etherscan is intentionally NOT a source. It is only used to fetch
 * verified source code for the code-level checker, so it never produces signals
 * of its own.
 */
export const SOURCES = {
  goplus: 'goplus',
  honeypotIs: 'honeypot_is',
  safeAnalyzer: 'safeanalyzer',
  dexScreener: 'dexscreener',
  lpLockReader: 'lp_lock_reader',
  codeLevelChecker: 'code_level_checker',
} as const;

/** A value that is one of the six canonical source ids. */
export type SourceName = (typeof SOURCES)[keyof typeof SOURCES];

/** The six source ids as a runtime array, in canonical pipeline order. */
export const SOURCE_NAMES: readonly SourceName[] = Object.values(SOURCES);
