import type { Severity, Signal, SignalStatus } from '../types/index.js';
import { SOURCES } from '../types/index.js';
import type { SignalKey, SignalValue } from './keys.js';
import { asString, buildSignal, isRecord, toNumber } from './keys.js';

const SOURCE = SOURCES.safeAnalyzer;

/** Strip HTML tags and collapse whitespace (SafeAnalyzer returns HTML strings). */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Pull a "<label>: N%" percentage out of a stripped taxes string. */
function labelledPercent(text: string, label: string): number | undefined {
  const match = new RegExp(`${label}\\s*:?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*%`, 'i').exec(text);
  return match ? toNumber(match[1]) : undefined;
}

/** Map the `honeypot` STATUS STRING to a status + value. */
function honeypotStatus(value: string): { status: SignalStatus; value: SignalValue; evidence: string } {
  const text = value.trim();
  if (text === '') return { status: 'absent', value: false, evidence: '' };
  const upper = text.toUpperCase();
  if (upper.includes('SIMULATION FAILED') || upper.includes('TOO LOW') || upper.includes('LIQU')) {
    return { status: 'undetermined', value: text, evidence: text };
  }
  return { status: 'present', value: text, evidence: text };
}

/** Map one `reportx[]` flag object onto a canonical key. */
function mapReportxFlag(flag: unknown): { key: SignalKey; evidence: string } | undefined {
  if (!isRecord(flag)) return undefined;
  const item = asString(flag.item).toLowerCase();
  const evidence = asString(flag.data) || asString(flag.point) || asString(flag.item);
  if (item.includes('blacklist')) return { key: 'blacklist', evidence };
  if (item.includes('mint')) return { key: 'mint_authority', evidence };
  if (item.includes('proxy')) return { key: 'proxy_upgradeable', evidence };
  if (item.includes('fee') || item.includes('tax')) return { key: 'mutable_taxes', evidence };
  if (item.includes('trading') || item.includes('pause') || item.includes('disable')) {
    return { key: 'pausable', evidence };
  }
  return undefined;
}

/**
 * (3) SafeAnalyzer → cross-validation of contract flags + liquidity/holder data.
 *
 * Parses the HTML-formatted fields carefully:
 *   `taxes` ("Buy: <b>X%</b> | Sell: <b>Y%</b>") → strip tags → `buy_tax`/`sell_tax`
 *   `honeypot` STATUS STRING → `honeypot` (''=absent; SIMULATION FAILED/TOO LOW
 *     LIQUDITY=undetermined; other non-empty=present)
 *   `owner` (`***RENOUNCED***` / address) → `owner_status`
 *   `lockValue` (HTML) → `lp_locked`
 *   `holders` ([count, ...]) → `holder_count`
 *   `reportx[]` flags → blacklist / mint / proxy / mutable_taxes(set-fee) /
 *     pausable(trading-disable), AND → `contract_scam_flags`: any point>=53 = scam
 *     (high), 7 = medium — UNLESS the point sum >500 ("unique"/over-fire → low);
 *     value = point sum.
 */
export function normaliseSafeAnalyzer(raw: unknown): Signal[] {
  if (!isRecord(raw)) return [];
  const signals: Signal[] = [];

  if (typeof raw.taxes === 'string' && raw.taxes.trim() !== '') {
    const text = stripHtml(raw.taxes);
    const buy = labelledPercent(text, 'buy');
    const sell = labelledPercent(text, 'sell');
    if (buy !== undefined) signals.push(buildSignal(SOURCE, 'buy_tax', 'present', buy, text));
    if (sell !== undefined) signals.push(buildSignal(SOURCE, 'sell_tax', 'present', sell, text));
  }

  if (typeof raw.honeypot === 'string') {
    const hp = honeypotStatus(raw.honeypot);
    signals.push(buildSignal(SOURCE, 'honeypot', hp.status, hp.value, hp.evidence));
  }

  if (typeof raw.owner === 'string' && raw.owner.trim() !== '') {
    const renounced = /renounced/i.test(raw.owner);
    signals.push(
      buildSignal(
        SOURCE,
        'owner_status',
        renounced ? 'absent' : 'present',
        renounced ? 'renounced' : raw.owner,
        raw.owner,
      ),
    );
  }

  if (typeof raw.lockValue === 'string' && raw.lockValue.trim() !== '') {
    const text = stripHtml(raw.lockValue);
    const lower = text.toLowerCase();
    // An EXPIRED lock means the LP is no longer locked → absent, not present.
    if (/expired/.test(lower)) {
      signals.push(buildSignal(SOURCE, 'lp_locked', 'absent', false, text));
    } else if (/burn|lock/.test(lower)) {
      signals.push(buildSignal(SOURCE, 'lp_locked', 'present', true, text));
    }
  }

  if (Array.isArray(raw.holders) && raw.holders.length > 0) {
    const count = toNumber(raw.holders[0]);
    if (count !== undefined) signals.push(buildSignal(SOURCE, 'holder_count', 'present', count));
  }

  if (Array.isArray(raw.reportx)) {
    let pointSum = 0;
    let maxPoint = 0;
    for (const flag of raw.reportx) {
      if (isRecord(flag)) {
        const p = toNumber(flag.point);
        if (p !== undefined) {
          pointSum += p;
          if (p > maxPoint) maxPoint = p;
        }
      }
      const mapped = mapReportxFlag(flag);
      if (mapped) signals.push(buildSignal(SOURCE, mapped.key, 'present', true, mapped.evidence));
    }
    // Rule (per the API author): a SINGLE point >= 53 is already scam → high;
    // 7 → medium; any flag → low. BUT if the point SUM > 500, the Rug-Checker
    // regex has over-fired on an unusual ("unique") contract, so it is NOT
    // treated as scam (down-weighted to low). `value` = sum for inspection.
    const unique = pointSum > 500;
    const severity: Severity = unique
      ? 'low'
      : maxPoint >= 53
        ? 'high'
        : maxPoint >= 7
          ? 'medium'
          : maxPoint > 0
            ? 'low'
            : 'none';
    const evidence = `reportx: max point ${maxPoint}, sum ${pointSum}${unique ? ' — unique/over-fire (>500)' : ''}`;
    signals.push(buildSignal(SOURCE, 'contract_scam_flags', 'present', pointSum, evidence, severity));
  }

  return signals;
}
