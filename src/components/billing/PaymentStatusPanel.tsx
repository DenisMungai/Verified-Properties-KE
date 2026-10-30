"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, Clock, Smartphone } from "lucide-react";
import { getPaymentStatusAction } from "@/app/account/billing/actions";
import { Button, Spinner, buttonClasses } from "@/components/ui";
import type { PaymentView } from "@/lib/billing/payment-view";
import { formatKes } from "@/lib/format";
import { PaybillInstructions } from "./PaybillInstructions";

/** Poll every 3 s for up to 2 minutes (prompt S6 decision 6). */
const POLL_MS = 3_000;
const GIVE_UP_MS = 120_000;

type Shown = PaymentView["state"] | "timed_out" | "not_found";

export interface PaymentStatusPanelProps {
  paymentId: string;
  method: PaymentView["method"];
  invoiceNumber: string;
  planName: string;
  amountKes: number;
  /** "+254 7•• ••• 678" for M-Pesa. */
  maskedPhone?: string;
  /** The Paybill for the timed-out fallback; null when M-Pesa is not set up. */
  paybill: string | null;
  /** Back to the form with the same plan. */
  onRetry?: () => void;
  retryHref?: string;
}

type Copy = { title: string | ((p: PaymentStatusPanelProps) => string); body: (p: PaymentStatusPanelProps, view: PaymentView | null) => string };

const COPY: Record<Exclude<Shown, "waiting">, Copy> = {
  confirmed: {
    title: "Payment received",
    body: (p, view) => (view?.paidUntil ? `Your ${p.planName} plan is paid until ${view.paidUntil}.` : `Your ${p.planName} plan is paid.`),
  },
  failed: {
    title: "The payment didn't go through",
    body: (p) =>
      p.method === "card"
        ? "Your bank declined the card, or the payment wasn't finished. Nothing was charged."
        : "M-Pesa reported a problem, such as a wrong PIN or a low balance. Nothing was charged.",
  },
  cancelled: {
    title: "The payment didn't go through",
    body: (p) => (p.method === "card" ? "The card payment wasn't completed." : "The request was cancelled on your phone."),
  },
  flagged: {
    title: "We received a payment we need to check",
    body: () => "Our team will review it and get back to you. You don't need to pay again.",
  },
  timed_out: {
    title: (p) => (p.method === "card" ? "Still waiting for your bank" : "Still waiting for M-Pesa"),
    body: (p) =>
      p.method === "card"
        ? "We haven't had a final answer yet. If you finished paying, check again in a moment."
        : "We haven't heard back yet. If you didn't get the prompt, pay by Paybill below, then check again. If you already paid, check again in a moment.",
  },
  not_found: {
    title: "We couldn't find that payment",
    body: () => "Open your billing page to see your invoices.",
  },
};

export function PaymentStatusPanel(props: PaymentStatusPanelProps) {
  const { paymentId, method, planName, amountKes, maskedPhone, paybill, invoiceNumber, onRetry, retryHref } = props;
  const [shown, setShown] = useState<Shown>("waiting");
  const [view, setView] = useState<PaymentView | null>(null);
  const [checking, setChecking] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const poll = useCallback(async (): Promise<Shown> => {
    const result = await getPaymentStatusAction(paymentId);
    if (!result.ok) return "not_found";
    setView(result.payment);
    return result.payment.state;
  }, [paymentId]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const tick = async () => {
      let next: Shown;
      try {
        next = await poll();
      } catch {
        next = "waiting";
      }
      if (stopped) return;
      if (next !== "waiting") return setShown(next);
      if (Date.now() - startedAt >= GIVE_UP_MS) return setShown("timed_out");
      timer = setTimeout(tick, POLL_MS);
    };
    // Server Actions run one at a time per client, so each poll waits for the previous one.
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [poll]);

  useEffect(() => {
    if (shown !== "waiting") headingRef.current?.focus();
  }, [shown]);

  async function checkAgain() {
    setChecking(true);
    try {
      const next = await poll();
      setShown(next === "waiting" ? "timed_out" : next);
    } catch {
      setShown("timed_out");
    } finally {
      setChecking(false);
    }
  }

  const amount = formatKes(amountKes);
  const retry =
    onRetry ? (
      <Button size="lg" onClick={onRetry} className="w-full sm:w-auto">
        Try again
      </Button>
    ) : retryHref ? (
      <Link href={retryHref} className={buttonClasses({ size: "lg", className: "w-full sm:w-auto" })}>
        Try again
      </Link>
    ) : null;

  let icon = <Spinner className="size-6 text-emerald-600" />;
  let title = method === "card" ? "Confirming your card payment" : "Check your phone";
  let body =
    method === "card"
      ? `We're confirming your payment of ${amount} for ${planName} with your bank. This takes a few seconds.`
      : `Enter your M-Pesa PIN on ${maskedPhone ?? "your phone"} to pay ${amount} for ${planName}.`;
  if (shown !== "waiting") {
    const copy = COPY[shown];
    title = typeof copy.title === "function" ? copy.title(props) : copy.title;
    body = copy.body(props, view);
    icon =
      shown === "confirmed" ? (
        <CircleCheck className="size-6 text-emerald-600" />
      ) : shown === "timed_out" ? (
        <Clock className="size-6 text-warning-text" />
      ) : (
        <CircleAlert className="size-6 text-danger" />
      );
  } else if (method === "mpesa") {
    icon = <Smartphone className="size-6 text-emerald-600" />;
  }

  return (
    <section aria-labelledby="payment-status-heading" className="flex flex-col gap-6 rounded-xl border border-line bg-white p-4 md:p-6">
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className="inline-flex size-12 shrink-0 items-center justify-center rounded-pill bg-mint-50">
          {icon}
        </span>
        <div aria-live="polite" className="flex min-w-0 flex-col gap-1">
          <h2 id="payment-status-heading" ref={headingRef} tabIndex={-1} className="text-h3 focus:outline-none">
            {title}
          </h2>
          <p className="text-body text-slate-700">{body}</p>
          <p className="text-body-sm text-slate-600 tabular">Invoice {invoiceNumber}</p>
        </div>
      </div>

      {shown === "waiting" && method === "mpesa" && (
        <p className="flex items-center gap-2 text-body-sm text-slate-600">
          <Spinner />
          Waiting for M-Pesa to confirm…
        </p>
      )}

      {shown === "timed_out" && method === "mpesa" && paybill && (
        <PaybillInstructions paybill={paybill} invoiceNumber={invoiceNumber} amountKes={amountKes} />
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        {shown === "confirmed" && (
          <>
            <Link href="/account/listings" className={buttonClasses({ size: "lg", className: "w-full sm:w-auto" })}>
              Go to my listings
            </Link>
            <Link href="/account/billing" className={buttonClasses({ variant: "secondary", size: "lg", className: "w-full sm:w-auto" })}>
              View billing
            </Link>
          </>
        )}
        {(shown === "failed" || shown === "cancelled") && retry}
        {shown === "timed_out" && (
          <Button size="lg" loading={checking} onClick={checkAgain} className="w-full sm:w-auto">
            Check again
          </Button>
        )}
        {(shown === "flagged" || shown === "not_found") && (
          <Link href="/account/billing" className={buttonClasses({ variant: "secondary", size: "lg", className: "w-full sm:w-auto" })}>
            View billing
          </Link>
        )}
      </div>
    </section>
  );
}
