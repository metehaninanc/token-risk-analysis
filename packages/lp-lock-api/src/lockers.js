// The four LP-lock sources. Each query returns a list of records in ONE standard
// shape (see record()); a source with no lock returns []. Only the exact contract
// functions specified are called.
import { ethers } from 'ethers';

export const LOCKERS = {
  ONLYMOONS: '0x7BF2f06D65b5C9f146ea79a4eCC7C7cdFC01B613',
  PINKLOCK: '0x71B5759d73262FBb223956913ecF4ecC51057641',
  UNCX: '0x663A5C229c09b049E36dCc11a9B0d4a8Eb9db214',
};

// Burn addresses to check (0x..0, 0x..dEaD, 0x..1).
export const BURN_ADDRESSES = [
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dEaD',
  '0x0000000000000000000000000000000000000001',
];

const ABI = {
  onlymoons: [
    'function getTokenLockersForAddress(address) view returns (uint40[])',
    'function getTokenLockData(uint40 id) view returns (bool isLpToken, uint40 id, address contractAddress, address lockOwner, address token, address createdBy, uint40 createdAt, uint40 unlockTime, uint256 balance, uint256 totalSupply)',
  ],
  pinklock: [
    'function getLocksForToken(address token, uint256 start, uint256 end) view returns (tuple(uint256 id, address token, address owner, uint256 amount, uint256 lockDate, uint256 tgeDate, uint256 tgeBps, uint256 cycle, uint256 cycleBps, uint256 unlockedAmount, string description)[])',
  ],
  uncx: [
    'function tokenLocks(address, uint256) view returns (uint256 lockDate, uint256 amount, uint256 initialAmount, uint256 unlockDate, uint256 lockID, address owner)',
  ],
  erc20: [
    'function balanceOf(address) view returns (uint256)',
    'function totalSupply() view returns (uint256)',
  ],
};

const str = (v) => (v == null ? null : v.toString());
const num = (v) => (v == null ? null : Number(v));

/** locked amount as a percentage of LP supply (2 decimals), when supply is known. */
function percent(amount, total) {
  if (amount == null || total == null) return null;
  const t = BigInt(total);
  if (t === 0n) return null;
  return Number((BigInt(amount) * 10000n) / t) / 100;
}

/** The one standard lock record every source maps into. */
function record(o) {
  return {
    source: o.source,
    lockerContract: o.lockerContract,
    lockedToken: o.lockedToken ?? null,
    owner: o.owner ?? null,
    amount: str(o.amount),
    lockedPercent: o.lockedPercent ?? null,
    lockDate: num(o.lockDate),
    unlockTime: num(o.unlockTime),
    isBurned: !!o.isBurned,
    lockId: str(o.lockId),
    description: o.description ?? null,
    raw: o.raw ?? null,
  };
}

/** OnlyMoons — query by the token; each returned id resolves to lock data. */
export async function onlyMoons(provider, token) {
  const c = new ethers.Contract(LOCKERS.ONLYMOONS, ABI.onlymoons, provider);
  const ids = await c.getTokenLockersForAddress(token);
  const out = [];
  for (const id of ids) {
    const d = await c.getTokenLockData(id);
    out.push(
      record({
        source: 'OnlyMoons',
        lockerContract: LOCKERS.ONLYMOONS,
        lockedToken: d.token,
        owner: d.lockOwner,
        amount: d.balance,
        lockedPercent: percent(d.balance, d.totalSupply),
        lockDate: d.createdAt,
        unlockTime: d.unlockTime,
        lockId: d.id,
        raw: {
          isLpToken: d.isLpToken,
          contractAddress: d.contractAddress,
          createdBy: d.createdBy,
          totalSupply: str(d.totalSupply),
        },
      }),
    );
  }
  return out;
}

/** PinkLock — query by the pair; (start,end) clamps to the real count. A token with
 *  no locks makes the contract underflow-revert, which we read as "no lock". */
export async function pinkLock(provider, pair) {
  const c = new ethers.Contract(LOCKERS.PINKLOCK, ABI.pinklock, provider);
  let locks;
  try {
    locks = await c.getLocksForToken(pair, 0, 100000);
  } catch (e) {
    if (e?.code === 'CALL_EXCEPTION') return []; // no locks for this token
    throw e;
  }
  return locks.map((l) => {
    let description = l.description;
    try {
      const parsed = JSON.parse(l.description);
      description = (parsed.l ?? parsed.label ?? l.description).toString().trim();
    } catch {
      /* not JSON — keep the raw string */
    }
    return record({
      source: 'PinkLock',
      lockerContract: LOCKERS.PINKLOCK,
      lockedToken: l.token,
      owner: l.owner,
      amount: l.amount,
      lockDate: l.lockDate,
      unlockTime: l.tgeDate, // simple locks unlock at tgeDate
      lockId: l.id,
      description,
      raw: {
        tgeBps: str(l.tgeBps),
        cycle: str(l.cycle),
        cycleBps: str(l.cycleBps),
        unlockedAmount: str(l.unlockedAmount),
      },
    });
  });
}

/** UNCX — query by the pair at index 0; an empty slot reverts (= no lock). */
export async function uncx(provider, pair) {
  const c = new ethers.Contract(LOCKERS.UNCX, ABI.uncx, provider);
  try {
    const d = await c.tokenLocks(pair, 0);
    if (d.amount === 0n) return [];
    return [
      record({
        source: 'UNCX',
        lockerContract: LOCKERS.UNCX,
        lockedToken: pair,
        owner: d.owner,
        amount: d.amount,
        lockDate: d.lockDate,
        unlockTime: d.unlockDate,
        lockId: d.lockID,
        raw: { initialAmount: str(d.initialAmount) },
      }),
    ];
  } catch (e) {
    if (e?.code === 'CALL_EXCEPTION') return []; // index out of range = no lock
    throw e;
  }
}

/** Burn check — fallback only. How much LP supply sits at dead addresses. */
export async function burnCheck(provider, pair) {
  const c = new ethers.Contract(pair, ABI.erc20, provider);
  const [total, ...balances] = await Promise.all([
    c.totalSupply(),
    ...BURN_ADDRESSES.map((b) => c.balanceOf(b)),
  ]);
  const out = [];
  BURN_ADDRESSES.forEach((addr, i) => {
    if (balances[i] > 0n) {
      out.push(
        record({
          source: 'Burn',
          lockerContract: addr,
          lockedToken: pair,
          owner: null,
          amount: balances[i],
          lockedPercent: percent(balances[i], total),
          unlockTime: 0, // burned = permanent
          isBurned: true,
          raw: { burnAddress: addr, totalSupply: str(total) },
        }),
      );
    }
  });
  return out;
}
