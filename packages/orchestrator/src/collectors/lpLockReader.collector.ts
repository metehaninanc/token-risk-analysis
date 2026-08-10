import type { Collector, RawCollectorResult } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { type AppConfig, loadConfig } from '../config/index.js';
import { archiveRawResult } from '../utils/archive.js';
import { DEFAULT_TIMEOUT_MS, getJson } from '../utils/http.js';
import { failResult, okResult } from './result.js';

/**
 * EDITABLE ROUTE — change here if the lp-lock-api route changes.
 * Builds `GET {base}/lp-lock?address={address}` (base = `LP_LOCK_API_URL`).
 */
const buildLpLockUrl = (base: string, address: string): string =>
  `${base.replace(/\/+$/, '')}/lp-lock?address=${encodeURIComponent(address)}`;

/**
 * (5) LP-Lock Reader — the author's own LP-lock service, called over HTTP.
 *
 * The service runs as a separate package (`packages/lp-lock-api`) and reports
 * whether a token's LP is locked or burned (OnlyMoons / PinkLock / UNCX / burn).
 *
 * Endpoint (base from config `LP_LOCK_API_URL`; route in `buildLpLockUrl`):
 *   `GET {LP_LOCK_API_URL}/lp-lock?address={address}`
 *
 * Same contract as the other collectors: returns a `RawCollectorResult`, never
 * throws, keeps the response untouched, and archives on success. No parsing.
 */
export class LpLockReaderCollector implements Collector {
  readonly name = SOURCES.lpLockReader;

  constructor(
    private readonly config: AppConfig = loadConfig(),
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async collect(address: string): Promise<RawCollectorResult> {
    try {
      const { baseUrl } = this.config.lpLock;
      if (!baseUrl) return failResult(this.name, address, 'missing LP_LOCK_API_URL');

      const url = buildLpLockUrl(baseUrl, address);
      const raw = await getJson(url, { timeoutMs: this.timeoutMs });

      const result = okResult(this.name, address, raw);
      await archiveRawResult(result, this.config.archiveDir);
      return result;
    } catch (err) {
      return failResult(this.name, address, err instanceof Error ? err.message : String(err));
    }
  }
}
