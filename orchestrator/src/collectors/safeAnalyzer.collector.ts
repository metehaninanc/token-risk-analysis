import type { Collector, RawCollectorResult } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { failResult } from './result.js';

/**
 * (3) SafeAnalyzer.
 * Will provide an additional third-party contract-risk assessment used to
 * cross-check the other sources.
 *
 * Module 0: stub only — returns "not implemented".
 */
export class SafeAnalyzerCollector implements Collector {
  readonly name = SOURCES.safeAnalyzer;

  async collect(address: string): Promise<RawCollectorResult> {
    return failResult(this.name, address, 'not implemented');
  }
}
