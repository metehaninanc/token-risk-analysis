/**
 * Public entry point for the token-risk orchestrator.
 *
 * Pipeline order (see README):
 *   collectors → normaliser → orchestrator → conversation → evaluation
 *
 * Module 0 exposes the shared contracts, the collector stubs, config, and the
 * archive helper. Layer implementations arrive in later modules.
 */

// Shared data contracts (the signal schema, collector + profile types).
export * from './src/types/index.js';

// Data-collection layer: the six collectors + factory + result helpers.
export * from './src/collectors/index.js';

// Typed, env-based configuration.
export * from './src/config/index.js';

// Reproducibility: archive raw collector responses to disk.
export { archiveRawResult } from './src/utils/archive.js';

// Downstream layer contracts (interfaces only in Module 0).
export type { Normaliser } from './src/normaliser/index.js';
export type { Orchestrator, OrchestratorInput } from './src/orchestrator/index.js';
export type { Conversation } from './src/conversation/index.js';
export type {
  Evaluator,
  EvaluationCase,
  EvaluationResult,
} from './src/evaluation/index.js';
