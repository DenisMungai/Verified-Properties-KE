"use client";

import { useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { Button, Input, SegmentedControl, Select } from "@/components/ui";
import { formatKesCompact } from "@/lib/format";
import { MODES, MODE_LABELS, Q_MAX, type SearchMode } from "@/lib/search/params";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/validation/listing";
import { SearchForm } from "./SearchForm";

const MODE_OPTIONS = MODES.map((mode) => ({ value: mode, label: MODE_LABELS[mode] }));

const TYPE_OPTIONS = CATEGORIES.map((category) => ({ value: category, label: CATEGORY_LABELS[category] }));

/** Budget presets per mode, as a maximum price in whole shillings. */
const BUDGETS: Record<SearchMode, readonly number[]> = {
  buy: [5_000_000, 10_000_000, 20_000_000, 50_000_000, 100_000_000],
  rent: [25_000, 50_000, 100_000, 250_000, 500_000],
  land: [1_000_000, 3_000_000, 5_000_000, 10_000_000, 50_000_000],
};

const label = "text-label uppercase text-slate-600";

/**
 * Home search control (design "01 — Homepage" and "06 — Mobile Homepage"; prompt S7 decision 6).
 * Budget presets follow the mode, so this is a client component; without JavaScript it is still a
 * GET form with the Buy presets.
 */
export function HomeSearch() {
  const [mode, setMode] = useState<SearchMode>("buy");
  return (
    <SearchForm
      ariaLabel="Find a property"
      className="flex flex-col gap-4 rounded-xl border border-line bg-white p-4 shadow-card md:p-6 lg:flex-row lg:items-end lg:gap-6"
    >
      <div className="flex flex-col gap-3">
        <p className="text-body font-semibold text-ink">
          What are you looking for?
        </p>
        <SegmentedControl legend="Buy, rent or land" name="mode" idPrefix="home-mode" options={MODE_OPTIONS} value={mode} onValueChange={setMode} />
      </div>
      <div className="grid flex-1 gap-4 md:grid-cols-3 lg:gap-0 lg:divide-x lg:divide-line">
        <div className="flex flex-col gap-2 lg:px-4">
          <label htmlFor="home-q" className={label}>
            Location
          </label>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-600" />
            <Input
              id="home-q"
              name="q"
              type="search"
              placeholder="County, town or area"
              maxLength={Q_MAX}
              autoComplete="off"
              className="pl-11"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 lg:px-4">
          <label htmlFor="home-type" className={label}>
            Property type
          </label>
          {mode === "land" ? (
            <Select id="home-type" options={[]} placeholder="Land" disabled />
          ) : (
            <Select id="home-type" name="type" options={TYPE_OPTIONS} placeholder="Any property" defaultValue="" />
          )}
        </div>
        <div className="flex flex-col gap-2 lg:px-4">
          <label htmlFor="home-budget" className={label}>
            Price range
          </label>
          <Select
            key={mode}
            id="home-budget"
            name="maxPrice"
            placeholder="Any budget"
            defaultValue=""
            options={BUDGETS[mode].map((amount) => ({ value: String(amount), label: `Up to ${formatKesCompact(amount)}` }))}
          />
        </div>
      </div>
      <Button type="submit" size="lg" className="lg:min-w-52">
        Search properties
        <ArrowRight aria-hidden="true" className="size-5" />
      </Button>
    </SearchForm>
  );
}
