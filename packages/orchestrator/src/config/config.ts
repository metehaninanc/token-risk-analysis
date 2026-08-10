import { config as loadDotenv } from 'dotenv';

// Load a local .env if present. Missing file is fine — env vars may come from
// the shell or a secrets manager instead. Secrets are NEVER hardcoded here.
loadDotenv();

/** Read a trimmed env var, or undefined when unset/blank. */
function env(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Read a trimmed env var, or fall back to a non-secret default. */
function envOr(name: string, fallback: string): string {
  return env(name) ?? fallback;
}

/** A keyless HTTP source: just a base URL. */
export interface UrlSourceConfig {
  baseUrl: string;
}

/** A keyed HTTP source: an API key plus a base URL. */
export interface HttpSourceConfig {
  apiKey: string | undefined;
  baseUrl: string;
}

/** LLM settings for the code-level checker and the conversational layer. */
export interface OpenAiConfig {
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
}

/** Fully typed application config, assembled from the environment. */
export interface AppConfig {
  /** GoPlus, honeypot.is and DexScreener are public, keyless APIs. */
  goplus: UrlSourceConfig;
  honeypotIs: UrlSourceConfig;
  /** SafeAnalyzer (dexanalyzer.io) requires a mandatory apiKey. */
  safeAnalyzer: HttpSourceConfig;
  dexScreener: UrlSourceConfig;
  /** The author's LP-lock HTTP service (packages/lp-lock-api). */
  lpLock: UrlSourceConfig;
  /** Used ONLY to fetch verified source for the code-level checker. */
  etherscan: HttpSourceConfig;
  openai: OpenAiConfig;
  /** JSON-RPC endpoint for the on-chain LP-lock reader. */
  ethRpcUrl: string | undefined;
  /** Directory where raw collector responses are archived. */
  archiveDir: string;
}

/**
 * Build the config from environment variables. Base URLs have sensible public
 * defaults; API keys and the RPC URL default to undefined so a missing secret
 * surfaces as a failed collector rather than a silent misconfiguration.
 */
export function loadConfig(): AppConfig {
  return {
    goplus: {
      baseUrl: envOr('GOPLUS_BASE_URL', 'https://api.gopluslabs.io/api/v1'),
    },
    honeypotIs: {
      baseUrl: envOr('HONEYPOT_IS_BASE_URL', 'https://api.honeypot.is/v2'),
    },
    safeAnalyzer: {
      apiKey: env('SAFEANALYZER_API_KEY'),
      baseUrl: envOr('SAFEANALYZER_API_URL', 'https://api1.dexanalyzer.io'),
    },
    dexScreener: {
      baseUrl: envOr('DEXSCREENER_BASE_URL', 'https://api.dexscreener.com/latest'),
    },
    lpLock: {
      baseUrl: envOr('LP_LOCK_API_URL', 'http://localhost:3001'),
    },
    etherscan: {
      // Prefer ETHERSCAN_KEY; fall back to the legacy ETHERSCAN_API_KEY name.
      apiKey: env('ETHERSCAN_KEY') ?? env('ETHERSCAN_API_KEY'),
      baseUrl: envOr('ETHERSCAN_BASE_URL', 'https://api.etherscan.io/v2/api'),
    },
    openai: {
      apiKey: env('OPENAI_API_KEY'),
      baseUrl: envOr('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
      model: envOr('OPENAI_MODEL', 'gpt-4o-mini'),
    },
    ethRpcUrl: env('ETH_RPC_URL'),
    archiveDir: envOr('ARCHIVE_DIR', './data/raw'),
  };
}
