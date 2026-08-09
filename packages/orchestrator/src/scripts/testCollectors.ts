/**
 * Manual smoke test for the Module 1 HTTP collectors (GoPlus, honeypot.is,
 * DexScreener). Fetches real data for one address, prints ok/error per source,
 * and confirms each raw payload was archived to
 * `{ARCHIVE_DIR}/{address}/{source}.json`.
 *
 * Usage (compile first, then run):
 *   npm run build
 *   node dist/src/scripts/testCollectors.js [address]
 *
 * Defaults to USDC, a well-known legitimate Ethereum token. Known SCAM
 * addresses will be added here as a labelled set for evaluation in a later
 * module — for now this only exercises the fetch + archive path.
 */
import { access, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Collector } from '../types/index.js';
import { loadConfig } from '../config/index.js';
import { GoPlusCollector } from '../collectors/goplus.collector.js';
import { HoneypotIsCollector } from '../collectors/honeypotIs.collector.js';
import { DexScreenerCollector } from '../collectors/dexScreener.collector.js';

/** USDC — well-known, legitimate. Scam addresses added later for evaluation. */
const DEFAULT_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

/** Report whether the archive file exists and its size. */
async function archiveStatus(path: string): Promise<string> {
  try {
    await access(path);
    const { size } = await stat(path);
    return `archived (${size} bytes)`;
  } catch {
    return 'NOT archived';
  }
}

async function main(): Promise<void> {
  const address = process.argv[2] ?? DEFAULT_ADDRESS;
  const config = loadConfig();

  const collectors: Collector[] = [
    new GoPlusCollector(config),
    new HoneypotIsCollector(config),
    new DexScreenerCollector(config),
  ];

  console.log(`Address:     ${address}`);
  console.log(`Archive dir: ${resolve(config.archiveDir)}\n`);

  let failures = 0;

  for (const collector of collectors) {
    const result = await collector.collect(address);
    const archivePath = resolve(
      config.archiveDir,
      address.toLowerCase(),
      `${collector.name}.json`,
    );

    if (result.ok) {
      console.log(`[ok]    ${collector.name}: ${await archiveStatus(archivePath)}`);
    } else {
      failures += 1;
      console.log(`[error] ${collector.name}: ${result.error}`);
    }
  }

  console.log(`\n${collectors.length - failures}/${collectors.length} collectors ok.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error('testCollectors crashed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
