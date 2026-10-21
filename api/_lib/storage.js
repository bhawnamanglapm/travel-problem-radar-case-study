// Vercel Blob as a tiny key-value store. The store is private; the only public
// reader is api/data.js, which allow-lists the keys.
import { del, get, list, put } from "@vercel/blob";

const path = (key) => "radar/" + key.replace(/[^a-z0-9]+/gi, "-") + ".json";

// `blob` is the @vercel/blob client; the offline tests pass a fake with the same four calls.
export function blobStorage(blob = { del, get, list, put }) {
  return {
    async get(key) {
      const r = await blob.get(path(key), { access: "private" });
      if (!r || r.statusCode !== 200) return null;
      return await new Response(r.stream).text();
    },
    async set(key, value) {
      await blob.put(path(key), value, {
        access: "private", contentType: "application/json",
        allowOverwrite: true, addRandomSuffix: false,
      });
    },
    async del(key) { await blob.del(path(key)); },
    // The key suffixes under a logical prefix, sorted: list("radar:sub:") -> ["<id>", ...].
    // The prefix must start with "radar:" and end in ":" or "-" (the latter for a day's events,
    // "radar:event:20261021-") so a careless call can't list the whole store, and the suffixes
    // must be letters, digits and "-" so each one maps back to the key exactly (prefix + suffix).
    async list(prefix) {
      if (typeof prefix !== "string" || !/^radar:.*[:-]$/.test(prefix)) throw new Error("list: prefix must start with 'radar:' and end in ':' or '-'");
      const base = path(prefix).slice(0, -".json".length);
      const out = [];
      let cursor;
      do {
        const page = await blob.list({ prefix: base, cursor });
        for (const b of page.blobs) {
          if (b.pathname.startsWith(base) && b.pathname.endsWith(".json")) {
            out.push(b.pathname.slice(base.length, -".json".length));
          }
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return out.sort();
    },
  };
}
