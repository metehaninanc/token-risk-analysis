import type { Signal } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import { asString, buildSignal, isRecord, toNumber } from './keys.js';

const SOURCE = SOURCES.lpLockReader;

/** Names of the lockers that reported a lock, for evidence. */
function lockerEvidence(raw: Record<string, unknown>): string {
  return Array.isArray(raw.sources) ? raw.sources.map(String).join(', ') : '';
}

/**
 * Longest remaining lock across `locks[]`, in seconds. A burned/permanent lock
 * (`isBurned` or `unlockTime === 0`) is reported as effectively infinite.
 */
function longestRemaining(
  locks: unknown[],
): { seconds: number; evidence: string } | undefined {
  const now = Math.floor(Date.now() / 1000);
  let best: number | undefined;
  let burned = false;
  let source = '';

  for (const lock of locks) {
    if (!isRecord(lock)) continue;
    const name = asString(lock.source);
    if (lock.isBurned === true) {
      burned = true;
      source = name || source;
      continue;
    }
    const unlock = toNumber(lock.unlockTime);
    if (unlock === undefined) continue;
    if (unlock === 0) {
      burned = true; // 0 = permanent in lp-lock-api
      source = name || source;
      continue;
    }
    const remaining = unlock - now;
    if (best === undefined || remaining > best) {
      best = remaining;
      source = name || source;
    }
  }

  if (burned) return { seconds: Number.MAX_SAFE_INTEGER, evidence: 'LP burned / permanent lock' };
  if (best === undefined) return undefined;
  return { seconds: best, evidence: source ? `locker: ${source}` : '' };
}

/**
 * (5) LP-Lock reader → `lp_locked`, `lp_lock_duration`, `lp_holder_count`.
 *
 * Input is the lp-lock-api response `{ locked, count, sources, locks[] }`.
 * `locked` → `lp_locked`; the longest `locks[].unlockTime` → `lp_lock_duration`
 * (remaining seconds; burned = permanent). NOTE: the current lp-lock-api does
 * NOT expose an LP holder count, so `lp_holder_count` is emitted only if a
 * future payload provides one — it is never fabricated from the lock count.
 */
export function normaliseLpLock(raw: unknown): Signal[] {
  if (!isRecord(raw)) return [];
  const signals: Signal[] = [];

  if (typeof raw.locked === 'boolean') {
    signals.push(
      buildSignal(SOURCE, 'lp_locked', raw.locked ? 'present' : 'absent', raw.locked, lockerEvidence(raw)),
    );
  }

  const locks = Array.isArray(raw.locks) ? raw.locks : [];
  const duration = longestRemaining(locks);
  if (duration !== undefined) {
    signals.push(buildSignal(SOURCE, 'lp_lock_duration', 'present', duration.seconds, duration.evidence));
  }

  const lpHolders = toNumber(raw.lpHolderCount);
  if (lpHolders !== undefined) {
    signals.push(buildSignal(SOURCE, 'lp_holder_count', 'present', lpHolders));
  }

  return signals;
}
