import type { Collector, RawCollectorResult } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { failResult } from './result.js';

/**
 * (6) Code-Level Checker — LLM-based.
 * Will fetch the verified source from Etherscan (Etherscan is used ONLY for
 * this fetch, never as an independent signal source) and run an LLM pass over
 * it to flag code-level risk patterns.
 *
 * Module 0: stub only — returns "not implemented".
 */
export class CodeLevelCheckerCollector implements Collector {
  readonly name = SOURCES.codeLevelChecker;

  async collect(address: string): Promise<RawCollectorResult> {
    return failResult(this.name, address, 'not implemented');
  }
}
