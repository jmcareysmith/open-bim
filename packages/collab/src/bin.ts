#!/usr/bin/env node
import { startServer } from "./server.ts";

// Usage: OPEN_BIM_TOKEN=secret OPEN_BIM_DATA=./rooms PORT=4455 node src/bin.ts
const env = process.env;
const server = await startServer({
  port: Number(env.PORT ?? 4455),
  host: env.HOST,
  dataDir: env.OPEN_BIM_DATA ?? "./open-bim-rooms",
  token: env.OPEN_BIM_TOKEN || undefined,
});
console.log(`Open-BIM sync server on ws://localhost:${server.port}${env.OPEN_BIM_TOKEN ? " (token required)" : " (no token: open access)"}`);
const stop = () => server.close().then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
