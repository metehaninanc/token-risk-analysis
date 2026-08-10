/**
 * Manual smoke test for the Module 2 additions: the LP-Lock collector, the
 * SafeAnalyzer collector, and the Etherscan verified-source fetcher. Runs all
 * three for one address, prints ok/error, and confirms each raw payload was
 * archived under `{ARCHIVE_DIR}/{address}/`.
 *
 * Usage (compile first, then run):
 *   npm run build
 *   node dist/src/scripts/testCollectors2.js [address]
 *
 * Default is the SafeAnalyzer docs example contract. Note: the LP-Lock check
 * needs the lp-lock-api service running at LP_LOCK_API_URL; if it is down the
 * collector fails gracefully ([error]), which is the expected behaviour.
 */
import { access, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../config/index.js';
import { LpLockReaderCollector } from '../collectors/lpLockReader.collector.js';
import { SafeAnalyzerCollector } from '../collectors/safeAnalyzer.collector.js';
import { fetchVerifiedSource } from '../utils/etherscanSource.js';

/** SafeAnalyzer docs example contract; override via argv. */
const DEFAULT_ADDRESS = '0x71823B57de5898957d763D2A92A1571fCb0d6B44';

/** Report whether an archive file exists and its size. */
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
  const file = (name: string): string =>
    resolve(config.archiveDir, address.toLowerCase(), name);

  console.log(`Address:     ${address}`);
  console.log(`Archive dir: ${resolve(config.archiveDir)}\n`);

  let failures = 0;

  // 1) LP-Lock collector
  const lp = new LpLockReaderCollector(config);
  const lpRes = await lp.collect(address);
  if (lpRes.ok) {
    console.log(`[ok]    ${lp.name}: ${await archiveStatus(file(`${lp.name}.json`))}`);
  } else {
    failures += 1;
    console.log(`[error] ${lp.name}: ${lpRes.error}`);
  }

  // 2) SafeAnalyzer collector
  const sa = new SafeAnalyzerCollector(config);
  const saRes = await sa.collect(address);
  if (saRes.ok) {
    console.log(`[ok]    ${sa.name}: ${await archiveStatus(file(`${sa.name}.json`))}`);
  } else {
    failures += 1;
    console.log(`[error] ${sa.name}: ${saRes.error}`);
  }

  // 3) Etherscan verified-source fetcher (utility, not a collector)
  const es = await fetchVerifiedSource(address, config);
  if (es.ok) {
    console.log(
      `[ok]    etherscan_source: verified=${es.verified} ` +
        `name=${es.contractName || '-'} (${es.sourceCode.length} src chars) ` +
        `${await archiveStatus(file('etherscan_source.json'))}`,
    );
  } else {
    failures += 1;
    console.log(`[error] etherscan_source: ${es.error}`);
  }

  const total = 3;
  console.log(`\n${total - failures}/${total} ok.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  console.error('testCollectors2 crashed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
