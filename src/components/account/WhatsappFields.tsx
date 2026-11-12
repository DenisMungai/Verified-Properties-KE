import { Field, Input } from "@/components/ui";

/**
 * "Same as my phone number" checkbox plus the WhatsApp number (prompt lister-contact-buttons
 * decision 2). The number field hides with CSS while the box is ticked, so it works without
 * JavaScript; when ticked, the server ignores whatever the field holds.
 */
export function WhatsappFields({
  idPrefix,
  sameAsPhone,
  value,
  error,
  phoneWord = "phone number",
}: {
  /** Keeps ids unique when two forms share a page. */
  idPrefix: string;
  sameAsPhone: boolean;
  value: string;
  error?: string;
  phoneWord?: string;
}) {
  const checkboxId = `${idPrefix}whatsappSameAsPhone`;
  return (
    <div className="group flex flex-col gap-3">
      <label htmlFor={checkboxId} className="flex min-h-control cursor-pointer items-center gap-3 text-small text-ink">
        <input
          id={checkboxId}
          type="checkbox"
          name="whatsappSameAsPhone"
          defaultChecked={sameAsPhone}
          className="peer size-5 shrink-0 accent-emerald-600"
        />
        WhatsApp is on the same {phoneWord}
      </label>
      <Field
        id={`${idPrefix}whatsapp`}
        label="WhatsApp number"
        hint="Buyers tap WhatsApp to chat with you about the listing. Leave blank for no WhatsApp button."
        error={error}
        className="group-has-[input[type=checkbox]:checked]:hidden"
      >
        {(control) => <Input {...control} name="whatsapp" type="tel" inputMode="tel" autoComplete="tel" defaultValue={value} />}
      </Field>
    </div>
  );
}
