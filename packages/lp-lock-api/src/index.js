// Public API: find a token's LP locks across OnlyMoons / PinkLock / UNCX, falling
// back to a burn-address check, and return them in one standard format.
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { onlyMoons, pinkLock, uncx, burnCheck } from './lockers.js';

/** Load .env (for LP_RPC_URL). Prefers Node's built-in loader, falls back to a tiny parser. */
export function loadEnv(path = '.env') {
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(path);
      return;
    } catch {
      /* fall through */
    }
  }
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    /* no .env — fine */
  }
}

/** A JSON-RPC provider from LP_RPC_URL (read at call time, after loadEnv). */
export function getProvider() {
  const url = process.env.LP_RPC_URL;
  if (!url) throw new Error('No RPC URL. Set LP_RPC_URL (env var or .env in the project root).');
  return new ethers.JsonRpcProvider(url);
}

const isAddress = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v.trim());

/**
 * @param {{token?: string, pair?: string}} input  token (for OnlyMoons) and/or LP pair (others)
 * @param {{provider?: import('ethers').Provider}} [options]
 * @returns {Promise<object>} standard result: { query, locked, sources, count, locks[], checked, errors? }
 */
export async function findLpLocks({ token, pair } = {}, options = {}) {
  if (!token && !pair) throw new Error('Provide a token and/or pair address');
  for (const [k, v] of Object.entries({ token, pair })) {
    if (v && !isAddress(v)) throw new Error(`Invalid ${k} address: "${v}"`);
  }

  const provider = options.provider ?? getProvider();
  const onlyAddr = (token ?? pair).toLowerCase();
  const pairAddr = (pair ?? token).toLowerCase();

  const errors = {};
  const safe = (name, promise) =>
    promise.then((locks) => locks).catch((e) => {
      errors[name] = e.shortMessage || e.message;
      return [];
    });

  const [om, pl, un] = await Promise.all([
    safe('OnlyMoons', onlyMoons(provider, onlyAddr)),
    safe('PinkLock', pinkLock(provider, pairAddr)),
    safe('UNCX', uncx(provider, pairAddr)),
  ]);

  let locks = [...om, ...pl, ...un];
  const checked = ['OnlyMoons', 'PinkLock', 'UNCX'];

  // Burn check runs only when no locker returned a result.
  if (locks.length === 0) {
    locks = await safe('Burn', burnCheck(provider, pairAddr));
    checked.push('Burn');
  }

  return {
    query: { token: token ?? null, pair: pair ?? null },
    locked: locks.length > 0,
    count: locks.length,
    sources: [...new Set(locks.map((l) => l.source))],
    locks,
    checked,
    ...(Object.keys(errors).length ? { errors } : {}),
  };
}

export { onlyMoons, pinkLock, uncx, burnCheck, LOCKERS, BURN_ADDRESSES } from './lockers.js';
