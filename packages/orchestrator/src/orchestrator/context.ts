import type { Severity, Signal } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { SEVERITY_ORDER } from './aggregate.js';

/**
 * CONTEXTUAL ADJUSTMENTS — deterministic, documented post-merge rules (§3.3/§3.4).
 * Applied AFTER merge and BEFORE overall aggregation. They only ever LOWER a
 * severity, never raise it, and every change is written into the signal's
 * `evidence` for a transparent audit trail.
 *
 *  A. RENOUNCE NEUTRALISATION — if ownership is renounced (a RUNTIME fact from
 *     GoPlus `owner_address == 0x0` or SafeAnalyzer "RENOUNCED"), the classic
 *     owner-only capabilities cannot be invoked, so their risk drops to `none`.
 *     `hidden_owner_privileges` is NOT auto-neutralised — it may be a non-owner
 *     backdoor; the (renounce-aware) code checker judges that.
 *
 *  B. GOPLUS-ONLY CAP — GoPlus's static code check is shallow, so a contract
 *     capability that ONLY GoPlus reports (no SafeAnalyzer / code-checker
 *     corroboration) is capped at `low`. Corroborated signals keep full severity.
 *     GoPlus's honeypot / tax / holder data is untouched (not a shallow code call).
 */

/** Owner-only capabilities that are inert once ownership is renounced. */
const OWNER_ONLY_KEYS = new Set<string>(['blacklist', 'pausable', 'mint_authority', 'mutable_taxes']);

/** GoPlus's shallow static contract flags — capped at low when uncorroborated. */
const GOPLUS_SHALLOW_KEYS = new Set<string>([
  'blacklist',
  'hidden_owner_privileges',
  'mint_authority',
  'pausable',
  'proxy_upgradeable',
]);

/**
 * Renouncement is decided from the RUNTIME sources only (GoPlus / SafeAnalyzer).
 * The code checker's source-only `ownership_status` is unreliable for CURRENT
 * state, so it is deliberately excluded here.
 */
export function isRenounced(singleSourceSignals: Signal[]): boolean {
  return singleSourceSignals.some(
    (s) =>
      s.key === 'owner_status' &&
      s.status === 'absent' &&
      (s.sources[0] === SOURCES.goplus || s.sources[0] === SOURCES.safeAnalyzer),
  );
}

function withSeverity(signal: Signal, severity: Severity, note: string): Signal {
  return { ...signal, severity, evidence: signal.evidence ? `${signal.evidence} — ${note}` : note };
}

/** The sources that ASSERT `key` as present (from the pre-merge single-source signals). */
function assertingSources(single: Signal[], key: string): string[] {
  return single
    .filter((s) => s.key === key && s.status === 'present')
    .map((s) => s.sources[0] ?? '');
}

/**
 * Apply the contextual adjustments to the merged signals (deterministic).
 * `single` is the pre-merge single-source signal list, used to tell which
 * source actually ASSERTS a capability (so GoPlus can be capped even when the
 * code checker disagrees, which would otherwise make it look "multi-source").
 */
export function applyContext(merged: Signal[], single: Signal[], renounced: boolean): Signal[] {
  return merged.map((signal) => {
    // A. Renounce neutralisation — owner can't call it, so no risk remains.
    if (
      renounced &&
      OWNER_ONLY_KEYS.has(signal.key) &&
      signal.status === 'present' &&
      signal.severity !== 'none'
    ) {
      return withSeverity(
        signal,
        'none',
        'ownership renounced — this owner-only capability cannot be invoked',
      );
    }
    // B. GoPlus-only cap — GoPlus is the LONE source asserting this shallow
    //    static-code capability (SafeAnalyzer / code checker do not corroborate,
    //    or actively disagree). Its shallow check shouldn't drive a high verdict.
    if (GOPLUS_SHALLOW_KEYS.has(signal.key) && SEVERITY_ORDER[signal.severity] > SEVERITY_ORDER.low) {
      const asserters = assertingSources(single, signal.key);
      if (asserters.length > 0 && asserters.every((src) => src === SOURCES.goplus)) {
        return withSeverity(
          signal,
          'low',
          'asserted only by GoPlus (shallow static check), uncorroborated by SafeAnalyzer or the code checker — capped',
        );
      }
    }
    // C. lp_locked — POSITIVE EVIDENCE WINS. A lock/burn found by ANY source
    //    (GoPlus / SafeAnalyzer / lp-lock-api) is not cancelled by another source
    //    that reports "not locked" — that is usually just an incomplete check
    //    (e.g. lp-lock-api without the pair sees only OnlyMoons). One confirmation
    //    is enough. This overrides the generic fail-safe for this key only.
    if (signal.key === 'lp_locked' && signal.status !== 'present') {
      const confirmers = assertingSources(single, 'lp_locked');
      if (confirmers.length > 0) {
        return {
          ...signal,
          status: 'present',
          value: true,
          severity: 'none',
          evidence: `${signal.evidence ? `${signal.evidence} — ` : ''}LP lock/burn confirmed by ${[...new Set(confirmers)].join(', ')} — positive evidence wins`,
        };
      }
    }
    return signal;
  });
}
