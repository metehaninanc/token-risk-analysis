import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** One labelled token in the evaluation set. */
export interface LabelledToken {
  address: string;
  label: 'scam' | 'legitimate';
  /** Where the ground-truth label came from — MUST be independent of the signal sources. */
  labelSource: string;
}

/**
 * ANTI-CIRCULARITY (methodology 3.6): the ground-truth labels MUST come from
 * sources that are independent of the signal sources the system itself queries.
 * Using a security API's own verdict (GoPlus / SafeAnalyzer / honeypot.is) as the
 * label would make the evaluation circular. These substrings are flagged.
 */
const SIGNAL_SOURCE_HINTS = [
  'goplus',
  'safeanalyzer',
  'dexanalyzer',
  'honeypot_is',
  'honeypot.is',
  'honeypotis',
  'dexscreener',
  'lp_lock',
  'code_checker',
  'code_level_checker',
];

export const DEFAULT_LABELS_PATH = 'data/eval/labels.json';

/**
 * Versioned baseline set (independent, legitimate blue-chips) — a fresh-checkout
 * FALLBACK only. Once `data/eval/labels.json` exists (it is now tracked in git),
 * that FILE is the SOURCE OF TRUTH: `loadLabelledTokens` prefers it, so keep this
 * constant and the file in sync (or let the file win).
 *
 * TODO(researcher): grow the tracked `data/eval/labels.json` to the 50/50 target:
 *   - paste 50 REAL scam addresses collected from INDEPENDENT registries
 *     (Chainabuse, TokenSniffer, RugDoc, CertiK), each with its `labelSource`;
 *     build entries safely with the `scamLabel(address, registry)` helper.
 *   - verify/extend the 50 legitimate addresses (independent listings only).
 * NEVER use a signal source (goplus / safeanalyzer / honeypot_is) as a labelSource.
 */
export const DEFAULT_LABELS: LabelledToken[] = [
  { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', label: 'legitimate', labelSource: 'coingecko-top-marketcap' },
  { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', label: 'legitimate', labelSource: 'coingecko-top-marketcap' },
  { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', label: 'legitimate', labelSource: 'defillama-bluechip' },
  { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', label: 'legitimate', labelSource: 'coingecko-top-marketcap' },
  { address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', label: 'legitimate', labelSource: 'etherscan-public-labels' },
  { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', label: 'legitimate', labelSource: 'defillama-bluechip' },
  { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', label: 'legitimate', labelSource: 'coingecko-top-marketcap' },
  { address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', label: 'legitimate', labelSource: 'etherscan-public-labels' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLabelledToken(value: unknown): value is LabelledToken {
  if (!isRecord(value)) return false;
  return (
    typeof value.address === 'string' &&
    (value.label === 'scam' || value.label === 'legitimate') &&
    typeof value.labelSource === 'string'
  );
}

/** Accept either a bare array or `{ tokens: [...] }` (so a `_readme` can travel with the file). */
function extractTokens(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (isRecord(raw) && Array.isArray(raw.tokens)) return raw.tokens;
  return [];
}

/**
 * Load the labelled evaluation set from `path` (default `data/eval/labels.json`).
 * The FILE is the source of truth once present; `DEFAULT_LABELS` is only the
 * fresh-checkout fallback, so the evaluation stays reproducible even without it.
 */
export async function loadLabelledTokens(path: string = DEFAULT_LABELS_PATH): Promise<LabelledToken[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(resolve(path), 'utf8'));
  } catch {
    return [...DEFAULT_LABELS];
  }
  const tokens = extractTokens(raw).filter(isLabelledToken);
  return tokens.length > 0 ? tokens : [...DEFAULT_LABELS];
}

/** True if a labelSource names one of the signal sources under test. */
function isSignalSource(labelSource: string): boolean {
  const source = labelSource.toLowerCase();
  return SIGNAL_SOURCE_HINTS.some((hint) => source.includes(hint));
}

/**
 * Throw if `labelSource` names a signal source — using a source under test as the
 * ground-truth label creates circularity (methodology 3.6). Independent registries
 * (chainabuse, tokensniffer, rugdoc, certik, etherscan/coingecko listings) are fine.
 */
export function assertIndependentSource(labelSource: string): void {
  if (isSignalSource(labelSource)) {
    throw new Error(
      `Circular label source "${labelSource}": labels must be INDEPENDENT of the signal sources under test (methodology 3.6). Use an independent registry (Chainabuse, TokenSniffer, RugDoc, CertiK, or a listing like Etherscan/CoinGecko).`,
    );
  }
}

/**
 * Enforce label independence across the whole set (methodology 3.6). THROWS,
 * listing every offender, if any `labelSource` matches a signal source id
 * (goplus / safeanalyzer / honeypot_is / …) — circular labels must never pass
 * silently into the evaluation.
 */
export function checkLabelIndependence(tokens: LabelledToken[]): void {
  const offenders = tokens.filter((t) => isSignalSource(t.labelSource));
  if (offenders.length > 0) {
    const detail = offenders.map((t) => `${t.address} (labelSource="${t.labelSource}")`).join('; ');
    throw new Error(
      `Circular label sources detected (methodology 3.6) — labels must be independent of the signal sources under test: ${detail}`,
    );
  }
}

/**
 * SCAM-LABEL INTAKE — build a scam label from a REAL address you collected by
 * hand from an INDEPENDENT registry. This does NOT fabricate addresses: you pass
 * a verified address and the registry it came from. Throws if `registry` names a
 * signal source (3.6).
 *
 *   scamLabel('0x<verified>', 'chainabuse')
 *   scamLabel('0x<verified>', 'tokensniffer')
 *   scamLabel('0x<verified>', 'rugdoc')
 */
export function scamLabel(address: string, registry: string): LabelledToken {
  assertIndependentSource(registry);
  return { address, label: 'scam', labelSource: registry };
}
