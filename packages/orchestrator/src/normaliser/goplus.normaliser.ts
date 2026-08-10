import type { Signal } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import type { SignalKey } from './keys.js';
import { buildSignal, flag01, isRecord, round2, toNumber } from './keys.js';

const SOURCE = SOURCES.goplus;

/** Owner addresses that mean "ownership renounced". */
const RENOUNCED_OWNERS = new Set([
  '',
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
]);

/** GoPlus returns the token object under `result[address]` — exactly one entry. */
function tokenData(raw: unknown): Record<string, unknown> | undefined {
  if (!isRecord(raw)) return undefined;
  const result = raw.result;
  if (!isRecord(result)) return undefined;
  const first: unknown = Object.values(result)[0];
  return isRecord(first) ? first : undefined;
}

/** GoPlus taxes are decimal fractions ("0.05" = 5%); convert to a percentage. */
function taxPercent(value: unknown): number | undefined {
  const n = toNumber(value);
  return n === undefined ? undefined : round2(n * 100);
}

/** `holders[i].percent` is a fraction string ("0.55" = 55%). */
function holderPercent(entry: unknown): number | undefined {
  return isRecord(entry) ? toNumber(entry.percent) : undefined;
}

/** Boolean "1"/"0" contract flags mapped onto canonical keys. */
const FLAG_KEYS: ReadonlyArray<readonly [string, SignalKey]> = [
  ['is_honeypot', 'honeypot'],
  ['is_mintable', 'mint_authority'],
  ['is_blacklisted', 'blacklist'],
  ['transfer_pausable', 'pausable'],
  ['is_anti_whale', 'anti_whale'],
  ['is_proxy', 'proxy_upgradeable'],
  ['hidden_owner', 'hidden_owner_privileges'],
];

/**
 * (1) GoPlus → contract flags + holder distribution.
 *
 * Maps GoPlus's "1"/"0" flags, its decimal-fraction taxes, owner/renounce state,
 * holder_count, and the holders[] distribution (top1 / top10 / creator share).
 * Fields GoPlus does not return are skipped (no signal emitted).
 */
export function normaliseGoPlus(raw: unknown): Signal[] {
  const d = tokenData(raw);
  if (!d) return [];
  const signals: Signal[] = [];

  for (const [field, key] of FLAG_KEYS) {
    const status = flag01(d[field]);
    if (status) signals.push(buildSignal(SOURCE, key, status, status === 'present'));
  }

  // is_open_source: "1" verified → present, "0" unverified → absent.
  const openStatus = flag01(d.is_open_source);
  if (openStatus) {
    signals.push(buildSignal(SOURCE, 'source_verified', openStatus, openStatus === 'present'));
  }

  const buy = taxPercent(d.buy_tax);
  if (buy !== undefined) signals.push(buildSignal(SOURCE, 'buy_tax', 'present', buy));
  const sell = taxPercent(d.sell_tax);
  if (sell !== undefined) signals.push(buildSignal(SOURCE, 'sell_tax', 'present', sell));

  const owner = d.owner_address;
  if (typeof owner === 'string') {
    const renounced = RENOUNCED_OWNERS.has(owner.toLowerCase());
    signals.push(
      buildSignal(
        SOURCE,
        'owner_status',
        renounced ? 'absent' : 'present',
        renounced ? 'renounced' : owner,
        owner,
      ),
    );
  }

  const holderCount = toNumber(d.holder_count);
  if (holderCount !== undefined) {
    signals.push(buildSignal(SOURCE, 'holder_count', 'present', holderCount));
  }

  const holders = d.holders;
  if (Array.isArray(holders) && holders.length > 0) {
    const top1 = holderPercent(holders[0]);
    if (top1 !== undefined) {
      signals.push(buildSignal(SOURCE, 'top1_holder_share', 'present', round2(top1 * 100)));
    }
    let sum = 0;
    let any = false;
    for (const entry of holders.slice(0, 10)) {
      const p = holderPercent(entry);
      if (p !== undefined) {
        sum += p;
        any = true;
      }
    }
    if (any) signals.push(buildSignal(SOURCE, 'top10_holder_share', 'present', round2(sum * 100)));
  }

  const creator = toNumber(d.creator_percent);
  if (creator !== undefined) {
    signals.push(buildSignal(SOURCE, 'deployer_share', 'present', round2(creator * 100)));
  }

  return signals;
}
