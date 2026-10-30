/**
 * What a Daraja result means for a payment (prompt S5 decision 6). Pure.
 *
 * A payment is confirmed only when the callback and the STK Query agree on success; the query
 * never confirms alone, because only the callback carries the receipt and amount.
 */

export const RESULT_SUCCESS = 0;
export const RESULT_CANCELLED_BY_USER = 1032;

/** Query answers that mean "ask again later", not a final result. */
const QUERY_STILL_PROCESSING_CODES = new Set([4999]);
const QUERY_STILL_PROCESSING_ERRORS = new Set(["500.001.1001"]);

export function isQueryStillProcessing({
  resultCode,
  errorCode,
}: {
  resultCode?: number;
  errorCode?: string;
}): boolean {
  if (resultCode !== undefined && QUERY_STILL_PROCESSING_CODES.has(resultCode)) return true;
  return errorCode !== undefined && QUERY_STILL_PROCESSING_ERRORS.has(errorCode);
}

export type ClosedStatus = "cancelled" | "failed";

export function closedStatusFor(resultCode: number): ClosedStatus {
  return resultCode === RESULT_CANCELLED_BY_USER ? "cancelled" : "failed";
}

export type StkDecision =
  | { action: "confirm" }
  | { action: "close"; status: ClosedStatus }
  | { action: "flag"; reason: "callback_query_mismatch" };

/** The table in decision 6, for a callback result and a definitive query result. */
export function decideStkOutcome(callbackCode: number, queryCode: number): StkDecision {
  const callbackOk = callbackCode === RESULT_SUCCESS;
  const queryOk = queryCode === RESULT_SUCCESS;
  if (callbackOk && queryOk) return { action: "confirm" };
  if (!callbackOk && !queryOk) return { action: "close", status: closedStatusFor(callbackCode) };
  return { action: "flag", reason: "callback_query_mismatch" };
}
