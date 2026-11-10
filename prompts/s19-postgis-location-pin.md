# S19 PostGIS and the listing location pin

> **Status: not implemented. Skipped with all of Phase 3 by owner decision, 2026-11-10.** Kept
> for reference in case location features return after launch. The S19 slice number is reused
> for Phase 4 work.

## Goal

Give listings a real map location without exposing owners' exact positions (plan §11). After
this slice:

- **The lister places a pin.** On the Basics step, the lister can drop a pin on a Mapbox map.
  The pin is stored as the listing's **private exact point**.
- **The public point is derived.** The server works out a **public approximate point** from the
  pin: a cell of about 1 km. The exact pin is used only when the lister opts in to showing it.
- **PostGIS.** A new migration adds a `geography` column computed from the public point, with a
  spatial (GIST) index. S21's map search queries it.
- **A map adapter.** Pages and components never import Mapbox directly. Mapbox lives behind a
  small server geocoder and one client pin-picker component, so the provider can change later.
- **Public responses never carry exact coordinates.** A test proves it.

**Out of scope:**
- location autocomplete (S20)
- List and Map search views and pin clustering (S21)
- any public map
- any geocoding result being stored

## References read

- `AGENTS.md`:
  - §1: design rules; compact system, tokens, 44px targets, phone sizes
  - §5: layers
  - §6: never infer locations; public fields only
  - §7: location columns, public and exact points
  - §8: only `NEXT_PUBLIC_APP_URL` and a *restricted* public map token reach the browser
  - §9: checks and the migration workflow
- `docs/implementation-plan-v2.md` §11 build list:
  - PostGIS on a Neon branch first
  - the map adapter
  - geocoding
  - manual pin
  - the privacy rules
  - the fallback when maps fail
- `docs/PHASE3_PROVIDER_TEST.md` and `prompts/s18-map-provider-test.md` amendments A6 and A9:
  - Mapbox chosen
  - temporary geocoding results may not be stored
  - city-centre fallbacks in Kisumu and Nakuru
- `prompts/ui-compact-design-system.md` and `prompts/ui-mobile-optimization.md` (type scale,
  control sizes, phone inputs at 16px)
- Memory:
  - `phone-browser-no-popover`: no Popover API on your phone
  - `vercel-deploy-state`: apply each migration to test, dev **and** production before pushing;
    production DB writes are run by you
  - `local-env-browser-db`: browser checks through Edge with `playwright-core@1.56.1`

## Existing code inspected

- `src/db/schema.ts` `properties`:
  - `county`, `town` and `neighbourhood`
  - `publicLatitude/Longitude` and `exactLatitude/Longitude` (double precision)
  - `showExactLocation` (default false)
  - check `properties_coords_valid`
  - btree `properties_public_coords_idx` ("PostGIS replaces this in Phase 3")

  No app code reads or writes any coordinate today. Only the seed sets `public*` for the
  SAMPLE listings.
- `src/components/listings/BasicsForm.tsx`: Basics step. It has county, town and neighbourhood
  fields, plus `useActionState(saveBasicsAction)`, `state.values` replay and `StepFormFooter`.
- `src/app/account/listings/actions.ts` `saveBasicsAction`:
  - `requireLister`
  - `parseBasicsStep`
  - `createDraft` / `updateListing`
  - a rate limit on create only
- `src/lib/validation/listing.ts`: `BASICS_FIELDS`, `basicsSchema`, `basicsFormValues`,
  `ListingFields`, `FIELD_LABELS`.
- `src/db/queries/listings.ts` `updateListing`. Edits go through `isMaterialEdit` and
  `statusAfterEdit`.
- `src/lib/listings/workflow.ts`: `MATERIAL_FIELDS` is title, description, category, listing
  type, county, town and neighbourhood.
- `src/db/queries/public-listings.ts`, `listing-detail.ts` and `ranking.ts`: explicit column lists
  with no coordinates.
- `src/lib/rate-limit.ts` `POLICIES`.
- `src/lib/env.ts`: server env schema, no map keys yet.
- `next.config.ts`: no CSP headers, so mapbox-gl needs no header change.
- `src/components/ui`:
  - `Button`, `Input`, `Field` and `Spinner`
  - no Checkbox component; `DetailsForm` styles native checkboxes inline
