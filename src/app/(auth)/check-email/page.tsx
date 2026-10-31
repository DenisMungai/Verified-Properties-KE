import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { EmailOnlyForm } from "@/components/auth/EmailOnlyForm";

export const metadata: Metadata = { title: "Check your email" };

export default function CheckEmailPage() {
  return (
    <AuthShell title="Check your email" subtitle="One more step to finish setting up your account.">
      <div className="flex gap-4 rounded-lg border border-line bg-white p-5">
        <span
          aria-hidden="true"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-mint-50 text-emerald-700"
        >
          <MailCheck className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-body font-medium text-ink">If this email is new to us, we&apos;ve sent a confirmation link.</p>
          <p className="text-small text-slate-600">
            Open it on this device to finish signing up. The link expires in 1 hour. Check your spam folder if it
            hasn&apos;t arrived after a few minutes.
          </p>
        </div>
      </div>
      <section aria-labelledby="resend-heading" className="flex flex-col gap-4">
        <h2 id="resend-heading" className="text-title">
          Didn&apos;t get it?
        </h2>
        <EmailOnlyForm kind="resend-verification" />
      </section>
      <p className="text-body text-ink">
        Already confirmed?{" "}
        <Link href="/sign-in" className="font-medium text-emerald-700 underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
