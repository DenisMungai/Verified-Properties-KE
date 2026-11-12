/**
 * Resets the e2e branch to its parent's current state through the Neon API (prompt S22
 * decision 1). Needs NEON_API_KEY, E2E_NEON_PROJECT_ID and E2E_NEON_BRANCH_ID in .env.local.
 * The branch's endpoint must be the guarded e2e endpoint, or nothing is reset.
 */
import { E2eGuardError } from "./env";

const API = "https://console.neon.tech/api/v2";

interface BranchInfo {
  branch: { id: string; name: string; parent_id?: string };
}

interface EndpointList {
  endpoints: { id: string; branch_id: string }[];
}

async function neon<T>(key: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Neon API ${init.method ?? "GET"} ${path} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function resetE2eBranch(expectedEndpoint: string): Promise<void> {
  const key = process.env.NEON_API_KEY;
  const projectId = process.env.E2E_NEON_PROJECT_ID;
  const branchId = process.env.E2E_NEON_BRANCH_ID;
  if (!key || !projectId || !branchId) {
    throw new Error(
      [
        "[e2e] Can't reset the e2e branch: set NEON_API_KEY, E2E_NEON_PROJECT_ID and E2E_NEON_BRANCH_ID in .env.local,",
        "or reset it yourself (Neon console > Branches > e2e > Reset from parent) and run again with E2E_SKIP_RESET=yes.",
      ].join("\n"),
    );
  }

  const { branch } = await neon<BranchInfo>(key, `/projects/${projectId}/branches/${branchId}`);
  const { endpoints } = await neon<EndpointList>(key, `/projects/${projectId}/branches/${branchId}/endpoints`);
  if (branch.name !== "e2e" || !branch.parent_id || !endpoints.some((e) => e.id === expectedEndpoint)) {
    throw new E2eGuardError(`branch ${branchId} is not the e2e branch behind ${expectedEndpoint}; not resetting.`);
  }

  console.info(`[e2e] resetting branch ${branch.name} from its parent…`);
  await neon(key, `/projects/${projectId}/branches/${branchId}/restore`, {
    method: "POST",
    body: JSON.stringify({ source_branch_id: branch.parent_id }),
  });
  for (let i = 0; i < 60; i++) {
    const { operations } = await neon<{ operations: { status: string }[] }>(
      key,
      `/projects/${projectId}/operations?limit=10`,
    );
    if (operations.every((op) => op.status === "finished" || op.status === "failed" || op.status === "skipped")) {
      console.info("[e2e] reset done.");
      return;
    }
    await wait(2_000);
  }
  throw new Error("[e2e] the branch reset did not finish within 2 minutes.");
}
