import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { FormAlert } from "@/components/forms/FormAlert";
import { FormSkeleton } from "@/components/forms/FormSkeleton";
import { buttonClasses } from "@/components/ui/Button";
import { type SearchParams, single } from "@/lib/search-params";

export const metadata: Metadata = { title: "Choose a new password" };

/** Better Auth redirects here with ?token=… from a valid link, or ?error=INVALID_TOKEN. */
async function ResetLoader({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const token = single(params.token);
  if (!token || single(params.error)) {
    return (
      <div className="flex flex-col gap-5">
        <FormAlert state={{ formError: "This link has expired or was already used. Request a new one." }} />
        <Link href="/forgot-password" className={buttonClasses({ size: "lg", className: "w-full" })}>
          Request a new link
        </Link>
      </div>
    );
  }
  return <ResetPasswordForm token={token} />;
}

export default function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthShell title="Choose a new password" subtitle="Your other devices will be signed out.">
      <Suspense fallback={<FormSkeleton fields={2} />}>
        <ResetLoader searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
