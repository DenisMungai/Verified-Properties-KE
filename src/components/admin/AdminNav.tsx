import { NavLink } from "@/components/layout/NavLink";

const OVERVIEW = { href: "/admin", label: "Overview", exact: true } as const;
const MODERATION_LINKS = [
  { href: "/admin/listings", label: "Listings queue", exact: false },
  { href: "/admin/verification", label: "Verification", exact: false },
  { href: "/admin/reports", label: "Reports", exact: false },
] as const;
/** Billing and platform admins both work on billing (prompt S10 decision 1). */
const BILLING = { href: "/admin/billing", label: "Billing", exact: false } as const;
/** Both admin roles see job health and email delivery (prompt S16 decision 12). */
const JOBS = { href: "/admin/jobs", label: "Jobs & emails", exact: false } as const;

/** Admin sections (design "03 — Admin Console & Moderation"). Moderation links are for platform admins. */
export function AdminNav({ moderator }: { moderator: boolean }) {
  const links = moderator ? [OVERVIEW, ...MODERATION_LINKS, BILLING, JOBS] : [OVERVIEW, BILLING, JOBS];
  return (
    <nav aria-label="Admin">
      <ul className="hide-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0">
        {links.map((link) => (
          <li key={link.href} className="shrink-0">
            <NavLink
              href={link.href}
              exact={link.exact}
              className="flex min-h-control items-center whitespace-nowrap rounded-md px-3 text-small font-medium text-slate-600 transition-colors hover:bg-white hover:text-ink"
              activeClassName="bg-mint-50 font-semibold text-emerald-700 hover:bg-mint-50 hover:text-emerald-700"
            >
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
