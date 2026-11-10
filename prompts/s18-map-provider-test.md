# S18 Map provider test (Google Maps vs Mapbox)

## Goal

Pick the Phase 3 map provider by test, not by preference (plan §11, "Provider test, first 2
days"). Run 50 real Kenyan locations through Google Maps Platform and Mapbox. Score:

- autocomplete hits
- geocoding accuracy at neighbourhood level
- tile quality
- expected monthly cost at launch traffic

The output is a scored report, `docs/PHASE3_PROVIDER_TEST.md`, ending in a recommendation:
one provider, or a split such as Google for search and geocoding with Mapbox for tiles. The
recommendation decides how S19 (PostGIS, geocoding, map adapter) is built.

No app code, UI, schema or migration changes. This slice adds one operator script, a dataset,
pure scoring helpers with unit tests, and the report.

## References read

- `AGENTS.md`:
  - §1: plan precedence
  - §4: stack
  - §6: trust signals, never infer locations
  - §7: county, town and neighbourhood stored separately
  - §8: privileged keys are server-only
  - §9: checks
- `docs/implementation-plan-v2.md`:
  - §11 Phase 3: the provider test and build list
  - §14 cross-cutting rules: localization, testing data
- `docs/PHASE2_REPORT.md`, "Next steps": Phase 3 starts with this test

## Existing code inspected

- `.env.example` and `.env`:
  - `NEXT_PUBLIC_MAP_TOKEN` (the future restricted browser tile token, unused until S21)
  - `GOOGLE_MAPS_API_KEY` and `MAPBOX_ACCESS_TOKEN`, added in this session as server-only
    placeholders. You fill them in.
- `src/lib/env.ts`: the app's server env schema. The map keys are **not** added here yet.
  Nothing in the app reads them until S19. The script validates its own env.
- `src/db/schema.ts`:
  - `properties` has `publicLatitude/Longitude` and `exactLatitude/Longitude` (double), with
    range checks
  - a plain index commented "PostGIS replaces this in Phase 3"
- `src/lib/kenya.ts`: `KENYA_COUNTIES`, used to validate the dataset's county names.
- `scripts/*.ts` and `package.json`: operator scripts run as
  `node --env-file-if-exists=.env --env-file-if-exists=.env.local --import tsx scripts/<x>.ts`.
- `vitest.config.ts`: `include` is `src/**/*.test.ts` only.
- `.gitignore`: `.env*` is ignored except `.env.example`.

## Decisions and assumptions

1. **Server-side test only.** Every provider call runs from the Node script with server-only
   keys. No key reaches a browser in this slice. Tile quality is judged from Static Images APIs
   fetched by the script, not from an interactive map page.
2. **APIs compared.** Before writing any client code, confirm each endpoint, parameter and
   response field against the providers' live docs. Record each docs URL and the date checked
   in the report.

   | Measure | Google Maps Platform | Mapbox |
   |---|---|---|
   | Autocomplete | Places API (New) Autocomplete: `POST https://places.googleapis.com/v1/places:autocomplete`, `includedRegionCodes: ["ke"]`, one session token per query | Search Box API `/suggest` (session token, POIs and places), and Geocoding v6 `forward` with `autocomplete=true&country=ke` (places only). Both are scored; the better one counts for Mapbox and sets its cost line. |
   | Geocoding | Geocoding API `geocode/json?address=…&components=country:KE&region=ke` | Geocoding v6 `forward?q=…&country=ke&limit=1` |
   | Tiles | Maps Static API, `roadmap` | Static Images API, `mapbox/streets-v12` |

3. **Reference points come from a third source.** Neither provider can be its own ground truth.
   For each location, the script fetches a reference point once from OpenStreetMap Nominatim:
   - `countrycodes=ke`
   - at most 1 request per second
   - a generic identifying User-Agent, `VerifiedPropertiesKE-provider-test/1.0`, with no
     personal email

   The point is saved to the dataset file with `referenceSource: "osm"` and the OSM id. If
   Nominatim has no result, or its result is only at town level for a neighbourhood query, the
   row gets `referenceSource: "none"`:
   - It is scored on name and component match only, not distance.
   - It is listed in the report. You can add a point by hand later (`"manual"`).

   No coordinates are made up.
4. **Disagreement flag.** A row is flagged for manual review in the report when:
   - both providers land within 1 km of each other, and
   - both are more than 2 km from the OSM reference.

   That pattern suggests the reference is wrong, not the providers. Flagged rows still count.
5. **Geocoding score per location.** Distance uses haversine to the reference.
   - **neighbourhood hit**: ≤ 2 km, *and* the result is finer than town level (neighbourhood,
     locality, street, address or POI types, mapped per provider), *and* its name or components
     contain the expected neighbourhood, a known alias, or the expected town.
   - **town hit**: ≤ 8 km, or the town is named correctly.
   - **miss**: anything else, including no result or a result outside Kenya.
   - **Points**: neighbourhood 2, town 1, miss 0. A provider's geocoding score is its points ÷ 100.
   - A result at only city or county level for a neighbourhood query is a town hit at most, even
     when it is close.
6. **Autocomplete score per location.** Run two prefix queries:
   - the first 4 characters of the neighbourhood name
   - the first 7 characters, or the full name if shorter, followed by `, <town>`

   A hit is the expected neighbourhood, or a known alias, in the top 5 suggestions, matched on
   suggestion text. Record its rank.

   Score is hits ÷ 100 (2 queries × 50). Also report the mean reciprocal rank as a tiebreaker.
7. **Tile quality.** Fetch 600×400 static maps at zooms 13, 15 and 17 for 6 sample points:
   - Kilimani
   - Ruaka
   - Kitengela
   - Nyali
   - Milimani (Kisumu)
   - Milimani (Nakuru)

   That is 18 per provider. I view each pair and score it 0–2 on each of:
   - estate and neighbourhood labels present
   - local roads and lanes drawn
   - buildings and landmarks visible
   - legibility

   That gives a provider score out of 8, averaged across the points. My scores are marked as a
   judgement for you to override.
8. **Cost model.** Take prices from each provider's current pricing page (URL and date go in the
   report). Monthly free caps and credits apply as published. Default launch traffic, editable at
   the top of the script and stated in the report:

   | Driver | Default per month |
   |---|---|
   | Map views (dynamic tile loads, S21) | 30,000 |
   | Autocomplete sessions (search box and listing form) | 20,000 |
   | Geocoding requests (listing saves and edits) | 2,000 |

   The report also shows cost at 3× that traffic, so we see the growth curve.
