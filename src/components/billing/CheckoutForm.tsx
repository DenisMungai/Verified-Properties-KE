"use client";

import { useState, useTransition } from "react";
import { Lock } from "lucide-react";
import {
  scheduleDowngradeAction,
  startCardPaymentAction,
  startPlanPaymentAction,
} from "@/app/account/billing/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { Button, Field, Input, SegmentedControl } from "@/components/ui";
import type { PlanChangeKind } from "@/lib/billing/plan-change";
import { cn } from "@/lib/cn";
import { formatKes } from "@/lib/format";
import { listingLimitLine } from "./plan-copy";
import { PaymentStatusPanel } from "./PaymentStatusPanel";

export interface CheckoutPlanOption {
  code: string;
  name: string;
  listingLimit: number | null;
  kind: PlanChangeKind;
  /** What paying now costs; 0 for a scheduled downgrade. Display only: the server prices it. */
  payKes: number;
  line: string;
  isCurrent: boolean;
}

type Method = "mpesa" | "card";

type Started = {
  paymentId: string;
  invoiceNumber: string;
  amountKes: number;
  planName: string;
  maskedPhone: string;
};

/**
 * Plan picker and payment (prompt S6 decisions 6, 15, 16). The browser sends a plan code and a
 * phone only; amounts shown here come from the server and are never sent back.
 */
export function CheckoutForm({
  options,
  defaultCode,
  defaultPhone,
  mpesaEnabled,
  cardsEnabled,
  paybill,
}: {
  options: CheckoutPlanOption[];
  defaultCode: string;
  defaultPhone: string;
  mpesaEnabled: boolean;
  cardsEnabled: boolean;
  paybill: string | null;
}) {
  const [code, setCode] = useState(defaultCode);
  const [method, setMethod] = useState<Method>(mpesaEnabled ? "mpesa" : "card");
  const [phone, setPhone] = useState(defaultPhone);
  const [error, setError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [started, setStarted] = useState<Started | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [pending, startTransition] = useTransition();

  const selected = options.find((option) => option.code === code) ?? options[0];
  const isDowngrade = selected.kind === "downgrade";
  const busy = pending || redirecting;

  if (started) {
    return (
      <PaymentStatusPanel
        paymentId={started.paymentId}
        method="mpesa"
        invoiceNumber={started.invoiceNumber}
        planName={started.planName}
        amountKes={started.amountKes}
        maskedPhone={started.maskedPhone}
        paybill={paybill}
        onRetry={() => setStarted(null)}
      />
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPhoneError(null);
    startTransition(async () => {
      if (isDowngrade) {
        const result = await scheduleDowngradeAction({ planCode: selected.code });
        if (result && !result.ok) setError(result.error);
        return;
      }
      if (method === "card") {
        const result = await startCardPaymentAction({ planCode: selected.code });
        if (!result.ok) return setError(result.error);
        setRedirecting(true);
        window.location.assign(result.authorizationUrl);
        return;
      }
      const result = await startPlanPaymentAction({ planCode: selected.code, phone });
      if (!result.ok) {
        if (result.field === "phone") setPhoneError(result.error);
        else setError(result.error);
        return;
      }
      setStarted(result);
    });
  }

  const showMethods = !isDowngrade && mpesaEnabled && cardsEnabled;
  const submitLabel = isDowngrade
    ? "Schedule downgrade"
    : method === "card"
      ? `Pay ${formatKes(selected.payKes)} by card`
      : `Pay ${formatKes(selected.payKes)} with M-Pesa`;

  return (
    <form onSubmit={submit} className="flex flex-col gap-6 rounded-xl border border-line bg-white p-4 md:p-6" noValidate>
      {error && <FormAlert state={{ formError: error }} />}

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-h4">Choose a plan</legend>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {options.map((option) => {
            const id = `plan-${option.code}`;
            const checked = option.code === selected.code;
            return (
              <div key={option.code} className="relative">
                <input
                  type="radio"
                  id={id}
                  name="planCode"
                  value={option.code}
                  checked={checked}
                  onChange={() => setCode(option.code)}
                  className="peer sr-only"
                  aria-describedby={`${id}-line`}
                />
                <label
                  htmlFor={id}
                  className={cn(
                    "flex h-full cursor-pointer flex-col gap-2 rounded-xl border bg-white p-4 transition-colors hover:border-ink",
                    "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-emerald-600",
                    checked ? "border-emerald-600 ring-2 ring-emerald-600" : "border-line-strong",
                  )}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-h4">{option.name}</span>
                    {option.isCurrent && (
                      <span className="rounded-pill bg-mint-50 px-3 py-1 text-caption font-semibold text-emerald-700">
                        Current plan
                      </span>
                    )}
                  </span>
                  <span className="text-body-sm text-slate-600">{listingLimitLine(option.listingLimit)}</span>
                  <span className="text-body font-semibold tabular">
                    {option.kind === "downgrade" ? "Nothing to pay now" : `${formatKes(option.payKes)} / 30 days`}
                  </span>
                  <span id={`${id}-line`} className="text-body-sm text-emerald-700">
                    {option.line}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>

      {showMethods && (
        <SegmentedControl<Method>
          legend="How do you want to pay?"
          legendClassName="mb-3 text-h4"
          name="method"
          variant="outline"
          options={[
            { value: "mpesa", label: "M-Pesa" },
            { value: "card", label: "Card" },
          ]}
          value={method}
          onValueChange={setMethod}
        />
      )}

      {!isDowngrade && method === "mpesa" && (
        <Field
          id="phone"
          label="M-Pesa number"
          hint="We'll send an M-Pesa request to this number."
          error={phoneError ?? undefined}
          required
          className="max-w-sm"
        >
          {(control) => (
            <Input
              {...control}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          )}
        </Field>
      )}

      {!isDowngrade && method === "card" && (
        <p className="flex items-start gap-2 text-body-sm text-slate-700">
          <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          You&rsquo;ll enter your Visa or Mastercard details on Paystack&rsquo;s secure page. We never see or store your
          card number.
        </p>
      )}

      <div className="flex flex-col gap-3 border-t border-line pt-6">
        <p className="text-body-sm text-slate-700">
          {isDowngrade
            ? `${selected.name} starts when your current period ends. You keep your current plan until then.`
            : method === "card"
              ? `You'll pay ${formatKes(selected.payKes)} by card through Paystack.`
              : `You'll pay ${formatKes(selected.payKes)} to Paybill ${paybill ?? ""}.`}
        </p>
        <Button type="submit" size="lg" loading={busy} className="w-full sm:w-auto sm:self-start">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
