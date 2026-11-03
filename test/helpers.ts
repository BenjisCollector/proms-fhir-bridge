import fs from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createHandler, type Config } from "../src/app.js";
import { createLogger } from "../src/logger.js";

export const fixture = (name: string): unknown =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

export const fhirResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/fhir+json", ...headers } });

export const noSleep = { retries: 3, baseDelayMs: 1, maxDelayMs: 5, timeoutMs: 1000, sleep: async () => {}, random: () => 0.5 };

/** Starts the real HTTP handler with upstream calls answered by `upstream`. */
export async function startApp(upstream: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const logs: string[] = [];
  const config: Config = { pdsBaseUrl: "https://pds.test/FHIR/R4", fhirBaseUrl: "https://fhir.test/baseR4", maxBodyBytes: 100_000 };
  const calls: { url: string; init?: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return upstream(url, init);
  }) as typeof fetch;
  const server = createServer(createHandler(config, { log: createLogger((l) => logs.push(l)), fetch: fakeFetch, retry: noSleep }));
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, logs, calls, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) };
}
