import { ChevronDown } from "lucide-react";
import { cancelInvoiceAction, deleteInvoiceAction } from "@/app/account/billing/actions";
import type { ButtonVariant } from "@/components/ui";
import type { InvoiceRow } from "@/db/queries/billing-page";
import { cn } from "@/lib/cn";
import { ConfirmSubmitButton } from "./ConfirmSubmitButton";

const ACTIONS = {
  cancel: {
    label: "Cancel",
    consequence: "This invoice can't be paid after you cancel it.",
    confirm: "Yes, cancel invoice",
    variant: "danger",
    action: cancelInvoiceAction,
    tone: "text-ink",
  },
  delete: {
    label: "Delete",
    consequence: "It's removed from your list. Our payment records keep it.",
    confirm: "Yes, delete",
    variant: "secondary",
    action: deleteInvoiceAction,
    tone: "text-slate-700",
  },
} satisfies Record<
  string,
  { label: string; consequence: string; confirm: string; variant: ButtonVariant; action: (formData: FormData) => Promise<void>; tone: string }
>;

/** Which action an invoice offers its manager: cancel while open, delete once void and never paid. */
export function invoiceAction(row: InvoiceRow): keyof typeof ACTIONS | null {
  if (row.status === "open") return "cancel";
  if (row.status === "void" && !row.hasMoney) return "delete";
  return null;
}

/**
 * A disclosure, not a popover (the user's phone has no Popover API): the first click explains,
 * the second confirms, in the style of ListingActions.
 */
export function InvoiceRowActions({ row }: { row: InvoiceRow }) {
  const kind = invoiceAction(row);
  if (!kind) return null;
  const item = ACTIONS[kind];
  return (
    // -mx-3 lines the trigger text up with the cell and card text despite its own padding.
    <details className="group -mx-3">
      <summary
        className={cn(
          "inline-flex min-h-control cursor-pointer list-none items-center gap-1 rounded-lg px-3 text-small font-medium",
          "hover:bg-white md:min-h-control-sm [&::-webkit-details-marker]:hidden",
          item.tone,
        )}
      >
        {item.label}
        <span className="sr-only"> invoice {row.invoiceNumber}</span>
        <ChevronDown aria-hidden="true" className="size-4 text-slate-600 transition-transform group-open:rotate-180" />
      </summary>
      <form action={item.action} className="flex flex-col gap-2 px-3 pb-1 pt-2 md:max-w-56">
        <input type="hidden" name="invoiceNumber" value={row.invoiceNumber} />
        <p className="text-micro text-slate-700">{item.consequence}</p>
        <ConfirmSubmitButton label={item.confirm} variant={item.variant} />
      </form>
    </details>
  );
}
