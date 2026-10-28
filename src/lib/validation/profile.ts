import { z } from "zod";
import { LISTER_TYPES } from "@/lib/roles";
import { normalizeKenyanPhone } from "@/lib/kenya";

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, { error: message })
    .transform((value) => (value === "" ? null : value));

/**
 * Lister onboarding / profile. Only these fields are read from the form; anything else the
 * client sends (role, verification, agency) is ignored because it never reaches the schema output.
 */
export const listerProfileSchema = z.object({
  listerType: z.enum(LISTER_TYPES, { error: "Choose how you list property." }),
  displayName: z
    .string()
    .trim()
    .min(2, { error: "Enter the name buyers will see." })
    .max(80, { error: "Use at most 80 characters." }),
  phone: z
    .string()
    .trim()
    .min(1, { error: "Enter a phone number buyers can call." })
    .transform((value, ctx) => {
      const normalized = normalizeKenyanPhone(value);
      if (!normalized) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a Kenyan mobile number, for example 0712 345 678.",
        });
        return z.NEVER;
      }
      return normalized.e164;
    }),
  publicEmail: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => (value === "" ? null : value))
    .pipe(
      z.union([z.null(), z.email({ error: "Enter a valid email address, or leave it blank." })]),
    ),
  bio: optionalText(600, "Use at most 600 characters."),
});

export type ListerProfileInput = z.infer<typeof listerProfileSchema>;
