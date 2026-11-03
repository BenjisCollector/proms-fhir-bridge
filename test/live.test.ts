// Live contract check against the real public endpoints. Not part of `npm test`;
// run with `npm run contract:live` (CI runs it weekly) to detect upstream drift.
import { describe, expect, it } from "vitest";
import { getPdsPatient } from "../src/clients.js";
import { DEFAULT_CONFIG } from "../src/app.js";
import { createLogger } from "../src/logger.js";
import { pdsToRehabPatient } from "../src/mapping.js";

describe.runIf(process.env.LIVE)("live NHS England PDS sandbox", () => {
  it("still returns a Patient our schema and mapping accept", async () => {
    const p = await getPdsPatient(DEFAULT_CONFIG.pdsBaseUrl, "9000000009", "live-contract-test", { log: createLogger(() => {}) });
    expect(pdsToRehabPatient(p!)).toMatchObject({ nhs_number: "9000000009" });
  }, 30_000);
});
