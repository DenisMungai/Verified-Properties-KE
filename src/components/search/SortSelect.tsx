"use client";

import { Select } from "@/components/ui/Select";
import { SORTS, SORT_LABELS, type SearchSort } from "@/lib/search/params";
import { SEARCH_FORM_ID } from "./ids";

const SORT_OPTIONS = SORTS.map((sort) => ({ value: sort, label: SORT_LABELS[sort] }));

/** Submits the search form on change; the visually hidden button covers no-JavaScript use. */
export function SortSelect({ value }: { value: SearchSort }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="search-sort" className="whitespace-nowrap text-small text-slate-600">
        Sort by
      </label>
      <Select
        id="search-sort"
        name="sort"
        form={SEARCH_FORM_ID}
        defaultValue={value}
        options={SORT_OPTIONS}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="h-8 w-44 pl-3 pr-8"
      />
      <button
        type="submit"
        form={SEARCH_FORM_ID}
        className="sr-only focus:not-sr-only focus:inline-flex focus:min-h-control focus:items-center focus:rounded-md focus:px-3 focus:text-small focus:font-semibold focus:text-emerald-700"
      >
        Apply sort
      </button>
    </div>
  );
}
