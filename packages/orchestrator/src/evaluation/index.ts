import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RawCollectorResult, RiskProfile, Severity } from '../types/index.js';
import { SOURCE_NAMES } from '../types/index.js';
import { type AppConfig, loadConfig } from '../config/index.js';
import { createCollectors } from '../collectors/index.js';
import { archiveRiskProfile, buildRiskProfile } from '../orchestrator/index.js';
import { explainProfile } from '../conversation/index.js';
import { DEFAULT_LABELS_PATH, type LabelledToken, checkLabelIndependence, loadLabelledTokens } from './dataset.js';
import { FLAG_SEVERITIES, type LabelledPrediction, type Metrics, computeMetrics, predict } from './metrics.js';
import {
  type CitedSummary,
  type FaithfulnessCase,
  type FaithfulnessReport,
  aggregateFaithfulness,
  scoreFaithfulness,
} from './faithfulness.js';
import { type ConflictStats, type SourceAvailability, conflictStats, sourceAvailability } from './conflicts.js';

export * from './dataset.js';
export * from './metrics.js';
export * from './faithfulness.js';
export * from './conflicts.js';

/**
 * Legacy contract (Module 0) — retained so the package entry re-export
 * (`export type { Evaluator, EvaluationCase, EvaluationResult }`) stays valid.
 */
export interface EvaluationCase {
  address: string;
  chain: string;
  label: 'scam' | 'legit';
  expectedRisk?: Severity;
}
export interface EvaluationResult {
  case: EvaluationCase;
  profile: RiskProfile;
  passed: boolean;
}
export interface Evaluator {
  run(cases: EvaluationCase[]): Promise<EvaluationResult[]>;
}

/** Default size of the faithfulness subset (methodology: ~30 tokens). */
export const DEFAULT_FAITHFULNESS_SUBSET = 30;

/**
 * Default pause between tokens that actually HIT THE NETWORK, to respect
 * free-tier rate limits (the binding one is the LLM). 15s ≈ 4 tokens/min; set a
 * higher value (e.g. 20000) for a strict 3 RPM. Tokens served from the archive
 * add no delay. Override via `EvaluationOptions.delayMs` or `EVAL_DELAY_MS`.
 */
export const DEFAULT_EVAL_DELAY_MS = 15_000;

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

function resolveDelayMs(optionDelay: number | undefined): number {
  if (optionDelay !== undefined) return Math.max(0, optionDelay);
  const fromEnv = Number(process.env.EVAL_DELAY_MS);
  return Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : DEFAULT_EVAL_DELAY_MS;
}

/** Per-token progress event for CLI logging (fired as the run advances). */
export interface EvalProgressEvent {
  phase: 'profile' | 'faithfulness';
  index: number;
  total: number;
  address: string;
  /** True when this token hit the network (a live collect / LLM call). */
  hitNetwork: boolean;
  overallRisk?: Severity;
}

export interface EvaluationOptions {
  labelsPath?: string;
  faithfulnessSubset?: number;
  /** Pause (ms) between live tokens; 0 disables. Defaults to `EVAL_DELAY_MS` / 15s. */
  delayMs?: number;
  /** Optional callback fired after each token, for progress logging. */
  onProgress?: (event: EvalProgressEvent) => void;
  config?: AppConfig;
}

export interface PerTokenResult {
  address: string;
  label: 'scam' | 'legitimate';
  overallRisk: Severity;
  prediction: 'flagged' | 'not_flagged';
  /** True when the prediction matches the ground-truth label. */
  correct: boolean;
  /** Signal keys that fired at high/critical (the reason it was flagged). */
  highSignals: Array<{ key: string; severity: Severity }>;
  conflicts: string[];
}

export interface EvaluationResults {
  generatedAt: string;
  threshold: string;
  model: string;
  tokenCount: number;
  labelCounts: { scam: number; legitimate: number };
  metrics: Metrics;
  faithfulness: FaithfulnessReport;
  conflicts: ConflictStats;
  availability: SourceAvailability[];
  perToken: PerTokenResult[];
  /** Count of tokens at each overall-risk level (all tokens). */
  riskDistribution: Record<Severity, number>;
}

/* ── reproducibility helpers: archived-data-first loading ── */

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRiskProfile(value: unknown): value is RiskProfile {
  return (
    isRecord(value) &&
    typeof value.address === 'string' &&
    typeof value.overallRisk === 'string' &&
    Array.isArray(value.signals) &&
    Array.isArray(value.conflicts) &&
    Array.isArray(value.sourcesQueried)
  );
}

function isRawResult(value: unknown): value is RawCollectorResult {
  return isRecord(value) && typeof value.source === 'string' && typeof value.ok === 'boolean';
}

