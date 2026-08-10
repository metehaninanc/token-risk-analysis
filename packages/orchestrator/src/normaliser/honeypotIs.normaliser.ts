import type { Signal } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { buildSignal, isRecord, round2, toNumber } from './keys.js';

const SOURCE = SOURCES.honeypotIs;

/**
 * (2) honeypot.is → honeypot verdict + simulated buy/sell taxes.
 *
 * `honeypotResult.isHoneypot` (bool) → `honeypot`. When the simulation itself
 * failed (`simulationSuccess === false`) the honeypot state is `undetermined`.
 * `simulationResult.buyTax`/`sellTax` are already percentages.
 */
export function normaliseHoneypotIs(raw: unknown): Signal[] {
  if (!isRecord(raw)) return [];
  const signals: Signal[] = [];

  const result = raw.honeypotResult;
  if (isRecord(result) && typeof result.isHoneypot === 'boolean') {
    signals.push(buildSignal(SOURCE, 'honeypot', result.isHoneypot ? 'present' : 'absent', result.isHoneypot));
  } else if (raw.simulationSuccess === false) {
    signals.push(buildSignal(SOURCE, 'honeypot', 'undetermined', null, 'simulation failed'));
  }

  const sim = raw.simulationResult;
  if (isRecord(sim)) {
    const buy = toNumber(sim.buyTax);
    if (buy !== undefined) signals.push(buildSignal(SOURCE, 'buy_tax', 'present', round2(buy)));
    const sell = toNumber(sim.sellTax);
    if (sell !== undefined) signals.push(buildSignal(SOURCE, 'sell_tax', 'present', round2(sell)));
  }

  return signals;
}
