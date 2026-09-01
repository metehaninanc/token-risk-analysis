# Explainable Conversational AI for Blockchain Token Risk Assessment

MSc dissertation system that detects EVM token scams and explains its findings in natural language. A deterministic risk engine merges signals from six independent data sources, then a grounded LLM explains — never changes — the computed verdict.

## Evaluation results (100-token dataset, 50 scam / 50 legit)

| Metric | Score |
|---|---|
| Precision | 0.820 |
| Recall | **1.000** — zero scams missed |
| F1 | 0.901 |
| Accuracy | 0.890 |
| Faithfulness | **1.000** — every LLM citation traceable to the profile |

Confusion matrix: TP 50 · FP 11 · FN 0 · TN 39

## Architecture

```
token address
      │
      ▼
┌─────────────────────────── data collection ───────────────────────────┐
│  1 GoPlus Security      2 honeypot.is        3 SafeAnalyzer (reportx) │
│  4 DexScreener          5 LP-Lock Reader     6 Code-Level Checker (LLM)│
└───────────────────────────────────┬───────────────────────────────────┘
                                    │ RawCollectorResult[]
                                    ▼
                   normaliser  ──▶  Signal[]       (shared schema)
                                    ▼
                   orchestrator ──▶ RiskProfile    (deterministic merge + contextual rules)
                                    ▼
                   conversation ──▶ grounded natural-language explanation
                                    ▼
                   evaluation   ──▶ reproducible scoring vs labelled corpus
```

**No ML training.** The risk verdict is fully deterministic and rule-based. The LLM is used only to articulate the pre-computed result.

## Monorepo layout

```
packages/
├── token-risk-api/      static Solidity AST analysis (feeds code-level checker)
├── lp-lock-api/         on-chain LP lock / burn detection via OnlyMoons · PinkLock · UNCX
└── orchestrator/        the unifying engine — all six sources, merge logic, conversation, eval
```

## Key design decisions

- **Shared `Signal` schema** — every source normalises to `{ key, group, status, value, severity, sources, evidence, conflict }`. Cross-source conflicts are surfaced as first-class data, not silently resolved.
- **Contextual rules** — renounced ownership neutralises owner-only flags; GoPlus-only assertions without corroboration are capped to `low`; a single LP-lock confirmation from any source overrides absent signals from others.
- **Faithfulness measurement** — the evaluation checks that every key the LLM cites exists in the actual `RiskProfile`, including structural fields (`overallRisk`, `conflicts`, `sourcesQueried`).
- **Reproducibility** — raw API responses are archived to disk per token; re-runs reuse cached data and only go live for uncached tokens.

## Tech stack

TypeScript · Node.js (ESM) · ethers v6 · OpenAI API · dotenv · strict tsconfig (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, no `any`)

## Setup

```bash
# install all packages
npm install --workspaces

# orchestrator (main engine)
cd packages/orchestrator
cp .env.example .env        # OPENAI_API_KEY, SAFE_ANALYZER_KEY, ETH_RPC_URL, ETHERSCAN_API_KEY
npm run build

# run evaluation (uses archived data; only live-calls for uncached tokens)
node dist/src/scripts/runEvaluation.js data/eval/labels.json 30 20000
```

```bash
# lp-lock-api (required by orchestrator at runtime)
cd packages/lp-lock-api
node src/server.js          # listens on :3001 by default
```

## Packages

| Package | Description |
|---|---|
| [`packages/orchestrator`](packages/orchestrator) | Core engine — collectors, normaliser, orchestrator, conversation, evaluation |
| [`packages/lp-lock-api`](packages/lp-lock-api) | REST API: checks whether a token's LP is locked or burned on-chain |
| [`packages/token-risk-api`](packages/token-risk-api) | Static Solidity AST analyser (legacy; now used as Code-Level Checker input) |
