import type { ReactNode } from "react";

export function PageHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col">
        <h1 className="text-display-sm">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-body text-slate-600">{description}</p>}
      </div>
      {action}
    </div>
  );
}
