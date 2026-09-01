import type { Severity, Signal } from '../types/index.js';

/**
 * OVERALL-RISK AGGREGATION — one documented place, fully readable.
 *
 * Deterministic and rule-based: NO machine learning, NO averaging, NO weighting
 * learned from data. The overall risk is simply the HIGHEST severity present on
 * any single merged signal (a fail-safe maximum):
 *
 *   any `critical` signal → overall `critical`
 *   else any `high`       → overall `high`
 *   else any `medium`     → overall `medium`
 *   else any `low`        → overall `low`
 *   else                  → overall `none`
 *
 * This makes the path from raw signal to final verdict inspectable for any
 * token: the overall risk always traces to at least one concrete signal. A
 * single high-severity signal — even one that rests on a contested key — can
 * drive the overall verdict; `conflict`/`conflictDetail` are preserved on that
 * signal so the conversational layer can disclose that the verdict is contested.
 */

/** Total order over severities (higher number = worse). */
export const SEVERITY_ORDER: Record<Severity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** The worse of two severities. */
export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

/** The worst severity across a list of signals ('none' when empty). */
export function maxSeverityOf(signals: Signal[]): Severity {
  return signals.reduce<Severity>((worst, s) => maxSeverity(worst, s.severity), 'none');
}

/** Overall risk = the highest single-signal severity (see file header). */
export function aggregateOverallRisk(signals: Signal[]): Severity {
  return maxSeverityOf(signals);
}
