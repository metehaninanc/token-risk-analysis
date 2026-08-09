import type { Collector, RawCollectorResult } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { failResult } from './result.js';

/**
 * (3) SafeAnalyzer (dexanalyzer.io) — third-party contract-risk assessment used
 * to cross-check the other sources.
 *
 * Endpoint (see https://dexanalyzer.io/api.md — Ethereum-only, no chain param):
 *   `POST https://api1.dexanalyzer.io/eth`
 *   Headers: `Content-Type: application/json`, `apiKey: <SAFEANALYZER_API_KEY>`  (key MANDATORY)
 *   Body:    `{ "ca": "<contract address>" }`
 *   Success: `{ "data": { ...contractAddress, honeypot, taxes, lockValue,
 *            reportx[], error: "" } }`; failure: `{ "data": { "error": "..." } }`.
 *
 * NOTE: unlike the other HTTP collectors this is a POST with a JSON body and a
 * required `apiKey` header, so its future implementation cannot reuse the
 * GET-only `getJson` helper as-is. `config.safeAnalyzer` carries the base URL
 * and apiKey.
 *
 * TODO(next module): implement `collect()` — currently a stub.
 */
export class SafeAnalyzerCollector implements Collector {
  readonly name = SOURCES.safeAnalyzer;

  async collect(address: string): Promise<RawCollectorResult> {
    return failResult(this.name, address, 'not implemented');
  }
}
