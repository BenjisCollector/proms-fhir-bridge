import { describe, expect, it } from "vitest";
import { IdempotencyStore } from "../src/idempotency.js";
import { createLogger, redact } from "../src/logger.js";
import { isValidNhsNumber } from "../src/nhs-number.js";

describe("NHS number Modulus 11", () => {
  it("accepts valid test numbers", () => {
    for (const n of ["9000000009", "9000000025", "9000000033"]) expect(isValidNhsNumber(n)).toBe(true);
  });
  it("rejects bad check digits, wrong length and non-digits", () => {
    for (const n of ["9000000008", "1234567890", "900000000", "90000000099", "900000000a", ""]) expect(isValidNhsNumber(n)).toBe(false);
  });
});

describe("log redaction", () => {
  it("masks PII keys at any depth and NHS-number-like strings anywhere", () => {
    const out = redact({ nhsNumber: "9000000009", patient: { name: [{ family: "Smith" }], birthDate: "2010-10-22" }, note: "lookup 900 000 0009 failed", status: 404 });
    expect(out).toEqual({ nhsNumber: "[redacted]", patient: { name: "[redacted]", birthDate: "[redacted]" }, note: "lookup [redacted] failed", status: 404 });
  });
  it("writes one JSON object per line", () => {
    const lines: string[] = [];
    createLogger((l) => lines.push(l)).info("evt", { given: "Jane", count: 2 });
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: "info", event: "evt", given: "[redacted]", count: 2 });
  });
});

describe("IdempotencyStore", () => {
  it("runs work once per key and replays the stored result", async () => {
    const store = new IdempotencyStore();
    let runs = 0;
    const work = async () => ({ status: 200, body: { n: ++runs } });
    expect(await store.run("key-0001", "{}", work)).toEqual({ kind: "fresh", result: { status: 200, body: { n: 1 } } });
    expect(await store.run("key-0001", "{}", work)).toEqual({ kind: "replay", result: { status: 200, body: { n: 1 } } });
    expect(runs).toBe(1);
  });
  it("collapses concurrent duplicates onto the in-flight request", async () => {
    const store = new IdempotencyStore();
    let runs = 0;
    const work = () => new Promise<{ status: number; body: unknown }>((r) => setTimeout(() => r({ status: 200, body: ++runs }), 10));
    const [a, b] = await Promise.all([store.run("key-0002", "x", work), store.run("key-0002", "x", work)]);
    expect(runs).toBe(1);
    expect([a.kind, b.kind].sort()).toEqual(["fresh", "replay"]);
  });
  it("rejects key reuse with a different body", async () => {
    const store = new IdempotencyStore();
    await store.run("key-0003", "a", async () => ({ status: 200, body: 1 }));
    expect(await store.run("key-0003", "b", async () => ({ status: 200, body: 2 }))).toEqual({ kind: "conflict" });
  });
  it("forgets server errors and expired keys so the client can retry", async () => {
    const store = new IdempotencyStore(1000);
    await store.run("key-0004", "a", async () => ({ status: 502, body: 1 }));
    expect((await store.run("key-0004", "a", async () => ({ status: 200, body: 2 }))).kind).toBe("fresh");
    expect((await store.run("key-0004", "a", async () => ({ status: 200, body: 3 }), Date.now() + 2000)).kind).toBe("fresh");
  });
});
