import type { Collector, RawCollectorResult } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { type AppConfig, loadConfig } from '../config/index.js';
import { archiveRawResult } from '../utils/archive.js';
import { DEFAULT_TIMEOUT_MS, getJson } from '../utils/http.js';
import { failResult, okResult } from './result.js';

/**
 * (1) GoPlus Token Security API.
 *
 * Endpoint:
 *   `GET https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses={address}`
 *   (chain_id `1` = Ethereum; the address is lower-cased for the query).
 *
 * The useful data lives under `raw.result[address]` (address lower-cased), but
 * this collector keeps the whole response untouched — field selection happens
 * in the normaliser (a later module). This is a public, keyless endpoint.
 */
export class GoPlusCollector implements Collector {
  readonly name = SOURCES.goplus;

  constructor(
    private readonly config: AppConfig = loadConfig(),
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async collect(address: string): Promise<RawCollectorResult> {
    try {
      const { baseUrl } = this.config.goplus;
      if (!baseUrl) return failResult(this.name, address, 'missing GoPlus base URL');

      const addressLower = address.toLowerCase();
      const url = new URL(`${baseUrl}/token_security/1`);
      url.searchParams.set('contract_addresses', addressLower);

      const raw = await getJson(url.toString(), { timeoutMs: this.timeoutMs });

      const result = okResult(this.name, address, raw);
      await archiveRawResult(result, this.config.archiveDir);
      return result;
    } catch (err) {
      return failResult(this.name, address, err instanceof Error ? err.message : String(err));
    }
  }
}
