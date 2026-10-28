"use client";

import { useState, type FormEvent } from "react";
import { CircleCheck } from "lucide-react";
import { Button, Chip, Field, Input, SegmentedControl } from "@/components/ui";
import { normalizeKenyanPhone, type NormalizedPhone } from "@/lib/kenya";

type Mode = "buy" | "rent" | "land";

const INITIAL_CHIPS = ["Nairobi", "Under KSh 100K", "2+ bedrooms"];

export function StyleguideDemo() {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<NormalizedPhone>();
  const [mode, setMode] = useState<Mode>("rent");
  const [chips, setChips] = useState(INITIAL_CHIPS);
  const [saving, setSaving] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeKenyanPhone(phone);
    if (!normalized) {
      setResult(undefined);
      setError("Enter a Kenyan mobile number, for example 0712 345 678 or +254 712 345 678.");
      return;
    }
    setError(undefined);
    setResult(normalized);
  }

  function simulateSave() {
    setSaving(true);
    window.setTimeout(() => setSaving(false), 1500);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 rounded-lg border border-line bg-white p-6">
        <h3 className="text-h4">Kenyan phone number</h3>
        <Field
          id="demo-phone"
          label="M-Pesa phone number"
          hint="07xx, 01xx or +254 formats are accepted."
          error={error}
          required
        >
          {(control) => (
            <Input
              {...control}
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" className="self-start">
          Check number
        </Button>
        <div aria-live="polite">
          {result && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md bg-mint-50 p-4 text-body-sm">
              <dt className="flex items-center gap-1.5 font-medium text-success">
                <CircleCheck aria-hidden="true" className="size-4" />
                Stored (E.164)
              </dt>
              <dd className="tabular">{result.e164}</dd>
              <dt className="pl-[22px] font-medium text-success">M-Pesa (Daraja)</dt>
              <dd className="tabular">{result.daraja}</dd>
            </dl>
          )}
        </div>
      </form>

      <div className="flex flex-col gap-6 rounded-lg border border-line bg-white p-6">
        <h3 className="text-h4">Controlled components</h3>
        <SegmentedControl
          legend="Search mode"
          name="demo-mode"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "buy", label: "Buy" },
            { value: "rent", label: "Rent" },
            { value: "land", label: "Land" },
          ]}
        />
        <p className="text-body-sm text-slate-600" aria-live="polite">
          Selected mode: <span className="font-medium text-ink">{mode}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <Chip
              key={chip}
              removeLabel={`Remove ${chip}`}
              onRemove={() => setChips((current) => current.filter((c) => c !== chip))}
            >
              {chip}
            </Chip>
          ))}
          {chips.length === 0 && (
            <Button variant="ghost" onClick={() => setChips(INITIAL_CHIPS)}>
              Restore filters
            </Button>
          )}
        </div>
        <Button variant="secondary" loading={saving} onClick={simulateSave} className="self-start">
          {saving ? "Saving" : "Save search"}
        </Button>
      </div>
    </div>
  );
}
