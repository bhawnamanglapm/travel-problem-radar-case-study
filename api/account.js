// The manage page's data and its "Request Pro" button (/manage/, linked from every digest).
import { makeAccountHandler } from "./_lib/subscription-handlers.js";
import { blobStorage } from "./_lib/storage.js";

export default makeAccountHandler({ env: process.env, storage: blobStorage(), fetchFn: fetch, now: Date.now });
