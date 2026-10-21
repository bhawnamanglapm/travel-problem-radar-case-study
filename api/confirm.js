// The link in the confirmation email (docs/subscriptions/tasks/T06). GET shows a button; POST confirms.
import { makeConfirmHandler } from "./_lib/subscription-handlers.js";
import { blobStorage } from "./_lib/storage.js";

export default makeConfirmHandler({ env: process.env, storage: blobStorage(), now: Date.now });
