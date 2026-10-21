// Daily sweep, called by Vercel Cron (see vercel.json) with the CRON_SECRET bearer token.
import { randomBytes } from "node:crypto";
import { makeSweepHandler } from "./_lib/handlers.js";
import { blobStorage } from "./_lib/storage.js";

export default makeSweepHandler({ env: process.env, storage: blobStorage(), fetchFn: fetch, now: Date.now, randomBytes });