- `design/…`: there's no map or pin design. The "Input – Location" component is a plain text
  field, so the compact system governs the new section.
- `npm view mapbox-gl`: latest 3.34.2 (3 Nov). **3.33.0** (13 Oct) is the newest release at
  least two weeks old.

## Decisions and assumptions

1. **Pin only, free (your call, 2026-11-10).**
   - The only point we store is one the lister placed.
   - Geocoding just centres the map, through Mapbox **temporary** geocoding, server-side.
   - The result is never written to the database, never cached and never logged.
   - No permanent geocoding, so no card and no geocoding bill.
   - **The map opens with no pin.** The lister must tap or click to place one, so a stored
     point is never just Mapbox's answer accepted unseen.
2. **Optional, never blocks.**
   - A listing without a pin saves, submits and publishes as today.
   - It just won't appear on S21's map; list search is unaffected.
   - The submit checklist does not ask for a pin.
3. **Public point rule.** A pure function, `publicPointFor`, in `src/lib/maps/privacy.ts`:
   - **No pin:** null.
   - **`showExactLocation = true`:** the exact pin.
   - **Otherwise:** the centre of the 0.01° grid cell containing the pin. That's about
     1.1 × 1.1 km, so the public point is at most about 780 m from the pin.
     - It is deterministic, with no random jitter. Re-saves can't be averaged to find the pin.
     - It is the same for every listing in that cell.

   The server always computes `public*` from `exact*` on write. The browser never sends a
   public point.
4. **Kenya only.**
   - A pin must be inside Kenya's bounding box (lat −4.9 to 5.1, lng 33.8 to 42.0).
   - Latitude and longitude come as a pair or not at all.
   - Values are rounded to 6 decimal places (about 0.1 m) before saving.
   - Zod v4 in `basicsSchema`; the database check stays as the backstop.
5. **Pin edits are not material.**
   - Moving or removing the pin, or toggling `showExactLocation`, does not send a published
     listing back to review. The exact pin is private and the public point is coarse.
   - County, town and neighbourhood stay material, as now.
   - `location_updated_at` records when the pin last changed, for moderators.
6. **Where it lives.** It's a "Map location" section at the end of the Basics step, saved by the
   same form and action. There's no new stepper step; the four-step design stays.
7. **PostGIS (migration `0011_postgis_location`).**
   - `CREATE EXTENSION IF NOT EXISTS postgis;`.
   - Add `public_point geography(Point, 4326)`, generated and stored, so app code keeps writing
     only latitude and longitude:
     `GENERATED ALWAYS AS (CASE WHEN public_latitude IS NOT NULL AND public_longitude IS NOT NULL
     THEN ST_SetSRID(ST_MakePoint(public_longitude, public_latitude), 4326)::geography END) STORED`.
   - Add GIST index `properties_public_point_gist`.
   - Drop the btree `properties_public_coords_idx`.
   - Add `location_updated_at timestamptz`.
   - **No geography column on the exact point:** it is never queried spatially.
   - **Drizzle:**
     - a `customType` for `geography(Point,4326)` with `.generatedAlwaysAs(...)`
     - the `.using("gist", …)` index
     - Check the generated SQL. If drizzle-kit writes it wrong, hand-correct the migration file
       and keep the snapshot consistent.
8. **Order of applying the migration:**
   1. Neon **test** branch, then run the integration tests.
   2. **dev** branch.
   3. **production:** you run it, before any push. The command goes in the manual steps.

   Before writing anything, I confirm the Neon Postgres version supports `postgis` (Neon
   MCP, read-only). I'll also try PGlite's PostGIS extension for a local check. If it's not
   available there, I skip PGlite, and the Neon test branch is the first place it runs.
