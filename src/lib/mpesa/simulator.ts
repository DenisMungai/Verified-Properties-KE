import "server-only";
import { randomUUID } from "node:crypto";
import type { DarajaClient } from "./client";

/**
 * Dev-only Daraja stand-in (prompt S5 decision 2). STK Push sends nothing to a phone; STK Query
 * reports the result stored from that payment's callback, which `npm run mpesa:simulate` posts
 * to the real route. It can never be built in production.
 */

export const SIMULATED_CHECKOUT_PREFIX = "ws_CO_SIM_";

export class SimulatorInProductionError extends Error {
  constructor() {
    super("The M-Pesa simulator cannot run in production.");
    this.name = "SimulatorInProductionError";
  }
}

/** Reads the result code stored from a payment's callback, or null when none has arrived. */
export type StoredResultLookup = (checkoutRequestId: string) => Promise<{ resultCode: number; resultDesc: string } | null>;

export function createSimulatorClient(lookup: StoredResultLookup, nodeEnv = process.env.NODE_ENV): DarajaClient {
  if (nodeEnv === "production") throw new SimulatorInProductionError();
  return {
    kind: "simulator",

    async stkPush() {
      const id = randomUUID();
      return {
        ok: true,
        checkoutRequestId: `${SIMULATED_CHECKOUT_PREFIX}${id}`,
        merchantRequestId: `SIM-${id.slice(0, 8)}`,
        customerMessage: "Simulated: no prompt is sent. Run npm run mpesa:simulate.",
      };
    },

    async stkQuery(checkoutRequestId) {
      if (!checkoutRequestId.startsWith(SIMULATED_CHECKOUT_PREFIX)) {
        return { kind: "error", error: "not a simulated payment" };
      }
      const stored = await lookup(checkoutRequestId);
      return stored ? { kind: "result", ...stored } : { kind: "pending" };
    },

    async registerC2bUrls() {
      return { ok: true };
    },
  };
}
