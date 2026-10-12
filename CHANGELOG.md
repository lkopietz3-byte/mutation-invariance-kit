# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - unreleased

### Breaking changes

Code that passed on 0.2.1 can now throw or report differently. Each item has a one-line fix.

- `assertInvariance` now throws when `fn` edits a mutated input in place (for example `fn` sorts its argument and the scenario's `mutate` returned a fresh, out-of-order array). 0.2.1 only checked `baseInput`, so a function that sorts in place passed whenever the base example was already in order. Migration: copy before sorting or editing (`[...list].sort()`), as you already do for `baseInput`.
- The in-place checks (on `baseInput`, on mutated inputs and on the baseline output) are now order-sensitive, so an `fn` or `mutate` that reorders a `Map`, `Set` or object in place throws; before, that went unnoticed. Migration: do not reorder the argument in place; copy it first.
- `deepEqual` no longer treats a `RangeError` raised while classifying a value as "not comparable"; it throws. `assertInvariance` rethrows it as an error that names the scenario. Migration: flatten very deep nesting, or pass your own `isEqual` and `hasChanged`.
- Scenarios that share a name are renamed `name (2)`, `name (3)` and so on in `failures`, `vacuous` and error messages (the first keeps its name). Migration: if you match on a scenario name from a repeated preset value, match on the suffixed name or give the scenarios distinct names.
- Two verdicts that were wrong now change: two identical chains about 5,000 levels deep now compare equal (they compared different), and a Proxy array that hides an extra key no longer compares equal to an array without it. Migration: none unless you relied on the old wrong answer.
- The message for a failing `cleanup()` now reads "threw after fn ran on the baseline input". Migration: update any test that matches the old text.

### Added

- Edits that `fn` makes to a mutated input are now detected (see Breaking changes). Each mutated input is deep-copied just before `fn` runs on it and compared afterward. The run costs roughly one extra copy and comparison per non-vacuous scenario.
- `orderSensitive` option (default `false`) on `assertInvariance` and `deepEqual(a, b, options?)`, and the exported type `DeepEqualOptions`. With it, `Map` entry order, `Set` member order and object key order count. The default comparison still ignores that order, so a ranking returned as a `Map`, `Set` or keyed object that reorders after a mutation passes unless you pass `orderSensitive: true` or return an array.

### Fixed

- A rejecting Promise returned by `fn`, `mutate` or `cleanup` (or by `isEqual` or `hasChanged`) ended the Node process with an unhandled rejection even though `assertInvariance` threw its documented `TypeError`. The refused Promise now gets a no-op rejection handler first.
- Deeply nested values: two identical chains about 5,000 levels deep compared as different, because a stack overflow while classifying a value was read as "not comparable"; around 10,000 levels a raw `RangeError` escaped with no scenario named. `deepEqual` and the internal copy now walk objects, arrays, `Map` values, `Error` causes and (with `orderSensitive`) `Map`/`Set` members with an explicit work list, so depth is limited by memory. A stack overflow is never read as "different": where recursion remains (object-keyed `Set` members and `Map` keys matched without `orderSensitive`), `deepEqual` throws the `RangeError` and `assertInvariance` rethrows it as an error that names the scenario.
- Comparing and copying large arrays and typed arrays was slow because every element went through a per-key path. Arrays and typed arrays with no extra keys now take a fast path with identical results (holes, non-enumerable elements, extra named keys and symbols still compare exactly as before). Measured CPU time for a 1,000,000 element `Float64Array` run through `assertInvariance`: about 0.9 s before, 0.45 s after; for a 1,000,000 number array, 2.0 to 2.6 s before, 1.1 s after (comparing two such arrays alone is unchanged at about 0.25 s; comparing many small objects is about 30 percent slower). The fast paths read each element once by index and never evaluate a getter just to count keys, so an array or typed array with a getter-valued extra key (such as a `label`) is compared with each getter run once, as before.
- A refused thenable's own `then()` is no longer called to detach it (an `async then() { throw ... }` made a new rejecting Promise that ended the process). Only a genuine Promise (any subclass) is detached, with the built-in `Promise.prototype.then`.
- An accessor on `Array.prototype` (a setter that discards writes) could swallow elements while a clean array was read for comparison or copying. Elements are now created as own data properties.
- Renaming many scenarios that share one name was quadratic (8,000 repeats took about 7 s); it is now linear.
- Lists the package builds and then reads back to reach a verdict (the work queue, the visited-pair journal, key lists, Map and Set entries, matching candidates, the copy's pending list, and the `failures`, `vacuous` and preset scenario lists) no longer go through `push` or index assignment. An accessor an outside script put on `Array.prototype` (a setter that discards writes) could otherwise drop an entry and change a verdict, for example make two arrays of objects that differ compare equal. They now use linked stacks or own data properties.
- Rewriting built-ins after import could change a verdict: an empty generator at `Object.prototype[Symbol.iterator]` made `Array.from` return no elements (so `deepEqual([1], [2])` was true), a replaced `Object.prototype.propertyIsEnumerable` made a sparse array with an extra key look clean, and an always-true `Set.prototype.has` made scenario renaming loop forever. The comparison, the copy and the run loop now use built-ins saved at import, avoid the iteration protocol and `Array.prototype` methods, and keep scenario names in null-prototype dictionaries. The README (Honest limits, "Built-ins and tampering") lists what is saved and what is out of scope.
- The array fast path trusted a Proxy: one that left out an element key and listed an extra key in its place (same key count) had the extra key dropped from the comparison and the copy, so arrays with different extra keys compared equal. The listed keys must now be exactly the element indices, otherwise the key-by-key path is used.
- Map entries were read with array destructuring, which uses `Array.prototype[Symbol.iterator]`; with that rewritten, ordered Maps with different values could compare equal. Entry elements are now read by index (every other destructuring on a verdict path was already gone; a grep of the four source files for destructuring, spread and `for...of` finds only import-time code).
- Classifying an exception thrown by a Proxy whose `getPrototypeOf` returns itself looped forever. The prototype walk is now bounded, and the value is reported as not comparable.
- Copying a `Map` or `Set` in the input used the value's own `set` and `add`, so one with a null or replaced prototype threw and a subclass override ran during the copy (a read-only subclass threw). The copy is now filled with the built-in operations.
- Comparing or copying a typed array with very many named keys, or an object-keyed `Set` nested inside another `Set` with a very large journal of compared pairs (for example `Set(Set(array of 150,000 objects))`), threw a `RangeError` from spreading a huge list into one call. Lists are now appended in a loop.
- The message for a failing `cleanup()` read "threw after on the baseline input"; it now reads "threw after fn ran on the baseline input".
- Scenarios that share a name (for example a preset given a repeated value) were indistinguishable in `failures`, `vacuous` and error messages. Later duplicates are now named `name (2)`, `name (3)` and so on.

### Changed

- The checks for in-place edits (to `baseInput` and to the baseline output) are now always order-sensitive, so an `fn` or `mutate` that reorders a `Map`, `Set` or object it was given in place is reported. Before, that reorder went unnoticed.
- With `orderSensitive: true`, the default `hasChanged` also treats a mutation that only reorders a `Map`, `Set` or object as a change, not a vacuous scenario.
- `deepEqual` no longer reads a `RangeError` raised while classifying a value as "not comparable"; it propagates.
- Duplicate scenario names are renamed as described under Fixed (the first keeps its name).

### Documented

- Honest limits now say that the mutated-input check needs `fn` to run on the input (a vacuous scenario's input is never passed to `fn`), has the same by-reference blind spots as the `baseInput` check, and is not part of the README's async recipe, which checks `baseInput` only.
- The README opens with who the kit is for.
- Honest limits now say that the default comparison ignores the order of `Map` entries, `Set` members and object keys, and what to do about it.
- A mutation that rebuilds an opaque value (a class with a `Symbol.toStringTag`, a `URL`) unchanged still looks like a change to the default `hasChanged`, so it is not reported as vacuous. Use a custom `hasChanged`.
- A change made in place to a non-enumerable property is not detected, because the comparison reads enumerable properties only. The README no longer implies that every in-place change throws.
- The Cost note has measured numbers for large arrays and typed arrays.

## [0.2.1] - 2026-10-07

No change to the library's behavior or API.

### Changed

- The README links to the [in-browser playground](https://lkopietz3-byte.github.io/honesty-kits/#mutation-invariance-kit) and the honesty kits family, and the npm homepage now points to the playground.
- Added the `honesty-kits` npm keyword so the family shows up together in search.

### Security

- Development lockfile: `source-map-js` 1.2.2 (GHSA-68fv-2mgg-jv7q). Development tooling only; the published package has no runtime dependencies.

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
- `deepEqual` compared a value that looks like a built-in but fails its
  brand check as an ordinary object when the resemblance came from another
  realm or was hidden. From another realm (a `node:vm` context): a `Proxy`
  around a `Date`, `Number`, `Boolean`, `String` or `RegExp`,
  `Object.create()` of its `Date.prototype`, or an old-style subclass whose
  instances never got the internal slot. From any realm: a `Proxy` whose
  `getPrototypeOf` trap hides a `Date`, or a `Proxy` that answers
  `Symbol.toStringTag`. So another realm's `new Proxy(new Date(1), {})`
  equaled `new Proxy(new Date(2), {})`. Such values are now not comparable
  (equal only to themselves). A built-in is recognized from any realm by
  its native constructor's name; a user class merely named `Map` is still
  an ordinary class. An `Error`-like value from any realm, including a
  `Proxy` around one, is compared as an `Error` by `name`, `message`,
  `cause` and `errors`.
- The error thrown when `fn` returns a Promise now says that each Promise
  is equal only to itself, instead of only "would compare promises".

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
- README "Honest limits" no longer says the default comparison "should not
  produce false passes". It lists the known false passes (private
  `#fields`, with the fix: an `isEqual` that compares the getters, or plain
  data; one shared `Error`, `DataView` or boxed primitive returned and
  edited on every call; values it cannot see into that still look
  ordinary) and how to avoid them.

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
