// Shared by the offline test files (test-sweep.mjs, test-subscriptions.mjs): the PASS/FAIL
// printer, an in-memory store with the same calls as api/_lib/storage.js, and a fake response.
export const failures = [];

export const check = (ok, label) => {
  console.log((ok ? "PASS " : "FAIL ") + label);
  if (!ok) failures.push(label);
};

// `update` is storage.js's conditional write: a per-key version stands in for the ETag. It reads
// through st.get and writes through st.set, so tests that replace those still apply. A test that
// wraps get can slip a competing write in after the read, as can `beforeWrite(key)`, called just
// before each write.
export const memStorage = () => {
  const m = new Map();
  const ver = new Map();
  const bump = (k) => ver.set(k, (ver.get(k) || 0) + 1);
  const st = {
    m,
    beforeWrite: null,
    updateMisses: 0,
    get: async (k) => (m.has(k) ? m.get(k) : null),
    set: async (k, v) => { m.set(k, v); bump(k); },
    del: async (k) => { m.delete(k); bump(k); },
    list: async (prefix) => [...m.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)).sort(),
    async update(k, change, { tries = 5 } = {}) {
      for (let i = 1; ; i++) {
        const seen = ver.get(k) || 0;
        const current = await st.get(k);
        const next = await change(current);
        if (next === undefined) return current;
        if (st.beforeWrite) await st.beforeWrite(k);
        if ((ver.get(k) || 0) === seen) { await st.set(k, next); return next; } // through set, so a test's failing set fails it
        st.updateMisses++;
        if (i >= tries) throw Object.assign(new Error("Precondition failed: ETag mismatch."), { name: "BlobPreconditionFailedError" });
      }
    },
  };
  return st;
};

export const mockRes = () => {
  const r = { code: 0, headers: {}, body: "", ended: false };
  // Like Node: a header set after end() throws ERR_HTTP_HEADERS_SENT.
  r.setHeader = (k, v) => {
    if (r.ended) throw Object.assign(new Error("Cannot set headers after they are sent to the client"), { code: "ERR_HTTP_HEADERS_SENT" });
    r.headers[k.toLowerCase()] = v;
  };
  r.end = (b) => { r.body = b; r.ended = true; };
  Object.defineProperty(r, "statusCode", { set(v) { r.code = v; }, get() { return r.code; } });
  r.json = () => JSON.parse(r.body);
  return r;
};

// Prints the summary and sets the exit code. `label` completes "All <label> passed."
export const finish = (label) => {
  console.log(failures.length ? `\n${failures.length} failure(s)` : `\nAll ${label} passed.`);
  process.exit(failures.length ? 1 : 0);
};
