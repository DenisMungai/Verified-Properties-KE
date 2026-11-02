import { Search } from "lucide-react";
import { Button, Input, SegmentedControl } from "@/components/ui";
import { MODES, MODE_LABELS, Q_MAX, type SearchFilters } from "@/lib/search/params";
import { FiltersButton } from "./FilterDrawer";
import { SEARCH_FORM_ID } from "./ids";
import { SearchForm } from "./SearchForm";

const MODE_OPTIONS = MODES.map((mode) => ({ value: mode, label: MODE_LABELS[mode] }));
const SUBMIT_ON_CHANGE = ["mode"] as const;

/**
 * Results top bar (design "02 — Search Results" and "Search control - desktop"). Phones: two rows,
 * location + search icon button, then Buy / Rent / Land and "Filters (n)". From md: one row with
 * "Update results". Buy / Rent / Land submits as soon as it changes.
 */
export function SearchBar({ filters, activeCount }: { filters: SearchFilters; activeCount: number }) {
  return (
    <SearchForm
      id={SEARCH_FORM_ID}
      ariaLabel="Property search"
      submitOnChange={SUBMIT_ON_CHANGE}
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-xl border border-line bg-white p-3 md:flex md:items-center md:gap-3 md:p-2"
    >
      <div className="relative min-w-0 md:flex-1">
        <label htmlFor="search-q" className="sr-only">
          Location
        </label>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" />
        <Input
          id="search-q"
          name="q"
          type="search"
          defaultValue={filters.q ?? ""}
          placeholder="County, town or area"
          maxLength={Q_MAX}
          autoComplete="off"
          className="rounded-full pl-9"
        />
      </div>
      <Button type="submit" className="size-control px-0 md:hidden">
        <Search aria-hidden="true" className="size-5" />
        <span className="sr-only">Search</span>
      </Button>
      <div className="col-span-2 flex items-center justify-between gap-3 md:contents">
        <div className="md:border-l md:border-line md:pl-3">
          <SegmentedControl legend="Buy, rent or land" name="mode" idPrefix="search-mode" options={MODE_OPTIONS} defaultValue={filters.mode} />
        </div>
        <FiltersButton activeCount={activeCount} className="md:hidden" />
      </div>
      <Button type="submit" className="hidden md:inline-flex md:min-w-36">
        Update results
      </Button>
    </SearchForm>
  );
}
