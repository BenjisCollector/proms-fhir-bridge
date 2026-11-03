import { randomUUID } from "node:crypto";
import { type PdsPatient, type TransactionBundle, pdsPatientSchema, transactionResponseSchema } from "./fhir.js";
import { HttpError, type RetryOptions, DEFAULT_RETRY, fetchWithRetry } from "./http.js";
import type { Logger } from "./logger.js";

export interface Deps {
  log: Logger;
  fetch?: typeof fetch;
  retry?: RetryOptions;
}

const FHIR_JSON = "application/fhir+json";

/**
 * Read a patient from the Personal Demographics Service (FHIR R4).
 * The sandbox needs no credentials; the integration and live environments need
 * application-restricted or user-restricted OAuth, which is out of scope here.
 */
export async function getPdsPatient(baseUrl: string, nhsNumber: string, correlationId: string, deps: Deps): Promise<PdsPatient | null> {
  const res = await fetchWithRetry(
    `${baseUrl}/Patient/${nhsNumber}`,
    // PDS requires a fresh X-Request-ID per request; X-Correlation-ID ties our logs to theirs.
    { headers: { accept: FHIR_JSON, "x-request-id": randomUUID(), "x-correlation-id": correlationId } },
    deps.log,
    deps.retry ?? DEFAULT_RETRY,
    deps.fetch,
  );
  if (res.status === 404) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(res.status, body);
  return pdsPatientSchema.parse(body);
}

export interface PushSummary {
  created: number;
  existing: number;
  locations: string[];
}

/** POST a transaction Bundle. Safe to retry because every entry is a conditional create. */
export async function postTransaction(baseUrl: string, tx: TransactionBundle, correlationId: string, deps: Deps): Promise<PushSummary> {
  const res = await fetchWithRetry(
    baseUrl,
    {
      method: "POST",
      headers: { accept: FHIR_JSON, "content-type": FHIR_JSON, "x-correlation-id": correlationId },
      body: JSON.stringify(tx),
    },
    deps.log,
    deps.retry ?? DEFAULT_RETRY,
    deps.fetch,
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(res.status, body);
  const parsed = transactionResponseSchema.parse(body);
  const statuses = parsed.entry.map((e) => e.response.status);
  return {
    created: statuses.filter((s) => s.startsWith("201")).length,
    existing: statuses.filter((s) => s.startsWith("200")).length,
    locations: parsed.entry.flatMap((e) => (e.response.location ? [e.response.location] : [])),
  };
}
