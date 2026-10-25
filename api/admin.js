// The owner's dashboard data and its sign-in (/admin/). See makeAdminHandler.
import { makeAdminHandler } from "./_lib/admin.js";
import { blobStorage } from "./_lib/storage.js";
import { randomBytes } from "node:crypto";

export default makeAdminHandler({ env: process.env, storage: blobStorage(), now: Date.now, randomBytes });
