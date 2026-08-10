import type { Signal } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { buildSignal, isRecord, round2, toNumber } from './keys.js';

const SOURCE = SOURCES.dexScreener;

/**
 * (4) DexScreener → `liquidity_usd` only.
 *
 * Takes the deepest pool's `pairs[].liquidity.usd`. Pair age and volume are
 * intentionally NOT mapped: no canonical key represents them, and this module
 * must not invent keys.
 */
export function normaliseDexScreener(raw: unknown): Signal[] {
  if (!isRecord(raw)) return [];
  const pairs = raw.pairs;
  if (!Array.isArray(pairs) || pairs.length === 0) return [];

  let maxUsd: number | undefined;
  for (const pair of pairs) {
    if (!isRecord(pair)) continue;
    const liquidity = pair.liquidity;
    const usd = isRecord(liquidity) ? toNumber(liquidity.usd) : undefined;
    if (usd !== undefined && (maxUsd === undefined || usd > maxUsd)) maxUsd = usd;
  }

  if (maxUsd === undefined) return [];
  return [buildSignal(SOURCE, 'liquidity_usd', 'present', round2(maxUsd))];
}
