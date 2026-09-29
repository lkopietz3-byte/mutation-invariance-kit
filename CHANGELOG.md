# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-09-29

Some inputs that 0.1.1 accepted now throw, and some comparisons now give a
different (stricter) answer, so this is a minor release.

### Fixed

- `scenarios` was validated with `forEach` and run with a spread copy: an
  overridden `Symbol.iterator` ran zero mutations and passed, and a sparse
  array ran `fn` before failing (MIK-F004). It is now validated with one
  indexed pass (holes rejected), each `name`, `mutate` and `category` is
  read once, and the run uses only that snapshot.
- `ArrayBuffer`, `SharedArrayBuffer` and `DataView` compared only bytes, so
  a `score` property attached to one was ignored (MIK-F001). They now
  compare their own enumerable properties, like every other kind.
- `deepEqual` recognized built-ins by `Symbol.toStringTag` first and read
  content through overridable methods, so a masked `Map`, a `Date` subclass
  whose `getTime` returns 0, or a `Number` subclass whose `valueOf` returns
  0 hid a real difference (MIK-F002). Built-ins are now recognized by
  intrinsic brand checks and read through intrinsics. A value that
  inherits from a built-in prototype without its brand (a `Proxy` around a
  `Map`), and a built-in's prototype object itself, are not comparable.
- The internal snapshot dropped typed-array metadata that `deepEqual`
  compared, so a pure function reading a `Uint8Array` with a `label` was
  accused of modifying its input (MIK-F003). It now keeps it (and
  `ArrayBuffer` metadata).
- An `arguments` object no longer equals a plain object with the same
  entries.
- `cleanup` was read from `opts` on every call; it is read once.
- Error messages escape scenario names, preset labels and thrown messages
  (newlines, control and bidi characters). A thrown value or getter result
  that cannot be printed (a BigInt in `JSON.stringify`, a null-prototype
  object) no longer replaces the intended error.
- Presets rejected nothing when `substitutionValues` had a hole (`map`
  skipped it); a hole is now a `TypeError`.

### Changed

- `assertInvariance` throws a `TypeError` when `opts` is not a plain object
  or a hook is not a function, before `fn` runs.
- The presets throw a `TypeError` when `opts` is not a plain object or
  `fieldLabel` is not a non-blank string.
- In error messages, a scenario name is quoted with its own quotes escaped
  (`scenario "zip -> \"02138\""`).
- The README async recipe is narrowed to a tested scorer that resolves to a
  number. The old helper ran every call before the library took its
  snapshots, so a scorer returning one shared object passed (MIK-F005).
- `package.json` adds `typesVersions` for `/presets`, and `attw` runs
  without `--profile node16`. Release workflow: runs only on a matching
  `v*` tag for both triggers, runs the dependency audit, verify and attw,
  and treats only a confirmed E404 as "not published" (MIK-F006). CI adds
  Node 20.19.0 and 22.12.0 compatibility jobs.

### Added

- A differential fuzz test against `node:util`'s `isDeepStrictEqual` (test
  only; the library does not import `node:util`), a runtime-portability
  test, and an ESM/CommonJS compatibility table in the README.

## [0.1.1] - 2026-09-27

### Added

- CommonJS `require()` support: a `"default"` condition next to `"import"`
  on every `exports` entry (root and `./presets`), pointing at the same
  built file. Proven against the packed tarball with `require()` on Node
  26.3.0, and guarded in CI on Node 20, 22, and 24 by an extended
  `scripts/verify-package.mjs`.

### Fixed

- Shipped `.js.map` files now inline the original TypeScript source
  (`inlineSources` in `tsconfig.build.json`), so they resolve without the
  unshipped `src/` directory. `.d.ts.map` generation is now disabled instead
  of shipping a source map with an unresolvable `../src/*.ts` path; the
  `.d.ts` declaration files themselves are unaffected.

### Changed

- README: replaced "ESM only" with an accurate statement that `require()`
  also works on Node versions that support `require(esm)`.

## [0.1.0] - 2026-09-27

First release.

### Added

- `assertInvariance(fn, baseInput, scenarios, opts?)`: runs `fn` on a base
  input and on each mutated input, and returns
  `{ passed, baseline, failures, vacuous }`. A mutation that changes nothing is
  reported as vacuous and makes `passed` false. Options: `isEqual`,
  `hasChanged`, `cleanup`.
- `deepEqual(a, b)`: the default structural comparator. Fails closed; handles
  `Map`, `Set`, `Date`, `RegExp`, `Error`, typed arrays, buffers, boxed
  primitives, array holes, symbol keys, prototypes, and circular references.
- Presets `protectedAttributeScenarios`, `geographyScenarios`, and
  `priceScenarios`, available from the root and from the
  `mutation-invariance-kit/presets` subpath.
- Examples for loan scoring, ad ranking, and checking an async function.

### Behavior worth knowing before upgrading from a pre-release copy

Earlier unreleased copies of this code returned `passed: true` in cases where
nothing was really compared. These now throw instead:

- `fn` or `mutate` returns a Promise (async functions were compared as two
  equal Promises).
- The scenario list is empty.
- `isEqual` or `hasChanged` returns a non-boolean, or `cleanup` returns a
  Promise.
- `fn` or `mutate` modifies `baseInput` in place, or a later `fn` call modifies
  the baseline output.
- Invalid `scenarios` entries, and preset values of the wrong type.

Errors thrown by `fn` or `mutate` are now rethrown with the scenario name and
the original error as `cause`. `deepEqual` no longer treats array holes,
different `Error` messages, different buffer bytes, or Sets with duplicate
object members as equal. `priceScenarios` now names `-0` as `-0`.
