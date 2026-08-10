# orchestrator — explainable token risk assessment

The unifying engine for the thesis *Explainable Conversational AI for Blockchain
Token Risk Assessment*. It merges **six independent sources** into a single,
deterministic, explainable **risk profile**, then lets a grounded LLM explain
that profile in natural language.

It sits alongside the two existing sub-projects, which become two of its six
sources:

- [`token-risk-api/`](../token-risk-api) → the **Code-Level Checker** source
- [`lp-lock-api/`](../lp-lock-api) → the **LP-Lock Reader** source

> **Module 0 (this commit): scaffolding + shared signal schema only.**
> No detector, scoring, or LLM logic yet — collectors are stubs and the
> downstream layers are typed contracts.

## Architecture — three layers, six sources

```
                        ┌─────────────── data collection ───────────────┐
  token address  ──▶    │ 1 GoPlus   2 honeypot.is   3 SafeAnalyzer      │
                        │ 4 DexScreener   5 LP-Lock Reader (on-chain)    │
                        │ 6 Code-Level Checker (LLM over verified source)│
                        └───────────────────────┬───────────────────────┘
                                                 │ RawCollectorResult[]
                                                 ▼
                                   normaliser  → Signal[]        (shared schema)
                                                 ▼
                                   orchestrator → RiskProfile    (deterministic merge)
                                                 ▼
                                   conversation → natural-language explanation
                                                 ▼
                                   evaluation   → reproducible scoring vs labels
```

Etherscan is **not** a source — it is used only to fetch verified source code
for the code-level checker.

## Pipeline order

1. **collectors** (`src/collectors/`) — six independent collectors; each takes a
   token address and returns a raw, untouched `RawCollectorResult`. Raw
   responses are archived to disk (`{address}/{source}.json`) for
   reproducibility.
2. **normaliser** (`src/normaliser/`) — maps each source's raw payload into the
   **shared `Signal` schema** (`src/types/signal.ts`).
3. **orchestrator** (`src/orchestrator/`) — a deterministic, rule-based merge of
   signals into one `RiskProfile` (dedupe by `key`, flag conflicts, derive
   `overallRisk`). **No ML, no training.**
4. **conversation** (`src/conversation/`) — a grounded LLM that only *explains*
   the computed `RiskProfile`; it never changes the risk.
5. **evaluation** (`src/evaluation/`) — runs the pipeline over a labelled corpus
   for reproducible measurement.

## Layout

```
orchestrator/
├── index.ts                 public entry point (re-exports contracts + collectors)
├── package.json
├── tsconfig.json
├── .env.example
└── src/
    ├── collectors/          one file per source (stubs in Module 0)
    │   ├── goplus.collector.ts
    │   ├── honeypotIs.collector.ts
    │   ├── safeAnalyzer.collector.ts
    │   ├── dexScreener.collector.ts
    │   ├── lpLockReader.collector.ts
    │   ├── codeLevelChecker.collector.ts
    │   ├── result.ts        ok/fail RawCollectorResult builders
    │   └── index.ts         barrel + createCollectors()
    ├── normaliser/          Normaliser contract (impl. later)
    ├── orchestrator/        Orchestrator contract (impl. later)
    ├── conversation/        Conversation contract (impl. later)
    ├── evaluation/          Evaluator contract (impl. later)
    ├── types/               SHARED SIGNAL SCHEMA + Collector/RiskProfile types
    │   ├── sources.ts       canonical source ids
    │   ├── signal.ts        Severity, SignalStatus, Signal
    │   ├── collector.ts     RawCollectorResult, Collector
    │   ├── riskProfile.ts   RiskProfile
    │   └── index.ts
    ├── config/              typed, env-based config loader
    └── utils/               archive helper (reproducibility)
```

## Shared signal schema

Every collector output is normalised to `Signal[]`. See
[`src/types/signal.ts`](src/types/signal.ts):

```ts
type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical';
type SignalStatus = 'present' | 'absent' | 'undetermined';

interface Signal {
  key: string;              // e.g. 'mint_authority', 'lp_locked', 'honeypot'
  group: 'contract' | 'holder' | 'liquidity';
  status: SignalStatus;     // 'undetermined' when a source has no data
  value: string | number | boolean | null;
  severity: Severity;
  sources: string[];        // e.g. ['goplus','safeanalyzer']
  evidence?: string;
  conflict?: boolean;       // true if sources disagreed
  conflictDetail?: { source: string; value: unknown; severity: Severity }[];
}
```

## Setup

```bash
cd orchestrator
npm install
cp .env.example .env     # fill in API keys + ETH_RPC_URL
npm run typecheck        # strict type check (no emit)
npm run build            # compile to dist/
```

## Status (Module 0)

- ✅ Folder skeleton, strict TypeScript (ESM, `ethers` v6), no `any`.
- ✅ Shared `Signal` / `RiskProfile` / `Collector` schema.
- ✅ Typed env config + raw-response archive helper.
- ✅ Six collector stubs (return `{ ok: false, error: 'not implemented' }`).
- ⏳ Normaliser, orchestrator, conversation, evaluation: contracts only.
```
