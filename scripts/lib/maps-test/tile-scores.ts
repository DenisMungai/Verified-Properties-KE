/**
 * Tile judgements (decision 7), filled in by eye after `--run` saves the static images to
 * `.provider-test/tiles/`. Each criterion is 0–2: estate and neighbourhood labels, local roads,
 * buildings and landmarks, legibility. These are a judgement, and the report says so; edit them
 * and run `npm run maps:test -- --report-only` to regenerate.
 */
import type { ProviderId, TileJudgement } from "./types";

export const TILE_JUDGE =
  "Claude, 2026-11-10, from the zoom 13/15/17 images; Mapbox judged before Google's images existed, to be re-checked side by side";

export const TILE_SCORES: Record<ProviderId, Record<string, TileJudgement>> = {
  google: {},
  mapbox: {
    kilimani: {
      labels: 2, roads: 2, buildings: 2, legibility: 2,
      note: "Kilimani, Hurlingham, Woodley, Thompson labelled at z13; footprints and named buildings at z17",
    },
    ruaka: {
      labels: 2, roads: 2, buildings: 2, legibility: 2,
      note: "Ruaka, Rosslyn, Runda, Gachie, Muchatha labelled; Ruaka Arcade and footprints at z17",
    },
    kitengela: {
      labels: 2, roads: 2, buildings: 2, legibility: 2,
      note: "Kitengela, Milimani and The Promise labelled; dense lane grid drawn; footprints at z17",
    },
    nyali: {
      labels: 2, roads: 2, buildings: 2, legibility: 2,
      note: "Nyali, Kongowea, Maweni labelled at z13 (not at z15); Beach Road, golf club, footprints",
    },
    "milimani-kisumu": {
      labels: 2, roads: 2, buildings: 2, legibility: 2,
      note: "Milimani, Nyalenda A/B and Kilo labelled; Ojijo Oteko and Riddoch roads; footprints at z17",
    },
    "nakuru-cbd": {
      labels: 2, roads: 2, buildings: 2, legibility: 2,
      note: "Kenyatta Avenue, Section 58, Bondeni, Shabab labelled; banks and footprints at z17",
    },
  },
};
