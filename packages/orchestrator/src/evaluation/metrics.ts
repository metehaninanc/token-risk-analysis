import type { Severity } from '../types/index.js';

/**
 * DETECTION THRESHOLD — one documented place (methodology 3.6).
 *
 * The deterministic `overallRisk` is mapped to a binary prediction: an overall
 * risk of `high` or `critical` counts as a positive detection ("scam / high
 * risk"); anything lower is "not flagged". Adjust here to move the operating
 * point; nothing else in the harness hard-codes the threshold.
 */
export const FLAG_SEVERITIES: ReadonlySet<Severity> = new Set<Severity>(['high', 'critical']);

export type Prediction = 'flagged' | 'not_flagged';

/** Map a deterministic overall risk to a binary prediction. */
export function predict(overallRisk: Severity): Prediction {
  return FLAG_SEVERITIES.has(overallRisk) ? 'flagged' : 'not_flagged';
}

/** One labelled prediction: ground-truth label + the system's overall risk. */
export interface LabelledPrediction {
  label: 'scam' | 'legitimate';
  overallRisk: Severity;
}

export interface ConfusionMatrix {
  /** scam correctly flagged. */
  tp: number;
  /** legitimate wrongly flagged. */
  fp: number;
  /** scam missed. */
  fn: number;
  /** legitimate correctly not flagged. */
  tn: number;
}

export interface Metrics {
  confusion: ConfusionMatrix;
  /** `null` = undefined (division by zero), reported as N/A rather than NaN. */
  precision: number | null;
  recall: number | null;
  f1: number | null;
  accuracy: number | null;
  total: number;
}

/** Build the confusion matrix from labelled predictions. */
export function confusionMatrix(items: LabelledPrediction[]): ConfusionMatrix {
  const c: ConfusionMatrix = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const item of items) {
    const flagged = predict(item.overallRisk) === 'flagged';
    if (item.label === 'scam') {
      if (flagged) c.tp += 1;
      else c.fn += 1;
    } else {
      if (flagged) c.fp += 1;
      else c.tn += 1;
    }
  }
  return c;
}

/** Safe ratio: returns `null` when the denominator is 0 (never NaN). */
function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * Precision, recall, F1, accuracy (methodology 3.6). Division by zero is
 * reported as `null` (→ "N/A"), never NaN.
 */
export function computeMetrics(items: LabelledPrediction[]): Metrics {
  const c = confusionMatrix(items);
  const precision = ratio(c.tp, c.tp + c.fp);
  const recall = ratio(c.tp, c.tp + c.fn);
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;
  const total = c.tp + c.fp + c.fn + c.tn;
  const accuracy = ratio(c.tp + c.tn, total);
  return { confusion: c, precision, recall, f1, accuracy, total };
}
