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
  const r = { code: 0, headers: {}, body: "" };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.end = (b) => { r.body = b; };
  Object.defineProperty(r, "statusCode", { set(v) { r.code = v; }, get() { return r.code; } });
  r.json = () => JSON.parse(r.body);
  return r;
};

// Prints the summary and sets the exit code. `label` completes "All <label> passed."
export const finish = (label) => {
  console.log(failures.length ? `\n${failures.length} failure(s)` : `\nAll ${label} passed.`);
  process.exit(failures.length ? 1 : 0);
};
