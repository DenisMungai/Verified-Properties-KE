import { TooLargeError, type ObjectStore, type StoredObject } from "@/lib/storage/object-store";

export interface MemoryObject {
  body: Buffer;
  contentType: string;
  lastModified: Date;
}

/** In-memory ObjectStore for tests. `objects` is exposed so tests can inspect and age entries. */
export function createMemoryStore(): ObjectStore & { objects: Map<string, MemoryObject> } {
  const objects = new Map<string, MemoryObject>();
  return {
    objects,
    async presignPut(key, contentType, contentLength) {
      return `memory://${key}?type=${encodeURIComponent(contentType)}&length=${contentLength}`;
    },
    async get(key, maxBytes) {
      const found = objects.get(key);
      if (!found) return null;
      if (found.body.length > maxBytes) throw new TooLargeError();
      return found.body;
    },
    async put(key, body, contentType) {
      objects.set(key, { body, contentType, lastModified: new Date() });
    },
    async delete(keys) {
      for (const key of keys) objects.delete(key);
    },
    async list(prefix) {
      const out: StoredObject[] = [];
      for (const [key, value] of objects) if (key.startsWith(prefix)) out.push({ key, lastModified: value.lastModified });
      return out;
    },
  };
}
