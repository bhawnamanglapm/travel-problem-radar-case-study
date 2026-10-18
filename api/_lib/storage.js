// Vercel Blob as a tiny key-value store. The store is private; the only public
// reader is api/data.js, which allow-lists the keys.
import { del, get, put } from "@vercel/blob";

const path = (key) => "radar/" + key.replace(/[^a-z0-9]+/gi, "-") + ".json";

export function blobStorage() {
  return {
    async get(key) {
      const r = await get(path(key), { access: "private" });
      if (!r || r.statusCode !== 200) return null;
      return await new Response(r.stream).text();
    },
    async set(key, value) {
      await put(path(key), value, {
        access: "private", contentType: "application/json",
        allowOverwrite: true, addRandomSuffix: false,
      });
    },
    async del(key) { await del(path(key)); },
  };
}