function isCitedSummary(value: unknown): value is CitedSummary {
  return isRecord(value) && typeof value.summary === 'string' && Array.isArray(value.citedKeys);
}

/** Load every archived `{source}.json` raw result for an address. */
async function loadArchivedRawResults(dir: string): Promise<RawCollectorResult[]> {
  const out: RawCollectorResult[] = [];
  for (const source of SOURCE_NAMES) {
    const parsed = await readJson(join(dir, `${source}.json`));
    if (isRawResult(parsed)) out.push(parsed);
  }
  return out;
}

/**
 * Resolve a token's profile, ARCHIVED-DATA-FIRST for reproducibility:
 *   1. an archived `risk_profile.json`,
 *   2. else rebuild from archived raw `{source}.json` files,
 *   3. else collect live (only for tokens not yet collected) and archive.
 */
async function loadOrBuildProfile(
  address: string,
  config: AppConfig,
): Promise<{ profile: RiskProfile; hitNetwork: boolean }> {
  const dir = resolve(config.archiveDir, address.toLowerCase());

  const archivedProfile = await readJson(join(dir, 'risk_profile.json'));
  if (isRiskProfile(archivedProfile)) return { profile: archivedProfile, hitNetwork: false };

  const archivedRaw = await loadArchivedRawResults(dir);
  if (archivedRaw.length > 0) {
    const profile = buildRiskProfile(address, archivedRaw);
    await archiveRiskProfile(profile, config.archiveDir);
    return { profile, hitNetwork: false };
  }

  const collectors = createCollectors();
  const results = await Promise.all(collectors.map((collector) => collector.collect(address)));
  const profile = buildRiskProfile(address, results);
  await archiveRiskProfile(profile, config.archiveDir);
  return { profile, hitNetwork: true };
}

/**
 * Cached-first cited summary for faithfulness (skips the LLM when unavailable).
 * Uses the CONVERSATION layer's grounded summary + citedKeys — the exact
 * explanation a user would receive — rather than a separate eval-only call.
 */
async function resolveCitedSummary(
  address: string,
  profile: RiskProfile,
  config: AppConfig,
): Promise<{ cited: CitedSummary | undefined; hitNetwork: boolean }> {
  const dir = resolve(config.archiveDir, address.toLowerCase());
  const cachePath = join(dir, 'eval_summary.json');

  const cached = await readJson(cachePath);
  if (isCitedSummary(cached)) return { cited: cached, hitNetwork: false };
  if (!config.openai.apiKey) return { cited: undefined, hitNetwork: false };

  try {
    const grounded = await explainProfile('summary', profile, '', [], config);
    const cited: CitedSummary = { summary: grounded.reply, citedKeys: grounded.citedKeys };
    await mkdir(dir, { recursive: true });
    await writeFile(cachePath, JSON.stringify(cited, null, 2), 'utf8');
    return { cited, hitNetwork: true };
  } catch {
    return { cited: undefined, hitNetwork: false };
  }
}

/**
 * Run the full evaluation over the labelled set. Archived-data-first, so a
 * re-run is byte-stable except for timestamps; the model is temperature 0.
 * Computes metrics only — no risk logic is touched here.
 */
