import type { Signal } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import type { SignalKey } from './keys.js';
import { asStatus, asString, buildSignal, isRecord } from './keys.js';

const SOURCE = SOURCES.codeLevelChecker;

/**
 * Map each of the checker's five observations onto a canonical key.
 *
 * `restrict_transfers` → `pausable`: the closest general "owner can halt/restrict
 * transfers" capability. The more specific `blacklist` key is populated by the
 * sources that explicitly detect per-address blacklisting (GoPlus, SafeAnalyzer),
 * so it is kept distinct here.
 */
const OBSERVATION_TO_KEY: Record<string, SignalKey> = {
  mint_after_deploy: 'mint_authority',
  restrict_transfers: 'pausable',
  mutable_taxes: 'mutable_taxes',
  hidden_owner_privileges: 'hidden_owner_privileges',
  ownership_status: 'owner_status',
};

/**
 * (6) Code-Level Checker → its five LLM observations, mapped 1:1 onto canonical
 * keys. The observation `status` (present/absent/undetermined) is carried
 * through unchanged and its `evidence` becomes `Signal.evidence`. An unverified
 * contract has an empty `checks` array, so it emits no signals (absence = "this
 * source had nothing to say").
 */
export function normaliseCodeChecker(raw: unknown): Signal[] {
  if (!isRecord(raw) || !Array.isArray(raw.checks)) return [];
  const signals: Signal[] = [];

  for (const observation of raw.checks) {
    if (!isRecord(observation)) continue;
    const key = OBSERVATION_TO_KEY[asString(observation.check)];
    if (!key) continue;
    const status = asStatus(observation.status);
    if (!status) continue;
    const value = status === 'present' ? true : status === 'absent' ? false : null;
    signals.push(buildSignal(SOURCE, key, status, value, asString(observation.evidence)));
  }

  return signals;
}
