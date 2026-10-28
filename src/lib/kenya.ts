/** Kenyan reference data and phone handling. */

export const KENYA_COUNTIES = [
  "Baringo", "Bomet", "Bungoma", "Busia", "Elgeyo-Marakwet", "Embu", "Garissa", "Homa Bay",
  "Isiolo", "Kajiado", "Kakamega", "Kericho", "Kiambu", "Kilifi", "Kirinyaga", "Kisii",
  "Kisumu", "Kitui", "Kwale", "Laikipia", "Lamu", "Machakos", "Makueni", "Mandera",
  "Marsabit", "Meru", "Migori", "Mombasa", "Murang'a", "Nairobi", "Nakuru", "Nandi",
  "Narok", "Nyamira", "Nyandarua", "Nyeri", "Samburu", "Siaya", "Taita-Taveta", "Tana River",
  "Tharaka-Nithi", "Trans Nzoia", "Turkana", "Uasin Gishu", "Vihiga", "Wajir", "West Pokot",
] as const;

export type KenyaCounty = (typeof KENYA_COUNTIES)[number];

export const AMENITIES = [
  "24-hour security", "Backup generator", "Borehole", "CCTV", "Fibre internet", "Garden",
  "Gated community", "Gym", "Lift", "Loading bays", "Parking", "Sea view",
  "Servant quarters", "Solar water heating", "Swimming pool", "Water included",
] as const;

export const COMMERCIAL_SUBTYPES = [
  "Office", "Retail", "Warehouse", "Industrial", "Hospitality", "Mixed use", "Other",
] as const;

export interface NormalizedPhone {
  /** E.164 for storage and display: +254712345678 */
  e164: string;
  /** Daraja (M-Pesa) PartyA/PhoneNumber format: 254712345678 */
  daraja: string;
}

/** Kenyan mobile subscriber numbers: 9 digits starting with 7 or 1 (07xx / 01xx locally). */
const SUBSCRIBER = /^[71]\d{8}$/;

/**
 * Accepts 07xx / 01xx, 7xx / 1xx, 2547xx / 2541xx and +254… forms, with spaces, dashes, dots or
 * brackets. Returns null for anything that is not a Kenyan mobile number.
 */
export function normalizeKenyanPhone(input: string): NormalizedPhone | null {
  const trimmed = input.trim();
  // At most one "+", and only before the first digit: "+254…" or "(+254)…".
  if (!/^[\s(]*\+?[\d\s\-().]+$/.test(trimmed)) return null;
  const hasPlus = trimmed.includes("+");
  const digits = trimmed.replace(/\D/g, "");

  let subscriber: string | null = null;
  if (hasPlus) {
    if (digits.startsWith("254")) subscriber = digits.slice(3);
  } else if (digits.startsWith("254")) {
    subscriber = digits.slice(3);
  } else if (digits.startsWith("0")) {
    subscriber = digits.slice(1);
  } else {
    subscriber = digits;
  }

  if (!subscriber || !SUBSCRIBER.test(subscriber)) return null;
  return { e164: `+254${subscriber}`, daraja: `254${subscriber}` };
}

/** "+254712345678" -> "+254 712 345 678" */
export function displayKenyanPhone(e164: string): string {
  const match = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return match ? `+254 ${match[1]} ${match[2]} ${match[3]}` : e164;
}

/**
 * For logs and admin lists: keeps the network digit and the last three digits only.
 * "+254712345678" -> "+254 7•• ••• 678". Anything unexpected is fully masked.
 */
export function maskPhone(phone: string): string {
  const match = /^\+?254(\d)\d{5}(\d{3})$/.exec(phone);
  return match ? `+254 ${match[1]}•• ••• ${match[2]}` : "••••••••";
}
