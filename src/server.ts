import { createServer } from "node:http";
import { DEFAULT_CONFIG, createHandler } from "./app.js";
import { createLogger } from "./logger.js";

const log = createLogger();
const port = Number(process.env.PORT ?? 8080);
const server = createServer(createHandler(DEFAULT_CONFIG, { log }));
server.listen(port, () => log.info("server.started", { port, pds: DEFAULT_CONFIG.pdsBaseUrl, fhir: DEFAULT_CONFIG.fhirBaseUrl }));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log.info("server.stopping", { signal });
    server.close(() => process.exit(0));
  });
}
