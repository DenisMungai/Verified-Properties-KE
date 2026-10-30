import type { DarajaClient, StkPushRequest, StkPushResult, StkQueryResult } from "@/lib/mpesa/client";

/**
 * In-memory Daraja for tests: records pushes, hands out checkout ids, and answers STK Query from
 * `queryResults` (success by default). `failNextPush` makes the next push fail.
 */
export interface FakeDaraja extends DarajaClient {
  pushes: StkPushRequest[];
  queryResults: Map<string, StkQueryResult[]>;
  queryCalls: string[];
  failNextPush: string | null;
}

export function createFakeDaraja(): FakeDaraja {
  let n = 0;
  const fake: FakeDaraja = {
    kind: "fake",
    pushes: [],
    queryResults: new Map(),
    queryCalls: [],
    failNextPush: null,

    async stkPush(request): Promise<StkPushResult> {
      fake.pushes.push(request);
      if (fake.failNextPush) {
        const error = fake.failNextPush;
        fake.failNextPush = null;
        return { ok: false, error };
      }
      n += 1;
      const id = `ws_CO_TEST_${Date.now()}_${n}`;
      return { ok: true, checkoutRequestId: id, merchantRequestId: `m_${n}`, customerMessage: "ok" };
    },

    async stkQuery(checkoutRequestId): Promise<StkQueryResult> {
      fake.queryCalls.push(checkoutRequestId);
      const queue = fake.queryResults.get(checkoutRequestId);
      return queue?.shift() ?? { kind: "result", resultCode: 0, resultDesc: "ok" };
    },

    async registerC2bUrls() {
      return { ok: true };
    },
  };
  return fake;
}
