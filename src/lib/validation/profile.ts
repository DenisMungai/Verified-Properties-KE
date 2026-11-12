import { z } from "zod";
import { LISTER_TYPES } from "@/lib/roles";
import { normalizeKenyanPhone } from "@/lib/kenya";

const MOBILE_ERROR = "Enter a Kenyan mobile number, for example 0712 345 678.";

/** A required Kenyan mobile number, stored as E.164. */
const kenyanMobile = (missing: string) =>
  z
    .string()
    .trim()
    .min(1, { error: missing })
    .transform((value, ctx) => {
      const normalized = normalizeKenyanPhone(value);
      if (!normalized) {
        ctx.addIssue({ code: "custom", message: MOBILE_ERROR });
        return z.NEVER;
      }
      return normalized.e164;
    });

/** An optional Kenyan mobile number: blank becomes null, anything else must normalise. */
export const optionalKenyanMobile = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === "") return null;
    const normalized = normalizeKenyanPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: MOBILE_ERROR });
      return z.NEVER;
    }
    return normalized.e164;
  });

/** An optional public email: blank becomes null. */
export const optionalPublicEmail = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => (value === "" ? null : value))
  .pipe(z.union([z.null(), z.email({ error: "Enter a valid email address, or leave it blank." })]));

/** A checkbox: present ("on") when ticked, absent otherwise. */
const checkbox = z
  .string()
  .optional()
  .transform((value) => value === "on");

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
export const listerProfileSchema = z
  .object({
    listerType: z.enum(LISTER_TYPES, { error: "Choose how you list property." }),
    displayName: z
      .string()
      .trim()
      .min(2, { error: "Enter the name buyers will see." })
      .max(80, { error: "Use at most 80 characters." }),
    phone: kenyanMobile("Enter a phone number buyers can call."),
    /** Ticked: WhatsApp uses the phone number and the WhatsApp field is ignored, valid or not. */
    whatsappSameAsPhone: checkbox,
    whatsapp: z.string().optional(),
    publicEmail: optionalPublicEmail,
    bio: optionalText(600, "Use at most 600 characters."),
  })
  .transform(({ whatsappSameAsPhone, whatsapp, ...rest }, ctx) => {
    if (whatsappSameAsPhone) return { ...rest, whatsapp: rest.phone };
    const parsed = optionalKenyanMobile.safeParse(whatsapp ?? "");
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: MOBILE_ERROR, path: ["whatsapp"] });
      return z.NEVER;
    }
    return { ...rest, whatsapp: parsed.data };
  });

export type ListerProfileInput = z.infer<typeof listerProfileSchema>;