9. **Weights.** The plan says autocomplete and geocoding matter more than map looks:

   | Measure | Weight |
   |---|---|
   | Autocomplete | 35 |
   | Geocoding | 35 |
   | Cost | 20 |
   | Tiles | 10 |

   Cost score is cheapest ÷ this, capped at 1; if both cost KES/USD 0, both score 1. The report
   computes:
   - each single-provider total
   - the best split: search and geocoding from one provider, tiles from the other, with costs
     added

   It recommends a split only when the split scores at least 5 points above the best single
   provider. Running two vendors costs more to operate.
10. **Budget safety.**
    - A hard cap of 300 billable requests per provider per run. The script aborts before going
        over it.
    - Responses are cached under `.provider-test/cache/` (gitignored). A re-run reuses them and
        bills nothing.
    - Planned volume is about 268 requests per provider (100 autocomplete, 50 geocoding,
        18 static, plus Mapbox's second autocomplete API). That sits inside Google's free
        monthly caps and Mapbox's free tier.
    - The script prints the planned request counts and needs `--run` to make paid calls.
        Without it, it is a dry run that only reports counts and which keys are set.
11. **Provider terms.** Raw Google and Mapbox responses and static images are **not committed**.
    Provider terms limit storing their content.
    - They stay in `.provider-test/` (gitignored), and the report says to delete that folder
      once S19 starts.
    - The committed report holds only derived numbers: hit or miss, rank, distance in km, and
      scores.
    - It also holds our own dataset and the OSM reference points. OSM data is ODbL, attributed
      in the report.
12. **Dataset.** `scripts/lib/maps-test/locations.ts` is a typed array of 50 entries:
    - `id`
    - `query` (as a lister would type it)
    - `neighbourhood`
    - `aliases`
    - `town`
    - `county` (must be in `KENYA_COUNTIES`)
    - `group`
    - reference fields filled by the first `--run`

    The mix of query shapes is deliberate:
    - bare neighbourhood
    - road plus neighbourhood
    - landmark or mall
    - satellite town

## Amendments from the live docs check (2026-11-10)

These amendments come from checking the live docs before coding. Where they conflict with the
decisions above, they win.

- **A1. Endpoints confirmed:**
  - Places API (New) `places:autocomplete`: `X-Goog-Api-Key` and `X-Goog-FieldMask` headers
  - Geocoding `geocode/json`: `key` query parameter only
  - Maps Static API (max 640×640 at scale 1)
  - Mapbox Geocoding v6 `forward`
  - Search Box `/suggest`: no coordinates, so `/retrieve` is not needed to score autocomplete
  - Mapbox Static Images `styles/v1/mapbox/streets-v12/static/{lon},{lat},{zoom}/{w}x{h}`
  - Nominatim `/search?format=jsonv2&addressdetails=1&countrycodes=ke`
- **A2. No raw responses cached.** Mapbox says temporary geocoding results "are not allowed to
  be cached", and Google limits caching. The cache (`.provider-test/outcomes.json`) stores only
  our derived outcome per request:
  - precision
  - distance to the reference in km
  - name, town and Kenya matches
  - suggestion rank
  - the gap in km between the two providers' points for that location (computed in memory
    while both answers are held)

  No provider names or coordinates are stored. Outcome keys include a hash of the reference
  point, so `--refresh-reference` makes affected outcomes re-fetch. Static images (PNG) are
  still saved under `.provider-test/tiles/` for viewing. The report says to delete them after
  the decision.
