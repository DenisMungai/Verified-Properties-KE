import { z } from "zod";
import { optionalKenyanMobile, optionalPublicEmail } from "./profile";

/**
 * An agency's office contacts (prompt lister-contact-buttons decision 10). All optional. Only these
 * fields are read from the form; the agency itself is found on the server, never from the browser.
 */
export const agencyContactSchema = z
  .object({
    phone: optionalKenyanMobile,
    /** Ticked: WhatsApp uses the office phone and the WhatsApp field is ignored, valid or not. */
    whatsappSameAsPhone: z
      .string()
      .optional()
      .transform((value) => value === "on"),
    whatsapp: z.string().optional(),
    email: optionalPublicEmail,
  })
  .transform(({ whatsappSameAsPhone, whatsapp, ...rest }, ctx) => {
    if (whatsappSameAsPhone) return { ...rest, whatsapp: rest.phone };
    const parsed = optionalKenyanMobile.safeParse(whatsapp ?? "");
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: parsed.error.issues[0]?.message ?? "Check this number.", path: ["whatsapp"] });
      return z.NEVER;
    }
    return { ...rest, whatsapp: parsed.data };
  });

export type AgencyContactInput = z.infer<typeof agencyContactSchema>;
