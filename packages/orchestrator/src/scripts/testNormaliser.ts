/**
 * Offline smoke test for the normaliser. Loads the archived raw JSONs for an
 * address from `data/{address}/` (populate them first with testCollectors /
 * testCollectors2 / testCodeChecker), normalises them, and prints the resulting
 * Signal[] grouped by key — highlighting keys carried by MORE THAN ONE source
 * (a preview of where the orchestrator will detect conflicts).
 *
 * Usage:
 *   npm run build
 *   node dist/src/scripts/testNormaliser.js [address]
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RawCollectorResult, Signal, SourceName } from '../types/index.js';
import { SOURCE_NAMES } from '../types/index.js';
import { loadConfig } from '../config/index.js';
import { normaliseDetailed } from '../normaliser/index.js';

/** USDC — has archives from earlier module tests. Override via argv. */
const DEFAULT_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

function isRawResult(value: unknown): value is RawCollectorResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { source?: unknown }).source === 'string' &&
    typeof (value as { ok?: unknown }).ok === 'boolean'
  );
}

/** Read one archived `{source}.json` as a RawCollectorResult, if present. */
async function loadResult(dir: string, source: SourceName): Promise<RawCollectorResult | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(resolve(dir, `${source}.json`), 'utf8'));
    return isRawResult(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
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

  console.log(`Address: ${address}`);
  console.log(`Loaded archives: ${results.map((r) => r.source).join(', ') || '(none)'}\n`);
  if (results.length === 0) {
    console.log('No archived raw data found. Run the collector test scripts first.');
    process.exitCode = 1;
    return;
  }

  const { signals, sourcesQueried, sourcesFailed } = normaliseDetailed(results);

  // Group signals by key (each carries one source at this stage).
  const byKey = new Map<string, Signal[]>();
  for (const signal of signals) {
    const list = byKey.get(signal.key) ?? [];
    list.push(signal);
    byKey.set(signal.key, list);
  }

  const keys = [...byKey.keys()].sort();
  for (const key of keys) {
    const list = byKey.get(key) ?? [];
    const multi = list.length > 1 ? '  <-- multi-source (conflict candidate)' : '';
    console.log(`${key}${multi}`);
    for (const s of list) {
      const evidence = s.evidence ? `  "${s.evidence.slice(0, 60)}"` : '';
      console.log(
        `    [${s.sources[0]}] status=${s.status} value=${String(s.value)} severity=${s.severity}${evidence}`,
      );
    }
  }

  const multiCount = keys.filter((k) => (byKey.get(k)?.length ?? 0) > 1).length;
  console.log(
    `\n${signals.length} signals across ${keys.length} keys ` +
      `(${multiCount} multi-source). queried=[${sourcesQueried.join(', ')}] ` +
      `failed=[${Object.keys(sourcesFailed).join(', ') || 'none'}]`,
  );
}

main().catch((err: unknown) => {
  console.error('testNormaliser crashed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
