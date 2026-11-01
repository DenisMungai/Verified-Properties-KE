import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbExecutor } from "@/db/executor";
import * as schema from "@/db/schema";
import { clearAvatar, getListerProfile, referencedAvatarKeys, saveListerProfile, setAvatar } from "./lister-profiles";

/**
 * Lister avatars against the Neon test branch (TEST_DATABASE_URL), each test in a rolled-back
 * transaction. Fixture ids (av_*) are unique to this suite, which runs alongside the others.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("lister avatars (integration)", { timeout: 60_000 }, () => {
  const client = new Client({ connectionString: url });
  const db = drizzle({ client, schema }) as unknown as DbExecutor;

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query("BEGIN");
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
  });

  async function insertLister(id: string) {
    await client.query(`insert into users (id, name, email) values ($1, $1, $1 || '@example.test')`, [id]);
    await client.query(`insert into lister_profiles (user_id, display_name) values ($1, $2)`, [id, `Lister ${id}`]);
  }

  it("sets, replaces and clears the avatar, returning the key it replaced", async () => {
    await insertLister("av_owner");
    expect(await setAvatar(db, "av_owner", "avatars/av_owner/one")).toBeNull();
    expect(await setAvatar(db, "av_owner", "avatars/av_owner/two")).toBe("avatars/av_owner/one");
    expect((await getListerProfile(db, "av_owner"))?.avatarKey).toBe("avatars/av_owner/two");
    expect(await clearAvatar(db, "av_owner")).toBe("avatars/av_owner/two");
    expect(await clearAvatar(db, "av_owner")).toBeNull();
    expect((await getListerProfile(db, "av_owner"))?.avatarKey).toBeNull();
  });

  it("writes nothing for a user without a lister profile", async () => {
    await client.query(`insert into users (id, name, email) values ('av_buyer', 'B', 'av_buyer@example.test')`);
    expect(await setAvatar(db, "av_buyer", "avatars/av_buyer/x")).toBeUndefined();
    expect(await getListerProfile(db, "av_buyer")).toBeNull();
  });

  it("keeps the avatar when the profile form is saved", async () => {
    await insertLister("av_keep");
    await setAvatar(db, "av_keep", "avatars/av_keep/photo");
    await saveListerProfile(db, "av_keep", {
      listerType: "owner",
      displayName: "Renamed",
      phone: "+254712345678",
      publicEmail: null,
      bio: null,
    });
    expect((await getListerProfile(db, "av_keep"))?.avatarKey).toBe("avatars/av_keep/photo");
  });

  it("referencedAvatarKeys reports only keys a profile points at", async () => {
    await insertLister("av_ref");
    await setAvatar(db, "av_ref", "avatars/av_ref/current");
    const found = await referencedAvatarKeys(db, ["avatars/av_ref/current", "avatars/av_ref/old"]);
    expect([...found]).toEqual(["avatars/av_ref/current"]);
  });
});
