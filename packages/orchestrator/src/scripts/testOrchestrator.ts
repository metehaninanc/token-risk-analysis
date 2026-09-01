/**
 * Offline smoke test for the orchestrator. Loads the archived raw JSONs for an
 * address from `data/{address}/`, builds the risk profile, archives it to
 * `data/{address}/risk_profile.json`, and prints: merged signals grouped by
 * group, every conflict with its `conflictDetail`, sources queried/failed, and
 * the overall risk.
 *
 * Usage:
 *   npm run build
 *   node dist/src/scripts/testOrchestrator.js [address]
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RawCollectorResult, Signal, SignalGroup, SourceName } from '../types/index.js';
import { SOURCE_NAMES } from '../types/index.js';
import { loadConfig } from '../config/index.js';
import { archiveRiskProfile, buildRiskProfile } from '../orchestrator/index.js';

/** USDC — has archives from earlier module tests. Override via argv. */
const DEFAULT_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const GROUPS: SignalGroup[] = ['contract', 'holder', 'liquidity'];

function isRawResult(value: unknown): value is RawCollectorResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { source?: unknown }).source === 'string' &&
    typeof (value as { ok?: unknown }).ok === 'boolean'
  );
}

async function loadResult(dir: string, source: SourceName): Promise<RawCollectorResult | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(resolve(dir, `${source}.json`), 'utf8'));
    return isRawResult(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function printSignal(s: Signal): void {
  const flag = s.conflict ? ' [CONFLICT]' : '';
  const evidence = s.evidence ? `\n        ${s.evidence}` : '';
  console.log(
    `  ${s.key.padEnd(24)} ${s.status.padEnd(13)} ${String(s.value).padEnd(12)} ` +
      `${s.severity.padEnd(9)} {${s.sources.join(', ')}}${flag}${evidence}`,
  );
}

async function main(): Promise<void> {
  const address = process.argv[2] ?? DEFAULT_ADDRESS;
  const config = loadConfig();
  const dir = resolve(config.archiveDir, address.toLowerCase());

  const results: RawCollectorResult[] = [];
  for (const source of SOURCE_NAMES) {
    const result = await loadResult(dir, source);
    if (result) results.push(result);
  }

  if (results.length === 0) {
    console.log('No archived raw data found. Run the collector test scripts first.');
    process.exitCode = 1;
    return;
  }

  const profile = buildRiskProfile(address, results);
  const archivedTo = await archiveRiskProfile(profile, config.archiveDir);

  console.log(`Address:       ${profile.address}`);
  console.log(`Overall risk:  ${profile.overallRisk.toUpperCase()}`);
  console.log(`Queried:       [${profile.sourcesQueried.join(', ')}]`);
  console.log(
    `Failed:        [${Object.entries(profile.sourcesFailed)
      .map(([s, e]) => `${s}: ${e}`)
      .join('; ') || 'none'}]`,
  );
  console.log(`Conflicts:     [${profile.conflicts.join(', ') || 'none'}]\n`);

  for (const group of GROUPS) {
    const inGroup = profile.signals.filter((s) => s.group === group);
    if (inGroup.length === 0) continue;
    console.log(`── ${group} ──`);
    for (const s of inGroup) printSignal(s);
    console.log('');
  }

  if (profile.conflicts.length > 0) {
    console.log(`── conflicts (${profile.conflicts.length}) ──`);
    for (const key of profile.conflicts) {
      const signal = profile.signals.find((s) => s.key === key);
      console.log(`  ${key}: resolved → ${signal?.status} (${signal?.severity})`);
      for (const detail of signal?.conflictDetail ?? []) {
        console.log(`      ${detail.source} = ${String(detail.value)} (${detail.severity})`);
      }
    }
    console.log('');
  }

  console.log(`Archived profile → ${archivedTo}`);
}

main().catch((err: unknown) => {
  console.error('testOrchestrator crashed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
