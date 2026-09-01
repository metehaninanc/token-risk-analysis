import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RawCollectorResult, RiskProfile } from '../types/index.js';
import { normaliseDetailed } from '../normaliser/index.js';
import { aggregateOverallRisk } from './aggregate.js';
import { mergeSignals } from './merge.js';
import { applyContext, isRenounced } from './context.js';

export { aggregateOverallRisk, SEVERITY_ORDER, maxSeverity } from './aggregate.js';
export { mergeSignals } from './merge.js';
export { applyContext, isRenounced } from './context.js';
export type { MergeOutcome } from './merge.js';

/**
 * Legacy contract from Module 0. `buildRiskProfile` is the concrete
 * implementation; these interfaces are retained so the package entry point's
 * re-export (`export type { Orchestrator, OrchestratorInput }`) stays valid.
 */
export interface OrchestratorInput {
  address: string;
  chain: string;
  results: RawCollectorResult[];
}
export interface Orchestrator {
  buildProfile(input: OrchestratorInput): RiskProfile;
}

/**
 * Build one deterministic risk profile from raw collector results.
 *
 * Pure function: normalise → merge by key (resolving conflicts fail-safe) →
 * aggregate the overall risk. Same input ⇒ same output (the only non-analytical
 * field is `timestamp`, which can be pinned via `now` for reproducible tests).
 * Does NO I/O — archive the result separately with `archiveRiskProfile`.
 */
export function buildRiskProfile(
  address: string,
  results: RawCollectorResult[],
  now: string = new Date().toISOString(),
): RiskProfile {
  const { signals, sourcesQueried, sourcesFailed } = normaliseDetailed(results);
  const { merged, conflictKeys } = mergeSignals(signals);
  // Contextual pass (§3.3/§3.4): renounce neutralisation + GoPlus-only cap.
  const contextual = applyContext(merged, signals, isRenounced(signals));
  const overallRisk = aggregateOverallRisk(contextual);

  return {
    address,
    chain: 'ethereum',
    timestamp: now,
    signals: contextual,
    overallRisk,
    sourcesQueried,
    sourcesFailed,
    conflicts: conflictKeys,
  };
}

/** Archive a built profile to `data/{address}/risk_profile.json` (reproducibility). */
export async function archiveRiskProfile(
  profile: RiskProfile,
  archiveDir: string,
): Promise<string> {
  const dir = resolve(archiveDir, profile.address.toLowerCase());
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'risk_profile.json');
  await writeFile(path, JSON.stringify(profile, null, 2), 'utf8');
  return path;
}
