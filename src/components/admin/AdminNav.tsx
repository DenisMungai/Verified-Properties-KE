import { NavLink } from "@/components/layout/NavLink";

const MODERATION_LINKS = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/listings", label: "Listings queue", exact: false },
  { href: "/admin/reports", label: "Reports", exact: false },
] as const;

/** Admin sections (design "03 — Admin Console & Moderation"). Moderation links are for platform admins. */
export function AdminNav({ moderator }: { moderator: boolean }) {
  const links = moderator ? MODERATION_LINKS : MODERATION_LINKS.slice(0, 1);
  return (
    <nav aria-label="Admin">
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0">
        {links.map((link) => (
          <li key={link.href} className="shrink-0">
            <NavLink
              href={link.href}
              exact={link.exact}
              className="flex min-h-control items-center whitespace-nowrap rounded-md px-4 text-body font-medium text-slate-600 hover:bg-white hover:text-ink"
              activeClassName="bg-mint-50 text-emerald-700 hover:bg-mint-50 hover:text-emerald-700"
            >
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
