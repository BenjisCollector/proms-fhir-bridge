import { describe, expect, it } from "vitest";
import { pdsPatientSchema, promBundleSchema } from "../src/fhir.js";
import { SOURCE_ID_SYSTEM, pdsToRehabPatient, toTransaction } from "../src/mapping.js";
import { fixture } from "./helpers.js";

describe("PDS contract (recorded from the NHS England sandbox)", () => {
  it("maps 9000000009 to the rehab-proms patient model, keeping only what is needed", () => {
    const p = pdsToRehabPatient(pdsPatientSchema.parse(fixture("pds-patient-9000000009.json")));
    expect(p).toEqual({ given: "Jane", family: "Smith", birth_date: "2010-10-22", nhs_number: "9000000009", restricted: false, deceased: true });
    expect(JSON.stringify(p)).not.toMatch(/address|telecom|01632/);
  });

  it("flags restricted (sensitive) records", () => {
    const p = pdsToRehabPatient(pdsPatientSchema.parse(fixture("pds-patient-restricted.json")));
    expect(p.restricted).toBe(true);
  });
});

describe("rehab-proms Bundle to FHIR transaction", () => {
  const bundle = promBundleSchema.parse(fixture("rehab-proms-everything.json"));
  const tx = toTransaction(bundle);

  it("accepts the Bundle exported by rehab-proms", () => {
    expect(tx.type).toBe("transaction");
    expect(tx.entry).toHaveLength(bundle.entry.length);
  });

  it("makes every entry a conditional create on a stable identifier (idempotent)", () => {
    for (const e of tx.entry) {
      expect(e.request.method).toBe("POST");
      expect(e.request.ifNoneExist).toMatch(/^identifier=/);
      expect(e.resource).not.toHaveProperty("id");
    }
    const qr = tx.entry.find((e) => e.request.url === "QuestionnaireResponse")!;
    expect(qr.resource.identifier).toEqual({ system: SOURCE_ID_SYSTEM, value: expect.stringMatching(/^QuestionnaireResponse\//) });
  });

  it("rewrites references to urn:uuid entries inside the transaction", () => {
    const fullUrls = new Set(tx.entry.map((e) => e.fullUrl));
    const obs = tx.entry.find((e) => e.request.url === "Observation")!.resource as { subject: { reference: string }; derivedFrom: { reference: string }[] };
    expect(fullUrls.has(obs.subject.reference)).toBe(true);
    expect(fullUrls.has(obs.derivedFrom[0]!.reference)).toBe(true);
    for (const u of fullUrls) expect(u).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("is deterministic, so a replay sends an identical transaction", () => {
    expect(toTransaction(bundle)).toEqual(tx);
  });

  it("keeps the synthetic-data tag on the Patient", () => {
    const patient = tx.entry.find((e) => e.request.url === "Patient")!.resource as { meta: { tag: { code: string }[] } };
    expect(patient.meta.tag[0]!.code).toBe("HTEST");
  });

  it("rejects Bundles that are not rehab-proms exports", () => {
    expect(promBundleSchema.safeParse({ resourceType: "Bundle", type: "transaction", entry: [] }).success).toBe(false);
  });
});
