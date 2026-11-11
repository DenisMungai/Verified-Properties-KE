# CI fix: typecheck on a clean checkout, build without a database

## Goal

Make the GitHub `CI / check` job pass on every push, and stop Vercel preview builds of non-`main`
branches from failing (and emailing) because previews have no environment variables.

## References read

- `AGENTS.md` (Cache Components rules, checks), `.github/workflows/ci.yml`, `vercel.json`
- Vercel build logs for `dpl_FNkTpohw…` / `dpl_Ejyez4A8…` (preview, `s19-security-audit`)
- GitHub failure email for `CI - main (2b6e752)`
- `node_modules/next/dist/docs/` — `next typegen`, `connection()`; Vercel `git.deploymentEnabled`

## Existing code inspected

- `src/lib/session.ts` — `getCurrentUser` calls `connection()` first (35ed609)
- `src/db/index.ts` — `getDb()` throws synchronously when `DATABASE_URL` is unset
- `src/app/page.tsx`, `src/app/properties/(search)/page.tsx`, `[slug]/page.tsx` — already
  `await connection()` before `getDb()`
- `src/app/pricing/page.tsx` (`Plans`), `src/components/verification/PublicOffer.tsx`
  (`activeVerificationPriceKes`) — call `getDb()` before anything marks the render dynamic

## Findings (reproduced on a clean worktree of `main`, no `.env` files)

1. `npm run typecheck` fails: TS2307 on `@/assets/images/*.jpg`. `next-env.d.ts` (image module
   types, route types) is gitignored and only created by `next dev` / `next build`; CI runs
   `tsc` before `next build`. `npx next typegen` first makes typecheck pass.
2. `npm run build` with no `DATABASE_URL` fails prerendering `/pricing` and `/how-it-works`:
   `getDb()` runs during the prerender pass. Same failure as the Vercel preview builds.

## Decisions

- CI: add `npx next typegen` before `npm run typecheck`. Keep `next-env.d.ts` gitignored.
- Code: every public DB reader that is not already behind `connection()`, `requireUser`,
  `requireRole` or `getCurrentUser` gets `await connection()` before `getDb()`. No `getDb()`
  signature change. Iterate with a no-database build until it passes; fix every page it reports.
- Vercel: `vercel.json` `ignoreCommand` (Ignored Build Step) builds only when
  `VERCEL_GIT_COMMIT_REF` is `main`; other branches show as Canceled, never failed. Chosen over
  `git.deploymentEnabled`, whose precedence for overlapping patterns (`"*": false` plus
  `"main": true`) is undocumented. Production deploys are unchanged. No preview env vars added.

## Files likely to change

- `.github/workflows/ci.yml`, `vercel.json`
- `src/app/pricing/page.tsx`, `src/components/verification/PublicOffer.tsx`, and any other page
  a no-database build reports

## Implementation requirements

- Smallest change per call site: `await connection()` as the first line of the async reader.
- No behaviour change at request time; pages still read prices and plans from the database.
- No unrelated refactors.

## Security requirements

- No secrets in CI; the build still runs with no database. No env values printed or committed.
- Preview deployments are not pointed at any database.

## Acceptance criteria

- On a clean checkout with no `.env` files: `npx next typegen && npm run typecheck` passes,
  `npm run lint` passes, `npm test` passes, `npm run build` with no `DATABASE_URL` passes.
- `vercel.json` is valid and only `main` deploys from Git.

## Checks to run

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build` (clean worktree, no database).

## Manual test steps

1. Push the branch: its Vercel deployment shows Canceled (build skipped), not Error, and no
   failure email arrives.
2. Merge to `main`: GitHub Actions `CI / check` goes green; Vercel production deploy is READY.
3. Open `/pricing` and `/how-it-works` on the live site: plan prices and the verification price show.
