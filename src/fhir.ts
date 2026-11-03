import { z } from "zod";

// Typed FHIR R4 subset. Schemas are permissive about extra fields (FHIR resources
// carry many) but strict about the fields this service actually relies on.

const coding = z.object({ system: z.string().optional(), code: z.string().optional(), display: z.string().optional() });
const identifier = z.object({ system: z.string().optional(), value: z.string().optional() });
const period = z.object({ start: z.string().optional(), end: z.string().optional() });

export const pdsPatientSchema = z.object({
  resourceType: z.literal("Patient"),
  id: z.string(),
  identifier: z.array(identifier).min(1),
  meta: z.object({ security: z.array(coding).optional() }).passthrough().optional(),
  name: z
    .array(
      z.object({
        use: z.string().optional(),
        given: z.array(z.string()).optional(),
        family: z.string().optional(),
        period: period.optional(),
      }).passthrough(),
    )
    .optional(),
  birthDate: z.string().optional(),
  deceasedDateTime: z.string().optional(),
}).passthrough();
export type PdsPatient = z.infer<typeof pdsPatientSchema>;

const qrSchema = z.object({
  resourceType: z.literal("QuestionnaireResponse"),
  id: z.string(),
  questionnaire: z.string(),
  status: z.string(),
  subject: z.object({ reference: z.string() }),
  authored: z.string(),
  item: z.array(z.object({ linkId: z.string() }).passthrough()),
}).passthrough();

const observationSchema = z.object({
  resourceType: z.literal("Observation"),
  id: z.string(),
  status: z.string(),
  code: z.object({ coding: z.array(coding).min(1) }).passthrough(),
  subject: z.object({ reference: z.string() }),
  effectiveDateTime: z.string(),
  valueQuantity: z.object({ value: z.number() }).passthrough(),
  derivedFrom: z.array(z.object({ reference: z.string() })).optional(),
}).passthrough();

const sourcePatientSchema = z.object({
  resourceType: z.literal("Patient"),
  id: z.string(),
  identifier: z.array(z.object({ system: z.string(), value: z.string() })).min(1),
}).passthrough();

/** The Patient/$everything Bundle exported by rehab-proms. */
export const promBundleSchema = z.object({
  resourceType: z.literal("Bundle"),
  type: z.enum(["searchset", "collection"]),
  entry: z
    .array(z.object({ resource: z.discriminatedUnion("resourceType", [sourcePatientSchema, qrSchema, observationSchema]) }).passthrough())
    .min(1),
}).passthrough();
export type PromBundle = z.infer<typeof promBundleSchema>;

export interface TransactionEntry {
  fullUrl: string;
  resource: Record<string, unknown>;
  request: { method: "POST"; url: string; ifNoneExist: string };
}

export interface TransactionBundle {
  resourceType: "Bundle";
  type: "transaction";
  entry: TransactionEntry[];
}

export const transactionResponseSchema = z.object({
  resourceType: z.literal("Bundle"),
  type: z.literal("transaction-response"),
  entry: z.array(z.object({ response: z.object({ status: z.string(), location: z.string().optional() }) })),
}).passthrough();
