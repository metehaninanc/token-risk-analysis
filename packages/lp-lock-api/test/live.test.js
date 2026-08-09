// Live tests — hit mainnet through LP_RPC_URL. Each fixture is a real token whose
// LP is locked/burned via a specific source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findLpLocks, loadEnv } from '../src/index.js';

loadEnv();

const CASES = [
  ['OnlyMoons', { token: '0xbb260eb2d4386b32dec46d9f7059d4ed6e78be33' }, 'OnlyMoons'],
  ['PinkLock', { token: '0x89fabe8405cfde3f6aeed8804e3ba4a10b7e21d3', pair: '0x89fabe8405cfde3f6aeed8804e3ba4a10b7e21d3' }, 'PinkLock'],
  ['UNCX', { token: '0xd0fbf2eec98c3388fa83a489631b5b27541899b5', pair: '0xf7ebdc2a28DDF98881bF6Fea55ed1E51949E8a0A' }, 'UNCX'],
  ['Burn', { token: '0x3AdD95b59415a95db0a546d8e7E49CA06BC77946', pair: '0x7Da918d7077923bBF02dBF5abc349CFCE8FEc4c1' }, 'Burn'],
];

const STANDARD_FIELDS = ['source', 'lockerContract', 'lockedToken', 'owner', 'amount', 'lockedPercent', 'lockDate', 'unlockTime', 'isBurned', 'lockId', 'description', 'raw'];

for (const [label, input, expected] of CASES) {
  test(`${label}: detected and returned in the standard format`, { timeout: 30000 }, async () => {
    const r = await findLpLocks(input);
    assert.equal(r.locked, true, `${label} should be locked`);
    assert.ok(r.sources.includes(expected), `expected ${expected}, got [${r.sources}]`);
    assert.ok(r.locks.length > 0);
    for (const lock of r.locks) {
      for (const f of STANDARD_FIELDS) assert.ok(f in lock, `missing field "${f}" in ${label} record`);
    }
  });
}

test('Burn only runs when the lockers find nothing', async () => {
  const r = await findLpLocks(CASES[0][1]); // OnlyMoons token
  assert.ok(!r.checked.includes('Burn'), 'burn check should be skipped when a locker matched');
});

test('rejects when no address is given', async () => {
  await assert.rejects(() => findLpLocks({}), /Provide a token/);
});

test('rejects an invalid address', async () => {
  await assert.rejects(() => findLpLocks({ token: 'nope' }), /Invalid token address/);
});
