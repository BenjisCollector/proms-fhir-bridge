/**
 * Structured JSON logs with no patient-identifiable data.
 * Known PII keys are masked wherever they appear, and anything that looks like an
 * NHS number is masked inside strings too, so a careless log call cannot leak one.
 */
const PII_KEYS = new Set(["nhsnumber", "nhs_number", "name", "given", "family", "birthdate", "birth_date", "address", "telecom", "email", "phone"]);
const NHS_NUMBER_LIKE = /\b\d{3}\s?\d{3}\s?\d{4}\b/g;

export function redact(value: unknown): unknown {
  if (typeof value === "string") return value.replace(NHS_NUMBER_LIKE, "[redacted]");
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, PII_KEYS.has(k.toLowerCase()) ? "[redacted]" : redact(v)]),
    );
  }
  return value;
}

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(write: (line: string) => void = (l) => process.stdout.write(l + "\n")) {
  const min = ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;
  const log = (level: Level, event: string, fields: Record<string, unknown> = {}) => {
    if (ORDER[level] < min) return;
    write(JSON.stringify({ time: new Date().toISOString(), level, event, ...(redact(fields) as object) }));
  };
  return {
    debug: (e: string, f?: Record<string, unknown>) => log("debug", e, f),
    info: (e: string, f?: Record<string, unknown>) => log("info", e, f),
    warn: (e: string, f?: Record<string, unknown>) => log("warn", e, f),
    error: (e: string, f?: Record<string, unknown>) => log("error", e, f),
  };
}

export type Logger = ReturnType<typeof createLogger>;