- **A3. Reference points live in `scripts/lib/maps-test/reference-points.json`** (committed,
  ODbL, attributed), not written back into `locations.ts`.
- **A4. Scoring details:**
  - When the neighbourhood is the town itself (rows 22–28, 31–34, 39), a `city` result counts
    as fine enough.
  - The second autocomplete query (with `, <town>`) is a hit only when the suggestion names the
    neighbourhood **and** its town or county, so the two Milimanis are told apart.
- **A5. Cost model:**
  - **Google autocomplete:** sessions end with a Place Details (Essentials) call to get
    coordinates. Autocomplete requests inside a session are free (Session Usage is unlimited),
    so cost is sessions × Place Details Essentials.
  - **Mapbox Geocoding v6 autocomplete:** priced per request, assuming 6 requests per
    debounced session.
  - **Mapbox Search Box:** priced per session, using intro pricing, with standard pricing shown
    as well.
  - **Google tiers:** graduated after each SKU's free monthly cap.
  - **Mapbox geocoding on save:** storing listing coordinates needs **permanent** geocoding.
    It's about USD 5 per 1,000 with no free tier, from third-party sources since the official
    pricing page doesn't show it. The report marks that figure as unverified.
- **A6. Storage terms row.** The report adds what S19 may store from each provider:
  - **Google:** latitude and longitude for up to 30 days, place IDs indefinitely. So a
    permanently stored listing point must come from the lister confirming the pin, or be
    re-geocoded. That needs legal confirmation.
  - **Mapbox:** permanent results can be stored indefinitely.

  This counts in the recommendation text, not in the weighted score.