export async function runEvaluation(options: EvaluationOptions = {}): Promise<EvaluationResults> {
  const config = options.config ?? loadConfig();
  const labelsPath = options.labelsPath ?? DEFAULT_LABELS_PATH;
  const subsetSize = options.faithfulnessSubset ?? DEFAULT_FAITHFULNESS_SUBSET;
  const delayMs = resolveDelayMs(options.delayMs);

  const tokens = await loadLabelledTokens(labelsPath);
  checkLabelIndependence(tokens);

  // Sequential, archived-first. Pause ONLY after a token that hit the network,
  // so the whole-list scan respects free-tier rate limits without wasting time
  // on cached tokens.
  const evaluated: Array<{ token: LabelledToken; profile: RiskProfile }> = [];
  for (const [i, token] of tokens.entries()) {
    const { profile, hitNetwork } = await loadOrBuildProfile(token.address, config);
    evaluated.push({ token, profile });
    options.onProgress?.({
      phase: 'profile',
      index: i + 1,
      total: tokens.length,
      address: token.address,
      hitNetwork,
      overallRisk: profile.overallRisk,
    });
    if (hitNetwork && delayMs > 0 && i < tokens.length - 1) await sleep(delayMs);
  }

  const predictions: LabelledPrediction[] = evaluated.map(({ token, profile }) => ({
    label: token.label,
    overallRisk: profile.overallRisk,
  }));
  const metrics = computeMetrics(predictions);

  const faithCases: FaithfulnessCase[] = [];
  const subset = evaluated.slice(0, subsetSize);
  for (const [i, { token, profile }] of subset.entries()) {
    const { cited, hitNetwork } = await resolveCitedSummary(token.address, profile, config);
    if (cited) faithCases.push(scoreFaithfulness(token.address, cited.citedKeys, profile));
    options.onProgress?.({
      phase: 'faithfulness',
      index: i + 1,
      total: subset.length,
      address: token.address,
      hitNetwork,
    });
    if (hitNetwork && delayMs > 0 && i < subset.length - 1) await sleep(delayMs);
  }
  const faithfulness = aggregateFaithfulness(faithCases);

  const profiles = evaluated.map((e) => e.profile);

  return {
    generatedAt: new Date().toISOString(),
    threshold: `${[...FLAG_SEVERITIES].join(' / ')} → flagged`,
    model: config.openai.model,
    tokenCount: tokens.length,
    labelCounts: {
      scam: tokens.filter((t) => t.label === 'scam').length,
      legitimate: tokens.filter((t) => t.label === 'legitimate').length,
    },
    metrics,
    faithfulness,
    conflicts: conflictStats(profiles),
    availability: sourceAvailability(profiles),
    perToken: evaluated.map(({ token, profile }) => {
      const prediction = predict(profile.overallRisk);
      return {
        address: token.address,
        label: token.label,
        overallRisk: profile.overallRisk,
        prediction,
        correct: (token.label === 'scam') === (prediction === 'flagged'),
        highSignals: profile.signals
          .filter((s) => s.severity === 'high' || s.severity === 'critical')
          .map((s) => ({ key: s.key, severity: s.severity })),
        conflicts: profile.conflicts,
      };
    }),
    riskDistribution: riskDistribution(profiles),
  };
}

