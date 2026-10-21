// Bounces and spam complaints from Resend (docs/subscriptions/tasks/T13, part A). A Web-standard
// handler, so the raw body reaches the signature check unparsed. Off until RESEND_WEBHOOK_SECRET is set.
import { makeResendWebhookHandler } from "./_lib/subscription-handlers.js";
import { blobStorage } from "./_lib/storage.js";

export default { fetch: makeResendWebhookHandler({ env: process.env, storage: blobStorage(), now: Date.now }) };
