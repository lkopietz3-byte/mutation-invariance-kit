# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-27

First release. Not yet published to npm.

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
