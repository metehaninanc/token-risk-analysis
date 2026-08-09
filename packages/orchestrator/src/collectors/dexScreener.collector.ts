import type { Collector, RawCollectorResult } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { type AppConfig, loadConfig } from '../config/index.js';
import { archiveRawResult } from '../utils/archive.js';
import { DEFAULT_TIMEOUT_MS, getJson } from '../utils/http.js';
import { failResult, okResult } from './result.js';

/**
 * (4) DexScreener API.
 *
 * Endpoint:
 *   `GET https://api.dexscreener.com/latest/dex/tokens/{address}`
 *
 * Returns a `pairs` array (market/liquidity context). Kept entirely raw — no
 * field selection here; the normaliser (a later module) picks what it needs.
 */
export class DexScreenerCollector implements Collector {
  readonly name = SOURCES.dexScreener;

  constructor(
    private readonly config: AppConfig = loadConfig(),
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async collect(address: string): Promise<RawCollectorResult> {
    try {
      const { baseUrl } = this.config.dexScreener;
      if (!baseUrl) return failResult(this.name, address, 'missing DexScreener base URL');

      const url = `${baseUrl}/dex/tokens/${encodeURIComponent(address)}`;

      const raw = await getJson(url, { timeoutMs: this.timeoutMs });

      const result = okResult(this.name, address, raw);
      await archiveRawResult(result, this.config.archiveDir);
      return result;
    } catch (err) {
      return failResult(this.name, address, err instanceof Error ? err.message : String(err));
    }
  }
}
