"use client";

import { useActionState, useRef, useState } from "react";
import { saveBasicsAction } from "@/app/account/listings/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Field, Input, SegmentedControl, Select } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { KENYA_COUNTIES } from "@/lib/kenya";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  LISTING_TYPES,
  LISTING_TYPE_LABELS,
  RENT_PERIODS,
  RENT_PERIOD_LABELS,
  type Category,
  type ListingTypeValue,
} from "@/lib/validation/listing";
import { StepFormFooter } from "./StepFormFooter";

export type BasicsDefaults = Record<
  "title" | "listingType" | "category" | "county" | "town" | "neighbourhood" | "priceKes" | "rentPeriod" | "bedrooms",
  string
>;

const TYPE_OPTIONS = LISTING_TYPES.map((value) => ({ value, label: LISTING_TYPE_LABELS[value] }));
const CATEGORY_OPTIONS = CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] }));
const COUNTY_OPTIONS = KENYA_COUNTIES.map((value) => ({ value, label: value }));
const RENT_PERIOD_OPTIONS = RENT_PERIODS.map((value) => ({ value, label: RENT_PERIOD_LABELS[value] }));
const BEDROOM_OPTIONS = Array.from({ length: 21 }, (_, n) => ({
  value: String(n),
  label: n === 0 ? "Studio (0)" : String(n),
}));

const asType = (value: string): ListingTypeValue => (value === "rent" ? "rent" : "sale");
const asCategory = (value: string): Category | "" =>
  (CATEGORIES as readonly string[]).includes(value) ? (value as Category) : "";

/** Step 1, "Property basics" (design "04 — Create Listing"). Creates the draft on first save. */
export function BasicsForm({ listingId, defaults }: { listingId?: string; defaults: BasicsDefaults }) {
  const [state, action, pending] = useActionState(saveBasicsAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const value = (name: keyof BasicsDefaults) => state.values?.[name] ?? defaults[name];
  const errors = state.fieldErrors ?? {};

  const [listingType, setListingType] = useState<ListingTypeValue>(asType(value("listingType")));
  const [category, setCategory] = useState<Category | "">(asCategory(value("category")));
  const isHome = category === "house" || category === "apartment";

  return (
    <form ref={formRef} action={action} noValidate className="flex flex-col gap-6">
      <h2 className="text-title">Property basics</h2>
      <FormAlert state={state} />
      {listingId && <input type="hidden" name="listingId" value={listingId} />}

      <Field id="title" label="Listing title" error={errors.title} required>
        {(control) => (
          <Input
            {...control}
            name="title"
            maxLength={120}
            placeholder="e.g. Modern 3-bedroom apartment in Kilimani"
            defaultValue={value("title")}
          />
        )}
      </Field>

      <div className="flex flex-col gap-2">
        <SegmentedControl
          legend="Listing type"
          legendClassName="mb-2 text-small font-medium text-ink"
          name="listingType"
          variant="outline"
          options={TYPE_OPTIONS}
          value={listingType}
          onValueChange={setListingType}
        />
        {errors.listingType && <p className="text-micro font-medium text-danger">{errors.listingType}</p>}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Field id="category" label="Property category" error={errors.category} required>
          {(control) => (
            <Select
              {...control}
              name="category"
              placeholder="Choose a category"
              options={CATEGORY_OPTIONS}
              value={category}
              onChange={(event) => setCategory(asCategory(event.target.value))}
            />
          )}
        </Field>
        <Field id="county" label="County" error={errors.county} required>
          {(control) => (
            <Select
              {...control}
              name="county"
              placeholder="Choose a county"
              options={COUNTY_OPTIONS}
              defaultValue={value("county")}
            />
          )}
        </Field>
        <Field id="town" label="Town" hint="For example Nairobi, Ruiru or Kisumu." error={errors.town} required>
          {(control) => (
            <Input {...control} name="town" maxLength={60} autoComplete="address-level2" defaultValue={value("town")} />
          )}
        </Field>
        <Field id="neighbourhood" label="Area / neighbourhood" error={errors.neighbourhood}>
          {(control) => (
            <Input
              {...control}
              name="neighbourhood"
              maxLength={60}
              placeholder="e.g. Kilimani"
              defaultValue={value("neighbourhood")}
            />
          )}
        </Field>
        <Field
          id="priceKes"
          label="Price (KSh)"
          hint={listingType === "rent" ? "The rent amount in shillings." : "The full asking price in shillings."}
          error={errors.priceKes}
          required
        >
          {(control) => (
            <Input
              {...control}
              name="priceKes"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Enter price"
              defaultValue={value("priceKes")}
            />
          )}
        </Field>
        {listingType === "rent" && (
          <Field id="rentPeriod" label="Rent is paid" error={errors.rentPeriod} required>
            {(control) => (
              <Select
                {...control}
                name="rentPeriod"
                options={RENT_PERIOD_OPTIONS}
                defaultValue={value("rentPeriod") || "month"}
              />
            )}
          </Field>
        )}
        {isHome && (
          <Field id="bedrooms" label="Bedrooms" error={errors.bedrooms} required>
            {(control) => (
              <Select
                {...control}
                name="bedrooms"
                placeholder="Choose"
                options={BEDROOM_OPTIONS}
                defaultValue={value("bedrooms")}
              />
            )}
          </Field>
        )}
      </div>

      <StepFormFooter pending={pending} />
    </form>
  );
}
