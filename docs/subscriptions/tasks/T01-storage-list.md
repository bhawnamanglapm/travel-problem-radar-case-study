# T01 · Add `list(prefix)` to storage; share test helpers

| | |
|---|---|
| Phase | 1a, foundations |
| Who | Developer |
| Size | S |
| Depends on | — |
| Unblocks | T02 and everything that reads more than one subscriber |

## Why

The storage layer (`api/_lib/storage.js`) has `get`, `set` and `del`. Subscribers are stored one file per address
(so two sign-ups at the same moment can't overwrite each other), and the sweep needs to find all of them. That needs
a `list(prefix)`.

The in-memory store in `scripts/test-sweep.mjs` needs the same method. The new subscription tests (in their own file)
need the same fakes, so move the shared ones into a helper module.

## What to build

### `list(prefix)` in `blobStorage()`

```js
// Returns the key suffixes under a logical prefix, e.g. list("radar:sub:") -> ["<id>", ...].
async list(prefix) { ... }
```

- Logical keys become Blob paths through `path()`: anything that is not a letter or digit becomes `-`, so
  `radar:sub:abc` is stored at `radar/radar-sub-abc.json`. (Since 2026-10-26 each kind of key has its own folder:
  `radar/subscribers/abc.json`; see DEPLOYMENT.md, What is stored.)
- `list` maps the prefix the same way (`radar:sub:` → `radar/radar-sub-`), calls `@vercel/blob`'s `list` with that
  prefix, follows every page, and returns each blob's pathname with the prefix and `.json` removed.
- **Only use it for prefixes that end in `:` and keys whose suffix is letters, digits and `-`.** Then the suffix maps
  back to the key exactly (`prefix + suffix`). Throw if the prefix doesn't end in `:`, so a careless call can't list
  the whole store.
- Return suffixes sorted, so tests and callers are deterministic.

### `list(prefix)` in the test store

```js
list: async (prefix) => [...m.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)).sort(),
```

### `scripts/test-helpers.mjs`

Move `check`, `memStorage`, `mockRes` and the `failures` array out of `scripts/test-sweep.mjs` into a shared module.
Export a `finish(label)` that prints the summary and sets the exit code. `test-sweep.mjs` imports them; its output
and its 68 checks stay the same.

Create `scripts/test-subscriptions.mjs` with one placeholder check, and change `package.json`:

```json
"test": "node scripts/test-sweep.mjs && node scripts/test-subscriptions.mjs"
```

CI (`.github/workflows/check.yml`) already runs `npm test`, so it needs no change.

## Acceptance criteria

- [ ] `blobStorage().list("radar:sub:")` returns suffixes across more than one page of results
- [ ] `list("radar")` (no trailing `:`) throws
- [ ] The test store's `list` behaves the same way on the same keys
- [ ] `npm test` runs both files; the existing 68 checks still pass and print as before
- [ ] TECHNICAL.md's file table lists `scripts/test-helpers.mjs` and `scripts/test-subscriptions.mjs`

## Tests (in `test-subscriptions.mjs`)

- `list` on the memory store returns only keys under the prefix, sorted, as suffixes
- A key under a different prefix (`radar:sweep:1`) is not returned by `list("radar:sub:")`

`blobStorage().list` itself needs the real service, so it is checked once by hand against the production store
(read-only: list an existing prefix such as `radar:sweep:`) and the result noted in the pull request.

## Verify at build time

- `@vercel/blob` 2.8.2 `list()` options and return shape: `prefix`, `cursor`, `limit`, `hasMore`, and whether it
  works on a private store with the same credentials as `get`
- How `list` is billed on the Hobby plan (Vercel counts it as an "advanced operation"; check the monthly allowance).
  At about 5 sweeps a day with one list call each, plus admin script runs, usage should be small

## Out of scope

- Any caching of the list. Subscriber counts are small; read them fresh each sweep.
