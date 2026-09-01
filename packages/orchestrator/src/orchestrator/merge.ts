import type { ConflictDetail, Severity, Signal, SignalStatus } from '../types/index.js';
import { SOURCE_NAMES } from '../types/index.js';
import { SEVERITY_ORDER, maxSeverityOf } from './aggregate.js';

type SignalValue = Signal['value'];

/**
 * CONDITIONAL-MEANING NOTES — keys whose surface reading overstates safety.
 *
 * A locked/burned LP lowers ONE specific risk (immediate withdrawal / rug) but
 * is not a safety guarantee. We attach the qualification to the merged signal's
 * `evidence` so the conversational layer can pass on the nuance rather than
 * presenting "LP locked" as blanket safety.
 */
const INTERPRETATIONS: Record<string, string> = {
  lp_locked:
    'note: a locked or burned LP reduces immediate-withdrawal (rug) risk only — it is not a safety guarantee',
};

/** Output of merging: the merged signals plus the keys that ended up contested. */
export interface MergeOutcome {
  merged: Signal[];
  conflictKeys: string[];
}

/**
 * MERGE — one merged `Signal` per canonical key (the core contribution).
 *
 * For each key we gather every source's signal and produce a single merged one:
 *
 *  • `sources`  = union of all contributing source ids (cross-validation record).
 *  • Agreement  = all DETERMINED signals (present/absent) share the same `status`
 *                 AND the same `severity`. The severity band boundaries defined in
 *                 severity.ts ARE the documented numeric tolerance: two values in
 *                 the same band (e.g. two ~0% taxes) agree; values that cross a
 *                 band (5% vs 30%) do not. Agreement keeps `conflict` unset and
 *                 records that N sources concur — this is CONFIDENCE, not a
 *                 changed verdict.
 *  • Conflict   = determined signals disagree on status or severity. Then we set
 *                 `conflict: true`, list every source in `conflictDetail`, and
 *                 resolve CONSERVATIVELY: the merged severity is the HIGHEST among
 *                 the contributing signals and the merged status/value take the
 *                 higher-risk reading — never an average, never a majority vote.
 *
 * Fail-safe rationale (methodology §3.4): the cost of errors is asymmetric. For a
 * user deciding whether to buy, a MISSED real risk is worse than a false alarm,
 * so a contested key resolves to its worst plausible reading while preserving the
 * full per-source detail for later disclosure.
 *
 * `undetermined` signals never trigger a conflict (they are "no opinion"); they
 * still join the `sources` union and appear in `conflictDetail` when one exists.
 */
export function mergeSignals(signals: Signal[]): MergeOutcome {
  const groups = new Map<string, Signal[]>();
  for (const signal of signals) {
    const list = groups.get(signal.key);
    if (list) list.push(signal);
    else groups.set(signal.key, [signal]);
  }

  const merged: Signal[] = [];
  const conflictKeys: string[] = [];
  for (const [key, group] of groups) {
    const mergedSignal = mergeGroup(key, group);
    merged.push(mergedSignal);
    if (mergedSignal.conflict) conflictKeys.push(key);
  }

  return { merged, conflictKeys };
}

/** Merge all signals that share one key into a single signal. */
function mergeGroup(key: string, group: Signal[]): Signal {
  const sources = unionSources(group);
  const determined = group.filter((s) => s.status !== 'undetermined');

  let status: SignalStatus;
  let value: SignalValue;
  let severity: Severity;
  let conflict = false;
  let conflictDetail: ConflictDetail[] | undefined;

  if (determined.length === 0) {
    // Every source was undetermined → merged stays undetermined.
    const rep = representative(group);
    status = 'undetermined';
    value = rep.value;
    severity = maxSeverityOf(group);
  } else if (agree(determined)) {
    // All determined sources concur → higher confidence, same verdict.
    const rep = representative(determined);
    status = rep.status;
    value = rep.value;
    severity = maxSeverityOf(determined);
  } else {
    // Sources disagree → contested; resolve to the worst reading (fail-safe).
    const rep = representative(group);
    status = rep.status;
    value = rep.value;
    severity = maxSeverityOf(group);
    conflict = true;
    conflictDetail = group.map((s) => ({
      source: s.sources[0] ?? 'unknown',
      value: s.value,
      severity: s.severity,
    }));
  }

  const mergedSignal: Signal = {
    key,
    group: group[0]?.group ?? 'contract',
    status,
    value,
    severity,
    sources,
  };
  if (conflict) mergedSignal.conflict = true;
  if (conflictDetail) mergedSignal.conflictDetail = conflictDetail;
  const evidence = buildEvidence(key, group, conflict);
  if (evidence) mergedSignal.evidence = evidence;

  return mergedSignal;
}

/** Determined signals agree iff they share the same status AND severity. */
function agree(determined: Signal[]): boolean {
  const first = determined[0];
  if (!first) return true;
  return determined.every((s) => s.status === first.status && s.severity === first.severity);
}

/**
 * The "representative" signal: highest severity wins (the fail-safe reading);
 * ties break by source priority (canonical `SOURCE_NAMES` order), then input
 * order — so the result is fully deterministic.
 */
function representative(signals: Signal[]): Signal {
  let best = signals[0];
  if (!best) throw new Error('representative() called on empty group');
  for (const s of signals) {
    if (s === best) continue;
    const bySeverity = SEVERITY_ORDER[s.severity] - SEVERITY_ORDER[best.severity];
    if (bySeverity > 0 || (bySeverity === 0 && sourceRank(s) < sourceRank(best))) {
      best = s;
    }
  }
  return best;
}

function sourceRank(signal: Signal): number {
  const source = signal.sources[0];
  const rank = source ? (SOURCE_NAMES as readonly string[]).indexOf(source) : -1;
  return rank === -1 ? SOURCE_NAMES.length : rank;
}

/** Union of contributing source ids, de-duplicated, order-preserving. */
function unionSources(group: Signal[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const signal of group) {
    for (const source of signal.sources) {
      if (!seen.has(source)) {
        seen.add(source);
        out.push(source);
      }
    }
  }
  return out;
}

function formatValue(value: SignalValue): string {
  return value === null ? 'n/a' : String(value);
}

/** Human-readable `evidence`: agreement/conflict summary + interpretation note. */
function buildEvidence(key: string, group: Signal[], conflict: boolean): string {
  const parts: string[] = [];

  if (conflict) {
    const detail = group
      .map((s) => `${s.sources[0] ?? '?'}=${formatValue(s.value)} (${s.severity})`)
      .join(', ');
    parts.push(`contested — sources disagree: ${detail}`);
  } else {
    const determined = group.filter((s) => s.status !== 'undetermined');
    const rep = representative(determined.length > 0 ? determined : group);
    if (rep.evidence) parts.push(rep.evidence);
    const n = unionSources(group).length;
    if (n > 1) parts.push(`${n} sources agree`);
  }

  const note = INTERPRETATIONS[key];
  if (note) parts.push(note);

  return parts.join(' — ');
}
