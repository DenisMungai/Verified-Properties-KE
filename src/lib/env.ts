import "server-only";
import { z } from "zod";

/**
 * Server-side environment, validated lazily so `next build` and the style guide work without a
 * database or any service configured. Call getServerEnv() only in code that needs it.
 * Only DATABASE_URL is required here; each later slice tightens the variables it depends on
 * with a dedicated `require…()` helper that fails with a clear message.
 */
const serverSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),

  DATABASE_URL: z.string({ error: "DATABASE_URL is required (Neon pooled connection string)" }).min(1),
  DATABASE_URL_UNPOOLED: z.string().optional(),
  TEST_DATABASE_URL: z.string().optional(),

  BETTER_AUTH_SECRET: z.string().min(32, { error: "must be at least 32 characters" }).optional(),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_PUBLIC_BUCKET: z.string().optional(),
  R2_PRIVATE_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.url().optional(),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  /** QStash region host (prompt S9 decision 14); unset uses the client's default. */
  QSTASH_URL: z.url().optional(),
  QSTASH_TOKEN: z.string().optional(),
  QSTASH_CURRENT_SIGNING_KEY: z.string().optional(),
  QSTASH_NEXT_SIGNING_KEY: z.string().optional(),

  MPESA_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_SHORTCODE: z.string().regex(/^\d{5,7}$/, { error: "must be a 5-7 digit shortcode" }).optional(),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_CALLBACK_TOKEN: z.string().min(24, { error: "must be at least 24 characters" }).optional(),
  MPESA_CALLBACK_BASE_URL: z.url().optional(),
  /** Comma-separated IPv4 CIDRs allowed to call the payment callbacks (prompt S5 decision 3). */
  MPESA_CALLBACK_ALLOWED_IPS: z.string().optional(),

  /** Paystack secret key for card payments (prompt S6 decision 17); unset hides the Card option. */
  PAYSTACK_SECRET_KEY: z
    .string()
    .regex(/^sk_(test|live)_[A-Za-z0-9]+$/, { error: "must be a Paystack secret key (sk_test_... or sk_live_...)" })
    .optional(),
  /** Comma-separated IPv4 CIDRs allowed to call the card webhook; defaults to Paystack's IPs with a live key. */
  PAYSTACK_WEBHOOK_ALLOWED_IPS: z.string().optional(),

  AT_USERNAME: z.string().optional(),
  AT_API_KEY: z.string().optional(),
  AT_SENDER_ID: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

/** Treat empty strings (as in a copied .env.example) as unset. */
function withoutEmptyStrings(
  source: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) out[key] = value === "" ? undefined : value;
  return out;
}

/** Pure parser, exported for tests. Error messages name variables, never values. */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const parsed = serverSchema.safeParse(withoutEmptyStrings(source));
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid server configuration:\n${problems}\nSee .env.example.`);
  }
  return parsed.data;
}

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
