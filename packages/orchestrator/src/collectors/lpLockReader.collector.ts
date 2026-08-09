import type { Collector, RawCollectorResult } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { failResult } from './result.js';

/**
 * (5) LP-Lock Reader — own on-chain component.
 * Will read on-chain (via ethers v6 + an RPC endpoint) whether a token's LP is
 * locked or burned across the supported lockers (OnlyMoons / PinkLock / UNCX /
 * burn address).
 *
 * Module 0: stub only — returns "not implemented".
 */
export class LpLockReaderCollector implements Collector {
  readonly name = SOURCES.lpLockReader;

  async collect(address: string): Promise<RawCollectorResult> {
    return failResult(this.name, address, 'not implemented');
  }
}
