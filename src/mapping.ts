import { createHash } from "node:crypto";
import type { PdsPatient, PromBundle, TransactionBundle, TransactionEntry } from "./fhir.js";

export const NHS_NUMBER_SYSTEM = "https://fhir.nhs.uk/Id/nhs-number";
export const SOURCE_ID_SYSTEM = "https://github.com/BenjisCollector/rehab-proms/resource-id";

/**
 * The patient shape used by rehab-proms (its `patients` table), plus the two flags
 * from PDS that change how a PROM service must treat the person.
 */
export interface RehabPatient {
  given: string;
  family: string;
  birth_date: string | null;
  nhs_number: string;
  /** PDS "restricted" (S flag): address and contact details must not be shared. */
  restricted: boolean;
  /** PDS records a date of death: do not send questionnaire reminders. */
  deceased: boolean;
}

/**
 * Map a PDS Patient to the rehab-proms model. Deliberately takes only what the PROM
 * service needs (data minimisation): no address, telecom, GP or contacts.
 */
export function pdsToRehabPatient(p: PdsPatient): RehabPatient {
  const nhs = p.identifier.find((i) => i.system === NHS_NUMBER_SYSTEM)?.value;
  if (!nhs) throw new Error("PDS Patient has no NHS number identifier");
  const names = p.name ?? [];
  const current = (n: (typeof names)[number]) => !n.period?.end || Date.parse(n.period.end) > Date.now();
  const name = names.find((n) => n.use === "usual" && current(n)) ?? names.find((n) => n.use === "usual") ?? names[0];
  return {
    given: name?.given?.join(" ") ?? "",
    family: name?.family ?? "",
    birth_date: p.birthDate ?? null,
    nhs_number: nhs,
    restricted: (p.meta?.security ?? []).some((s) => s.code === "R" || s.code === "V"),
    deceased: Boolean(p.deceasedDateTime),
  };
}

/**
 * Turn a rehab-proms Patient/$everything Bundle into a FHIR transaction that is safe
 * to send more than once: every entry is a conditional create keyed on a stable
 * business identifier, so a retry or replay returns "200 OK" instead of a duplicate.
 * References are rewritten to urn:uuid fullUrls so the server resolves them inside
 * the transaction.
 */
export function toTransaction(bundle: PromBundle): TransactionBundle {
  const urn = (type: string, id: string) => `urn:uuid:${stableUuid(`${type}/${id}`)}`;
  const ref = (reference: string) => {
    const [type, id] = reference.split("/");
    return { reference: urn(type!, id!) };
  };
  const entries: TransactionEntry[] = [];

  for (const { resource: r } of bundle.entry) {
    const sourceId = { system: SOURCE_ID_SYSTEM, value: `${r.resourceType}/${r.id}` };
    const { id: _id, ...body } = r as Record<string, unknown> & { id: string };
    void _id; // server assigns its own ids

    if (r.resourceType === "Patient") {
      const key = r.identifier[0]!;
      entries.push({
        fullUrl: urn("Patient", r.id),
        resource: body,
        request: { method: "POST", url: "Patient", ifNoneExist: `identifier=${encodeURIComponent(`${key.system}|${key.value}`)}` },
      });
    } else if (r.resourceType === "QuestionnaireResponse") {
      entries.push({
        fullUrl: urn(r.resourceType, r.id),
        resource: { ...body, identifier: sourceId, subject: ref(r.subject.reference) },
        request: { method: "POST", url: r.resourceType, ifNoneExist: identifierQuery(sourceId) },
      });
    } else {
      entries.push({
        fullUrl: urn(r.resourceType, r.id),
        resource: {
          ...body,
          identifier: [sourceId],
          subject: ref(r.subject.reference),
          ...(r.derivedFrom ? { derivedFrom: r.derivedFrom.map((d) => ref(d.reference)) } : {}),
        },
        request: { method: "POST", url: r.resourceType, ifNoneExist: identifierQuery(sourceId) },
      });
    }
  }
  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

function identifierQuery(id: { system: string; value: string }) {
  return `identifier=${encodeURIComponent(`${id.system}|${id.value}`)}`;
}

/** Deterministic UUID-shaped string from a key, so the same input always gives the same transaction. */
function stableUuid(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
