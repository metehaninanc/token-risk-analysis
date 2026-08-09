/**
 * Minimal, typed HTTP GET → JSON helper with a hard timeout.
 *
 * Shared by the HTTP-based collectors (GoPlus, honeypot.is, DexScreener) so the
 * `fetch` + `AbortController` timeout + error-normalisation logic lives in
 * exactly one place. It THROWS on any failure; callers convert that into a
 * `RawCollectorResult` with `ok: false`. It does no interpretation of the body.
 */

/** Default request timeout in milliseconds (10s). */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Options for a single GET request. */
export interface GetJsonOptions {
  /** Abort the request after this many milliseconds (default 10s). */
  timeoutMs?: number;
  /** Extra request headers, e.g. an access token. */
  headers?: Record<string, string>;
}

/** True when an unknown error is an `AbortController` timeout abort. */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * GET `url` and parse the JSON body.
 *
 * @throws Error on network failure, a non-2xx status, a timeout, or invalid JSON.
 */
export async function getJson<T = unknown>(
  url: string,
  options: GetJsonOptions = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', ...headers },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }

    const data: unknown = await response.json();
    return data as T;
  } catch (err) {
    if (isAbortError(err)) {
      throw new Error(`request timed out after ${timeoutMs}ms`);
    }
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    clearTimeout(timer);
  }
}
