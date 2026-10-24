// Shared by the offline test files (test-sweep.mjs, test-subscriptions.mjs): the PASS/FAIL
// printer, an in-memory store with the same calls as api/_lib/storage.js, and a fake response.
export const failures = [];

export const check = (ok, label) => {
  console.log((ok ? "PASS " : "FAIL ") + label);
  if (!ok) failures.push(label);
};

export const memStorage = () => {
  const m = new Map();
  return {
    m,
    get: async (k) => (m.has(k) ? m.get(k) : null),
    set: async (k, v) => { m.set(k, v); },
    del: async (k) => { m.delete(k); },
    list: async (prefix) => [...m.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)).sort(),
  };
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
