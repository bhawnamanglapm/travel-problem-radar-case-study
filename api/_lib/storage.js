// Vercel Blob as a tiny key-value store. The store is private; the only public
// reader is api/data.js, which allow-lists the keys.
import { BlobPreconditionFailedError, del, get, list, put } from "@vercel/blob";

// Each kind of key has its own folder under radar/ (2026-10-26). A one-off key maps to one file:
// radar:history -> radar/history/index.json. A prefix key's file is named by its kind and, for the kinds that are
// written over time, the UTC time as YYYY-MM-DD-HH-MM, then the rest of the key (anything not a letter or digit
// becomes "-"): radar:llmlog:1792948701207 -> radar/logs/llm-log-2026-10-25-17-18-1792948701207.json.
// Records that live on (subscribers, the Razorpay index) are named by id only. The logical keys don't change; only
// the file names do, and `from` turns a file name back into the key so list() still returns key suffixes.
const FILES = {
  "radar:history": "history/index",
  "radar:seenIds": "history/seen-ids",
  "radar:items": "history/items",
  "radar:search": "history/search",
  "radar:lastScheduled": "state/last-scheduled",
  "radar:subscriberCount": "state/subscriber-count",
};
const tidy = (s) => s.replace(/[^a-z0-9]+/gi, "-");
// A sweep or LLM log id is the start time in milliseconds.
const msTime = {
  to: [[/^\d{10,16}$/, (id) => new Date(Number(id)).toISOString().slice(0, 16).replace(/\D/g, "-") + "-" + id]],
  from: [[/^\d{4}-\d\d-\d\d-\d\d-\d\d-(\d{10,16})$/, "$1"]],
};
const FOLDERS = {
  "radar:sweep:": { dir: "sweeps/", word: "sweep-", ...msTime },
  "radar:llmlog:": { dir: "logs/", word: "llm-log-", ...msTime },
  "radar:sub:": { dir: "subscribers/" },
  // YYYYMMDD-HHMMSSmmm-<type>-<hex>, or a day's prefix YYYYMMDD- (countEvents).
  "radar:event:": { dir: "events/", word: "event-",
    to: [[/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)(\d{3})-/, "$1-$2-$3-$4-$5-$6-$7-"], [/^(\d{4})(\d\d)(\d\d)-$/, "$1-$2-$3-"]],
    from: [[/^(\d{4})-(\d\d)-(\d\d)-(\d\d)-(\d\d)-(\d\d)-(\d{3})-/, "$1$2$3-$4$5$6$7-"]] },
  // YYYYMMDD: one file a day.
  "radar:deliveries:": { dir: "deliveries/", word: "deliveries-",
    to: [[/^(\d{4})(\d\d)(\d\d)$/, "$1-$2-$3"]], from: [[/^(\d{4})-(\d\d)-(\d\d)$/, "$1$2$3"]] },
  // YYYYMMDDHH-<hash>-<hex>: the hour is what the rate limit counts, so there are no minutes.
  "radar:iphit:": { dir: "ip-hits/", word: "ip-hit-",
    to: [[/^(\d{4})(\d\d)(\d\d)(\d\d)-/, "$1-$2-$3-$4-"]], from: [[/^(\d{4})-(\d\d)-(\d\d)-(\d\d)-/, "$1$2$3$4-"]] },
  "radar:rzpsub:": { dir: "razorpay/subscriptions/" },
  // YYYYMMDD-HHMM-<event id> (YYYYMMDD-<event id> before 2026-10-26).
  "radar:rzp-event:": { dir: "razorpay/events/", word: "razorpay-event-",
    to: [[/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)-/, "$1-$2-$3-$4-$5-"], [/^(\d{4})(\d\d)(\d\d)-/, "$1-$2-$3-"]],
    from: [[/^(\d{4})-(\d\d)-(\d\d)-(\d\d)-(\d\d)-/, "$1$2$3-$4$5-"], [/^(\d{4})-(\d\d)-(\d\d)-/, "$1$2$3-"]] },
};
// The first rule that matches rewrites the text; none leaves it as it is.
const rewrite = (text, rules = []) => {
  const rule = rules.find(([re]) => re.test(text));
  return rule ? text.replace(rule[0], rule[1]) : text;
};
const folderOf = (key) => Object.keys(FOLDERS).find((p) => key.startsWith(p));
// The path without ".json". A key that fits neither table lands in radar/other/, so a new key still works.
const stem = (key) => {
  if (FILES[key]) return "radar/" + FILES[key];
  const p = folderOf(key);
  if (!p) return "radar/other/" + tidy(key);
  const f = FOLDERS[p];
  return "radar/" + f.dir + (f.word || "") + rewrite(tidy(key.slice(p.length)), f.to);
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
      const f = FOLDERS[folderOf(prefix)];
      const rest = prefix.slice(folderOf(prefix).length);
      const base = stem(prefix);
      const named = "radar/" + f.dir + (f.word || "");
      const out = [];
      let cursor;
      do {
        const page = await blob.list({ prefix: base, cursor });
        for (const b of page.blobs) {
          if (b.pathname.startsWith(base) && b.pathname.endsWith(".json")) {
            const suffix = rewrite(b.pathname.slice(named.length, -".json".length), f.from);
            if (suffix.startsWith(rest)) out.push(suffix.slice(rest.length));
          }
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return out.sort();
    },
  };
}
