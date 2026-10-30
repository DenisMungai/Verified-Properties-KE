/**
 * The Daraja operations the app uses (prompt S5). Implemented over HTTP (`daraja.ts`), by the
 * dev-only simulator (`simulator.ts`) and by a fake in tests. Errors carry a short code and text
 * only: never request bodies, secrets or full phone numbers.
 */

export interface StkPushRequest {
  /** 2547XXXXXXXX */
  phoneDaraja: string;
  amountKes: number;
  /** The invoice number (12 characters at most). */
  accountReference: string;
  /** 13 characters at most. */
  description: string;
  callbackUrl: string;
}

export type StkPushResult =
  | { ok: true; checkoutRequestId: string; merchantRequestId: string; customerMessage: string }
  | { ok: false; error: string };

export type StkQueryResult =
  | { kind: "result"; resultCode: number; resultDesc: string }
  | { kind: "pending" }
  | { kind: "error"; error: string };

export interface C2bRegistration {
  validationUrl: string;
  confirmationUrl: string;
  responseType: "Completed" | "Cancelled";
}

export interface DarajaClient {
  readonly kind: "daraja" | "simulator" | "fake";
  stkPush(request: StkPushRequest): Promise<StkPushResult>;
  stkQuery(checkoutRequestId: string): Promise<StkQueryResult>;
  registerC2bUrls(registration: C2bRegistration): Promise<{ ok: true } | { ok: false; error: string }>;
}
