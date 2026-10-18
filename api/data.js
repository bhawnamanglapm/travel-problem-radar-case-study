// Read-only data feed for the /live/ dashboard.
import { makeDataHandler } from "./_lib/handlers.js";
import { blobStorage } from "./_lib/storage.js";

export default makeDataHandler({ storage: blobStorage() });
