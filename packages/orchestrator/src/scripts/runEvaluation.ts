/**
 * Run the evaluation harness over the labelled set and write the reports.
 *
 * Archived-data-first (offline & reproducible): it reuses each token's archived
 * risk_profile.json / raw / eval_summary.json when present, and only collects or
 * calls the LLM for tokens not yet processed. Model is fixed + temperature 0.
 *
 * Outputs:
 *   data/eval/results.json   (machine-readable — every raw number)
 *   data/eval/report.md      (human-readable summary)
 *
 * Rate limiting: pauses between tokens that hit the network (free-tier RPM).
 * Set the pause with the [delayMs] arg or the EVAL_DELAY_MS env var (default 15s;
 * use ~20000 for a strict 3 RPM). Cached tokens add no delay.
 *
 * Usage:
 *   npm run build
 *   node dist/src/scripts/runEvaluation.js [labelsPath] [faithfulnessSubset] [delayMs]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../config/index.js';
import { renderDetailReport, renderReport, runEvaluation } from '../evaluation/index.js';

async function main(): Promise<void> {
  const labelsPath = process.argv[2];
  const subsetArg = process.argv[3];
  const delayArg = process.argv[4];
  const faithfulnessSubset = subsetArg ? Number(subsetArg) : undefined;
  const delayMs = delayArg ? Number(delayArg) : undefined;
  const config = loadConfig();

  const options: Parameters<typeof runEvaluation>[0] = { config };
  if (labelsPath) options.labelsPath = labelsPath;
  if (faithfulnessSubset !== undefined && Number.isFinite(faithfulnessSubset)) {
    options.faithfulnessSubset = faithfulnessSubset;
  }
  if (delayMs !== undefined && Number.isFinite(delayMs)) {
    options.delayMs = delayMs;
  }

  // Live progress so the run doesn't look frozen (cached tokens fly past instantly).
  console.log('Starting evaluation… (cached tokens are instant; live tokens pause for the rate limit)\n');
  options.onProgress = (e) => {
    const tag = e.hitNetwork ? 'live' : 'cached';
    if (e.phase === 'profile') {
      const risk = (e.overallRisk ?? '?').toUpperCase();
      console.log(`[${e.index}/${e.total}] ${e.address} → ${risk} (${tag})`);
    } else {
      console.log(`  faithfulness [${e.index}/${e.total}] ${e.address} (${tag})`);
    }
  };

  const results = await runEvaluation(options);
  console.log('');
  const report = renderReport(results);

  const outDir = resolve(config.archiveDir, '..', 'eval');
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, 'results.json'), JSON.stringify(results, null, 2), 'utf8');
  await writeFile(resolve(outDir, 'report.md'), report, 'utf8');
  await writeFile(resolve(outDir, 'results_detail.md'), renderDetailReport(results), 'utf8');

  console.log(report);
  console.log(`\nWrote ${resolve(outDir, 'results.json')}`);
  console.log(`Wrote ${resolve(outDir, 'report.md')}`);
  console.log(`Wrote ${resolve(outDir, 'results_detail.md')}`);
}

main().catch((err: unknown) => {
  console.error('runEvaluation crashed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
