import type { Collector, RawCollectorResult } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { failResult } from './result.js';

/**
 * (2) honeypot.is API.
 * Will simulate a buy/sell to detect honeypots and report buy/sell tax.
 *
 * Module 0: stub only — returns "not implemented".
 */
export class HoneypotIsCollector implements Collector {
  readonly name = SOURCES.honeypotIs;

  async collect(address: string): Promise<RawCollectorResult> {
    return failResult(this.name, address, 'not implemented');
  }
}
