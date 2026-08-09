import type { Collector, RawCollectorResult } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { type AppConfig, loadConfig } from '../config/index.js';
import { archiveRawResult } from '../utils/archive.js';
import { DEFAULT_TIMEOUT_MS, getJson } from '../utils/http.js';
import { failResult, okResult } from './result.js';

/**
 * (2) honeypot.is API.
 *
 * Endpoint:
 *   `GET https://api.honeypot.is/v2/IsHoneypot?address={address}&chainID=1`
 *
 * Simulates a buy/sell to detect honeypots and reports buy/sell tax. The full
 * response is archived untouched; interpretation happens in the normaliser.
 */
export class HoneypotIsCollector implements Collector {
  readonly name = SOURCES.honeypotIs;

  constructor(
    private readonly config: AppConfig = loadConfig(),
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async collect(address: string): Promise<RawCollectorResult> {
    try {
      const { baseUrl } = this.config.honeypotIs;
      if (!baseUrl) return failResult(this.name, address, 'missing honeypot.is base URL');

      const url = new URL(`${baseUrl}/IsHoneypot`);
      url.searchParams.set('address', address);
      url.searchParams.set('chainID', '1');

      const raw = await getJson(url.toString(), { timeoutMs: this.timeoutMs });

      const result = okResult(this.name, address, raw);
      await archiveRawResult(result, this.config.archiveDir);
      return result;
    } catch (err) {
      return failResult(this.name, address, err instanceof Error ? err.message : String(err));
    }
  }
}
