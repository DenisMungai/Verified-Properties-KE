# Infra — move Neon to Frankfurt and pin Vercel to fra1

## Goal

Cut database latency by running the database and the app's server functions next to each other
in Frankfurt:
- Neon `aws-eu-central-1`
- Vercel `fra1`

From Kenya, the current Neon project in Singapore (`aws-ap-southeast-1`) measured about 1.4s per
query, with roughly 7.5% of requests failing on connection timeouts. That made signed-in pages
slow and the S1 browser checks unreliable.

## References read

- `AGENTS.md`
- `README.md` (Neon setup section)
- `prompts/s1-auth.md`
- Neon account state via the Neon tools, read-only:
  - projects, regions, and branches of `fancy-cake-91987982`
- Vercel configuration: `vercel.json` `regions` controls where Functions run. Its `$schema` is
  `https://openapi.vercel.sh/vercel.json`.

## Current state

| | Value |
|---|---|
| Neon project | "Verified Properties KE" (`fancy-cake-91987982`), `aws-ap-southeast-1`, Postgres 18 |
| Branches | `production` (default), `dev`, `test` |
| Data | none worth keeping: S0/S1 schema only, 0 users (throwaway test accounts were deleted) |
| `.env` | `DATABASE_URL` / `DATABASE_URL_UNPOOLED` → `dev`; `TEST_DATABASE_URL` → `test` |
| Vercel | no project or `vercel.json` yet |
| Git | S1 is uncommitted (56 changed files) |

## Decisions

1. **Commit S1 first** as its own commit, so the infra change is separate and easy to review.
2. **A new Neon project is required.** Neon can't move a project between regions.
   - Name: "Verified Properties KE", in `aws-eu-central-1`, Postgres 18, in the same organisation
     (`org-red-poetry-09446460`).
   - Branches: the default `production`, plus `dev` and `test` created from it.
3. **Migrate all three new branches** with the committed migrations (`0000_extensions`,
   `0001_core_schema`). There is no data to copy.
4. **Leave the Singapore project untouched.** Deleting it is irreversible, so I won't do it. You
   can delete it in the Neon console once you're happy, or tell me to.
5. **Update `.env`.** Back it up first to the session scratchpad.
   - `DATABASE_URL`: new `dev` branch, **pooled**
   - `DATABASE_URL_UNPOOLED`: new `dev` branch, **direct**
   - `TEST_DATABASE_URL`: new `test` branch, **direct**. Integration tests use a TCP pool, and the
     direct host avoids the pooler's transaction-mode limits.
   - All other variables stay as they are. Connection strings are never printed in chat,
     committed, or written anywhere except `.env` and the backup.
6. **Vercel:** add `vercel.json` with `"regions": ["fra1"]`.
   - Linking a Vercel project, setting production env vars and deploying are **not** part of this
     task. You'll do them in Phase 4, or ask me when you're ready. That's when the `production`
     branch's pooled string goes into Vercel's `DATABASE_URL`.
7. **Docs and memory:** update the README's Neon section, add a `.env.example` comment naming the
   region, and update my memory notes about the region.

## Files likely to change

```text
vercel.json                 new: { "$schema": "...", "regions": ["fra1"] }
.env                        new connection strings (gitignored; backup in scratchpad)
README.md                   Neon region + Vercel region notes
.env.example                comment: use the Frankfurt project's dev/test branches
```

## Security requirements

- Connection strings and passwords never appear in chat output, logs, commits or docs. Scripts
  report hostnames' region only.
- `.env` stays gitignored, and the commit is checked to contain no `.env`.
- Nothing is deleted in Neon.

## Acceptance criteria

1. The new Neon project exists in `aws-eu-central-1` with `production`, `dev` and `test` branches,
   all migrated:
   - `listing_status` includes `paused`
   - the append-only triggers are present
2. `.env` points at the new `dev` and `test` branches. The old values are kept only in the
   scratchpad backup.
3. Latency probe from this machine (15 sequential plus 40 parallel HTTP queries): **median under
   500ms and no failures**, compared with 1.4s and 7.5% failures before. The numbers will be
   reported.
4. `npm run typecheck`, `lint`, `test`, `test:integration` and `build` all pass.
5. The full S1 signed-in browser walkthrough passes **with zero retries**. This needs your
   `npm run dev` restarted so it picks up the new `.env`, or stopped so I can run mine.
6. `vercel.json` contains `"regions": ["fra1"]`, and the build is unaffected.
7. There are two commits: "S1: …" and "Infra: Frankfurt database and fra1 functions". Neither
   contains `.env`.

## Checks to run

```bash
npm run typecheck && npm run lint && npm test && npm run test:integration && npm run build
npx drizzle-kit generate   # "No schema changes"
```

Plus the latency probe and the browser walkthrough (Edge via Playwright).

## Manual test steps (after implementation)

1. Restart your dev server (`Ctrl+C`, then `npm run dev`). Next caches the database client, so a
   restart is needed to use the new connection strings.
2. Open `http://localhost:3000`, sign up, and open the verification link from the terminal.
   Signed-in pages should now load in well under a second after the first compile.
3. In the Neon console, check the new project's region shows **AWS Europe Central 1
   (Frankfurt)**.
4. When you're ready, delete the old Singapore project ("Verified Properties KE",
   `fancy-cake-91987982`) in the Neon console, or ask me to.
5. When you deploy to Vercel, the functions region comes from `vercel.json` (`fra1`). Set
   Vercel's `DATABASE_URL` to the new `production` branch's **pooled** string.
