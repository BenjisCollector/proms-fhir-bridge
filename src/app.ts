import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getPdsPatient, postTransaction, type Deps } from "./clients.js";
import { promBundleSchema } from "./fhir.js";
import { HttpError } from "./http.js";
import { IdempotencyStore, type StoredResult } from "./idempotency.js";
import { pdsToRehabPatient, toTransaction } from "./mapping.js";
import { isValidNhsNumber } from "./nhs-number.js";

export interface Config {
  pdsBaseUrl: string;
  fhirBaseUrl: string;
  maxBodyBytes: number;
}

export const DEFAULT_CONFIG: Config = {
  pdsBaseUrl: process.env.PDS_BASE_URL ?? "https://sandbox.api.service.nhs.uk/personal-demographics/FHIR/R4",
  fhirBaseUrl: process.env.FHIR_BASE_URL ?? "https://hapi.fhir.org/baseR4",
  maxBodyBytes: 1_000_000,
};

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,128}$/;

function outcome(status: number, code: string, diagnostics: string): StoredResult {
  return { status, body: { resourceType: "OperationOutcome", issue: [{ severity: "error", code, diagnostics }] } };
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, null);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createHandler(config: Config, deps: Deps, idempotency = new IdempotencyStore()) {
  const { log } = deps;

  async function route(req: IncomingMessage, correlationId: string): Promise<StoredResult> {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/healthz") return { status: 200, body: { status: "ok" } };

    const pds = url.pathname.match(/^\/pds\/Patient\/([^/]+)$/);
    if (req.method === "GET" && pds) {
      const nhsNumber = pds[1]!;
      if (!isValidNhsNumber(nhsNumber)) return outcome(400, "value", "Not a valid NHS number (Modulus 11 check failed)");
      const patient = await getPdsPatient(config.pdsBaseUrl, nhsNumber, correlationId, deps);
      if (!patient) return outcome(404, "not-found", "No PDS record for that NHS number");
      return { status: 200, body: pdsToRehabPatient(patient) };
    }

    if (req.method === "POST" && url.pathname === "/prom-results") {
      const key = req.headers["idempotency-key"];
      if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
        return outcome(400, "required", "Idempotency-Key header required (8 to 128 characters: letters, digits, _ - : .)");
      }
      const raw = await readBody(req, config.maxBodyBytes);
      const result = await idempotency.run(key, raw, async () => {
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          return outcome(400, "structure", "Body is not valid JSON");
        }
        const parsed = promBundleSchema.safeParse(json);
        if (!parsed.success) {
          // Report where the problem is, never the submitted values (they may be clinical data).
          return outcome(422, "invalid", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 5).join("; "));
        }
        const tx = toTransaction(parsed.data);
        const summary = await postTransaction(config.fhirBaseUrl, tx, correlationId, deps);
        log.info("prom_results.pushed", { correlationId, entries: tx.entry.length, created: summary.created, existing: summary.existing });
        return { status: 200, body: summary };
      });
      if (result.kind === "conflict") return outcome(409, "conflict", "Idempotency-Key was already used with a different body");
      if (result.kind === "replay") log.info("prom_results.replayed", { correlationId });
      return result.result;
    }

    return outcome(404, "not-found", "No such route");
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    const incoming = req.headers["x-correlation-id"];
    const correlationId = typeof incoming === "string" && KEY_PATTERN.test(incoming) ? incoming : randomUUID();
    const started = Date.now();
    let result: StoredResult;
    try {
      result = await route(req, correlationId);
    } catch (e) {
      if (e instanceof HttpError && e.status === 413) result = outcome(413, "too-long", "Body too large");
      else if (e instanceof HttpError) {
        log.error("upstream.error", { correlationId, status: e.status });
        result = outcome(502, "transient", `Upstream FHIR server returned HTTP ${e.status}`);
      } else {
        log.error("request.failed", { correlationId, error: e instanceof Error ? e.name + ": " + e.message : "unknown" });
        result = outcome(500, "exception", "Internal error");
      }
    }
    // Path is logged without its last segment, which may be an NHS number.
    const path = (req.url ?? "/").split("?")[0]!.replace(/\/[^/]+$/, (m) => (/\d/.test(m) ? "/:id" : m));
    log.info("request", { correlationId, method: req.method, path, status: result.status, ms: Date.now() - started });
    res.writeHead(result.status, {
      "content-type": (result.body as { resourceType?: unknown }).resourceType ? "application/fhir+json" : "application/json",
      "x-correlation-id": correlationId,
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(result.body));
  };
}
