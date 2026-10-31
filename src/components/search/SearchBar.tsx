import { Search } from "lucide-react";
import { Button, Input, SegmentedControl } from "@/components/ui";
import { MODES, MODE_LABELS, Q_MAX, type SearchFilters } from "@/lib/search/params";
import { SEARCH_FORM_ID } from "./ids";
import { SearchForm } from "./SearchForm";

const MODE_OPTIONS = MODES.map((mode) => ({ value: mode, label: MODE_LABELS[mode] }));

/** Results top bar (design "02 — Search Results" and "Search control - desktop"). */
export function SearchBar({ filters }: { filters: SearchFilters }) {
  return (
    <SearchForm
      id={SEARCH_FORM_ID}
      ariaLabel="Property search"
      className="flex flex-col gap-3 rounded-xl border border-line bg-white p-3 md:flex-row md:items-center md:gap-3 md:p-2"
    >
      <div className="relative min-w-0 flex-1">
        <label htmlFor="search-q" className="sr-only">
          Location
        </label>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-600" />
        <Input
          id="search-q"
          name="q"
          type="search"
          defaultValue={filters.q ?? ""}
          placeholder="County, town or neighbourhood"
          maxLength={Q_MAX}
          autoComplete="off"
          className="rounded-full pl-9"
        />
      </div>
      <div className="md:border-l md:border-line md:pl-3">
        <SegmentedControl legend="Buy, rent or land" name="mode" idPrefix="search-mode" options={MODE_OPTIONS} defaultValue={filters.mode} />
      </div>
      <Button type="submit" className="md:min-w-36">
        Update results
      </Button>
    </SearchForm>
  );
}
