"use client";

import { useEffect, type RefObject } from "react";
import type { ActionState } from "@/lib/action-state";

/** After a failed submit, move focus to the first invalid field so keyboard users land on it. */
export function useFocusFirstError(formRef: RefObject<HTMLFormElement | null>, state: ActionState): void {
  useEffect(() => {
    if (!state.fieldErrors || Object.keys(state.fieldErrors).length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [formRef, state]);
}
