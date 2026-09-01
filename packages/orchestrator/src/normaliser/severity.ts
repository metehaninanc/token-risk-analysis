import type { Severity, SignalStatus } from '../types/index.js';
// Type-only import (erased at runtime) so there is NO runtime import cycle with
// keys.ts, which imports `severityFor` from here.
import type { SignalKey, SignalValue } from './keys.js';

/**
 * PER-KEY SEVERITY RULES — the transparent core of the methodology.
 *
 * One place, human-readable, easy to adjust. Each rule maps a signal's
 * (`status`, `value`) to a `Severity`. Philosophy (per the project summary):
 * an ACTIVE malicious mechanic is HIGH/CRITICAL; a centralisation CAPABILITY is
 * MEDIUM/LOW; a benign/renounced state is `none`; anything unclear is `low`.
 *
 *   key                      present / high-value              absent / good   undetermined
 *   ───────────────────────  ────────────────────────────────  ─────────────   ────────────
 *   honeypot                 critical                           none            low
 *   sell_tax                 >50 critical · 20–50 high ·
 *                            10–20 medium · >0 low · 0 none     —               low
 *   buy_tax                  as sell_tax but >50 → high         —               low
 *   mint_authority           medium (capability, §3.3)          none            low
 *   blacklist                medium (capability, §3.3)          none            low
 *   hidden_owner_privileges  high (genuine backdoor)            none            low
 *   contract_scam_flags      SafeAnalyzer reportx: ANY point>=53 → high (scam);
 *                            7 → medium; >0 → low; 0 → none — UNLESS the point
 *                            SUM > 500 (Rug-Checker over-fire on a "unique"
 *                            contract) → low. Computed in the SafeAnalyzer
 *                            normaliser (needs max-point + sum), passed as an
 *                            explicit severity to buildSignal.
 *   owner_status             medium (owner active/reclaimable)  none (renounced)low
 *   pausable                 medium                             none            low
 *   proxy_upgradeable        medium                             none            low
 *   mutable_taxes            medium                             none            low
 *   anti_whale               low                                none            none
 *   source_verified          none (verified)                    medium (absent) low
 *   top1_holder_share        >50 high · 20–50 medium · 5–20 low · <5 none
 *   top10_holder_share       >90 high · 70–90 medium · 50–70 low · <50 none
 *   deployer_share           >20 high · 5–20 medium · >0 low · 0 none
 *   holder_count             <50 medium · 50–1000 low · >1000 none
 *   liquidity_usd            <5k medium · 5k–50k low · >50k none
 *   lp_locked                none (locked)                      medium (absent) low
 *   lp_lock_duration         <7d high · 7–30d medium · 30–180d low · >180d none
 *   lp_holder_count          <2 medium · 2–5 low · >5 none
 *
 * §3.3 alignment: a centralisation CAPABILITY is MEDIUM, not HIGH — HIGH/CRITICAL
 * is reserved for ACTIVE malicious mechanics (honeypot, hidden mint, real
 * backdoors). Two CONTEXTUAL adjustments then run in the orchestrator (see
 * orchestrator/context.ts): owner-only capabilities are neutralised to `none`
 * when ownership is renounced (they cannot be called), and GoPlus-only contract
 * capabilities are capped at `low` (GoPlus's static code check is shallow).
 */

const DAY = 86_400;

