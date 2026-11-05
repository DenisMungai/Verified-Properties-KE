import Link from "next/link";
import { Suspense } from "react";
import { BRAND } from "@/lib/brand";
import { getCurrentUser } from "@/lib/session";
import { PageContainer } from "./PageContainer";

type FooterLinkItem = { href: string; label: string };

const FOOTER_LINKS: readonly FooterLinkItem[] = [
  { href: "/properties", label: "Explore" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
];

const SIGNED_OUT_LINKS: readonly FooterLinkItem[] = [
  { href: "/sign-in", label: "Log in" },
  { href: "/sign-up", label: "Get started" },
];

const SIGNED_IN_LINKS: readonly FooterLinkItem[] = [{ href: "/account", label: "My account" }];

function FooterLink({ href, label }: FooterLinkItem) {
  return (
    <li>
      <Link
        href={href}
        className="inline-flex min-h-control items-center rounded-md px-2 text-small text-white/90 underline-offset-4 transition-colors hover:text-white hover:underline"
      >
        {label}
      </Link>
    </li>
  );
}

/** Account links depend on the session, so they stream in behind <Suspense> (Cache Components). */
async function FooterAccount() {
  const user = await getCurrentUser();
  const links = user?.emailVerified ? SIGNED_IN_LINKS : SIGNED_OUT_LINKS;
  return links.map((link) => <FooterLink key={link.href} {...link} />);
}

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
          {/* -mx-2 cancels the links' px-2 hit padding so their text lines up with the brand. */}
          <ul className="-mx-2 grid grid-cols-2 gap-x-6 sm:flex sm:flex-wrap sm:gap-x-1">
            {FOOTER_LINKS.map((link) => (
              <FooterLink key={link.href} {...link} />
            ))}
            <Suspense fallback={null}>
              <FooterAccount />
            </Suspense>
          </ul>
        </nav>
      </PageContainer>
      <div className="border-t border-white/10">
        <PageContainer className="py-3 text-micro text-white/70">© {BRAND.name}</PageContainer>
      </div>
    </footer>
  );
}
