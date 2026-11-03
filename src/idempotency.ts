import { createHash } from "node:crypto";

export interface StoredResult {
  status: number;
  body: unknown;
}

type Outcome = { kind: "fresh" | "replay"; result: StoredResult } | { kind: "conflict" };

/**
 * Idempotency-Key handling for POST endpoints (as in the IETF httpapi
 * Idempotency-Key draft): the same key with the same body returns the first result,
 * including while the first request is still running; the same key with a different
 * body is rejected.
 * ponytail: in-memory and single-instance. Use Redis or the database when running more than one replica.
 */
export class IdempotencyStore {
  private entries = new Map<string, { hash: string; expires: number; result: Promise<StoredResult> }>();

  constructor(private ttlMs = 24 * 60 * 60 * 1000) {}

  async run(key: string, body: string, work: () => Promise<StoredResult>, now = Date.now()): Promise<Outcome> {
    for (const [k, v] of this.entries) if (v.expires <= now) this.entries.delete(k);
    const hash = createHash("sha256").update(body).digest("hex");
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.hash !== hash) return { kind: "conflict" };
      return { kind: "replay", result: await existing.result };
    }
    const result = work();
    this.entries.set(key, { hash, expires: now + this.ttlMs, result });
    try {
      const r = await result;
      // Only successful results are worth replaying; let the client retry failures.
      if (r.status >= 500) this.entries.delete(key);
      return { kind: "fresh", result: r };
    } catch (e) {
      this.entries.delete(key);
      throw e;
    }
  }
}
