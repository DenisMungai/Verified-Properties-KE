import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { FormSkeleton } from "@/components/forms/FormSkeleton";
import { getCurrentUser } from "@/lib/session";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/safe-redirect";
import { type SearchParams, carriedNext, single } from "@/lib/search-params";

export const metadata: Metadata = { title: "Create an account" };

async function SignUpLoader({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = carriedNext(params.next);
  if (await getCurrentUser()) redirect(next ?? DEFAULT_SIGNED_IN_PATH);
  return <SignUpForm next={next} defaultIntent={single(params.intent) === "list" ? "list" : "find"} />;
}

export default function SignUpPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthShell title="Create your account" subtitle="Save homes, contact listers and manage your listings.">
      <Suspense fallback={<FormSkeleton fields={4} />}>
        <SignUpLoader searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