- **A7. Reference picking (found during implementation).** Nominatim's first hit for Kikuyu,
  Ruiru and Juja was a sub-county area, whose centroid is up to about 8 km from the town. The
  script now asks for the top 5 results and keeps the first acceptable one:
  - county, state and region areas are never acceptable
  - city or town level is acceptable only when the neighbourhood is the town itself

  `--run` with no provider keys still runs this free reference pass, so the points can be
  checked before keys exist.
- **A8. Milimani, Nakuru reference rejected by hand.** The OSM result for #46 is a different
  Milimani near Lanet Umoja, about 11 km east of Nakuru town. The static image shows "Lanet Umoja
  Chief's office".
  - The row is now `source: "none"`, scored by name only.
  - The Nakuru tile place moves to the town centre (#50, Kenyatta Avenue), whose OSM point is
    right.

  No coordinate was typed in by hand.

## The 50 locations

| # | Query | Neighbourhood | Town | County | Group |
|---|---|---|---|---|---|
| 1 | Kilimani, Nairobi | Kilimani | Nairobi | Nairobi | Nairobi estates |
| 2 | Argwings Kodhek Road, Kilimani | Kilimani | Nairobi | Nairobi | Nairobi estates |
| 3 | Kileleshwa, Nairobi | Kileleshwa | Nairobi | Nairobi | Nairobi estates |
| 4 | Lavington, Nairobi | Lavington | Nairobi | Nairobi | Nairobi estates |
| 5 | Westlands, Nairobi | Westlands | Nairobi | Nairobi | Nairobi estates |
| 6 | Parklands, Nairobi | Parklands | Nairobi | Nairobi | Nairobi estates |
| 7 | South B, Nairobi | South B | Nairobi | Nairobi | Nairobi estates |
| 8 | South C, Nairobi | South C | Nairobi | Nairobi | Nairobi estates |
| 9 | Donholm, Nairobi | Donholm | Nairobi | Nairobi | Nairobi estates |
| 10 | Umoja, Nairobi | Umoja | Nairobi | Nairobi | Nairobi estates |
| 11 | Embakasi, Nairobi | Embakasi | Nairobi | Nairobi | Nairobi estates |
| 12 | Kasarani, Nairobi | Kasarani | Nairobi | Nairobi | Nairobi estates |
| 13 | Roysambu, Nairobi | Roysambu | Nairobi | Nairobi | Nairobi estates |
| 14 | Kahawa West, Nairobi | Kahawa West | Nairobi | Nairobi | Nairobi estates |
| 15 | Karen, Nairobi | Karen | Nairobi | Nairobi | Nairobi estates |
| 16 | Lang'ata, Nairobi | Lang'ata (alias Langata) | Nairobi | Nairobi | Nairobi estates |
| 17 | Runda, Nairobi | Runda | Nairobi | Nairobi | Nairobi estates |
| 18 | Ridgeways, Kiambu Road | Ridgeways | Nairobi | Nairobi | Nairobi estates |
| 19 | Yaya Centre, Kilimani | Kilimani | Nairobi | Nairobi | Landmarks |
| 20 | Garden City Mall, Thika Road | Roysambu (alias Garden City) | Nairobi | Nairobi | Landmarks |
| 21 | Adams Arcade, Ngong Road | Adams Arcade (alias Woodley) | Nairobi | Nairobi | Landmarks |
| 22 | Ruaka, Kiambu | Ruaka | Ruaka | Kiambu | Satellite towns |
| 23 | Syokimau, Machakos | Syokimau | Syokimau | Machakos | Satellite towns |
| 24 | Kitengela, Kajiado | Kitengela | Kitengela | Kajiado | Satellite towns |
| 25 | Ongata Rongai, Kajiado | Ongata Rongai (alias Rongai) | Ongata Rongai | Kajiado | Satellite towns |
| 26 | Ngong, Kajiado | Ngong | Ngong | Kajiado | Satellite towns |
| 27 | Kikuyu, Kiambu | Kikuyu | Kikuyu | Kiambu | Satellite towns |
| 28 | Ruiru, Kiambu | Ruiru | Ruiru | Kiambu | Satellite towns |
| 29 | Membley, Ruiru | Membley | Ruiru | Kiambu | Satellite towns |
| 30 | Tatu City, Kiambu | Tatu City | Ruiru | Kiambu | Satellite towns |
| 31 | Juja, Kiambu | Juja | Juja | Kiambu | Satellite towns |
| 32 | Thika, Kiambu | Thika | Thika | Kiambu | Satellite towns |
| 33 | Athi River, Machakos | Athi River (alias Mavoko) | Athi River | Machakos | Satellite towns |
| 34 | Mlolongo, Machakos | Mlolongo | Mlolongo | Machakos | Satellite towns |
| 35 | Nyali, Mombasa | Nyali | Mombasa | Mombasa | Mombasa |
| 36 | Bamburi, Mombasa | Bamburi | Mombasa | Mombasa | Mombasa |
| 37 | Shanzu, Mombasa | Shanzu | Mombasa | Mombasa | Mombasa |
| 38 | Tudor, Mombasa | Tudor | Mombasa | Mombasa | Mombasa |
| 39 | Mtwapa, Kilifi | Mtwapa | Mtwapa | Kilifi | Mombasa |
| 40 | Diani, Kwale | Diani (alias Diani Beach) | Ukunda | Kwale | Mombasa |
| 41 | Milimani, Kisumu | Milimani | Kisumu | Kisumu | Kisumu |
| 42 | Mamboleo, Kisumu | Mamboleo | Kisumu | Kisumu | Kisumu |
| 43 | Riat Hills, Kisumu | Riat (alias Riat Hills) | Kisumu | Kisumu | Kisumu |
| 44 | Nyalenda, Kisumu | Nyalenda | Kisumu | Kisumu | Kisumu |
| 45 | Oginga Odinga Street, Kisumu | Kisumu CBD (alias Kisumu Central) | Kisumu | Kisumu | Kisumu |
| 46 | Milimani, Nakuru | Milimani | Nakuru | Nakuru | Nakuru |
| 47 | Section 58, Nakuru | Section 58 | Nakuru | Nakuru | Nakuru |
| 48 | Lanet, Nakuru | Lanet | Nakuru | Nakuru | Nakuru |
| 49 | Naka, Nakuru | Naka | Nakuru | Nakuru | Nakuru |
| 50 | Kenyatta Avenue, Nakuru | Nakuru CBD (alias Nakuru Central) | Nakuru | Nakuru | Nakuru |

Groups: Nairobi estates and landmarks 21, satellite towns 13, Mombasa coast 6, Kisumu 5,
Nakuru 5. Two places are named Milimani (Kisumu and Nakuru). That tests whether each provider
uses the town context.

## Files likely to change

- `scripts/maps-provider-test.ts` (new): CLI entry. Flags:
  - `--dry-run` (default): no paid calls
  - `--run`
  - `--only=google|mapbox`
  - `--refresh-reference`: re-fetch Nominatim points
- `scripts/lib/maps-test/locations.ts` (new): the 50-row dataset and its type.
- `scripts/lib/maps-test/providers/google.ts`, `mapbox.ts`, `nominatim.ts` (new). Each:
  - is a thin client returning a normalised shape:
    `{ name, lat, lng, precision, components }`, or a suggestion list
  - handles timeouts (10 s), non-200 responses and error bodies without logging the key
- `scripts/lib/maps-test/cache.ts` (new): a file cache keyed by a hash of provider + endpoint +
  normalised params. The hash never includes the key.
- `scripts/lib/maps-test/scoring.ts` (new, pure):
  - `haversineKm`
  - `scoreGeocode`
  - `scoreAutocomplete`
  - `scoreTiles`
  - `costFor`
  - `weightedTotal`
  - `bestSplit`
  - name and alias matching: case, apostrophe and diacritic folding
- `scripts/lib/maps-test/scoring.test.ts` (new): unit tests for the above.
- `scripts/lib/maps-test/report.ts` (new): writes `docs/PHASE3_PROVIDER_TEST.md` from the
  results.
- `docs/PHASE3_PROVIDER_TEST.md` (new, generated, then the recommendation text is finished
  by hand).
- `vitest.config.ts`: add `scripts/**/*.test.ts` to `include`.
- `package.json`: add `maps:test`, the same `node --env-file-if-exists … --import tsx` pattern.
- `.gitignore`: add `/.provider-test/`.
- `.env.example` and `.env`: placeholders already added (`GOOGLE_MAPS_API_KEY`,
  `MAPBOX_ACCESS_TOKEN`).

## Implementation requirements

1. **Env check in the script.** A small Zod v4 schema reads the two keys; empty means unset.
   - With `--run`, a missing key skips that provider, and the report says it was not tested.
   - The script never prints key values, only `set` or `not set`.
2. **Dry run first.** With no flag, the script prints:
   - which keys are set
   - planned request counts per provider and API
   - cached versus billable counts
   - the hard cap

   It exits 0 and makes no network calls at all. Nominatim calls also need `--run`.
3. **Reference pass.** Under `--run`:
   - Fetch a Nominatim point for each location that has no reference yet.
   - Rate limit: at most 1 request per second, sequential.
   - Write the results back to `scripts/lib/maps-test/locations.ts`. Write `referenceLat/Lng`,
     `referenceSource`, `osmId` and `referenceType`, keeping the file formatted.
   - Rows that already have a reference are skipped unless `--refresh-reference` is passed.
4. **Provider passes.**
   - Run sequentially per provider, with at most 5 requests per second to be polite.
   - Each request goes through the cache and the budget counter.
   - Use one autocomplete session token per prefix query: a random UUID, never reused.
5. **Precision mapping.** Map provider result types to a shared `precision` value:
   `poi | address | street | neighbourhood | locality | city | county | country`.

   | Precision | Google `types` | Mapbox `feature_type` |
   |---|---|---|
   | neighbourhood | `neighborhood`, `sublocality*` | `neighborhood` |
   | locality | (not used) | `locality` |
   | city | `locality` | `place` |
   | county | `administrative_area_level_1/2` | `region`, `district` |
   | poi | `establishment`, `point_of_interest` | `poi` |

   Keep the mapping in one table in `scoring.ts`, unit tested.
6. **Tiles.**
   - Save PNGs to `.provider-test/tiles/<provider>-<place>-z<zoom>.png`.
   - Write a local comparison page, `.provider-test/tiles/index.html` (gitignored), that shows
     each pair side by side for viewing.
   - I then view the images, fill the tile scores into `scripts/lib/maps-test/tile-scores.ts`,
     and re-run report generation with `--report-only`, which makes no network calls.
7. **Report contents** (`docs/PHASE3_PROVIDER_TEST.md`):
   1. Summary table:

      | Provider | Autocomplete | Geocoding | Tiles | Monthly cost (1×, 3×) | Weighted total |
      |---|---|---|---|---|---|

      Plus the best-split row.
   2. Recommendation, with the reasons in two or three sentences.
   3. Breakdown by group: neighbourhood-hit rate per group per provider.
   4. Per-location table:
      - query
      - reference source
      - for each provider: precision, distance in km, hit level, autocomplete ranks
      - flag
   5. Rows with no reference, and rows flagged for disagreement.
   6. Cost workings:
      - traffic assumptions
      - prices with pricing-page URL and date
      - free caps used
   7. Method:
      - weights
      - thresholds
      - API endpoints and docs URLs with the date checked
      - run date
      - request counts actually billed
   8. Limits and caveats:
      - sample size
      - OSM as reference
      - tile scoring is a judgement
   9. What S19 needs from the winner:
      - which APIs to enable
      - key restrictions (server key by API; browser tile token by allowed origins)
      - env variable names
   10. Attribution: © OpenStreetMap contributors (ODbL) for reference points.
   11. Cleanup note: delete `.provider-test/` once S19 starts.
8. **No app changes.** Nothing under `src/` changes. `src/lib/kenya.ts` is only imported, for
   validating the county list.

## Security requirements

- Keys are read only by the server-side script. No `NEXT_PUBLIC_` variable is used or added.
- Keys never appear in:
  - logs
  - error messages
  - cache file names or contents
  - the report
  - committed files

  Request URLs are logged with the key parameter stripped. Google is called with the
  `X-Goog-Api-Key` header where the API supports it.
- Raw provider responses and images stay in gitignored `.provider-test/`.
- The hard budget cap and the dry-run default stop surprise bills.
- Nominatim usage follows its policy: 1 req/s, an identifying User-Agent, results cached and
  not re-queried. No personal email is sent.
- No database access, and no production systems touched.

### Key setup (you, before `--run`)

- **Google Cloud Console:**
  1. Create a project with billing enabled.
  2. Enable Places API (New), Geocoding API and Maps Static API.
  3. Create an API key, restricted to those three APIs.
  4. Optionally restrict it to your IP address.
  5. Set a budget alert, for example USD 5.
- **Mapbox:** use the default public token from your account page. For this test it is used
  server-side only.
- Paste the values into `.env`:
  - `GOOGLE_MAPS_API_KEY=…`
  - `MAPBOX_ACCESS_TOKEN=…`

## Acceptance criteria

- `npm run maps:test` (dry run):
  - prints key status and planned counts
  - makes no network calls
  - exits 0
- `npm run maps:test -- --run`:
  - completes with both keys set and stays under the cap
  - a second `--run` bills 0 requests, because everything comes from the cache
- All 50 locations have `referenceSource` set to `osm` or `none`, never an invented point.
- `docs/PHASE3_PROVIDER_TEST.md` exists with every section in requirement 7. It contains:
  - a clear recommendation, single provider or split, with the weighted totals behind it
  - real scores for every measure, with cost figures citing dated pricing pages
- No key value is found in the repo: `git grep` for the real key prefixes finds nothing.
- `.provider-test/` is ignored by git.
- Scoring unit tests pass, and nothing under `src/` changed.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`, which now also picks up `scripts/**/*.test.ts`
- `npm run build` is not needed (no route, config or server module change). I'll run it anyway
  if `vitest.config.ts` or `package.json` changes affect it. They shouldn't.

## Manual test steps (after implementation)

1. Put your keys in `.env` (`GOOGLE_MAPS_API_KEY`, `MAPBOX_ACCESS_TOKEN`).
2. Run `npm run maps:test`. Expect:
   - "Google: set, Mapbox: set"
   - planned counts per API
   - "dry run, no requests made"
3. Run `npm run maps:test -- --run`:
   - Progress prints per provider, with the billed count against the cap.
   - It finishes with "report written: docs/PHASE3_PROVIDER_TEST.md".
4. Run `npm run maps:test -- --run` again. Billed requests: 0 for both providers.
5. Open `.provider-test/tiles/index.html` in Edge and compare the tile pairs. Tell me if you
   disagree with my tile scores and I'll update them and run `--report-only`.
6. Read `docs/PHASE3_PROVIDER_TEST.md`. Check the recommendation, and the per-location rows for
   places you know well.
7. In Google Cloud Console → APIs & Services → Metrics, request counts match the report's
   "billed" numbers. The same goes for Mapbox → Statistics.
8. Approve the provider choice. S19 (PostGIS, server geocoding, map adapter) is then written
   for that provider.
