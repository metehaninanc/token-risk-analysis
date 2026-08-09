import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RawCollectorResult } from '../types/index.js';

/**
 * Persist one raw collector response to disk so every evaluation run is
 * reproducible. Files are keyed as `{baseDir}/{address}/{source}.json` and the
 * result is written verbatim (raw payload intact), pretty-printed for review.
 *
 * @returns the absolute path of the written file.
 */
export async function archiveRawResult(
  result: RawCollectorResult,
  baseDir: string,
): Promise<string> {
  const dir = resolve(baseDir, result.address.toLowerCase());
  await mkdir(dir, { recursive: true });

  const filePath = join(dir, `${result.source}.json`);
  await writeFile(filePath, JSON.stringify(result, null, 2), 'utf8');
  return filePath;
}
