/**
 * Manual smoke test for the LLM Code-Level Checker. Runs the checker for one
 * address and prints the five observations (or the undetermined / error state).
 *
 * Usage (compile first, then run):
 *   npm run build
 *   node dist/src/scripts/testCodeChecker.js [address]
 *
 * Default is WETH — a verified, well-known token with no owner, so most checks
 * should come back `absent`/`undetermined` (a clean baseline). Needs
 * OPENAI_API_KEY and ETHERSCAN_KEY configured.
 */
import { loadConfig } from '../config/index.js';
import {
  type CodeCheckerRaw,
  CodeLevelCheckerCollector,
} from '../collectors/codeLevelChecker.collector.js';

/** WETH — verified, well-known, ownerless. Override via argv. */
const DEFAULT_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

function isCodeCheckerRaw(raw: unknown): raw is CodeCheckerRaw {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as { verified?: unknown }).verified === 'boolean' &&
    Array.isArray((raw as { checks?: unknown }).checks)
  );
}

async function main(): Promise<void> {
  const address = process.argv[2] ?? DEFAULT_ADDRESS;
  const config = loadConfig();
  const checker = new CodeLevelCheckerCollector(config);

  console.log(`Address: ${address}\n`);
  const result = await checker.collect(address);

  if (!result.ok) {
    console.log(`[error] ${result.source}: ${result.error}`);
    process.exitCode = 1;
    return;
  }

  const raw = result.raw;
  if (!isCodeCheckerRaw(raw)) {
    console.log(`[error] ${result.source}: unexpected raw shape`);
    process.exitCode = 1;
    return;
  }

  if (!raw.verified) {
    const reason = raw.unavailableReason ? ` (${raw.unavailableReason})` : '';
    console.log(`[ok] ${result.source}: verified=false — undetermined, no checks run${reason}`);
    return;
  }

  const flags = raw.truncated ? ' [source truncated]' : '';
  console.log(`[ok] ${result.source}: verified=true  model=${raw.model}${flags}`);
  for (const c of raw.checks) {
    console.log(`  - ${c.check.padEnd(24)} ${c.status.padEnd(13)} ${c.evidence}`);
  }
}

main().catch((err: unknown) => {
  console.error('testCodeChecker crashed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
