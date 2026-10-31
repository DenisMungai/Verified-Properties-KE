import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { PageContainer } from "./PageContainer";

const FOOTER_LINKS = [
  { href: "/properties", label: "Explore" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/sign-in", label: "Log in" },
  { href: "/sign-up", label: "Get started" },
] as const;

/** Minimal footer with real links only (no dead links, plan §12). Keeps its dark palette. */
export function SiteFooter() {
  return (
    <footer className="mt-auto bg-ink text-white print:hidden">
      <PageContainer className="grid gap-6 py-8 md:grid-cols-2 md:items-start">
        <div className="flex max-w-sm flex-col gap-1.5">
          <p className="text-title font-bold tracking-tight text-white">{BRAND.name}</p>
          <p className="text-small text-white/80">{BRAND.description}</p>
        </div>
        <nav aria-label="Footer" className="md:justify-self-end">
          <ul className="grid grid-cols-2 gap-x-6 sm:flex sm:flex-wrap sm:gap-x-1">
            {FOOTER_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="inline-flex min-h-control items-center rounded-md px-2 text-small text-white/90 underline-offset-4 transition-colors hover:text-white hover:underline"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </PageContainer>
      <div className="border-t border-white/10">
        <PageContainer className="py-3 text-micro text-white/70">© {BRAND.name}</PageContainer>
      </div>
    </footer>
  );
}
