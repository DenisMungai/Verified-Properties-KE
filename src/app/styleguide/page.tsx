import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Heart, Inbox, Search, SlidersHorizontal } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import {
  Badge,
  Button,
  Chip,
  EmptyState,
  Field,
  IconButton,
  Input,
  SegmentedControl,
  Select,
  Skeleton,
  Textarea,
  VerifiedBadge,
} from "@/components/ui";
import { formatKes, formatKesCompact, formatLandSize } from "@/lib/format";
import { StyleguideDemo } from "./StyleguideDemo";

export const metadata: Metadata = { title: "Style guide" };

/** Full class names so Tailwind's scanner keeps them. */
const COLOURS: Array<{ name: string; hex: string; swatch: string; note?: string }> = [
  { name: "navy-950", hex: "#0B1F3A", swatch: "bg-navy-950", note: "Brand, headings, footer" },
  { name: "navy-900", hex: "#102746", swatch: "bg-navy-900" },
  { name: "navy-800", hex: "#163B63", swatch: "bg-navy-800", note: "Links" },
  { name: "navy-700", hex: "#24517A", swatch: "bg-navy-700", note: "Navy hover" },
  { name: "emerald-700", hex: "#087443", swatch: "bg-emerald-700", note: "Primary hover" },
  { name: "emerald-600", hex: "#14833B", swatch: "bg-emerald-600", note: "Primary action" },
  { name: "emerald-500", hex: "#1C9950", swatch: "bg-emerald-500", note: "Highlights" },
  { name: "mint-50", hex: "#F1F8F3", swatch: "bg-mint-50" },
  { name: "mint-100", hex: "#E4F2E8", swatch: "bg-mint-100", note: "Selected, verified" },
  { name: "canvas", hex: "#F7F7F3", swatch: "bg-canvas", note: "Page background" },
  { name: "white", hex: "#FFFFFF", swatch: "bg-white", note: "Cards, inputs" },
  { name: "ink", hex: "#171B22", swatch: "bg-ink", note: "Body text" },
  { name: "slate-700", hex: "#475569", swatch: "bg-slate-700", note: "Secondary text" },
  { name: "slate-600", hex: "#687280", swatch: "bg-slate-600", note: "Muted text" },
  { name: "slate-500", hex: "#87919E", swatch: "bg-slate-500", note: "Placeholders, icons only" },
  { name: "line", hex: "#DCE4E2", swatch: "bg-line", note: "Borders" },
  { name: "line-strong", hex: "#C7D2D0", swatch: "bg-line-strong" },
  { name: "surface-muted", hex: "#EEF2F0", swatch: "bg-surface-muted", note: "Skeletons, disabled" },
  { name: "success", hex: "#087443", swatch: "bg-success" },
  { name: "warning", hex: "#A96508", swatch: "bg-warning" },
  { name: "danger", hex: "#B42318", swatch: "bg-danger", note: "Errors only" },
  { name: "info", hex: "#175CD3", swatch: "bg-info" },
  { name: "sand-500", hex: "#D7B982", swatch: "bg-sand-500", note: "Accent, never text" },
];

const TYPE_SCALE: Array<{ name: string; className: string; spec: string }> = [
  { name: "Display", className: "text-display", spec: "40/48 · 700" },
  { name: "H1", className: "text-h1", spec: "32/40 · 700" },
  { name: "H2", className: "text-h2", spec: "24/32 · 700" },
  { name: "H3", className: "text-h3", spec: "20/28 · 600" },
  { name: "H4", className: "text-h4", spec: "18/26 · 600" },
  { name: "Body large", className: "text-body-lg", spec: "18/29 · 400" },
  { name: "Body", className: "text-body", spec: "16/24 · 400" },
  { name: "Body small", className: "text-body-sm", spec: "14/21 · 400" },
  { name: "Label", className: "text-label uppercase", spec: "12/17 · 600 · 0.06em" },
  { name: "Caption", className: "text-caption", spec: "12/18 · 400" },
  { name: "Price", className: "text-price tabular", spec: "20/28 · 700 · tabular" },
];

const RADII = [
  { name: "sm · 8px", className: "rounded-sm" },
  { name: "md · 12px", className: "rounded-md" },
  { name: "lg · 16px", className: "rounded-lg" },
  { name: "xl · 20px", className: "rounded-xl" },
  { name: "2xl · 24px", className: "rounded-2xl" },
  { name: "pill", className: "rounded-pill" },
];

