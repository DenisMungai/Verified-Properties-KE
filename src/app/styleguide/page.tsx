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
  { name: "emerald-600 · Forest", hex: "#14833B", swatch: "bg-emerald-600", note: "Primary action, brand" },
  { name: "emerald-700 · Deep green", hex: "#087443", swatch: "bg-emerald-700", note: "Hover, auth panel" },
  { name: "mint-50 · Soft green", hex: "#E8F4EC", swatch: "bg-mint-50", note: "Quiet button, active nav" },
  { name: "mint-100", hex: "#DCEDE2", swatch: "bg-mint-100", note: "Soft green hover" },
  { name: "canvas · Warm canvas", hex: "#F7F8F5", swatch: "bg-canvas", note: "Page background" },
  { name: "white", hex: "#FFFFFF", swatch: "bg-white", note: "Cards, inputs" },
  { name: "ink · Charcoal", hex: "#17231D", swatch: "bg-ink", note: "Text and headings" },
  { name: "slate-700", hex: "#4A564F", swatch: "bg-slate-700", note: "Secondary text" },
  { name: "slate-600 · Muted", hex: "#647168", swatch: "bg-slate-600", note: "Supporting text" },
  { name: "line · Border", hex: "#E1E7E2", swatch: "bg-line", note: "Cards, dividers" },
  { name: "line-strong", hex: "#8C968F", swatch: "bg-line-strong", note: "Form-control borders (3:1)" },
  { name: "surface-muted", hex: "#EEF2EF", swatch: "bg-surface-muted", note: "Skeletons, disabled" },
  { name: "warning", hex: "#B7791F", swatch: "bg-warning", note: "Icons and tints only" },
  { name: "warning-text", hex: "#8A5206", swatch: "bg-warning-text", note: "Warning text" },
  { name: "danger · Error", hex: "#B42318", swatch: "bg-danger", note: "Errors only" },
  { name: "info", hex: "#175CD3", swatch: "bg-info" },
];

/** Rendered px at the 90% root (1rem = 14.4px). */
const TYPE_SCALE: Array<{ name: string; className: string; spec: string }> = [
  { name: "Display", className: "text-display", spec: "3.5rem ≈ 50px · 700 · -0.055em" },
  { name: "Display small", className: "text-display-sm", spec: "2.25rem ≈ 32px · 700 · -0.045em" },
  { name: "Title", className: "text-title", spec: "1.125rem ≈ 16px · 600" },
  { name: "Body", className: "text-body", spec: "0.875rem ≈ 12.6px · 400" },
  { name: "Small (most UI)", className: "text-small", spec: "0.75rem ≈ 10.8px · 400" },
  { name: "Micro (meta, badges)", className: "text-micro", spec: "0.625rem ≈ 9px · 0.02em" },
  { name: "Eyebrow", className: "text-micro font-semibold uppercase tracking-wide", spec: "micro · 600 · caps" },
  { name: "Price", className: "text-display-sm tabular", spec: "display-sm · tabular" },
];

const RADII = [
  { name: "sm · 2px · cards", className: "rounded-sm" },
  { name: "4px · inputs", className: "rounded" },
  { name: "md · 6px · menu items", className: "rounded-md" },
  { name: "lg · 8px · buttons, panels", className: "rounded-lg" },
  { name: "xl · 12px · hero, popovers", className: "rounded-xl" },
  { name: "full · pills", className: "rounded-full" },
];

const COUNTY_OPTIONS = [
  { value: "nairobi", label: "Nairobi" },
  { value: "mombasa", label: "Mombasa" },
  { value: "kisumu", label: "Kisumu" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-6 border-t border-line py-10">
      <h2 className="text-title">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-micro tracking-wide font-semibold uppercase text-slate-600">{label}</h3>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export default function StyleguidePage() {
  return (
    <PageContainer className="py-10">
      <header className="flex flex-col gap-2 pb-6">
        <p className="text-micro tracking-wide font-semibold uppercase text-emerald-700">VerifiedPropertiesKE design system</p>
        <h1 className="text-display-sm">Style guide</h1>
        <p className="max-w-prose text-body text-slate-600">
          Tokens and base components. CSS root is 90%: body text is 14.4px at a 16px browser default, controls stay 44px. Tab through the page to check focus states.
        </p>
      </header>

      <Section title="Colour">
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {COLOURS.map((colour) => (
            <li key={colour.name} className="overflow-hidden rounded-md border border-line bg-white">
              <div className={`h-16 border-b border-line ${colour.swatch}`} />
              <div className="flex flex-col p-3">
                <span className="text-small font-medium">{colour.name}</span>
                <span className="text-micro tabular text-slate-600">{colour.hex}</span>
                {colour.note && <span className="text-micro text-slate-600">{colour.note}</span>}
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
              <span className="w-32 shrink-0 text-micro text-slate-600">
                {style.name} · {style.spec}
              </span>
              <span className={`${style.className} min-w-0 break-words text-ink`}>
                Nyumba nzuri in Kilimani
              </span>
            </li>
          ))}
        </ul>
        <Row label="Formatting">
          <span className="text-display-sm tabular">{formatKes(45_000_000)}</span>
          <span className="text-small tabular text-slate-600">{formatKesCompact(12_500_000)}</span>
          <span className="text-small text-slate-600">{formatLandSize(0.5, "acre")}</span>
        </Row>
      </Section>

      <Section title="Radius and elevation">
        <div className="flex flex-wrap gap-4">
          {RADII.map((radius) => (
            <div
              key={radius.name}
              className={`flex size-24 items-end border border-line-strong bg-white p-2 text-micro text-slate-600 ${radius.className}`}
            >
              {radius.name}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-6">
          <div className="rounded-lg border border-line bg-white p-5">Borders separate surfaces</div>
          <div className="rounded-sm border border-line bg-white p-5 transition-shadow hover:shadow-sm">Card hover: shadow-sm only</div>
          <div className="rounded-lg border border-line bg-white p-5 shadow-focus">Focus ring</div>
        </div>
      </Section>

      <Section title="Buttons">
        <Row label="Variants">
          <Button>Search properties</Button>
          <Button variant="secondary">View details</Button>
          <Button variant="quiet">Save property</Button>
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
          <Badge tone="warning">In review</Badge>
          <Badge tone="danger">Needs action</Badge>
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
