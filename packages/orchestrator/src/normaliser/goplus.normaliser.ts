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

/** Burn / null addresses that hold "dead" supply. */
const BURN_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
]);

/** Tags marking a holder as a DEX pair, locker, or burn — not a real user. */
const INFRA_TAG_RE = /uniswap|pancake|sushi|balancer|curve|\blp\b|liquidit|\bpair\b|\bpool\b|lock|burn|null|dead/i;

/** Tags marking an LP holder specifically as a lock/burn (NOT a plain dex pair). */
const LOCK_TAG_RE = /lock|burn|null|dead/i;

function isTruthyFlag(value: unknown): boolean {
  return value === '1' || value === 1 || value === true;
}

/**
 * True for holders that are NOT real users: the LP pair, lockers, or burn
 * addresses. Counting these as "top holders" wildly inflates concentration
 * (e.g. the Uniswap pair holding 62% of supply looks like a whale but is just
 * the liquidity pool). Excluded from top1/top10 concentration.
 */
function isInfrastructureHolder(entry: Record<string, unknown>): boolean {
  if (isTruthyFlag(entry.is_locked)) return true;
  const address = typeof entry.address === 'string' ? entry.address.toLowerCase() : '';
  if (BURN_ADDRESSES.has(address)) return true;
  const tag = typeof entry.tag === 'string' ? entry.tag : '';
  if (isTruthyFlag(entry.is_contract) && tag !== '' && INFRA_TAG_RE.test(tag)) return true;
  return false;
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
    // Concentration counts REAL users only — drop the LP pair / lockers / burn.
    const real = holders.filter(
      (h): h is Record<string, unknown> => isRecord(h) && !isInfrastructureHolder(h),
    );
    const top1 = real.length > 0 ? holderPercent(real[0]) : undefined;
    if (top1 !== undefined) {
      signals.push(buildSignal(SOURCE, 'top1_holder_share', 'present', round2(top1 * 100)));
    }
    let sum = 0;
    let any = false;
    for (const entry of real.slice(0, 10)) {
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

  // LP lock/burn from GoPlus lp_holders — a third source for lp_locked, so the
  // system still has LP coverage when lp-lock-api is down or incomplete.
  const lpHolders = d.lp_holders;
  if (Array.isArray(lpHolders) && lpHolders.length > 0) {
    let lockedFraction = 0;
    for (const h of lpHolders) {
      if (!isRecord(h)) continue;
      const pct = toNumber(h.percent) ?? 0;
      const addr = typeof h.address === 'string' ? h.address.toLowerCase() : '';
      const tag = typeof h.tag === 'string' ? h.tag : '';
      if (isTruthyFlag(h.is_locked) || BURN_ADDRESSES.has(addr) || LOCK_TAG_RE.test(tag)) {
        lockedFraction += pct;
      }
    }
    const lockedPct = round2(lockedFraction * 100);
    const status = lockedFraction >= 0.5 ? 'present' : 'absent';
    signals.push(
      buildSignal(SOURCE, 'lp_locked', status, status === 'present', `${lockedPct}% of LP locked/burned (GoPlus lp_holders)`),
    );
  }

  const lpHolderCount = toNumber(d.lp_holder_count);
  if (lpHolderCount !== undefined) {
    signals.push(buildSignal(SOURCE, 'lp_holder_count', 'present', lpHolderCount));
  }

  return signals;
}
