import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type AppConfig, loadConfig } from '../config/index.js';
import { DEFAULT_TIMEOUT_MS, getJson } from './http.js';

/**
 * Archive key for the raw Etherscan response. Etherscan is NOT a signal source
 * (not in `SOURCES`), so this file is archived directly rather than via
 * `archiveRawResult`, which keys strictly by `SourceName`.
 */
const ARCHIVE_KEY = 'etherscan_source';

/** Outcome of fetching verified source. Unverified is a valid `ok: true` case. */
export type EtherscanSourceResult =
  | {
      ok: true;
      verified: boolean;
      sourceCode: string;
      contractName: string;
      raw: unknown;
    }
  | { ok: false; error: string };

/** The `getsourcecode` result row fields we read (kept minimal, no `any`). */
interface EtherscanSourceRow {
  SourceCode?: unknown;
  ContractName?: unknown;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** First element of the Etherscan `result` array, when present and an object. */
function firstRow(raw: unknown): EtherscanSourceRow | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const result = (raw as { result?: unknown }).result;
  if (!Array.isArray(result) || result.length === 0) return undefined;
  const row: unknown = result[0];
  return typeof row === 'object' && row !== null ? (row as EtherscanSourceRow) : undefined;
}

/** Best-effort error text when `result` is an error string (rate limit, etc.). */
function errorMessage(raw: unknown): string {
  if (typeof raw === 'object' && raw !== null) {
    const r = raw as { result?: unknown; message?: unknown };
    if (typeof r.result === 'string' && r.result.trim() !== '') return r.result;
    if (typeof r.message === 'string' && r.message.trim() !== '') return r.message;
  }
  return 'unexpected Etherscan response shape';
}

/** Persist the raw Etherscan payload to `data/{address}/etherscan_source.json`. */
async function archive(address: string, raw: unknown, archiveDir: string): Promise<void> {
  const dir = resolve(archiveDir, address.toLowerCase());
  await mkdir(dir, { recursive: true });
  const envelope = { source: ARCHIVE_KEY, address, fetchedAt: new Date().toISOString(), raw };
  await writeFile(join(dir, `${ARCHIVE_KEY}.json`), JSON.stringify(envelope, null, 2), 'utf8');
}

/**
 * Fetch a contract's verified source code from Etherscan (V2 multichain API).
 *
 * This is a UTILITY, not a `Collector`: it is not a signal source. It only
 * supplies verified Solidity to the later Code-Level Checker. Unverified is a
 * VALID outcome (`verified: false`, empty `sourceCode`), not an error.
 *
 * Endpoint:
 *   `GET https://api.etherscan.io/v2/api?chainid=1&module=contract&action=getsourcecode&address={address}&apikey={ETHERSCAN_KEY}`
 *
 * Archives the raw response to `data/{address}/etherscan_source.json`.
 * A missing key returns `{ ok: false, error: 'ETHERSCAN_KEY not configured' }`.
 */
export async function fetchVerifiedSource(
  address: string,
  config: AppConfig = loadConfig(),
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<EtherscanSourceResult> {
  const { apiKey, baseUrl } = config.etherscan;
  if (!apiKey) return { ok: false, error: 'ETHERSCAN_KEY not configured' };

  try {
    const url = new URL(baseUrl);
    url.searchParams.set('chainid', '1');
    url.searchParams.set('module', 'contract');
    url.searchParams.set('action', 'getsourcecode');
    url.searchParams.set('address', address);
    url.searchParams.set('apikey', apiKey);

    const raw = await getJson(url.toString(), { timeoutMs });
    await archive(address, raw, config.archiveDir);

    const row = firstRow(raw);
    if (!row) return { ok: false, error: errorMessage(raw) };

    const sourceCode = asString(row.SourceCode);
    const contractName = asString(row.ContractName);
    // Empty SourceCode = unverified contract — a valid, non-error outcome.
    return { ok: true, verified: sourceCode.trim() !== '', sourceCode, contractName, raw };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
