/** Narrow, client-safe view of the signed-in user for header menus. */
export interface HeaderUser {
  name: string;
  isLister: boolean;
  isAdmin: boolean;
}

/** Public navigation. Only pages that exist are listed (no dead links, plan §12). */
export const MAIN_NAV = [{ href: "/", label: "Explore" }] as const;

export function accountLinks(user: HeaderUser) {
  return [
    { href: "/account", label: "Overview" },
    ...(user.isLister ? [{ href: "/account/listings", label: "My listings" }] : []),
    { href: "/account/saved", label: "Saved properties" },
    ...(user.isLister ? [{ href: "/account/profile", label: "Listing profile" }] : []),
    { href: "/account/settings", label: "Settings" },
    ...(user.isAdmin ? [{ href: "/admin", label: "Admin console" }] : []),
  ];
}
