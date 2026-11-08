/** Narrow, client-safe view of the signed-in user for header menus. */
export interface HeaderUser {
  name: string;
  isLister: boolean;
  isAdmin: boolean;
  /** Unread messages when the page rendered; badges poll for updates (prompt S15). */
  unread: number;
}

export interface AccountLink {
  href: string;
  label: string;
  /** Show the unread messages badge next to this link. */
  badge?: boolean;
}

export const MESSAGES_HREF = "/account/messages";

/** Public navigation. Only pages that exist are listed (no dead links, plan §12). */
export const MAIN_NAV = [
  { href: "/", label: "Home" },
  { href: "/properties", label: "Explore" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
] as const;

export function accountLinks(user: Pick<HeaderUser, "isLister" | "isAdmin">): AccountLink[] {
  return [
    { href: "/account", label: "Overview" },
    { href: MESSAGES_HREF, label: "Messages", badge: true },
    ...(user.isLister
      ? [
          { href: "/account/listings", label: "My listings" },
          { href: "/account/verification", label: "Verification" },
          { href: "/account/billing", label: "Subscription & billing" },
        ]
      : []),
    { href: "/account/saved", label: "Saved properties" },
    ...(user.isLister ? [{ href: "/account/profile", label: "Listing profile" }] : []),
    { href: "/account/settings", label: "Settings" },
    ...(user.isAdmin ? [{ href: "/admin", label: "Admin console" }] : []),
  ];
}