9. **Map adapter.**
   - **`src/lib/maps/types.ts`:** `LatLng` and `MapView` (`{ center, zoom }`). Provider-neutral,
     no imports.
   - **`src/lib/maps/privacy.ts`:** `publicPointFor`, `snapToCell` and `isInKenya`. Pure, unit
     tested.
   - **`src/lib/maps/geocoder.ts`** (server-only):
     - the `AreaLocator` interface: `locate({ county, town, neighbourhood }) → MapView | null`
     - `getAreaLocator()` returns the Mapbox locator when `MAPBOX_ACCESS_TOKEN` is set, or null
   - **`src/lib/maps/mapbox-locator.ts`** (server-only): Geocoding v6 `forward` with:
     - `country=ke`, `limit=1`, `types=neighborhood,locality,place,district,region`
     - a 5 s timeout and **no `permanent`**
     - Zoom by feature type: neighbourhood or locality 15, place 13, district or region 10.
     - On error, or when nothing is found, it returns null.
   - **`src/lib/maps/client-config.ts`** (browser-safe):
     - `NEXT_PUBLIC_MAP_TOKEN`
     - style `mapbox://styles/mapbox/streets-v12`
     - Kenya default view: centre −0.5, 37.9, zoom 5.5
     - Kenya `maxBounds`
   - **`src/components/maps/PinPicker.tsx`:**
     - Neutral props: `{ view, pin, onPinChange, label }`.
     - It loads `./mapbox/MapboxPinPicker` with `next/dynamic(..., { ssr: false })`.
     - Only that file imports `mapbox-gl` (pinned exactly at `3.33.0`) and its CSS.
10. **Centring action.** `locateAreaAction` in `src/app/account/listings/actions.ts`:
    - `requireLister`, then Zod on county (enum), town and neighbourhood
    - rate limit `POLICIES.mapLocatePerUser`, 30 an hour
    - Returns `{ view }`, `{ notFound: true }` or a typed error.
    - It runs only when the lister clicks "Find on map", never automatically.
    - When a pin already exists, the map centres on it and makes no call.
11. **Tokens.** Two Mapbox tokens, because URL-restricted tokens refuse server calls that have no
    Referer:
    - **`MAPBOX_ACCESS_TOKEN`** (server-only, already in `.env`):
      - geocoding only
      - added to `src/lib/env.ts` as optional
      - set in Vercel by you
    - **`NEXT_PUBLIC_MAP_TOKEN`** (browser):
      - a *new* public `pk.` token with styles/tiles scopes only
      - URL-restricted to `http://localhost:3000` and `https://verifiedpropertieske.vercel.app`
      - Without it, the picker shows its fallback, and "Enter coordinates instead" still works.
12. **Seed.** The SAMPLE listings keep their public points with no exact point. The generated
    column fills itself, so the seed doesn't change.
13. **No public read changes in S19.** No public query selects any coordinate, and none starts
    to. S21 will add `public_point` to search. A guard test locks this in now (requirement 9).

## Files likely to change

- `drizzle/0011_postgis_location.sql` and `drizzle/meta/*` (generated, reviewed)
- `src/db/schema.ts`:
  - geography `customType`
  - `publicPoint` (generated) and `locationUpdatedAt`
  - drop the btree index; add the GIST index
- `src/lib/maps/types.ts`, `privacy.ts`, `privacy.test.ts`, `geocoder.ts`, `mapbox-locator.ts`,
  `mapbox-locator.test.ts` and `client-config.ts` (new)
- `src/lib/env.ts` (`MAPBOX_ACCESS_TOKEN` optional) and `src/lib/env.test.ts`
- `src/lib/rate-limit.ts` (`mapLocatePerUser`)
- `src/lib/validation/listing.ts`:
  - new fields `exactLatitude`, `exactLongitude` and `showExactLocation`
  - `BASICS_FIELDS`, `basicsSchema`, `basicsFormValues` and labels
  - plus tests
- `src/db/queries/listings.ts`:
  - derive `public*` with `publicPointFor` on create and update
  - set `locationUpdatedAt` when the pin changes
  - plus integration test
- `src/app/account/listings/actions.ts` (`locateAreaAction`; `saveBasicsAction` passes the
  location fields)
- `src/app/account/listings/editor-data.ts` (location defaults for the form)
- `src/components/listings/BasicsForm.tsx` (renders the new section)
- `src/components/listings/MapLocationSection.tsx` (new): find button, picker, pin status,
  exact-location checkbox and coordinate fallback
