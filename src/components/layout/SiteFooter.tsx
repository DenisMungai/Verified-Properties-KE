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

/** Minimal footer with real links only (no dead links, plan §12). */
export function SiteFooter() {
  return (
    <footer className="mt-auto bg-ink text-white print:hidden">
      <PageContainer className="flex flex-col gap-6 py-10 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-sm flex-col gap-2">
          <p className="text-h4 font-bold text-white">{BRAND.name}</p>
          <p className="text-body-sm text-white/80">{BRAND.description}</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-2 gap-y-1">
            {FOOTER_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="inline-flex min-h-control items-center rounded-md px-3 text-body-sm text-white/90 hover:bg-white/10 hover:text-white"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </PageContainer>
      <div className="border-t border-white/10">
        <PageContainer className="py-4 text-caption text-white/70">© {BRAND.name}</PageContainer>
      </div>
    </footer>
  );
}
