/**
 * The card gateway as the rest of the app sees it (prompt S6 decision 14). Paystack implements it;
 * tests use a fake. Swapping providers later stays inside src/lib/card.
 */

export interface CardInitRequest {
  /** The payer's account email (Paystack requires one). */
  email: string;
  amountKes: number;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}

export type CardInitResult = { ok: true; authorizationUrl: string; reference: string } | { ok: false; error: string };

/** Gateway transaction states, as Paystack reports them. Anything unknown is treated as pending. */
export type CardTransactionStatus = "success" | "failed" | "abandoned" | "reversed" | "ongoing" | "pending" | "queued" | "processing";

export type CardVerifyResult =
  | {
      kind: "result";
      reference: string;
      status: CardTransactionStatus | string;
      /** In the currency's subunit (KES cents). */
      amountMinor: number;
      currency: string;
      paidAt: string | null;
      channel: string | null;
      /** The gateway's 64-bit transaction id, kept as digits (never through Number). */
      transactionId: string | null;
      brand: string | null;
      last4: string | null;
    }
  | { kind: "error"; error: string };

export interface CardGateway {
  readonly kind: string;
  initialize(request: CardInitRequest): Promise<CardInitResult>;
  verify(reference: string): Promise<CardVerifyResult>;
}
