"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { signOutAction } from "@/app/(auth)/actions";
import { buttonClasses } from "@/components/ui/Button";
import { Logo } from "./Logo";
import { NavLink } from "./NavLink";
import { MAIN_NAV, accountLinks, type HeaderUser } from "./nav";

const linkClasses = "flex min-h-control items-center rounded-md px-3 text-small font-medium text-ink transition-colors hover:bg-mint-50";
const activeLinkClasses = "bg-mint-50 font-semibold text-emerald-700";

/**
 * Slide-out drawer below `md` (17.5rem, pinned left), built on <dialog>: showModal() traps focus and makes the page
 * inert, Esc closes it and focus returns to the trigger. It also closes on navigation.
 */
export function MobileMenu({ user }: { user: HeaderUser | null }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const pathname = usePathname();

  useEffect(() => {
    dialogRef.current?.close();
  }, [pathname]);

  function show() {
    dialogRef.current?.showModal();
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        className="inline-flex size-control items-center justify-center rounded-md text-ink hover:bg-mint-50 group-has-[[data-header-overlay]]/header:text-white group-has-[[data-header-overlay]]/header:hover:bg-white/10"
      >
        <Menu aria-hidden="true" className="size-5" />
        <span className="sr-only">Open menu</span>
      </button>
      <dialog
        ref={dialogRef}
        id={dialogId}
        aria-label="Menu"
        onClose={() => setOpen(false)}
        className="m-0 h-dvh max-h-none w-sidebar max-w-[85vw] border-r border-line bg-white p-0 backdrop:bg-ink/40"
      >
        <div className="flex h-[66px] items-center justify-between border-b border-line px-4">
          <Logo />
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="inline-flex size-control items-center justify-center rounded-md text-ink hover:bg-mint-50"
          >
            <X aria-hidden="true" className="size-5" />
            <span className="sr-only">Close menu</span>
          </button>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-0.5 p-3">
          {MAIN_NAV.map((item) => (
            <NavLink key={item.href} href={item.href} className={linkClasses} activeClassName={activeLinkClasses}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          {user ? (
            <>
              <p className="px-3 pb-2 text-micro text-slate-600">Signed in as {user.name}</p>
              <ul className="flex flex-col gap-1">
                {accountLinks(user).map((link) => (
                  <li key={link.href}>
                    <NavLink href={link.href} className={linkClasses} activeClassName={activeLinkClasses}>
                      {link.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
              <form action={signOutAction} className="mt-3">
                <button type="submit" className={buttonClasses({ variant: "secondary", className: "w-full" })}>
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <Link href="/sign-in" className={buttonClasses({ variant: "secondary", className: "w-full" })}>
                Log in
              </Link>
              <Link href="/sign-up" className={buttonClasses({ className: "w-full" })}>
                Get started
              </Link>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
