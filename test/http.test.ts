import { describe, expect, it } from "vitest";
import { fetchWithRetry } from "../src/http.js";
import { createLogger } from "../src/logger.js";
import { noSleep } from "./helpers.js";

const log = createLogger(() => {});

function scripted(...steps: (number | Error)[]) {
  let i = 0;
  const fn = (async () => {
    const step = steps[Math.min(i++, steps.length - 1)]!;
    if (step instanceof Error) throw step;
    return new Response("{}", { status: step, headers: step === 429 ? { "retry-after": "2" } : {} });
  }) as unknown as typeof fetch;
  return { fn, count: () => i };
}

describe("fetchWithRetry", () => {
  it("retries transient 503 then succeeds", async () => {
    const s = scripted(503, 503, 200);
    expect((await fetchWithRetry("https://x.test/a", {}, log, noSleep, s.fn)).status).toBe(200);
    expect(s.count()).toBe(3);
  });

  it("retries network errors", async () => {
    const s = scripted(new TypeError("fetch failed"), 200);
    expect((await fetchWithRetry("https://x.test/a", {}, log, noSleep, s.fn)).status).toBe(200);
  });

  it("does not retry client errors", async () => {
    const s = scripted(400, 200);
    expect((await fetchWithRetry("https://x.test/a", {}, log, noSleep, s.fn)).status).toBe(400);
    expect(s.count()).toBe(1);
  });

  it("honours Retry-After on 429 (capped at maxDelayMs)", async () => {
    const delays: number[] = [];
    const s = scripted(429, 200);
    await fetchWithRetry("https://x.test/a", {}, log, { ...noSleep, maxDelayMs: 10_000, sleep: async (ms) => void delays.push(ms) }, s.fn);
    expect(delays).toEqual([2000]);
  });

  it("uses exponential backoff with jitter and gives up after the retry budget", async () => {
    const delays: number[] = [];
    const s = scripted(503);
    const res = await fetchWithRetry("https://x.test/a", {}, log, { ...noSleep, baseDelayMs: 100, maxDelayMs: 10_000, sleep: async (ms) => void delays.push(ms) }, s.fn);
    expect(res.status).toBe(503);
    expect(s.count()).toBe(4);
    expect(delays).toEqual([50, 100, 200]); // base * 2^n * jitter(0.5)
  });

  it("rethrows the last network error when out of retries", async () => {
    const s = scripted(new TypeError("fetch failed"));
    await expect(fetchWithRetry("https://x.test/a", {}, log, noSleep, s.fn)).rejects.toThrow("fetch failed");
  });
});
