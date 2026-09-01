# orchestrator

The core engine for *Explainable Conversational AI for Blockchain Token Risk Assessment*. Six independent data sources are merged deterministically into a single `RiskProfile`; a grounded LLM then explains that profile in natural language.

## Pipeline

```
token address
      │
      ├─▶ GoPlus Security          (contract flags, holder concentration, LP data)
      ├─▶ honeypot.is              (honeypot simulation)
      ├─▶ SafeAnalyzer / reportx   (Rug-Checker pattern scan, tax, lock, owner)
      ├─▶ DexScreener              (liquidity, pair, market cap)
      ├─▶ LP-Lock Reader           (on-chain lock/burn via OnlyMoons · PinkLock · UNCX)
      └─▶ Code-Level Checker       (LLM over Etherscan-verified Solidity)
                                    │
                          normaliser → Signal[]
                                    │
                        orchestrator → RiskProfile   (deterministic)
                                    │
                        conversation → grounded reply + citedKeys
                                    │
                          evaluation → precision / recall / F1 / faithfulness
```

## Signal schema

All six sources normalise to the same `Signal` type:

```ts
interface Signal {
  key: SignalKey;          // e.g. 'honeypot', 'mint_authority', 'lp_locked'
  group: 'contract' | 'holder' | 'liquidity';
  status: 'present' | 'absent' | 'undetermined';
  value: string | number | boolean | null;
  severity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  sources: SourceName[];
  evidence?: string;
  conflict?: boolean;
  conflictDetail?: { source: SourceName; value: unknown; severity: Severity }[];
}
```

Cross-source conflicts are preserved as first-class data (`conflict`, `conflictDetail`) rather than silently resolved.

## Contextual rules (`src/orchestrator/context.ts`)

After merging, three contextual adjustments are applied before aggregation:

| Rule | Condition | Effect |
|---|---|---|
| A — renounce neutralisation | Owner is renounced (GoPlus or SafeAnalyzer) | Owner-only flags (`blacklist`, `pausable`, `mint_authority`, `mutable_taxes`) → severity `none` |
| B — GoPlus-only cap | A flag has only GoPlus asserting it (no corroboration) | Severity capped to `low` |
| C — LP-lock positive wins | Any source reports LP locked/burned | Signal overridden to `present / none` |

## Faithfulness

The conversational layer returns `{ reply, citedKeys }`. Faithfulness is:

```
|citedKeys ∩ validKeys| / |citedKeys|
```

where `validKeys = signals[].key ∪ { overallRisk, conflicts, sourcesQueried, sourcesFailed }`.

## Evaluation results

100-token labelled dataset (50 scam / 50 legit), threshold = `high | critical`:

| Metric | Score |
|---|---|
| Precision | 0.820 |
| Recall | 1.000 |
| F1 | 0.901 |
| Accuracy | 0.890 |
| Faithfulness | 1.000 |

## Layout

```
src/
├── collectors/          one file per source; raw responses archived to disk
├── normaliser/          pure per-source mapping functions → Signal[]
├── orchestrator/        merge → context rules → aggregate → RiskProfile
├── conversation/        grounded LLM explanation with citedKeys
├── evaluation/          harness: runEvaluation(), renderReport(), faithfulness
├── types/               Signal, RiskProfile, Collector, SourceName, Severity
├── config/              typed env-based config (dotenv)
├── utils/               archive helper, http helpers
└── scripts/
    └── runEvaluation.ts CLI entry point
data/
└── eval/
    └── labels.json      100 labelled tokens (git-tracked)
```

## Setup

```bash
npm install
cp .env.example .env     # OPENAI_API_KEY, SAFE_ANALYZER_KEY, ETH_RPC_URL, ETHERSCAN_API_KEY
npm run build
```

Run evaluation (reuses archived data; only hits the network for uncached tokens):

```bash
node dist/src/scripts/runEvaluation.js data/eval/labels.json 30 20000
#                                       labels  faithSubset  delayMs
```

Outputs: `data/eval/results.json`, `data/eval/report.md`, `data/eval/results_detail.md`
