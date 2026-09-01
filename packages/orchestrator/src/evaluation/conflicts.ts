import type { ConflictDetail, RiskProfile, Signal } from '../types/index.js';
import { SOURCE_NAMES } from '../types/index.js';

/**
 * CONFLICT & AVAILABILITY STATISTICS (RQ3).
 *
 * Empirical evidence for "the limits of relying on automated security APIs":
 * how often sources disagree, on which signals, between which source pairs, and
 * how often each source is simply unavailable. Computed purely from the profiles
 * — no risk logic here.
 */

export interface ConflictStats {
  totalTokens: number;
  tokensWithConflict: number;
  /** Fraction of tokens with >=1 conflict (null if no tokens). */
  conflictRate: number | null;
  avgConflictsPerToken: number | null;
  /** Which signal keys disagreed most, descending. */
  perKey: Array<{ key: string; count: number }>;
  /** Which source pairs disagreed most, descending. */
  perSourcePair: Array<{ pair: string; count: number }>;
}

export interface SourceAvailability {
  source: string;
  /** Tokens where this source was queried. */
  queried: number;
  /** Tokens where the collector failed. */
  failed: number;
  /** Tokens where it contributed at least one merged signal. */
  contributed: number;
  failureRate: number | null;
  contributionRate: number | null;
}

/** Do two conflictDetail entries actually disagree (differ in severity or value)? */
function entriesDisagree(a: ConflictDetail, b: ConflictDetail): boolean {
  return a.severity !== b.severity || a.value !== b.value;
}

/** Unordered "src1 vs src2" label with a stable order. */
function pairLabel(a: string, b: string): string {
  return a <= b ? `${a} vs ${b}` : `${b} vs ${a}`;
}

function sortedCounts(counts: Map<string, number>): Array<{ key: string; count: number }> {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((x, y) => y.count - x.count || x.key.localeCompare(y.key));
}

/** Aggregate conflict statistics across the evaluation set. */
export function conflictStats(profiles: RiskProfile[]): ConflictStats {
  const totalTokens = profiles.length;
  let tokensWithConflict = 0;
  let totalConflicts = 0;
  const perKey = new Map<string, number>();
  const perPair = new Map<string, number>();

  for (const profile of profiles) {
    if (profile.conflicts.length > 0) tokensWithConflict += 1;
    totalConflicts += profile.conflicts.length;

    for (const key of profile.conflicts) {
      perKey.set(key, (perKey.get(key) ?? 0) + 1);
    }

    for (const signal of profile.signals) {
      if (!signal.conflict || !signal.conflictDetail) continue;
      const detail = signal.conflictDetail;
      for (let i = 0; i < detail.length; i += 1) {
        for (let j = i + 1; j < detail.length; j += 1) {
          const a = detail[i];
          const b = detail[j];
          if (a && b && entriesDisagree(a, b)) {
            const label = pairLabel(a.source, b.source);
            perPair.set(label, (perPair.get(label) ?? 0) + 1);
          }
        }
      }
    }
  }

  return {
    totalTokens,
    tokensWithConflict,
    conflictRate: totalTokens === 0 ? null : tokensWithConflict / totalTokens,
    avgConflictsPerToken: totalTokens === 0 ? null : totalConflicts / totalTokens,
    perKey: sortedCounts(perKey),
    perSourcePair: sortedCounts(perPair).map(({ key, count }) => ({ pair: key, count })),
  };
}

/** Union of sources that contributed any merged signal in a profile. */
function contributingSources(signals: Signal[]): Set<string> {
  const set = new Set<string>();
  for (const signal of signals) for (const source of signal.sources) set.add(source);
  return set;
}

/** Per-source availability across the evaluation set. */
export function sourceAvailability(profiles: RiskProfile[]): SourceAvailability[] {
  const queried = new Map<string, number>();
  const failed = new Map<string, number>();
  const contributed = new Map<string, number>();

  for (const profile of profiles) {
    for (const source of profile.sourcesQueried) {
      queried.set(source, (queried.get(source) ?? 0) + 1);
    }
    for (const source of Object.keys(profile.sourcesFailed)) {
      failed.set(source, (failed.get(source) ?? 0) + 1);
    }
    for (const source of contributingSources(profile.signals)) {
      contributed.set(source, (contributed.get(source) ?? 0) + 1);
    }
  }

  return SOURCE_NAMES.map((source) => {
    const q = queried.get(source) ?? 0;
    const f = failed.get(source) ?? 0;
    const c = contributed.get(source) ?? 0;
    return {
      source,
      queried: q,
      failed: f,
      contributed: c,
      failureRate: q === 0 ? null : f / q,
      contributionRate: q === 0 ? null : c / q,
    };
  });
}
