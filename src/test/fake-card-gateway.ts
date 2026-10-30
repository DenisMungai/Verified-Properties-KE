import type { CardGateway, CardInitRequest, CardVerifyResult } from "@/lib/card/gateway";

/**
 * In-memory card gateway for tests: records initialisations and answers Verify from
 * `verifyResults` (by default a success for the initialised amount, in KES, on a Visa •••• 4081).
 */
export interface FakeCardGateway extends CardGateway {
  inits: CardInitRequest[];
  verifyResults: Map<string, Partial<Extract<CardVerifyResult, { kind: "result" }>> | { kind: "error"; error: string }>;
  verifyCalls: string[];
  failNextInit: string | null;
}

export function createFakeCardGateway(): FakeCardGateway {
  const fake: FakeCardGateway = {
    kind: "fake",
    inits: [],
    verifyResults: new Map(),
    verifyCalls: [],
    failNextInit: null,

    async initialize(request) {
      fake.inits.push(request);
      if (fake.failNextInit) {
        const error = fake.failNextInit;
        fake.failNextInit = null;
        return { ok: false, error };
      }
      return { ok: true, authorizationUrl: `https://checkout.paystack.com/${request.reference}`, reference: request.reference };
    },

    async verify(reference): Promise<CardVerifyResult> {
      fake.verifyCalls.push(reference);
      const init = fake.inits.find((i) => i.reference === reference);
      const override = fake.verifyResults.get(reference);
      if (override && "kind" in override && override.kind === "error") return override;
      return {
        kind: "result",
        reference,
        status: "success",
        amountMinor: (init?.amountKes ?? 0) * 100,
        currency: "KES",
        paidAt: new Date().toISOString(),
        channel: "card",
        transactionId: "9007199254740993",
        brand: "visa",
        last4: "4081",
        ...(override as Partial<Extract<CardVerifyResult, { kind: "result" }>> | undefined),
      };
    },
  };
  return fake;
}
