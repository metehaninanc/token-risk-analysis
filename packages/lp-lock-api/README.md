# lp-lock-api

Given a token, checks whether the LP is **locked or
burned**, and returns it in one standard format. 

```bash

## Result

```jsonc
{
  "query":  { "token", "pair" },
  "locked": true,
  "count":  1,
  "sources": ["OnlyMoons"],
  "checked": ["OnlyMoons", "PinkLock", "UNCX"],
  "locks": [{
    "source": "OnlyMoons",
    "lockerContract": "0x7BF2…",
    "lockedToken": "0x…",        // the LP/token that is locked
    "owner": "0x…",              // null for burns
    "amount": "264575131106458059",
    "lockedPercent": 99.99,       // when LP supply is known (OnlyMoons / Burn)
    "lockDate": 1761153731,
    "unlockTime": 1792689692,     // 0 = permanent (burn)
    "isBurned": false,
    "lockId": "262",
    "description": null,          // PinkLock label, when present
    "raw": { … }                  // source-specific extras, nothing lost
  }]
}
```