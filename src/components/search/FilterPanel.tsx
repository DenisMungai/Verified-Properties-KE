import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { SearchFilters } from "@/lib/search/params";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/validation/listing";
import { SEARCH_FORM_ID } from "./ids";

/** Design: section eyebrows in caption caps, Muted. */
const eyebrow = "mb-2 text-label uppercase text-slate-600";

const ROOM_OPTIONS = [
  { value: "", label: "Any" },
  { value: "1", label: "1+" },
  { value: "2", label: "2+" },
  { value: "3", label: "3+" },
  { value: "4", label: "4+" },
] as const;

function Checkbox({ name, value = "1", defaultChecked, children }: { name: string; value?: string; defaultChecked: boolean; children: ReactNode }) {
  return (
    <label className="flex min-h-control cursor-pointer items-center gap-3 text-body-sm text-ink">
      <input
        type="checkbox"
        name={name}
        value={value}
        form={SEARCH_FORM_ID}
        defaultChecked={defaultChecked}
        className="size-5 shrink-0 cursor-pointer rounded-sm border-line-strong accent-emerald-600"
      />
      {children}
    </label>
  );
}

/** "Any / 1+ / 2+ / 3+ / 4+" as native radios, five 44px pills across the sidebar. */
function RoomPills({ name, legend, value }: { name: string; legend: string; value: number | null }) {
  const current = value === null ? "" : String(value);
  return (
    <fieldset>
      <legend className={eyebrow}>{legend}</legend>
      <div className="grid grid-cols-5 gap-1 rounded-pill bg-surface-muted p-1">
        {ROOM_OPTIONS.map((option) => {
          const id = `filter-${name}-${option.value || "any"}`;
          return (
            <div key={option.value} className="relative">
              <input
                type="radio"
                id={id}
                name={name}
                value={option.value}
                form={SEARCH_FORM_ID}
                defaultChecked={current === option.value}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                className={cn(
                  "flex h-control cursor-pointer items-center justify-center rounded-pill text-button text-slate-700",
                  "hover:bg-white hover:text-ink peer-checked:bg-emerald-600 peer-checked:text-white",
                  "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-emerald-600",
                )}
              >
                <span className="sr-only">{option.value ? `${option.value} or more` : "Any number"}</span>
                <span aria-hidden="true">{option.label}</span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Sidebar filters (design "02 — Search Results"). Server-rendered; every control joins the top
 * bar's form, so submitting either keeps all filters. Land mode hides home-only fields.
 */
export function FilterPanel({
  filters,
  priceError,
  priceInput,
}: {
  filters: SearchFilters;
  priceError?: string;
  /** What was typed, shown again when the range was rejected. */
  priceInput?: { min: string; max: string };
}) {
  const land = filters.mode === "land";
  const priceErrorId = priceError ? "filter-price-error" : undefined;
  return (
    <div className="flex flex-col gap-6">
      {!land && (
        <fieldset>
          <legend className={eyebrow}>Property type</legend>
          {CATEGORIES.map((category) => (
            <Checkbox key={category} name="type" value={category} defaultChecked={filters.types.includes(category)}>
              {CATEGORY_LABELS[category]}
            </Checkbox>
          ))}
        </fieldset>
      )}

      <fieldset aria-describedby={priceErrorId}>
        <legend className={eyebrow}>Price range</legend>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="filter-min-price" className="sr-only">
              Minimum price in shillings
            </label>
            <Input
              id="filter-min-price"
              name="minPrice"
              form={SEARCH_FORM_ID}
              inputMode="numeric"
              autoComplete="off"
              placeholder="KSh 0"
              defaultValue={priceInput?.min ?? filters.minPrice ?? ""}
              aria-invalid={priceError ? true : undefined}
              className="px-3"
            />
          </div>
          <div>
            <label htmlFor="filter-max-price" className="sr-only">
              Maximum price in shillings
            </label>
            <Input
              id="filter-max-price"
              name="maxPrice"
              form={SEARCH_FORM_ID}
              inputMode="numeric"
              autoComplete="off"
              placeholder="No max"
              defaultValue={priceInput?.max ?? filters.maxPrice ?? ""}
              aria-invalid={priceError ? true : undefined}
              className="px-3"
            />
          </div>
        </div>
        {priceError && (
          <p id={priceErrorId} className="mt-2 flex items-start gap-1.5 text-caption font-medium text-danger">
            <CircleAlert aria-hidden="true" className="mt-px size-4 shrink-0" />
            {priceError}
          </p>
        )}
      </fieldset>

      {!land && <RoomPills name="beds" legend="Bedrooms" value={filters.beds} />}
      {!land && <RoomPills name="baths" legend="Bathrooms" value={filters.baths} />}

      <fieldset>
        <legend className={eyebrow}>More</legend>
        {!land && (
          <Checkbox name="furnished" defaultChecked={filters.furnished}>
            Furnished
          </Checkbox>
        )}
        {!land && (
          <Checkbox name="parking" defaultChecked={filters.parking}>
            Parking
          </Checkbox>
        )}
        <Checkbox name="verified" defaultChecked={filters.verified}>
          Verified listers only
        </Checkbox>
      </fieldset>
    </div>
  );
}
