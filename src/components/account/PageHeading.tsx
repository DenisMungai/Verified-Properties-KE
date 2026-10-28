import type { ReactNode } from "react";

export function PageHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="text-h1-sm md:text-h1">{title}</h1>
        {description && <p className="text-body-lg text-slate-600">{description}</p>}
      </div>
      {action}
    </div>
  );
}
