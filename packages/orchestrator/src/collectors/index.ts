import type { Collector } from '../types/index.js';
import { GoPlusCollector } from './goplus.collector.js';
import { HoneypotIsCollector } from './honeypotIs.collector.js';
import { SafeAnalyzerCollector } from './safeAnalyzer.collector.js';
import { DexScreenerCollector } from './dexScreener.collector.js';
import { LpLockReaderCollector } from './lpLockReader.collector.js';
import { CodeLevelCheckerCollector } from './codeLevelChecker.collector.js';

export * from './result.js';
export { GoPlusCollector } from './goplus.collector.js';
export { HoneypotIsCollector } from './honeypotIs.collector.js';
export { SafeAnalyzerCollector } from './safeAnalyzer.collector.js';
export { DexScreenerCollector } from './dexScreener.collector.js';
export { LpLockReaderCollector } from './lpLockReader.collector.js';
export { CodeLevelCheckerCollector } from './codeLevelChecker.collector.js';

/** Instantiate all six collectors in canonical pipeline order. */
export function createCollectors(): Collector[] {
  return [
    new GoPlusCollector(),
    new HoneypotIsCollector(),
    new SafeAnalyzerCollector(),
    new DexScreenerCollector(),
    new LpLockReaderCollector(),
    new CodeLevelCheckerCollector(),
  ];
}
