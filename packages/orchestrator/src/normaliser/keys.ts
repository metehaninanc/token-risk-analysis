import type { Signal, SignalGroup, SignalStatus, SourceName } from '../types/index.js';
import { severityFor } from './severity.js';

/**
 * CANONICAL Signal.key CATALOGUE — the single source of truth.
 *
 * Every source must map the same concept onto the SAME key here, so that the
 * orchestrator can later cross-check sources that disagree. Grouped by the
 * `SignalGroup` they belong to.
 */
export const CONTRACT_KEYS = [
  'honeypot',
  'buy_tax',
  'sell_tax',
  'mint_authority',
  'owner_status',
  'blacklist',
  'pausable',
  'anti_whale',
  'proxy_upgradeable',
  'source_verified',
  'mutable_taxes',
  'hidden_owner_privileges',
] as const;

export const HOLDER_KEYS = [
  'top1_holder_share',
  'top10_holder_share',
  'holder_count',
  'deployer_share',
] as const;

export const LIQUIDITY_KEYS = [
  'liquidity_usd',
  'lp_locked',
  'lp_lock_duration',
  'lp_holder_count',
] as const;

export type ContractKey = (typeof CONTRACT_KEYS)[number];
export type HolderKey = (typeof HOLDER_KEYS)[number];
export type LiquidityKey = (typeof LIQUIDITY_KEYS)[number];
export type SignalKey = ContractKey | HolderKey | LiquidityKey;

/** The concrete value a signal may carry (mirrors `Signal['value']`). */
export type SignalValue = Signal['value'];

/** Which group each canonical key belongs to. */
export const KEY_GROUP: Record<SignalKey, SignalGroup> = buildKeyGroup();

function buildKeyGroup(): Record<SignalKey, SignalGroup> {
  const map = {} as Record<SignalKey, SignalGroup>;
  for (const k of CONTRACT_KEYS) map[k] = 'contract';
  for (const k of HOLDER_KEYS) map[k] = 'holder';
  for (const k of LIQUIDITY_KEYS) map[k] = 'liquidity';
  return map;
}

/**
 * Build a single-source `Signal` for `key`, deriving `group` from the catalogue
 * and `severity` from the central rules. `conflict` is intentionally left unset
 * — only the orchestrator sets it once it has merged across sources.
 */
export function buildSignal(
  source: SourceName,
  key: SignalKey,
  status: SignalStatus,
  value: SignalValue,
  evidence?: string,
): Signal {
  const signal: Signal = {
    key,
    group: KEY_GROUP[key],
    status,
    value,
    severity: severityFor(key, status, value),
    sources: [source],
  };
  if (evidence !== undefined && evidence.trim() !== '') signal.evidence = evidence;
  return signal;
}

/* ── generic parse helpers shared by the per-source normalisers ── */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Parse a number from number | boolean | numeric string ("0.05", "12%"). */
export function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const n = Number(value.replace('%', '').trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Round to two decimals for tidy percentages / dollar figures. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** GoPlus-style "1"/"0" (or bool/number) flag → status; undefined when absent. */
export function flag01(value: unknown): SignalStatus | undefined {
  if (value === '1' || value === 1 || value === true) return 'present';
  if (value === '0' || value === 0 || value === false) return 'absent';
  return undefined;
}

/** Validate a `SignalStatus` from unknown input. */
export function asStatus(value: unknown): SignalStatus | undefined {
  return value === 'present' || value === 'absent' || value === 'undetermined' ? value : undefined;
}
