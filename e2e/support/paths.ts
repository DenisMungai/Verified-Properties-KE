import path from "node:path";
import { E2E_DATA_DIR } from "./env";

/** Signed-in browser state of the run's platform admin (written by admin.setup.ts). */
export const ADMIN_STATE = path.join(E2E_DATA_DIR, "admin.json");
