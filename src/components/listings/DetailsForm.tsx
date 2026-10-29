"use client";

import { useActionState, useRef } from "react";
import { saveDetailsAction } from "@/app/account/listings/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { AMENITIES, COMMERCIAL_SUBTYPES } from "@/lib/kenya";
import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  LAND_UNITS,
  LAND_UNIT_LABELS,
  type Category,
} from "@/lib/validation/listing";
import { StepFormFooter } from "./StepFormFooter";

export type DetailsDefaults = Record<
  | "description"
  | "bathrooms"
  | "areaSqm"
  | "landSize"
  | "landSizeUnit"
  | "furnished"
  | "parkingSpaces"
  | "amenities"
  | "subtype"
  | "zoningNotes",
  string
>;

const LAND_UNIT_OPTIONS = LAND_UNITS.map((value) => ({ value, label: LAND_UNIT_LABELS[value] }));
const SUBTYPE_OPTIONS = COMMERCIAL_SUBTYPES.map((value) => ({ value, label: value }));

const checkboxRow =
  "flex min-h-control cursor-pointer items-center gap-3 rounded-md px-2 text-body-sm text-ink hover:bg-canvas";
const checkboxInput = "size-5 shrink-0 cursor-pointer rounded-sm accent-emerald-600";

/** Step 2, "Property details". Which fields show depends on the category saved in Basics. */
export function DetailsForm({
  listingId,
  category,
  defaults,
}: {
  listingId: string;
  category: Category;
  defaults: DetailsDefaults;
}) {
  const [state, action, pending] = useActionState(saveDetailsAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const value = (name: keyof DetailsDefaults) => state.values?.[name] ?? defaults[name];
  const errors = state.fieldErrors ?? {};
  const isHome = category === "house" || category === "apartment";
  const isLand = category === "land";
  const isCommercial = category === "commercial";
  const amenities = new Set(value("amenities").split("|").filter(Boolean));

  return (
    <form ref={formRef} action={action} noValidate className="flex flex-col gap-6">
      <h2 className="text-h3">Property details</h2>
      <FormAlert state={state} />
      <input type="hidden" name="listingId" value={listingId} />

      <Field
        id="description"
        label="Description"
        hint={`At least ${DESCRIPTION_MIN} characters to submit. Describe the layout, condition and what's nearby.`}
        error={errors.description}
        required
      >
        {(control) => (
          <Textarea
            {...control}
            name="description"
            rows={8}
            maxLength={DESCRIPTION_MAX}
            defaultValue={value("description")}
          />
        )}
      </Field>

      <div className="grid gap-6 md:grid-cols-2">
        {isHome && (
          <Field id="bathrooms" label="Bathrooms" hint="Whole or half numbers, e.g. 2.5." error={errors.bathrooms} required>
            {(control) => (
              <Input {...control} name="bathrooms" inputMode="decimal" defaultValue={value("bathrooms")} />
            )}
          </Field>
        )}
        {!isLand && (
          <Field id="areaSqm" label="Built area (m²)" error={errors.areaSqm}>
            {(control) => <Input {...control} name="areaSqm" inputMode="decimal" defaultValue={value("areaSqm")} />}
          </Field>
        )}
        {isLand && (
          <>
            <Field id="landSize" label="Land size" hint="For example 0.25 or 5." error={errors.landSize} required>
              {(control) => (
                <Input {...control} name="landSize" inputMode="decimal" defaultValue={value("landSize")} />
              )}
            </Field>
            <Field id="landSizeUnit" label="Unit" error={errors.landSizeUnit} required>
              {(control) => (
                <Select
                  {...control}
                  name="landSizeUnit"
                  placeholder="Choose a unit"
                  options={LAND_UNIT_OPTIONS}
                  defaultValue={value("landSizeUnit")}
                />
              )}
            </Field>
          </>
        )}
        {!isLand && (
          <Field id="parkingSpaces" label="Parking spaces" error={errors.parkingSpaces}>
            {(control) => (
              <Input {...control} name="parkingSpaces" inputMode="numeric" defaultValue={value("parkingSpaces")} />
            )}
          </Field>
        )}
        {isCommercial && (
          <Field id="subtype" label="Commercial type" error={errors.subtype} required>
            {(control) => (
              <Select
                {...control}
                name="subtype"
                placeholder="Choose a type"
                options={SUBTYPE_OPTIONS}
                defaultValue={value("subtype")}
              />
            )}
          </Field>
        )}
      </div>

      {isCommercial && (
        <Field
          id="zoningNotes"
          label="Zoning and permitted use"
          hint="As declared by you, for example “Approved for office and retail use”."
          error={errors.zoningNotes}
        >
          {(control) => (
            <Textarea {...control} name="zoningNotes" rows={3} maxLength={1000} defaultValue={value("zoningNotes")} />
          )}
        </Field>
      )}

      {!isLand && (
        <>
          <label className={checkboxRow}>
            <input
              type="checkbox"
              name="furnished"
              value="1"
              defaultChecked={value("furnished") === "1"}
              className={checkboxInput}
            />
            Furnished
          </label>
          <fieldset className="flex flex-col gap-2" aria-describedby={errors.amenities ? "amenities-error" : undefined}>
            <legend className="mb-2 text-body-sm font-medium text-ink">
              Amenities <span className="font-normal text-slate-600">(optional)</span>
            </legend>
            <div className="grid grid-cols-2 gap-x-3 md:grid-cols-3">
              {AMENITIES.map((amenity) => (
                <label key={amenity} className={checkboxRow}>
                  <input
                    type="checkbox"
                    name="amenities"
                    value={amenity}
                    defaultChecked={amenities.has(amenity)}
                    className={checkboxInput}
                  />
                  {amenity}
                </label>
              ))}
            </div>
            {errors.amenities && (
              <p id="amenities-error" className="text-caption font-medium text-danger">
                {errors.amenities}
              </p>
            )}
          </fieldset>
        </>
      )}

      <StepFormFooter pending={pending} />
    </form>
  );
}
