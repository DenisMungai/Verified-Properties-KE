"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

export function PrintButton() {
  return (
    <Button variant="secondary" onClick={() => window.print()} className="print:hidden">
      <Printer aria-hidden="true" className="size-4" />
      Print
    </Button>
  );
}
