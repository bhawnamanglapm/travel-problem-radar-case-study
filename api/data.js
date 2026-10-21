// Read-only data feed for the /live/ dashboard.
import { makeDataHandler } from "./_lib/handlers.js";
import { blobStorage } from "./_lib/storage.js";

// Read-only and already cached for 5 minutes by its response headers, so Blob's CDN cache is fine here.
export default makeDataHandler({ storage: blobStorage(undefined, { cached: true }) });
