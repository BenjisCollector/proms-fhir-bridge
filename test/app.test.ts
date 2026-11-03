import { afterEach, describe, expect, it } from "vitest";
import { fhirResponse, fixture, startApp } from "./helpers.js";

let app: Awaited<ReturnType<typeof startApp>>;
afterEach(() => app?.close());

const bundle = JSON.stringify(fixture("rehab-proms-everything.json"));
const post = (body: string, key?: string) =>
  fetch(`${app.base}/prom-results`, { method: "POST", body, headers: { "content-type": "application/fhir+json", ...(key ? { "idempotency-key": key } : {}) } });

describe("GET /pds/Patient/:nhsNumber", () => {
  it("returns the mapped patient and sends PDS the required headers", async () => {
    app = await startApp(async () => fhirResponse(fixture("pds-patient-9000000009.json")));
    const res = await fetch(`${app.base}/pds/Patient/9000000009`, { headers: { "x-correlation-id": "corr-123456" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ nhs_number: "9000000009", family: "Smith", deceased: true });
    const headers = app.calls[0]!.init!.headers as Record<string, string>;
    expect(headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers["x-correlation-id"]).toBe("corr-123456");
    expect(res.headers.get("x-correlation-id")).toBe("corr-123456");
  });

  it("rejects an invalid NHS number without calling PDS", async () => {
    app = await startApp(async () => fhirResponse({}));
    const res = await fetch(`${app.base}/pds/Patient/1234567890`);
    expect(res.status).toBe(400);
    expect(app.calls).toHaveLength(0);
  });

  it("passes through not-found as a FHIR OperationOutcome", async () => {
    app = await startApp(async () => fhirResponse(fixture("pds-not-found.json"), 404));
    const res = await fetch(`${app.base}/pds/Patient/9111231130`);
    expect(res.status).toBe(404);
    expect((await res.json()).resourceType).toBe("OperationOutcome");
  });

  it("returns 502 after retries when PDS keeps failing", async () => {
    app = await startApp(async () => fhirResponse({}, 503));
    expect((await fetch(`${app.base}/pds/Patient/9000000009`)).status).toBe(502);
    expect(app.calls).toHaveLength(4);
  });

  it("never writes NHS numbers or names to the logs", async () => {
    app = await startApp(async () => fhirResponse(fixture("pds-patient-9000000009.json")));
    await fetch(`${app.base}/pds/Patient/9000000009`);
    const logs = app.logs.join("\n");
    expect(logs).toContain('"path":"/pds/Patient/:id"');
    expect(logs).not.toMatch(/9000000009|Smith|Jane/);
  });
});

describe("POST /prom-results", () => {
  const created = () => fhirResponse(fixture("hapi-transaction-response-created.json"));

  it("requires an Idempotency-Key", async () => {
    app = await startApp(created);
    expect((await post(bundle)).status).toBe(400);
  });

  it("pushes a transaction and summarises the server's response", async () => {
    app = await startApp(created);
    const res = await post(bundle, "push-0001");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 9, existing: 0 });
    const sent = JSON.parse(app.calls[0]!.init!.body as string);
    expect(sent).toMatchObject({ resourceType: "Bundle", type: "transaction" });
    expect(app.calls[0]!.url).toBe("https://fhir.test/baseR4");
  });

  it("replays the first result for a repeated key without calling the server again", async () => {
    app = await startApp(created);
    const first = await (await post(bundle, "push-0002")).json();
    const second = await (await post(bundle, "push-0002")).json();
    expect(second).toEqual(first);
    expect(app.calls).toHaveLength(1);
  });

  it("rejects a reused key with a different body", async () => {
    app = await startApp(created);
    await post(bundle, "push-0003");
    expect((await post(bundle.replace("DEMO-0003", "DEMO-0009"), "push-0003")).status).toBe(409);
  });

  it("reports server-side duplicates as existing (conditional create matched)", async () => {
    app = await startApp(async () => fhirResponse(fixture("hapi-transaction-response-existing.json")));
    expect(await (await post(bundle, "push-0004")).json()).toMatchObject({ created: 0, existing: 9 });
  });

  it("validates the Bundle and does not echo submitted values", async () => {
    app = await startApp(created);
    const res = await post(JSON.stringify({ resourceType: "Bundle", type: "searchset", entry: [{ resource: { resourceType: "Patient", id: "x", identifier: [] } }] }), "push-0005");
    expect(res.status).toBe(422);
    expect(app.calls).toHaveLength(0);
  });

  it("rejects non-JSON and oversized bodies", async () => {
    app = await startApp(created);
    expect((await post("not json", "push-0006")).status).toBe(400);
    expect((await post("x".repeat(200_000), "push-0007")).status).toBe(413);
  });
});
