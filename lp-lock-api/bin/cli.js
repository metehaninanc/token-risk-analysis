#!/usr/bin/env node
// CLI: node bin/cli.js <tokenOrPair> [pair]  → prints the standard LP-lock result.
import { findLpLocks, loadEnv } from '../src/index.js';

loadEnv();

const [a, b] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
if (!a) {
  console.error('Usage: cli.js <token> [pair]   (token used for OnlyMoons; pair for the rest)');
  process.exit(2);
}

// One arg → use it as both token and pair. Two args → token, pair.
const input = b ? { token: a, pair: b } : { token: a, pair: a };

try {
  const result = await findLpLocks(input);
  const where = result.locked ? `LOCKED via ${result.sources.join(', ')}` : 'NO lock/burn found';
  console.error(`${where}  (checked: ${result.checked.join(', ')})`);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.locked ? 0 : 1);
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(2);
}
