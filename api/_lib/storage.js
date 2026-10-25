// Vercel Blob as a tiny key-value store. The store is private; the only public
// reader is api/data.js, which allow-lists the keys.
import { BlobPreconditionFailedError, del, get, list, put } from "@vercel/blob";

// Each kind of key has its own folder under radar/ (2026-10-26). A one-off key maps to one file; a prefix key keeps
// what follows the prefix as the file name, with anything not a letter or digit as "-":
// radar:sub:abc -> radar/subscribers/abc.json, radar:history -> radar/history/index.json.
const FILES = {
  "radar:history": "history/index",
  "radar:seenIds": "history/seen-ids",
  "radar:lastScheduled": "state/last-scheduled",
  "radar:subscriberCount": "state/subscriber-count",
};
const FOLDERS = {
  "radar:sweep:": "sweeps/",
  "radar:llmlog:": "logs/",
  "radar:sub:": "subscribers/",
  "radar:event:": "events/",
  "radar:deliveries:": "deliveries/",
  "radar:iphit:": "ip-hits/",
  "radar:rzpsub:": "razorpay/subscriptions/",
  "radar:rzp-event:": "razorpay/events/",
};
const tidy = (s) => s.replace(/[^a-z0-9]+/gi, "-");
const folderOf = (key) => Object.keys(FOLDERS).find((p) => key.startsWith(p));
// The path without ".json". A key that fits neither table lands in radar/other/, so a new key still works.
const stem = (key) => {
  if (FILES[key]) return "radar/" + FILES[key];
  const p = folderOf(key);
  return p ? "radar/" + FOLDERS[p] + tidy(key.slice(p.length)) : "radar/other/" + tidy(key);
};
const path = (key) => stem(key) + ".json";

// `blob` is the @vercel/blob client; the offline tests pass a fake with the same four calls.
// Reads skip Blob's CDN cache by default: an overwritten file can be served stale for up to 60 seconds, and most
// callers read, change and write back (subscriber records, the sweep index, delivery files), so a stale read would
// undo a recent write. `cached: true` is for read-only callers that can show a minute-old copy (/api/data).
export function blobStorage(blob = { del, get, list, put }, { cached = false } = {}) {
  return {
    async get(key) {
      const r = await blob.get(path(key), { access: "private", useCache: cached });
      if (!r || r.statusCode !== 200) return null;
      return await new Response(r.stream).text();
    },
    async set(key, value) {
      await blob.put(path(key), value, {
        access: "private", contentType: "application/json",
        allowOverwrite: true, addRandomSuffix: false,
      });
    },
    // Read, change, write back, and only if nobody wrote in between: the write carries the ETag that
    // was read (ifMatch), and on a mismatch the change runs again on a fresh read. `change(text)` gets
    // the current text (null if missing) and returns the new text, or undefined to write nothing.
    // Returns the text now stored. Throws after `tries` mismatches, so the caller answers 500.
    async update(key, change, { tries = 5 } = {}) {
      for (let i = 1; ; i++) {
        const r = await blob.get(path(key), { access: "private", useCache: false });
        const found = Boolean(r && r.statusCode === 200);
        const current = found ? await new Response(r.stream).text() : null;
        const next = await change(current);
        if (next === undefined) return current;
        try {
          await blob.put(path(key), next, {
            access: "private", contentType: "application/json",
            allowOverwrite: true, addRandomSuffix: false,
            ...(found && r.etag ? { ifMatch: r.etag } : {}),
          });
          return next;
        } catch (e) {
          // By name too: the offline tests pass a fake client whose errors aren't this class.
          const mismatch = e instanceof BlobPreconditionFailedError || (e && e.name === "BlobPreconditionFailedError");
          if (!mismatch || i >= tries) throw e;
        }
      }
    },
    async del(key) { await blob.del(path(key)); },
    // The key suffixes under a logical prefix, sorted: list("radar:sub:") -> ["<id>", ...].
    // The prefix must start with one of FOLDERS' prefixes and end in ":" or "-" (the latter for a day's events,
    // "radar:event:20261021-") so a careless call can't list the whole store, and the suffixes
    // must be letters, digits and "-" so each one maps back to the key exactly (prefix + suffix).
    async list(prefix) {
      if (typeof prefix !== "string" || !/^radar:.*[:-]$/.test(prefix) || !folderOf(prefix)) throw new Error("list: prefix must start with a known folder's prefix (radar:sub: …) and end in ':' or '-'");
      const base = stem(prefix);
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
