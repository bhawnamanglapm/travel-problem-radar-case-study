// Subscription events from Razorpay make a paid account Pro or Free (docs/subscriptions/tasks/T21). A
// Web-standard handler, so the raw body reaches the signature check unparsed. Off until RAZORPAY_WEBHOOK_SECRET is set.
import { makeRazorpayWebhookHandler } from "./_lib/subscription-handlers.js";
import { blobStorage } from "./_lib/storage.js";

export default { fetch: makeRazorpayWebhookHandler({ env: process.env, storage: blobStorage(), now: Date.now }) };
