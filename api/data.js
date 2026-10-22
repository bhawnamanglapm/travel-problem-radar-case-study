// Read-only data feed for the /live/ dashboard.
import { makeDataHandler } from "./_lib/handlers.js";
import { blobStorage } from "./_lib/storage.js";

// The sweeps are read-only and, with BOARD_PAYWALL off, cached for 5 minutes by the response
// headers, so Blob's CDN cache is fine for them. The login (BOARD_PAYWALL on) reads fresh.
export default makeDataHandler({ storage: blobStorage(undefined, { cached: true }), accounts: blobStorage(), env: process.env, now: Date.now });
