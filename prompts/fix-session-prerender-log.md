# Fix: session lookup logged as an error during prerender

## Goal

Stop the false `[Better Auth]: INTERNAL_SERVER_ERROR … HANGING_PROMISE_REJECTION` errors that fill
the Vercel runtime-error view, without changing what any page shows.

## What was found (investigation, 8 Nov 2026)

- **Vercel:** one error group, `count=51`, one user, first seen 2 Nov. It covers `/account*`,
  `/admin*`, `/pricing`, `/properties` and `/how-it-works`, and it predates S16.
- **Reproduced locally** with the production build (`next start`) on the dev database and a probe
  session. **Every signed-in page load** logged it, typically twice per load: `/account`,
  `/account/messages`, `/admin` and `/pricing`. Every page still returned 200 with the user
  rendered.
- **Mechanism:**
  - With Cache Components and Partial Prefetching, Next does a prerender pass with the request's
    cookies, then the real render.
  - `getCurrentUser()` (`src/lib/session.ts`) reads `headers()`, then Better Auth runs an uncached
    session query. That query is still pending when the prerender pass ends, so Next rejects its
    `fetch()` on purpose. React handles that silently.
  - Better Auth's adapter catches the rejection and **logs it** before rethrowing, which is the
    error we see. The real render then runs the query again and succeeds.
  - It's noise, but it hides real errors in the error view and uses log volume.
- **Experiment:**
  - Change: add `await connection()` at the top of `getCurrentUser()`. The Next docs on
    `connection()` say prerendering stops at that line and the code after it runs only at request
    time.
  - Result: **0 errors over 5 signed-in loads**, against 5 errors over 4 loads on the original
    build. Response sizes stayed within about 20 bytes and the user rendered every time.
- **Side effect found:**
  - `/api/messages/status` calls `getCurrentUser()` inside a `try/catch`. During `next build`, the
    `connection()` interruption is caught and logged as `[messaging] status failed Error`.
  - Calling `await connection()` at the top of `GET`, before the `try`, removes that log. The route
    stays dynamic (`ƒ`) and isn't prerendered.
- **Not related:** a signed-in call to `/api/messages/status` on a local production build returns
  500 with `RateLimitUnavailableError`. That's by design without Upstash locally; the live site has
  Upstash.

## References read

- `AGENTS.md` §§ 1, 2, 9 and 10 (Cache Components rules, `src/lib/session.ts` inside `<Suspense>`)
- `node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md`
- `node_modules/next/dist/docs/01-app/02-guides/optimizing-prefetching.md` ("Next.js includes
  static and cached content in the prefetch until it reaches an uncached read … Uncached work is
  already left out of prefetches")
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/connection.md`

## Existing code inspected

- `src/lib/session.ts` (`getCurrentUser`, `requireUser`, `requireRole`)
- `src/app/api/messages/status/route.ts` (session read inside `try/catch`)
- `src/app/admin/verification/documents/[documentId]/route.ts` (session read outside `try`, so no
  change)
- `next.config.ts` (`cacheComponents`, `partialPrefetching`)
- Existing `connection()` uses: the home page, the search page, the detail page, `account/saved`,
  admin detail pages and the dev-storage route

## Decisions

1. **Fix at the source.** `await connection()` at the top of `getCurrentUser()`, so the session
   query never starts during a prerender pass.
2. **Not chosen:**
   - Filtering Better Auth's logger: that hides the symptom and could hide real errors.
   - `use cache: private` for the session: a bigger change that keeps user data in the browser
     cache, for no visible gain here.
3. **No visible change.** The query never finished inside the prerender anyway, so the prefetched
   shell already showed the `<Suspense>` fallback. The output is the same, minus the failed query.
4. `/api/messages/status` gets its own `await connection()` before the `try`, so the build-time
   interruption isn't caught and logged.

## Files likely to change

- `src/lib/session.ts`: import `connection` from `next/server` and call it first in
  `getCurrentUser`, with a one-line comment on why
- `src/app/api/messages/status/route.ts`: `await connection()` before the `try`

## Implementation requirements

- No other behaviour changes: same return shapes, redirects, `notFound()` and React `cache()`.
- No new dependencies or config.

## Security requirements

- Session handling is unchanged: still read only on the server, per request, never cached
  server-side.
- `/api/messages/status` keeps its auth (401) and rate-limit (429) behaviour.

## Acceptance criteria

1. On a local production build, signed-in loads of `/account`, `/account/messages`, `/admin` and
   `/pricing` log no `[Better Auth]` or `HANGING_PROMISE_REJECTION` lines, and still render the
   signed-in user.
2. `npm run build` prints no `[messaging] status failed`, and `/api/messages/status` is still
   listed as dynamic (`ƒ`).
3. Signed-out `/api/messages/status` returns 401. Signed-out `/account` redirects to sign-in.
4. After deploy, Vercel's runtime-error view shows no new occurrences of this error group.

## Checks to run

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`
- Integration tests aren't needed: the change touches no queries (this is a render-time ordering
  change).

## Manual test steps (after implementation)

1. `npm run build`, then confirm `/api/messages/status` shows `ƒ` and there's no
   `[messaging] status failed` line.
2. `npx next start -p 3100`, sign in on http://localhost:3100 with a dev account, then open
   `/account`, `/account/messages` and `/pricing`. The terminal should show no `[Better Auth]`
   errors. (Without Upstash locally, the inbox badge poll returns 500 `RateLimitUnavailableError`;
   that's expected.)
3. After pushing, browse the live site signed in for a minute, then check that the Vercel project's
   runtime errors show no new `HANGING_PROMISE_REJECTION`.
