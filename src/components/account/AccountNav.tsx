import { NavLink } from "@/components/layout/NavLink";
import { accountLinks, type HeaderUser } from "@/components/layout/nav";

/**
 * Design "01 — Lister Dashboard" sidebar: active item on Soft green with Forest text.
 * Below lg it becomes a horizontally scrollable tab list. Only built sections are listed.
 */
export function AccountNav({ user }: { user: HeaderUser }) {
  const links = accountLinks(user).filter((link) => link.href.startsWith("/account"));
  return (
    <nav aria-label="Account">
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0">
        {links.map((link) => (
          <li key={link.href} className="shrink-0">
            <NavLink
              href={link.href}
              exact={link.href === "/account"}
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
