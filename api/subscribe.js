// Sign-up for the email digest (docs/subscriptions/tasks/T05). Public; off until SUBSCRIPTIONS_ENABLED=1.
import { makeSubscribeHandler } from "./_lib/subscription-handlers.js";
import { blobStorage } from "./_lib/storage.js";

export default makeSubscribeHandler({ env: process.env, storage: blobStorage(), fetchFn: fetch, now: Date.now });