const COUNTY_OPTIONS = [
  { value: "nairobi", label: "Nairobi" },
  { value: "mombasa", label: "Mombasa" },
  { value: "kisumu", label: "Kisumu" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-6 border-t border-line py-10">
      <h2 className="text-h2">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-label uppercase text-slate-600">{label}</h3>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export default function StyleguidePage() {
  return (
    <PageContainer className="py-10">
      <header className="flex flex-col gap-2 pb-6">
        <p className="text-label uppercase text-emerald-700">Design System v1.0</p>
        <h1 className="text-h1-sm md:text-h1">Style guide</h1>
        <p className="max-w-prose text-body text-slate-600">
          Tokens and base components. Tab through the page to check focus states.
        </p>
      </header>

      <Section title="Colour">
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {COLOURS.map((colour) => (
            <li key={colour.name} className="overflow-hidden rounded-md border border-line bg-white">
              <div className={`h-16 border-b border-line ${colour.swatch}`} />
              <div className="flex flex-col p-3">
                <span className="text-body-sm font-medium">{colour.name}</span>
                <span className="text-caption tabular text-slate-600">{colour.hex}</span>
                {colour.note && <span className="text-caption text-slate-600">{colour.note}</span>}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Typography">
        <ul className="flex flex-col gap-4">
          {TYPE_SCALE.map((style) => (
            <li
              key={style.name}
              className="flex flex-col gap-1 border-b border-line pb-4 last:border-0 sm:flex-row sm:items-baseline sm:gap-6"
            >
              <span className="w-32 shrink-0 text-caption text-slate-600">
                {style.name} · {style.spec}
              </span>
              <span className={`${style.className} min-w-0 break-words text-navy-950`}>
                Nyumba nzuri in Kilimani
              </span>
            </li>
          ))}
        </ul>
        <Row label="Formatting">
          <span className="text-price tabular">{formatKes(45_000_000)}</span>
          <span className="text-body-sm tabular text-slate-600">{formatKesCompact(12_500_000)}</span>
          <span className="text-body-sm text-slate-600">{formatLandSize(0.5, "acre")}</span>
        </Row>
      </Section>

      <Section title="Radius and elevation">
        <div className="flex flex-wrap gap-4">
          {RADII.map((radius) => (
            <div
              key={radius.name}
              className={`flex size-24 items-end border border-line-strong bg-white p-2 text-caption text-slate-600 ${radius.className}`}
            >
              {radius.name}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-6">
          <div className="rounded-lg border border-line bg-white p-6 shadow-card">Card shadow</div>
          <div className="rounded-lg border border-line bg-white p-6 shadow-popover">Popover shadow</div>
          <div className="rounded-lg border border-line bg-white p-6 shadow-focus">Focus ring</div>
        </div>
      </Section>

      <Section title="Buttons">
        <Row label="Variants">
          <Button>Search properties</Button>
          <Button variant="secondary">Save search</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Delete draft</Button>
        </Row>
        <Row label="Large">
          <Button size="lg">List your property</Button>
          <Button size="lg" variant="secondary">
            Contact lister
          </Button>
        </Row>
        <Row label="Loading and disabled">
          <Button loading>Sending</Button>
          <Button disabled>Publish</Button>
          <Button variant="secondary" disabled>
            Unavailable
          </Button>
        </Row>
        <Row label="Icon buttons (44px, labelled)">
          <IconButton label="Save listing" icon={<Heart />} />
          <IconButton label="Search" icon={<Search />} variant="secondary" />
          <IconButton label="Filters" icon={<SlidersHorizontal />} variant="secondary" disabled />
        </Row>
      </Section>

      <Section title="Form controls">
        <div className="grid gap-6 md:grid-cols-2">
          <Field id="sg-town" label="Town" hint="For example Kilimani or Nyali." required>
            {(control) => <Input {...control} placeholder="Town or neighbourhood" />}
          </Field>
          <Field id="sg-county" label="County">
            {(control) => <Select {...control} options={COUNTY_OPTIONS} placeholder="Any county" />}
          </Field>
          <Field id="sg-price" label="Maximum price (KSh)" error="Maximum price must be more than the minimum.">
            {(control) => <Input {...control} inputMode="numeric" defaultValue="50000" />}
          </Field>
          <Field id="sg-disabled" label="Listing reference">
            {(control) => <Input {...control} disabled defaultValue="VPK-000123" />}
          </Field>
          <Field id="sg-message" label="Message" className="md:col-span-2" required>
            {(control) => <Textarea {...control} placeholder="I'd like to arrange a viewing." />}
          </Field>
        </div>
        <Row label="Segmented control (arrow keys move between options)">
          <SegmentedControl
            legend="Listing mode"
            name="sg-mode"
            defaultValue="buy"
            options={[
              { value: "buy", label: "Buy" },
              { value: "rent", label: "Rent" },
              { value: "land", label: "Land" },
            ]}
          />
        </Row>
      </Section>

      <Section title="Badges and chips">
        <Row label="Badges">
          <VerifiedBadge />
          <Badge tone="success">Published</Badge>
          <Badge tone="warning">Pending review</Badge>
          <Badge tone="danger">Rejected</Badge>
          <Badge tone="info">For rent</Badge>
          <Badge>Paused</Badge>
        </Row>
        <Row label="Chips">
          <Chip removeHref="/styleguide" removeLabel="Remove Nairobi">
            Nairobi
          </Chip>
          <Chip removeHref="/styleguide" removeLabel="Remove 3+ bedrooms">
            3+ bedrooms
          </Chip>
          <Chip>Furnished</Chip>
        </Row>
      </Section>

      <Section title="Loading and empty states">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-white p-4" aria-busy="true">
            <span className="sr-only">Loading listings</span>
            <Skeleton className="aspect-[4/3] w-full" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <EmptyState
            icon={<Inbox />}
            title="No listings match these filters"
            description="Try a wider price range or a nearby town."
            action={<Button variant="secondary">Clear all filters</Button>}
          />
        </div>
      </Section>

      <Section title="Interactive demo">
        <StyleguideDemo />
      </Section>
    </PageContainer>
  );
}