- `src/components/maps/PinPicker.tsx` and `src/components/maps/mapbox/MapboxPinPicker.tsx` (new)
- `src/components/listings/ListingSummary.tsx`: a "Map location" line in Preview
- `src/db/queries/public-exposure.integration.test.ts` (new guard test)
- `package.json` / `package-lock.json` (`mapbox-gl@3.33.0`, exact)
- `.env.example` (purpose notes for both map tokens)

## Implementation requirements

1. **Migration.**
   - Write the schema change, run `npm run db:generate` and review the SQL against decision 7.
   - Test it on PGlite in the scratchpad first, if PGlite's `postgis` extension loads, checking
     that:
     - inserting `public_latitude/longitude` fills `public_point`
     - nulls leave it null
     - `ST_DWithin` uses the GIST index (`EXPLAIN`)
   - Then apply to the Neon test branch and dev with `npm run db:migrate`, printing the host
     label first.
2. **Privacy functions.**
   - `snapToCell(lat, lng)` returns the cell centre, `floor(x / 0.01) * 0.01 + 0.005`, rounded to
     6 decimal places.
   - `publicPointFor({ exact, showExact })` follows decision 3.
   - Unit tests cover:
     - a point exactly on a cell edge
     - negative latitudes (south of the equator)
     - the opt-in path
     - the null path
     - the snapped point never equals the exact point unless it is the cell centre
     - snapped distance ≤ 0.79 km
3. **Validation.**
   - `exactLatitude` and `exactLongitude`: empty string means none.
   - When given, they must be finite numbers inside Kenya, and both must be present.
   - Messages:
     - "Place the pin inside Kenya."
     - "Enter both latitude and longitude, or neither."
   - `showExactLocation` is `"on"` or absent.
   - Unit tests in `listing.test.ts`.
4. **Write path.**
   - `createDraft` and `updateListing` take the three location fields and compute `public*` on
     the server.
   - `locationUpdatedAt = now()` only when the exact pair or `showExact` changed.
   - Clearing the pin nulls all four coordinates.
   - `statusAfterEdit` is unchanged (decision 5).
5. **`locateAreaAction`.** As decision 10. Errors:
   - rate-limited → "Too many map lookups. Try again in N minutes."
   - map lookups unavailable (no token) → `{ unavailable: true }`, so the UI can offer the
     fallback
   - Logs carry the error name only, never the query text.
6. **Mapbox locator.**
   - Parse with Zod.
   - Map `feature_type` to zoom.
   - Never throw to the caller; return null.
   - Unit tests with a stubbed `fetch`:
     - success
     - empty
     - HTTP 401 (null, logged as `unauthorized`)
     - timeout
     - the request URL has no `permanent` parameter, and the token is never in a thrown or
       logged message
7. **Pin picker (client).**
   - **Map setup:** `MapboxPinPicker` creates the map once, with `attributionControl` kept
     (required) and `NavigationControl` top-right.
   - **Placing the pin:** click or tap places a draggable marker. Drag-end calls
     `onPinChange(rounded)`.
   - **Following props:** it follows `view` changes with `jumpTo` under
     `prefers-reduced-motion`, and `flyTo` otherwise.
   - **Cleanup:** it removes the map on unmount.
   - **Fallback:** on missing token, no WebGL (`mapboxgl.supported()` false, or a context
     failure) or a map `error` before first load, it calls `onUnavailable()`.
   - **Keyboard:** the canvas is focusable with a label, and arrow keys pan (Mapbox default).
     Placing a pin by keyboard is done through the coordinate fallback, which is always present.
   - **No Popover API.**
8. **Map location section (UI).** See the UI specification below. Hidden inputs carry
   `exactLatitude`, `exactLongitude` and `showExactLocation` into the Basics form. On a
   validation error, `state.values` replays them like the other fields.
9. **Public exposure guard.** `public-exposure.integration.test.ts`:
   - Create a published listing with an exact pin.
   - Call every public read: the search/browse query, home featured sections, listing detail,
     favourites list and similar listings — whatever `public-listings.ts`, `listing-detail.ts`
     and `ranking.ts` export for public pages.
   - Recursively check that no returned key matches `/latitude|longitude|exact|point|coord/i`,
     and that no returned value equals the exact coordinates.
