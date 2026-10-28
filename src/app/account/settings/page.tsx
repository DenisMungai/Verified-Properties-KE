import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { CircleCheck } from "lucide-react";
import { PageHeading } from "@/components/account/PageHeading";
import { ChangePasswordForm, NameForm, SignOutEverywhereForm } from "@/components/account/SettingsForms";
import { FormSkeleton } from "@/components/forms/FormSkeleton";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };

function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const id = `settings-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 rounded-xl border border-line bg-white p-6">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-h4">
          {title}
        </h2>
        {description && <p className="text-body-sm text-slate-600">{description}</p>}
      </div>
      {children}
    </section>
  );
}

async function Settings() {
  const user = await requireUser("/account/settings");
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card title="Profile">
        <NameForm name={user.name} />
        <div className="flex flex-col gap-1 border-t border-line pt-4">
          <p className="text-body-sm font-medium text-ink">Email address</p>
          <p className="text-body text-ink">{user.email}</p>
          <p className="flex items-center gap-1.5 text-caption font-medium text-success">
            <CircleCheck aria-hidden="true" className="size-4" />
            Verified
          </p>
        </div>
      </Card>
      <Card title="Password" description="Changing your password signs out your other devices.">
        <ChangePasswordForm />
      </Card>
      <Card title="Sessions" description="Signed in somewhere you don't recognise? Sign out everywhere, including here.">
        <SignOutEverywhereForm />
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeading title="Settings" description="Your account details and security." />
      <Suspense fallback={<FormSkeleton fields={3} />}>
        <Settings />
      </Suspense>
    </>
  );
}
