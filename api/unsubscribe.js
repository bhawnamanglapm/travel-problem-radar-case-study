// The unsubscribe link in every digest and its List-Unsubscribe header (docs/subscriptions/tasks/T07).
import { makeUnsubscribeHandler } from "./_lib/subscription-handlers.js";
import { blobStorage } from "./_lib/storage.js";

export default makeUnsubscribeHandler({ env: process.env, storage: blobStorage(), now: Date.now });
