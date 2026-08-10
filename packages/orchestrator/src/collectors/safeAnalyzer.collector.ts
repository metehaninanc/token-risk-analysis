import type { Collector, RawCollectorResult } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { type AppConfig, loadConfig } from '../config/index.js';
import { archiveRawResult } from '../utils/archive.js';
import { failResult, okResult } from './result.js';

/** SafeAnalyzer can be slow — allow a longer timeout than the GET collectors. */
const SAFEANALYZER_TIMEOUT_MS = 30_000;

/** POST route appended to the configured base URL. */
const SAFEANALYZER_ROUTE = '/eth';

/** True when an unknown error is an `AbortController` timeout abort. */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * Extract a present, non-empty application-level error from an HTTP-200 body.
 * The LIVE API returns a FLAT object with a top-level `error` (empty string on
 * success); the published docs instead show `{ data: { error } }`. We check the
 * flat field first, then the documented wrapper, so both shapes are handled.
 */
function appError(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const top = (raw as { error?: unknown }).error;
  if (typeof top === 'string' && top.trim() !== '') return top;
  const data = (raw as { data?: unknown }).data;
  if (typeof data === 'object' && data !== null) {
    const nested = (data as { error?: unknown }).error;
    if (typeof nested === 'string' && nested.trim() !== '') return nested;
  }
  return undefined;
}

/**
 * (3) SafeAnalyzer (dexanalyzer.io) — cross-validation source for contract-level
 * flags that ALSO provides liquidity / lock / tax / honeypot / holder data. It
 * degrades gracefully to a failed source (`ok: false`) if the key is missing or
 * the API is unavailable, never crashing the pipeline.
 *
 * Endpoint (https://dexanalyzer.io/api.md — Ethereum-only, no chain param):
 *   `POST https://api1.dexanalyzer.io/eth`   (base from config `SAFEANALYZER_API_URL`)
 *   Headers: `apiKey: <SAFEANALYZER_API_KEY>` (custom header — NOT Bearer, NOT a
 *            query param), `Content-Type: application/json`,
 *            `Accept-Encoding: gzip,deflate,compress`
 *   Body:    `{ "ca": "<address>" }`   (the address key is `ca`)
 *   Timeout: 30s via AbortController (this API can be slow).
 *
 * Response (kept RAW here — parsing/normalisation is a later module):
 *   - The live API's shape is OUTCOME-DEPENDENT (both verified against the API):
 *       • SUCCESS: a FLAT object (`{ contractAddress, name, owner, honeypot,
 *         taxes, lockValue, holders, error, ... }`) with a top-level `error: ""`.
 *       • ERROR: the documented wrapper `{ data: { error: "..." } }` (e.g.
 *         "ERR: ...") — still HTTP 200.
 *     So `appError` treats a present, non-empty error in EITHER position (flat
 *     top-level `error`, or `data.error`) as a FAILED collect (`ok: false`)
 *     despite the 200 status.
 *   - Field quirks the normaliser must handle later:
 *       • `taxes`, `lockValue` are HTML-formatted strings (e.g.
 *         `"Buy: <b>0.0%</b> | Sell: <b>0.0%</b>"`, `"<b>100% of Liquidity burned.</b>"`).
 *       • `honeypot` is a STATUS STRING, not a boolean ("", "SIMULATION FAILED",
 *         "HIGH TAX", …).
 *       • `owner` may be the sentinel `***RENOUNCED***`.
 *       • `holders` is a mixed array (`[count, "| %| %...", ...]`).
 *       • `reportx` is an array of Rug-Checker flag objects `{ data, point, item }`
 *         (blacklist, mint, proxy, set-fee, trading-disable, …); it may be ABSENT
 *         when the token has no flags.
 */
export class SafeAnalyzerCollector implements Collector {
  readonly name = SOURCES.safeAnalyzer;

  constructor(
    private readonly config: AppConfig = loadConfig(),
    private readonly timeoutMs: number = SAFEANALYZER_TIMEOUT_MS,
  ) {}

  async collect(address: string): Promise<RawCollectorResult> {
    const { apiKey, baseUrl } = this.config.safeAnalyzer;
    if (!apiKey) {
      return failResult(this.name, address, 'SAFEANALYZER_API_KEY not configured');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `${baseUrl.replace(/\/+$/, '')}${SAFEANALYZER_ROUTE}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          apiKey,
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip,deflate,compress',
        },
        body: JSON.stringify({ ca: address }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return failResult(
          this.name,
          address,
          `HTTP ${response.status} ${response.statusText}`.trim(),
        );
      }

      const raw: unknown = await response.json();

      // Application-level error arrives as HTTP 200 with a non-empty `error`.
      const failure = appError(raw);
      if (failure) return failResult(this.name, address, failure);

      const result = okResult(this.name, address, raw);
      await archiveRawResult(result, this.config.archiveDir);
      return result;
    } catch (err) {
      if (isAbortError(err)) {
        return failResult(this.name, address, `request timed out after ${this.timeoutMs}ms`);
      }
      return failResult(this.name, address, err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }
}
