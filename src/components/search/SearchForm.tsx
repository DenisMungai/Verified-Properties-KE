"use client";

import Form from "next/form";
import { useRouter } from "next/navigation";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { SEARCH_PATH, canonicalSearchHref, formDataToParams } from "@/lib/search/params";

/**
 * The search form (prompt S7 decision 6). Without JavaScript it is a plain GET form to
 * /properties and the page parses whatever arrives. With JavaScript it navigates to the canonical
 * URL instead, so blank fields never end up in the address bar. Fields named in `submitOnChange`
 * submit the form as soon as they change (results page Buy / Rent / Land).
 */
export function SearchForm({
  id,
  className,
  ariaLabel,
  submitOnChange,
  children,
}: {
  id?: string;
  className?: string;
  ariaLabel: string;
  submitOnChange?: readonly string[];
  children: ReactNode;
}) {
  const router = useRouter();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    router.push(canonicalSearchHref(formDataToParams(data.entries())));
  }

  function onChange(event: ChangeEvent<HTMLFormElement>) {
    const field = event.target as EventTarget & { name?: unknown };
    if (typeof field.name === "string" && submitOnChange?.includes(field.name)) {
      event.currentTarget.requestSubmit();
    }
  }

  return (
    <Form
      action={SEARCH_PATH}
      id={id}
      role="search"
      aria-label={ariaLabel}
      onSubmit={onSubmit}
      onChange={submitOnChange ? onChange : undefined}
      className={className}
    >
      {children}
    </Form>
  );
}