/** Count tokens at each overall-risk level. */
function riskDistribution(profiles: RiskProfile[]): Record<Severity, number> {
  const dist: Record<Severity, number> = { none: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (const p of profiles) dist[p.overallRisk] += 1;
  return dist;
}

/* ── reporting ── */

function pct(x: number | null): string {
  return x === null ? 'N/A' : `${(x * 100).toFixed(1)}%`;
}
function dec(x: number | null, digits = 3): string {
  return x === null ? 'N/A' : x.toFixed(digits);
}

/** Render the human-readable Markdown report. */
export function renderReport(r: EvaluationResults): string {
  const c = r.metrics.confusion;
  const lines: string[] = [];

  lines.push('# Token Risk Assessment — Evaluation Report', '');
  lines.push(`- Generated: ${r.generatedAt}`);
  lines.push(`- Model: \`${r.model}\` (temperature 0)`);
  lines.push(`- Detection threshold: **${r.threshold}**`);
  lines.push(`- Tokens: **${r.tokenCount}** (scam ${r.labelCounts.scam} / legitimate ${r.labelCounts.legitimate})`, '');

  lines.push('## 1. Risk-detection metrics', '');
  lines.push('| | predicted flagged | predicted not |');
  lines.push('|---|---|---|');
  lines.push(`| **actual scam** | ${c.tp} (TP) | ${c.fn} (FN) |`);
  lines.push(`| **actual legitimate** | ${c.fp} (FP) | ${c.tn} (TN) |`, '');
  lines.push(`- Precision: **${dec(r.metrics.precision)}**`);
  lines.push(`- Recall: **${dec(r.metrics.recall)}**`);
  lines.push(`- F1: **${dec(r.metrics.f1)}**`);
  lines.push(`- Accuracy: **${dec(r.metrics.accuracy)}**`, '');

  lines.push(`## 2. Explanation faithfulness (n=${r.faithfulness.evaluated})`, '');
  lines.push(`- Mean faithfulness: **${dec(r.faithfulness.meanFaithfulness)}**`);
  if (r.faithfulness.unfaithfulCases.length === 0) {
    lines.push('- Unfaithful (hallucinated) mentions: none', '');
  } else {
    lines.push('- Unfaithful (hallucinated) mentions:');
    for (const u of r.faithfulness.unfaithfulCases) {
      lines.push(`  - ${u.address}: ${u.unfaithful.join(', ')}`);
    }
    lines.push('');
  }

  lines.push('## 3. Source conflicts (RQ3)', '');
  lines.push(`- Tokens with ≥1 conflict: **${r.conflicts.tokensWithConflict}/${r.conflicts.totalTokens}** (${pct(r.conflicts.conflictRate)})`);
  lines.push(`- Avg conflicts per token: **${dec(r.conflicts.avgConflictsPerToken)}**`, '');
  lines.push('Most-contested signals:');
  if (r.conflicts.perKey.length === 0) lines.push('- (none)');
  for (const k of r.conflicts.perKey) lines.push(`- ${k.key}: ${k.count}`);
  lines.push('', 'Most-disagreeing source pairs:');
  if (r.conflicts.perSourcePair.length === 0) lines.push('- (none)');
  for (const p of r.conflicts.perSourcePair) lines.push(`- ${p.pair}: ${p.count}`);
  lines.push('');

  lines.push('## 4. Source availability (RQ3)', '');
  lines.push('| source | queried | failed | contributed | failure rate | contribution rate |');
  lines.push('|---|---|---|---|---|---|');
  for (const a of r.availability) {
    lines.push(
      `| ${a.source} | ${a.queried} | ${a.failed} | ${a.contributed} | ${pct(a.failureRate)} | ${pct(a.contributionRate)} |`,
    );
  }
  lines.push('');

  return lines.join('\n');
}

const SEVERITY_RANK: Record<Severity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function signalList(highSignals: PerTokenResult['highSignals']): string {
  return highSignals.length === 0
    ? '—'
    : highSignals.map((s) => `${s.key} (${s.severity})`).join(', ');
}

/**
 * Companion detailed report (numbers only, no risk logic): a per-token table,
 * the false positives with their firing signals, the overall-risk distribution,
 * and the scam "closest calls". Renders from `EvaluationResults`.
 */
export function renderDetailReport(r: EvaluationResults): string {
  const lines: string[] = [];
  lines.push('# Evaluation — Detailed Results', '');
  lines.push(`- Generated: ${r.generatedAt}`);
  lines.push(`- Detection threshold: **${r.threshold}**`, '');

  // 1) Per-token table (scam first, then by descending risk).
  lines.push('## 1. Per-token results', '');
  lines.push('| address | label | overallRisk | flagged | correct |');
  lines.push('|---|---|---|---|---|');
  const ordered = [...r.perToken].sort(
    (a, b) =>
      a.label.localeCompare(b.label) ||
      SEVERITY_RANK[b.overallRisk] - SEVERITY_RANK[a.overallRisk],
  );
  for (const t of ordered) {
    const flagged = t.prediction === 'flagged' ? 'Y' : 'N';
    lines.push(
      `| \`${t.address}\` | ${t.label} | ${t.overallRisk} | ${flagged} | ${t.correct ? '✓' : '✗'} |`,
    );
  }
  lines.push('');

  // 2) False positives with the signals that fired high/critical.
  const fps = r.perToken.filter((t) => t.label === 'legitimate' && t.prediction === 'flagged');
  lines.push(`## 2. False positives (${fps.length}) — why each legitimate token was over-flagged`, '');
  for (const t of fps) {
    lines.push(`- \`${t.address}\` → **${t.overallRisk}** · high/critical: ${signalList(t.highSignals)}`);
  }
  if (fps.length === 0) lines.push('- (none)');
  lines.push('');

  // 3) Overall-risk distribution across all tokens.
  lines.push('## 3. Overall-risk distribution (all tokens)', '');
  lines.push('| overallRisk | count |');
  lines.push('|---|---|');
  const severities: Severity[] = ['none', 'low', 'medium', 'high', 'critical'];
  for (const sev of severities) lines.push(`| ${sev} | ${r.riskDistribution[sev]} |`);
  lines.push('');

  // 4) Scam recall + closest calls.
  const scams = r.perToken.filter((t) => t.label === 'scam');
  const missed = scams.filter((t) => t.prediction !== 'flagged');
  const flaggedScams = scams.filter((t) => t.prediction === 'flagged');
  lines.push('## 4. Scam recall — closest calls', '');
  lines.push(`- Scams: ${scams.length} · flagged: ${flaggedScams.length} · missed (FN): ${missed.length}`);
  if (missed.length === 0) lines.push('- ✓ All scams flagged (0 false negatives).');
  else for (const t of missed) lines.push(`- MISSED: \`${t.address}\` → ${t.overallRisk}`);
  lines.push('', 'Closest calls (lowest-severity scams that still flagged):');
  const closest = [...flaggedScams]
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.overallRisk] - SEVERITY_RANK[b.overallRisk] ||
        a.highSignals.length - b.highSignals.length,
    )
    .slice(0, 3);
  for (const t of closest) {
    lines.push(`- \`${t.address}\` → **${t.overallRisk}** · high/critical: ${signalList(t.highSignals)}`);
  }
  lines.push('');

  return lines.join('\n');
}
