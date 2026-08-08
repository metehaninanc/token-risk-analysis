import type { Collector, RawCollectorResult } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { failResult } from './result.js';

/**
 * (4) DexScreener API.
 * Will fetch market/liquidity context: pairs, liquidity depth, volume, and
 * price — used for the liquidity dimension.
 *
 * Module 0: stub only — returns "not implemented".
 */
export class DexScreenerCollector implements Collector {
  readonly name = SOURCES.dexScreener;

  async collect(address: string): Promise<RawCollectorResult> {
    return failResult(this.name, address, 'not implemented');
  }
}
