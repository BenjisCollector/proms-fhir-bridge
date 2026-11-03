import type { Logger } from "./logger.js";

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export const DEFAULT_RETRY: RetryOptions = { retries: 3, baseDelayMs: 250, maxDelayMs: 4000, timeoutMs: 10_000 };

/** 429 and transient gateway errors are worth retrying; other 4xx/5xx are not. */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Upstream returned HTTP ${status}`);
  }
}

function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return secs * 1000;
  const at = Date.parse(h);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/**
 * fetch with a per-attempt timeout and exponential backoff with full jitter.
 * Only call this for idempotent requests: GETs, or writes made idempotent with
 * conditional creates (see mapping.ts). Never blindly retry a plain POST.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  log: Logger,
  opts: RetryOptions = DEFAULT_RETRY,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  const target = new URL(url);
  for (let attempt = 0; ; attempt++) {
    let res: Response | undefined;
    let error: unknown;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs) });
      if (!RETRYABLE.has(res.status)) return res;
    } catch (e) {
      error = e;
    }
    if (attempt >= opts.retries) {
      if (res) return res;
      throw error;
    }
    const backoff = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt) * random();
    const delay = Math.min(opts.maxDelayMs, (res && retryAfterMs(res)) ?? backoff);
    // Log host and path template only: paths can contain identifiers.
    log.warn("http.retry", { host: target.host, attempt: attempt + 1, status: res?.status, error: error ? String(error) : undefined, delayMs: Math.round(delay) });
    await sleep(delay);
  }
}
