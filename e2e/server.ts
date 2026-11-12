/**
 * Starts `next dev` on :3100 for the e2e suite (prompt S22 decision 2), against the Neon e2e
 * branch, in its own output folder so it can run next to your `npm run dev`. Output is copied to
 * server.log in the suite temp folder (support/env.ts E2E_DATA_DIR), where the tests read
 * development emails (decision 3).
 *
 * Run by Playwright's webServer: node --import tsx e2e/server.ts
 */
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { e2eDatabaseUrls, e2eProcessEnv, E2E_DATA_DIR, E2E_DIST_DIR, E2E_PORT, ROOT, SERVER_LOG } from "./support/env";

const db = e2eDatabaseUrls();
mkdirSync(E2E_DATA_DIR, { recursive: true });
// A fresh build folder each run: a persistent Turbopack cache left by an earlier run (with older
// code) was the common factor in runs where the dev server recompiled and reloaded in a loop.
rmSync(path.join(ROOT, E2E_DIST_DIR), { recursive: true, force: true });
const log = createWriteStream(SERVER_LOG, { flags: "w" });
console.info(`[e2e] next dev on :${E2E_PORT} against endpoint ${db.label}; log: ${path.relative(ROOT, SERVER_LOG)}`);

const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "dev", "-p", String(E2E_PORT)], {
  cwd: ROOT,
  env: e2eProcessEnv(),
  stdio: ["ignore", "pipe", "pipe"],
});

for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk: Buffer) => {
    log.write(chunk);
    process.stdout.write(chunk);
  });
}

const stop = () => {
  if (!child.killed) child.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", stop);
child.on("exit", (code) => {
  log.end();
  process.exit(code ?? 0);
});
