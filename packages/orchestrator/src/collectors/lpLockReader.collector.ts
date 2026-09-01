import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Collector, RawCollectorResult } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { type AppConfig, loadConfig } from '../config/index.js';
import { archiveRawResult } from '../utils/archive.js';
import { postJson } from '../utils/http.js';
import { DexScreenerCollector } from './dexScreener.collector.js';
import { failResult, okResult } from './result.js';

/** EDITABLE ROUTE — the lp-lock-api endpoint (POST, JSON body `{ token, pair? }`). */
const LP_LOCK_ROUTE = '/lp-lock';

/** lp-lock-api can be slower than a plain REST call (it does on-chain RPC reads). */
const LP_LOCK_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Pick the deepest Ethereum pair address from a DexScreener response. */
function pickPairAddress(dexRaw: unknown): string | undefined {
  if (!isRecord(dexRaw) || !Array.isArray(dexRaw.pairs)) return undefined;
  let best: { address: string; liquidity: number } | undefined;
  for (const pair of dexRaw.pairs) {
    if (!isRecord(pair) || pair.chainId !== 'ethereum') continue;
    if (typeof pair.pairAddress !== 'string') continue;
    const liquidity = isRecord(pair.liquidity) && typeof pair.liquidity.usd === 'number' ? pair.liquidity.usd : 0;
    if (!best || liquidity > best.liquidity) best = { address: pair.pairAddress, liquidity };
  }
  return best?.address;
}

/**
 * Resolve the token's LP pair address from DexScreener — archived data first
 * (reproducible / offline), else a fresh keyless DexScreener call. The pair lets
 * lp-lock-api run its pair-based lockers (PinkLock / UNCX / burn), not just
 * OnlyMoons. Returns undefined when no pair is found (token-only query then).
 */
async function resolvePair(address: string, config: AppConfig): Promise<string | undefined> {
  const dir = resolve(config.archiveDir, address.toLowerCase());
  try {
    const archived: unknown = JSON.parse(await readFile(join(dir, 'dexscreener.json'), 'utf8'));
    const pair = isRecord(archived) ? pickPairAddress(archived.raw) : undefined;
    if (pair) return pair;
  } catch {
    /* no archive — fall through to a fresh call */
  }
  try {
    const fresh = await new DexScreenerCollector(config).collect(address);
    if (fresh.ok) return pickPairAddress(fresh.raw);
  } catch {
    /* pair simply stays unknown */
  }
  return undefined;
}

/**
 * (5) LP-Lock Reader — the author's own lp-lock-api service, called over HTTP.
 *
 * The service (`packages/lp-lock-api`, default `http://localhost:3001`) reports
 * whether a token's LP is locked or burned (OnlyMoons / PinkLock / UNCX / burn).
 *
 * Endpoint (base from config `LP_LOCK_API_URL`):
 *   `POST {LP_LOCK_API_URL}/lp-lock`  body `{ "token": "0x..", "pair": "0x.." }`
 *
 * The pair address is resolved from DexScreener first, so all pair-based lockers
 * can run — not just OnlyMoons (token-only). If lp-lock-api is unavailable the
 * collector fails gracefully; GoPlus and SafeAnalyzer still provide `lp_locked`.
 *
 * Same contract as the other collectors: returns a `RawCollectorResult`, never
 * throws, keeps the response untouched, and archives on success. No parsing.
 */
export class LpLockReaderCollector implements Collector {
  readonly name = SOURCES.lpLockReader;

  constructor(
    private readonly config: AppConfig = loadConfig(),
    private readonly timeoutMs: number = LP_LOCK_TIMEOUT_MS,
  ) {}

  async collect(address: string): Promise<RawCollectorResult> {
    try {
      const { baseUrl } = this.config.lpLock;
      if (!baseUrl) return failResult(this.name, address, 'missing LP_LOCK_API_URL');

      const pair = await resolvePair(address, this.config);
      const body = pair ? { token: address, pair } : { token: address };

      const url = `${baseUrl.replace(/\/+$/, '')}${LP_LOCK_ROUTE}`;
      const raw = await postJson(url, body, { timeoutMs: this.timeoutMs });

      const result = okResult(this.name, address, raw);
      await archiveRawResult(result, this.config.archiveDir);
      return result;
    } catch (err) {
      return failResult(this.name, address, err instanceof Error ? err.message : String(err));
    }
  }
}
