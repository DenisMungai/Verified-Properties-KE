"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { signOutAction } from "@/app/(auth)/actions";
import { accountLinks, type HeaderUser } from "./nav";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}

/** Desktop account disclosure: name button → links and sign out. Esc and outside click close it. */
export function AccountMenu({ user }: { user: HeaderUser }) {
  const pathname = usePathname();
  // Remember where the menu was opened: navigating elsewhere closes it without an effect.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const setOpen = (value: boolean) => setOpenedOn(value ? pathname : null);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenedOn(null);
        buttonRef.current?.focus();
      }
    }
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpenedOn(null);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="inline-flex h-control items-center gap-2 rounded-full border border-line bg-white pl-0.5 pr-3 text-small font-semibold text-ink transition-colors hover:bg-canvas"
      >
        <span
          aria-hidden="true"
          className="inline-flex size-[38px] items-center justify-center rounded-full bg-mint-50 text-small font-semibold text-emerald-700"
        >
          {initials(user.name)}
        </span>
        <span className="max-w-40 truncate">{user.name}</span>
        <ChevronDown aria-hidden="true" className="size-4 text-slate-600" />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-line bg-white p-2"
      >
        <ul className="flex flex-col">
          {accountLinks(user).map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="flex min-h-control items-center rounded-md px-3 text-small text-ink hover:bg-mint-50"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <form action={signOutAction} className="mt-1 border-t border-line pt-1">
          <button
            type="submit"
            className="flex min-h-control w-full items-center gap-2 rounded-md px-3 text-left text-small text-ink hover:bg-mint-50"
          >
            <LogOut aria-hidden="true" className="size-4 text-slate-600" />
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