10. **Preview summary.** `ListingSummary` shows one of:
    - "Map location: Pinned (public maps show an area of about 1 km)"
    - "Map location: Pinned (exact spot shown)"
    - "Map location: Not pinned"
11. **Env docs.** `.env.example` explains both Mapbox tokens: purpose, scopes, URL restrictions,
    and that the server token must not be URL-restricted.

## UI specification (compact system; no design board for this section)

- **Placement:**
  - The last block inside the Basics card, after the field grid and before `StepFormFooter`.
  - A 1px `border-t border-line` with `pt-6` separates it.
  - Full card width on every breakpoint.
- **Heading row:**
  - "Map location" in `text-small font-medium text-ink`, then "Optional" in
    `text-micro text-slate-600`.
  - Hint below, `text-micro text-slate-600`: "Tap the map to drop a pin on the property. Buyers
    see an area of about 1 km, not the exact spot, unless you choose to show it."
- **Find button:**
  - `Button` secondary, `h-control` (44px), label "Find on map", with a `MapPin` lucide icon.
  - It reads the current county, town and neighbourhood values from the form and shows a
    `Spinner` while the lookup runs.
  - It's disabled with a hint, "Choose a county and enter the town first.", until county and town
    have values.
- **Map:**
  - A `rounded-lg border border-line overflow-hidden` box, `h-[280px]` on phones and
    `sm:h-auto sm:aspect-video` from 640px. No shadow.
  - It shows Kenya's default view until a lookup or an existing pin sets the view.
  - The canvas is labelled "Map. Tap to place the property pin."
- **Status line under the map** (`text-micro`, `aria-live="polite"`):
  - **No pin:** "No pin yet. Tap the map to place one." (`text-slate-600`).
  - **Pin placed:** "Pin placed. Drag it to adjust." (`text-emerald-700`), plus a "Remove pin"
    quiet button at `h-control-sm` (32px) with a 44px hit area.
  - **Lookup found nothing:** "We couldn't find that area. Zoom in and tap to place the pin
    yourself." (`text-warning-text`).
- **Exact-location checkbox:**
  - Styled like `DetailsForm`'s native checkboxes, in a 44px-tall label row.
  - Text: "Show the exact location on public maps."
  - Default off. Disabled until a pin exists.
- **Coordinate fallback:**
  - A `<details>` with summary "Enter coordinates instead" in `text-small text-emerald-700`, 44px
    row.
  - It holds two `Input`s, Latitude and Longitude (`inputMode="decimal"`, placeholders `-1.2921`
    and `36.7856`), side by side from `sm`, stacked on phones.
  - Inputs are 16px on phones through the global rule.
  - Editing them moves the pin, and moving the pin updates them.
- **Unavailable state:** when there's no browser token, no WebGL or a load error, the map box is
  replaced by:
  - a `bg-mint-50 rounded-lg p-5` panel
  - with `text-small` "The map couldn't load here. You can enter coordinates instead, or add the
    pin later."
  - and the `<details>` fallback opened
- **Errors:** field errors for the pin show under the section in `text-micro font-medium
  text-danger`, and `useFocusFirstError` focuses the latitude input.
- **Colours:**
  - tokens only, no navy
  - Mapbox's own marker colour set to the Forest token (`#14833B` from the tokens, read from
    `tailwind.config.ts` values, not hard-coded twice)
- **Motion:** none beyond the map's own; `jumpTo` under `prefers-reduced-motion`.

## Security requirements

- **Tokens:**
  - `MAPBOX_ACCESS_TOKEN` is read only in `server-only` modules and never sent to the client.
  - The browser uses only the URL-restricted `NEXT_PUBLIC_MAP_TOKEN`.
- **`locateAreaAction`:**
  - checks the session (`requireLister`)
  - validates with Zod
  - is rate-limited, and fails closed if the limiter is down, as the other actions do
  - returns typed errors and never echoes provider errors
- **Writes:** pin values are validated on the server, and `public*` is always server-computed.
  Ownership goes through the existing `manageableBy` scoping.
- **Never stored or logged:**
  - Geocoding responses are never stored, cached or logged (Mapbox terms, amendment A2).
  - Query text is not logged.
