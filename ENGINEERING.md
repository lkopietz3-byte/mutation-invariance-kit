# Engineering contract

## Invariants

1. `assertInvariance` returns `passed: true` only if every scenario changed the
   input and every changed input produced an output equal to the baseline.
2. A run that cannot be trusted throws instead of returning a result: empty or
   malformed scenarios, `fn`/`mutate` throwing or returning a Promise,
   non-boolean comparator results, an async `cleanup`, or in-place changes to
   `baseInput` or the baseline output.
3. The library never writes to caller values and uses no randomness or clock.
4. `deepEqual` fails closed: values it cannot inspect are equal only to
   themselves. Built-ins are recognized by brand checks, not
   `Symbol.toStringTag`.
5. No path-string parsing; no caller-supplied key is used to write into an
   object. The internal snapshot writes keys with `Object.defineProperty`.
6. Zero runtime dependencies (`dependencies` stays empty).

## Setup and verification

```bash
npm ci
npm run verify   # lint, typecheck, test, build, verify:package
npm audit --include=dev
```

`verify:package` packs the tarball, installs it into a temp project offline,
checks the file list and `api-surface.json`, runs `scripts/consumer-probe.mjs`
(imports both entry points by name), and compiles `scripts/consumer-probe.mts`
under strict NodeNext.

Tests live next to the code (`src/*.test.ts`) and in `examples/`. Every bug
fix has a regression test that failed on the code before the fix.

`deepEqual` was differentially fuzzed against `node:util`'s
`isDeepStrictEqual` (about 1.4M seeded pairs, no disagreements). The fuzz
script is not in the repo; the generator did not include objects with a custom
`Symbol.toStringTag`, where this kit is deliberately stricter than Node.

## Not certified

- A pass is evidence for the scenarios run, not proof of independence.
- Not a fairness audit, legal compliance evidence, or a security control.
- Performance is not benchmarked. Each run deep-copies `baseInput` and the
  baseline output; object `Set`/`Map` matching in `deepEqual` is quadratic.
- In-place change detection does not see inside values kept by reference
  (functions, `Error`, `Promise`, private fields).

## Release and rollback

- Version `0.1.0`, never published. Install is from GitHub until published.
- Before a release: `npm ci && npm run verify` (CI also runs build, test, and
  `verify:package` on Node 20, 22, and 24), update `CHANGELOG.md`, and review
  any `api-surface.json` diff.
- Rollback: this is a dev-time library with no stored state. Pin consumers to
  the previous git tag or version.
