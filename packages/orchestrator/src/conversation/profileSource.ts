import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AppConfig } from '../config/index.js';
import type { RawCollectorResult, RiskProfile } from '../types/index.js';
import { createCollectors } from '../collectors/index.js';
import { archiveRiskProfile, buildRiskProfile } from '../orchestrator/index.js';

/** Minimal structural check that a parsed object is a `RiskProfile`. */
function isRiskProfile(value: unknown): value is RiskProfile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.address === 'string' &&
    typeof v.chain === 'string' &&
    typeof v.overallRisk === 'string' &&
    Array.isArray(v.signals) &&
    Array.isArray(v.conflicts) &&
    Array.isArray(v.sourcesQueried) &&
    typeof v.sourcesFailed === 'object' &&
    v.sourcesFailed !== null
  );
}

/** Load a previously archived profile, or undefined if none/invalid. */
async function loadArchivedProfile(
  address: string,
  archiveDir: string,
): Promise<RiskProfile | undefined> {
  try {
    const path = resolve(archiveDir, address.toLowerCase(), 'risk_profile.json');
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return isRiskProfile(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the `RiskProfile` for an address.
 *
 * Prefers an archived `data/{address}/risk_profile.json` (so the chat can be
 * demoed OFFLINE on already-collected tokens). If none exists, runs the full
 * pipeline live — all six collectors → `buildRiskProfile` — and archives it.
 * The conversational layer never recomputes risk; it only consumes this profile.
 */
export async function resolveProfile(address: string, config: AppConfig): Promise<RiskProfile> {
  const archived = await loadArchivedProfile(address, config.archiveDir);
  if (archived) return archived;

  const collectors = createCollectors();
  const results: RawCollectorResult[] = await Promise.all(
    collectors.map((collector) => collector.collect(address)),
  );
  const profile = buildRiskProfile(address, results);
  await archiveRiskProfile(profile, config.archiveDir);
  return profile;
}
