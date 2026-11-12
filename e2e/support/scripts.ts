/**
 * Runs the project's own operator scripts against the e2e branch (prompt S22 decisions 4 to 6),
 * so the tests use exactly the code an operator would. The environment always comes from
 * e2eProcessEnv(), which has passed the endpoint guard.
 */
import { spawnSync } from "node:child_process";
import { e2eProcessEnv, ROOT } from "./env";

export interface ScriptResult {
  status: number;
  output: string;
}

export function runNodeScript(label: string, args: string[], extraEnv: Record<string, string> = {}): ScriptResult {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: { ...e2eProcessEnv(), ...extraEnv },
    encoding: "utf8",
    timeout: 180_000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`[e2e] ${label} failed (exit ${result.status ?? "none"}):\n${output.slice(-2_000)}`);
  }
  return { status: result.status, output };
}

const TSX_SCRIPT = ["--conditions=react-server", "--import", "tsx"];

/** `npm run mpesa:simulate -- --checkout <id>`: posts a successful callback to the e2e server. */
export function simulatePayment(checkoutRequestId: string): ScriptResult {
  return runNodeScript("mpesa:simulate", [...TSX_SCRIPT, "scripts/mpesa-simulate.ts", "--checkout", checkoutRequestId]);
}

/** `npm run admin:create -- <email>`: the operator path for the first platform admin. */
export function grantPlatformAdmin(email: string): ScriptResult {
  return runNodeScript("admin:create", ["--import", "tsx", "scripts/create-admin.ts", email], {
    ADMIN_CREATE_CONFIRM: "yes",
  });
}

/** `npm run jobs:run -- <job>` with the real clock. */
export function runJob(name: string): ScriptResult {
  return runNodeScript(`jobs:run ${name}`, [...TSX_SCRIPT, "scripts/jobs-run.ts", name]);
}
