import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { EmailOnlyForm } from "@/components/auth/EmailOnlyForm";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Reset your password" subtitle="Enter your email and we'll send you a link to choose a new one.">
      <EmailOnlyForm kind="forgot-password" />
      <p className="text-body text-ink">
        Remembered it?{" "}
        <Link href="/sign-in" className="font-medium text-emerald-700 underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
