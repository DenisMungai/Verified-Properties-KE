import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignInForm } from "@/components/auth/SignInForm";
import { FormSkeleton } from "@/components/forms/FormSkeleton";
import { getCurrentUser } from "@/lib/session";
import { DEFAULT_SIGNED_IN_PATH } from "@/lib/safe-redirect";
import { type SearchParams, carriedNext, single } from "@/lib/search-params";

export const metadata: Metadata = { title: "Log in" };

async function SignInLoader({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = carriedNext(params.next);
  if (await getCurrentUser()) redirect(next ?? DEFAULT_SIGNED_IN_PATH);
  const notice = single(params.reset) === "1" ? "Password updated. Sign in with your new password." : undefined;
  return <SignInForm next={next} notice={notice} />;
}

export default function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to continue to your account.">
      <Suspense fallback={<FormSkeleton fields={2} />}>
        <SignInLoader searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
