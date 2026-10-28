import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// .env.local wins over .env (dotenv never overwrites a variable that is already set).
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

/** Migrations use the direct (non-pooled) connection; the app uses the pooled one. */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