/** Local numeric parse (kept local to avoid a runtime import cycle with keys.ts). */
function num(value: SignalValue): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const n = Number(value.replace('%', '').trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function taxSeverity(value: SignalValue, sell: boolean): Severity {
  const n = num(value);
  if (n === undefined) return 'low';
  if (n <= 0) return 'none';
  if (n > 50) return sell ? 'critical' : 'high';
  if (n >= 20) return 'high';
  if (n >= 10) return 'medium';
  return 'low';
}

function top1Share(value: SignalValue): Severity {
  const n = num(value);
  if (n === undefined) return 'low';
  if (n > 50) return 'high';
  if (n >= 20) return 'medium';
  if (n >= 5) return 'low';
  return 'none';
}

function top10Share(value: SignalValue): Severity {
  const n = num(value);
  if (n === undefined) return 'low';
  if (n > 90) return 'high';
  if (n >= 70) return 'medium';
  if (n >= 50) return 'low';
  return 'none';
}

function deployerShare(value: SignalValue): Severity {
  const n = num(value);
  if (n === undefined) return 'low';
  if (n > 20) return 'high';
  if (n >= 5) return 'medium';
  if (n > 0) return 'low';
  return 'none';
}

function holderCount(value: SignalValue): Severity {
  const n = num(value);
  if (n === undefined) return 'low';
  if (n < 50) return 'medium';
  if (n < 1000) return 'low';
  return 'none';
}

function liquidityUsd(value: SignalValue): Severity {
  const n = num(value);
  if (n === undefined) return 'low';
  // §3.3: low liquidity is a caution, not an active malicious mechanic.
  if (n < 5_000) return 'medium';
  if (n < 50_000) return 'low';
  return 'none';
}

function lockDuration(value: SignalValue): Severity {
  const n = num(value);
  if (n === undefined) return 'low';
  if (n >= 180 * DAY) return 'none';
  if (n >= 30 * DAY) return 'low';
  if (n >= 7 * DAY) return 'medium';
  if (n > 0) return 'high';
  return 'none'; // <=0 encodes a permanent / burned lock
}

function lpHolderCount(value: SignalValue): Severity {
  const n = num(value);
  if (n === undefined) return 'none';
  if (n < 2) return 'medium';
  if (n < 5) return 'low';
  return 'none';
}

/** `present` → given severity, `undetermined` → low, otherwise `none`. */
function whenPresent(present: Severity): (s: SignalStatus) => Severity {
  return (s) => (s === 'present' ? present : s === 'undetermined' ? 'low' : 'none');
}

/** `absent` → given severity, `undetermined` → low, otherwise `none`. */
function whenAbsent(absent: Severity): (s: SignalStatus) => Severity {
  return (s) => (s === 'absent' ? absent : s === 'undetermined' ? 'low' : 'none');
}

const RULES: Record<SignalKey, (status: SignalStatus, value: SignalValue) => Severity> = {
  // ── contract ──
  honeypot: whenPresent('critical'),
  buy_tax: (s, v) => (s === 'present' ? taxSeverity(v, false) : s === 'undetermined' ? 'low' : 'none'),
  sell_tax: (s, v) => (s === 'present' ? taxSeverity(v, true) : s === 'undetermined' ? 'low' : 'none'),
  mint_authority: whenPresent('medium'),
  owner_status: whenPresent('medium'),
  blacklist: whenPresent('medium'),
  pausable: whenPresent('medium'),
  anti_whale: (s) => (s === 'present' ? 'low' : 'none'),
  proxy_upgradeable: whenPresent('medium'),
  source_verified: whenAbsent('medium'),
  mutable_taxes: whenPresent('medium'),
  hidden_owner_privileges: whenPresent('high'),
  // Authoritative severity is set in safeAnalyzer.normaliser (reportx max-point
  // + >500 unique override) and passed to buildSignal; this is only a fallback.
  contract_scam_flags: () => 'low',
  // ── holder ──
  top1_holder_share: (_s, v) => top1Share(v),
  top10_holder_share: (_s, v) => top10Share(v),
  holder_count: (_s, v) => holderCount(v),
  deployer_share: (_s, v) => deployerShare(v),
  // ── liquidity ──
  liquidity_usd: (_s, v) => liquidityUsd(v),
  lp_locked: whenAbsent('medium'),
  lp_lock_duration: (_s, v) => lockDuration(v),
  lp_holder_count: (_s, v) => lpHolderCount(v),
};

/** Map a signal's (key, status, value) to its Severity using the rules above. */
export function severityFor(key: SignalKey, status: SignalStatus, value: SignalValue): Severity {
  return RULES[key](status, value);
}
