import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { properties } from "@/db/schema";
import type { SearchSort } from "@/lib/search/params";
import {
  CAP_WINDOW,
  COMPLETE_DESCRIPTION_CHARS,
  LISTER_CAP,
  PHOTO_SHARE,
  PHOTO_TARGET,
  RECENCY_DAYS,
  SCORE_BUCKET,
  SCORE_WEIGHTS,
} from "@/lib/search/ranking";

/**
 * Search ordering SQL (plan v2.0 §5; prompt S7 decisions 1, 2 and 7). Ranking only reorders the
 * rows the filters matched; nothing here adds a row. The order expressions run over the
 * `matched` CTE built in `public-listings.ts`, whose columns include `id`, `verified`, `score`,
 * `published`, `"priceKes"` and `lister_key`.
 */

const p = properties;

/** Our own numeric constants, inlined so Postgres types them as numbers (never user input). */
function num(value: number): SQL {
  if (!Number.isFinite(value)) throw new RangeError(`Not a finite constant: ${value}`);
  return sql.raw(String(value));
}

function filled(condition: SQL): SQL {
  return sql`(${condition})::int`;
}

/**
 * Share of the fields that apply to the category which are filled in. Bedrooms and bathrooms
 * only exist on homes, and amenities never on land (`normalizeForCategory`), so each category
 * is scored against its own fields.
 */
function completenessSql(): SQL {
  const neighbourhood = filled(sql`nullif(trim(${p.neighbourhood}), '') is not null`);
  const description = filled(sql`char_length(${p.description}) >= ${num(COMPLETE_DESCRIPTION_CHARS)}`);
  const amenity = filled(sql`cardinality(${p.amenities}) > 0`);
  const area = filled(sql`${p.areaSqm} is not null`);
  return sql`case ${p.category}
    when 'land' then (${filled(sql`${p.landSize} is not null`)} + ${neighbourhood} + ${description})::float8 / 3
    when 'commercial' then (${area} + ${neighbourhood} + ${amenity} + ${description})::float8 / 4
    else (${filled(sql`${p.bedrooms} is not null`)} + ${filled(sql`${p.bathrooms} is not null`)} + ${area}
      + ${neighbourhood} + ${amenity} + ${description})::float8 / 6
  end`;
}

/** Best trigram similarity of the location query against where the listing is, else 0. */
function matchSql(q: string | null): SQL {
  if (!q) return sql`0`;
  return sql`greatest(
    similarity(coalesce(${p.neighbourhood}, ''), ${q}::text),
    similarity(${p.town}, ${q}::text),
    similarity(${p.county}, ${q}::text),
    similarity(${p.title}, ${q}::text)
  )`;
}

/**
 * The Recommended score in [0, 1] (decision 1). `photoCount` is the listing's photo count
 * expression; `now` is bound so tests can fix the clock.
 */
export function scoreSql(q: string | null, now: Date, photoCount: SQL): SQL {
  const days = sql`greatest(0, extract(epoch from (${now.toISOString()}::timestamptz - coalesce(${p.publishedAt}, ${p.createdAt}))) / 86400.0)`;
  const recency = sql`1.0 / (1.0 + ${days} / ${num(RECENCY_DAYS)})`;
  const quality = sql`${num(PHOTO_SHARE)} * least(${photoCount}, ${num(PHOTO_TARGET)})::float8 / ${num(PHOTO_TARGET)}
    + ${num(1 - PHOTO_SHARE)} * ${completenessSql()}`;
  return sql`(${num(SCORE_WEIGHTS.match)} * ${matchSql(q)}
    + ${num(SCORE_WEIGHTS.recency)} * ${recency}
    + ${num(SCORE_WEIGHTS.quality)} * (${quality}))::float8`;
}

/** Daily rotation key: stable within a Nairobi day, different the next. */
export function rotationKey(seed: string): SQL {
  return sql`md5(id::text || ${seed}::text)`;
}

/** Verified tier: score buckets, then the daily rotation inside each bucket. */
export function verifiedTierOrderBy(seed: string): SQL {
  return sql`floor(score / ${num(SCORE_BUCKET)}) desc, ${rotationKey(seed)}, id`;
}

/** Recommended before the cap: verified tier first (rotated), then everyone else by score. */
export function recommendedOrderBy(seed: string): SQL {
  return sql`verified desc,
    case when verified then floor(score / ${num(SCORE_BUCKET)}) end desc,
    case when verified then ${rotationKey(seed)} end,
    score desc, published desc, id`;
}

/** Newest and Price are strict: no tiers, no cap. */
export function strictOrderBy(sort: Exclude<SearchSort, "recommended">): SQL {
  switch (sort) {
    case "newest":
      return sql`published desc, id`;
    case "price_asc":
      return sql`"priceKes" asc, published desc, id`;
    case "price_desc":
      return sql`"priceKes" desc, published desc, id`;
  }
}

/**
 * CTEs after `matched` that end in `capped`, whose `final_pos` column is the final Recommended order
 * (decision 2):
 *  1. `ranked`: position in the uncapped order;
 *  2. `listed`: each lister's own running count (`lr`);
 *  3. `capped`: the first CAP_WINDOW positions go to rows with `lr <= LISTER_CAP`, in order;
 *     every other row follows in its original order.
 */
export function cappedRecommendedCtes(seed: string): SQL {
  return sql`ranked as (
      select m.*, row_number() over (order by ${recommendedOrderBy(seed)}) as pos from matched m
    ),
    listed as (
      select r.*, row_number() over (partition by lister_key order by pos) as lr from ranked r
    ),
    eligible as (
      select l.*,
        case when lr <= ${num(LISTER_CAP)} then row_number() over (partition by lr <= ${num(LISTER_CAP)} order by pos) end as er
      from listed l
    ),
    capped as (
      select e.*,
        row_number() over (order by (er is not null and er <= ${num(CAP_WINDOW)}) desc, pos) as final_pos
      from eligible e
    )`;
}
