import type { Collector, RawCollectorResult } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { failResult } from './result.js';

/**
 * (1) GoPlus Token Security API.
 * Will fetch contract-security flags (mint authority, blacklist, honeypot
 * heuristics, holder concentration, etc.) for a token address.
 *
 * Module 0: stub only — returns "not implemented".
 */
export class GoPlusCollector implements Collector {
  readonly name = SOURCES.goplus;

  async collect(address: string): Promise<RawCollectorResult> {
    return failResult(this.name, address, 'not implemented');
  }
}