- **Public responses:** no public response gains any coordinate field in S19. The guard test
  enforces it.
- **Migrations:** no production database access by me. The production migration is your step.

## Acceptance criteria

- Migration 0011 applies cleanly on PGlite, the Neon test branch and dev:
  - `public_point` is filled for SAMPLE listings with public points
  - the GIST index exists, and the old btree index is gone
- A lister can save Basics with no pin (as today), and with a pin:
  - **Default:** `exact*` holds the rounded pin, and `public*` holds the 0.01° cell centre.
  - **With "show exact" ticked:** `public*` equals `exact*`.
  - **Remove pin:** clears all four columns.
- Moving the pin on a published listing by an unverified lister keeps it `published`.
- A pin outside Kenya, or half a pair, is refused with the specified messages, and the values
  replay.
- **"Find on map":**
  - "Kilimani, Nairobi" centres near Kilimani.
  - "Milimani, Kisumu" centres on Kisumu at city zoom. The lister still places the pin.
  - The 31st lookup in an hour is refused.
- Without `NEXT_PUBLIC_MAP_TOKEN`, the section shows the unavailable panel, and coordinates
  still save.
- Mapbox code is imported only from `src/lib/maps/mapbox-locator.ts` and
  `src/components/maps/mapbox/*`; a `grep` check is included in the report.
- The public exposure guard test passes, and every existing test still passes.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:integration`: the full suite after migration 0011 is on the test branch
- `npm run build` (schema, actions, a new client dependency)
- Browser walkthrough in Edge (`playwright-core@1.56.1`) against `npm run dev`, at 1280px and
  390px:
  - place, drag and remove a pin
  - the coordinate fallback
  - the unavailable state with the token unset
  - screenshots for you

## Manual test steps (after implementation)

1. **Create the browser token.** In Mapbox → Access tokens → Create token:
   - public scopes only (styles:read, tiles)
   - URL restrictions `http://localhost:3000` and `https://verifiedpropertieske.vercel.app`

   Put it in `.env` as `NEXT_PUBLIC_MAP_TOKEN=…`, then restart `npm run dev`. Next only reads
   `NEXT_PUBLIC_` values at start.
2. **Find and pin.**
   1. Open `/account/listings/new`.
   2. Choose Nairobi, enter town "Nairobi" and neighbourhood "Kilimani", then click
      **Find on map**. The map flies to Kilimani with no pin.
   3. Tap a building. The pin appears with "Pin placed. Drag it to adjust." Drag it.
   4. Click **Save draft**, and reload. The pin is where you left it.
3. **Exact spot.**
   1. Tick **Show the exact location on public maps** and save.
   2. Open Preview. It reads "Map location: Pinned (exact spot shown)".
   3. Untick it and save again. Preview reads "public maps show an area of about 1 km".
4. **Remove pin.** Click **Remove pin** and save. Preview reads "Not pinned".
5. **Coordinates.**
   1. Open **Enter coordinates instead** and type `10` / `36.8`. Save refuses with "Place the pin
      inside Kenya."
   2. Type `-0.0917` / `34.7617`. The pin moves to Kisumu and saves.
6. **Fallback.**
   1. Blank `NEXT_PUBLIC_MAP_TOKEN` and restart dev.
   2. The section shows "The map couldn't load here…" with the coordinate fields open, and
      saving still works.
   3. Restore the token.
7. **Phone.** Repeat step 2 on your phone. The map is 280px tall, and tapping places the pin
   without zooming the page.
8. **Production migration, before any push** (you run this):

   ```
   node --env-file=.env.local -e "process.env.DATABASE_URL_UNPOOLED=process.env.PROD_DATABASE_URL_UNPOOLED; console.log(new URL(process.env.DATABASE_URL_UNPOOLED).hostname.split('.')[0])"
   ```

   1. Confirm the command prints `ep-summer-morning-b9otl4v9`.
   2. Then run the same mapping with `npx drizzle-kit migrate`. I'll give the exact one-line
      command in the hand-off.
9. **Vercel env.** In Vercel → Project → Environment Variables, add `MAPBOX_ACCESS_TOKEN` (server
   token) and `NEXT_PUBLIC_MAP_TOKEN` (browser token) to Production and Preview, then push.
