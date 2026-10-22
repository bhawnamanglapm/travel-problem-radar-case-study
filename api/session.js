// Sign-in by emailed link and the login cookie (docs/subscriptions/tasks/T16). See makeSessionHandler.
import { makeSessionHandler } from "./_lib/subscription-handlers.js";
import { blobStorage } from "./_lib/storage.js";

export default makeSessionHandler({ env: process.env, storage: blobStorage(), fetchFn: fetch, now: Date.now });
