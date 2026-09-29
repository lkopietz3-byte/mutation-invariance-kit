# mutation-invariance-kit

A small, zero-dependency TypeScript library for checking whether a decision,
score, or ranking function's output changes when you change an input it is
supposed to ignore.

You give it a real function, a realistic input, and a list of named mutations
("swap the applicant's name", "change the zip code", "raise this ad's price").
It runs the function on the original input and on each mutated input, and
reports every mutation that changed the output. If the output never changed,
you have evidence for the specific mutations you tried, not proof that the
function ignores that input. See [Honest limits](#honest-limits).

It returns plain data and never calls a test framework itself, so it works
with vitest, jest, `node:test`, or a plain script.

**When not to use it**

- To measure outcomes across a population (disparate impact, approval rates by
  group). This compares one input to its mutations; it does not do statistics.
- As a fairness certification or legal compliance evidence. It is a regression
  test, nothing more.
- On a function whose output varies between calls (clock, random numbers,
  shared counters) unless you fix those first. Nondeterminism shows up as
  failures.
- Directly on an async function. It is synchronous and throws if the function
  returns a Promise; see [Async functions](#async-functions) for the pattern.

## Install

```bash
npm install --save-dev mutation-invariance-kit
```

Or build from source: clone the repository and run `npm install && npm run build`.

Requires Node 20 or later. Ships as ESM; `require()` also works on Node
versions that support `require(esm)` (20.19+, 22.12+). No runtime
dependencies.

## Quickstart

```ts
import { assertInvariance } from "mutation-invariance-kit";
import { geographyScenarios } from "mutation-invariance-kit/presets";

interface Application {
  name: string;
  zip: string;
  income: number;
}

// The function under test: it should not care about zip code.
function scoreLoan(app: Application) {
  return { approved: app.income >= 40_000, rateBps: 900 - Math.round(app.income / 1000) };
}

const base: Application = { name: "Base Applicant", zip: "00000", income: 85_000 };

const scenarios = geographyScenarios<Application>(
  (app) => app.zip,
  (app, zip) => ({ ...app, zip }),
  ["02138", "90210"],
  { fieldLabel: "zip code" },
);

const result = assertInvariance(scoreLoan, base, scenarios);
console.log(result.passed); // true
console.log(result.baseline); // { approved: true, rateBps: 815 }
console.log(result.failures); // []
console.log(result.vacuous); // []
```

With vitest (or any runner), assert on the result:

```ts
import { expect, it } from "vitest";

it("the loan decision does not depend on zip code", () => {
  const result = assertInvariance(scoreLoan, base, scenarios);
  expect(result.vacuous).toEqual([]);
  expect(result.failures).toEqual([]);
});
```

## API

The package has two entry points. The root exports everything; the
`./presets` subpath exports only the three preset generators and their option
types (the same functions, not copies).

```ts
import { assertInvariance, deepEqual } from "mutation-invariance-kit";
import { protectedAttributeScenarios, geographyScenarios, priceScenarios } from "mutation-invariance-kit/presets";
```

### `assertInvariance(fn, baseInput, scenarios, opts?)`

```ts
function assertInvariance<Input, Output>(
  fn: (input: Input) => Output,
  baseInput: Input,
  scenarios: MutationScenario<Input>[],
  opts?: AssertInvarianceOptions<Input, Output>,
): InvarianceResult<Input, Output>;
```

Runs `fn(baseInput)` once for the baseline, then for each scenario in order
calls `mutate(baseInput)` once and, if the mutation changed the input, runs
`fn` on the mutated input and compares the output to the baseline.

Returns `{ passed, baseline, failures, vacuous }`:

- `passed` is `true` only when there are no failures and no vacuous
  scenarios.
- `baseline` is the value `fn` returned for `baseInput` (the same object).
- `failures` lists each scenario whose output differed:
  `{ scenario, category?, mutatedInput, expected, actual }`.
- `vacuous` lists the names of scenarios whose `mutate` did not change the
  input. `fn` is not re-run for them. A vacuous scenario tested nothing, so it
  makes `passed` false.

Options:

- `isEqual(expected, actual)` compares outputs. Defaults to `deepEqual`. Use
  it to ignore fields (timestamps, generated ids) or to allow a tolerance.
  Must return a boolean.
- `hasChanged(baseInput, mutatedInput)` decides whether a mutation changed
  anything. Defaults to `!deepEqual(baseInput, mutatedInput)`, a whole-object
  comparison, so a change to an unrelated field also counts. Pass your own to
  check only the field you meant to change. Must return a boolean.
- `cleanup()` runs after every `fn` call, even when `fn` throws. Only needed
  when `fn` touches external state that must be reset between calls. Must be
  synchronous.

It throws instead of returning a result when the run cannot be trusted:

| Situation | What happens |
| --- | --- |
| `scenarios` is not an array, is empty, or has an entry without a string `name` and a `mutate` function; `fn` is not a function | `TypeError` or `Error` before `fn` runs |
| `fn` throws (baseline or mutated input) | `Error` naming the scenario, original error as `cause`. Never counted as "no difference". |
| `mutate` throws | `Error` naming the scenario, original error as `cause` |
| `fn` or `mutate` returns a Promise | `TypeError` |
| `isEqual` or `hasChanged` returns a non-boolean; `cleanup` returns a Promise | `TypeError` |
| `cleanup` throws | `Error`; if `fn` also threw, `fn`'s error is thrown and mentions the cleanup failure |
| `fn` or `mutate` modified `baseInput` in place | `Error` naming who did it |
| a later `fn` call modified the object `fn` returned for the baseline | `Error` naming the scenario |

In-place changes are found by comparing against a deep copy taken before the
first call. The copy covers plain objects, class instances, arrays, `Map`,
`Set`, `Date`, `RegExp`, `ArrayBuffer`, and typed arrays. Changes inside values
it keeps by reference (functions, `Error`, `Promise`, private `#fields`, and
other opaque objects) are not detected.

The library never writes to `baseInput` or to anything `fn` returns, and never
clones the values it passes to your code. It uses no randomness and no clock.

### `deepEqual(a, b)`

The default comparator, exported for use in your own `isEqual` or
`hasChanged`. It fails closed: when it cannot show two values are equal, it
says they are different.

- Primitives use `Object.is`: `NaN` equals `NaN`; `0` and `-0` are different;
  no floating-point tolerance (`0.1 + 0.2` is not `0.3`).
- Objects must have the same prototype (a class instance never equals a plain
  object). Own enumerable string and symbol keys are compared. Non-enumerable
  properties and private `#fields` are not, except an `Error`'s `name`,
  `message`, `cause`, and `errors`.
- Arrays compare length, elements and extra keys; a hole is not `undefined`.
- `Map`, `Set`, `Date` (invalid dates equal each other), `RegExp`, boxed
  primitives, `ArrayBuffer`, `DataView`, and typed arrays compare by content.
  Object `Set` members and `Map` keys are matched by structure, one-to-one;
  that matching is quadratic in the number of object members.
- Circular references are handled.
- Functions, `Promise`, `WeakMap`, `WeakSet`, `URL`, and any object that sets
  its own `Symbol.toStringTag` without being one of the built-ins above (some
  decimal and date libraries do) are equal only to themselves. Compare those
  with a custom `isEqual`.

### Presets

Three generators that turn a getter, a setter, and a list of values into
`MutationScenario[]`. You write the accessors; the kit never parses a
field-path string, so there is no path syntax to get wrong and no key from your
data is used to write into an object.

```ts
function protectedAttributeScenarios<Input>(
  get: (input: Input) => string,
  set: (input: Input, value: string) => Input,
  substitutionValues: string[],
  opts?: { fieldLabel?: string }, // default "protected attribute"
): MutationScenario<Input>[];

function geographyScenarios<Input>(/* same, string values */): MutationScenario<Input>[]; // default label "geography"
function priceScenarios<Input>(/* same, number values */): MutationScenario<Input>[]; // default label "price"
```

- One scenario per value, named `<fieldLabel> -> <value>`. String values are
  JSON-quoted (`zip code -> "02138"`); prices use `String(value)`, except `-0`
  is written `-0`.
- `category` is set to `"protected-attribute"`, `"geography"`, or `"price"`.
- Each `mutate` checks that `get(set(input, value))` is the same value
  (`Object.is`) and throws otherwise, which catches a getter and setter that
  touch different fields, or a setter that rounds or clamps.
- `set` must return a new input. A setter that writes into its argument makes
  `assertInvariance` throw.
- A value equal to the input's current value produces a vacuous scenario.
- An empty value list returns `[]` (and `assertInvariance` refuses to run with
  no scenarios).
- Throws a `TypeError` if `get` or `set` is not a function, or a value has the
  wrong type (geography and protected-attribute values must be strings, so a
  zip's leading zero is kept; prices must be numbers, and any number is
  accepted, including `NaN` and `Infinity`).

The kit ships no default values. Choosing names, zip codes, or prices that are
genuinely adversarial for your domain is your job.

For a field inside an array, address the item by id, not by position:

```ts
const get = (input: RankInput) => input.candidates.find((c) => c.id === targetId)!.price;
const set = (input: RankInput, price: number): RankInput => ({
  candidates: input.candidates.map((c) => (c.id === targetId ? { ...c, price } : c)),
});
```

`examples/toy-ad-delivery.test.ts` has the full version.

### Types

```ts
type ScenarioCategory = "protected-attribute" | "geography" | "price" | "payout" | "custom";

interface MutationScenario<Input> {
  name: string;
  mutate: (input: Input) => Input; // synchronous; must return a new value
  category?: ScenarioCategory; // informational only; copied onto failures
}

interface InvarianceFailure<Input, Output> {
  scenario: string;
  category?: ScenarioCategory;
  mutatedInput: Input;
  expected: Output; // the baseline
  actual: Output;
}

interface InvarianceResult<Input, Output> {
  passed: boolean;
  baseline: Output;
  failures: InvarianceFailure<Input, Output>[];
  vacuous: string[];
}
```

Also exported as types: `AssertInvarianceOptions`,
`ProtectedAttributeScenariosOptions`, `GeographyScenariosOptions`, and
`PriceScenariosOptions` (each `{ fieldLabel?: string }`).

### Async functions

`assertInvariance` is synchronous, and there is no general async version.
The recipe below covers one narrow shape: an async scorer that resolves to a
number, on plain-data input. It keeps the library's guards where they
matter:

- `assertInvariance` itself validates the scenarios, runs each `mutate`
  once, rejects an in-place edit or a Promise from `mutate`, and flags
  vacuous scenarios, all before the scorer is awaited even once.
- The scorer must resolve to a number. A number cannot be edited or reused
  later, so a scorer that keeps returning one shared object is rejected
  instead of making every result look the same.
- A copy of `baseInput` taken before the first call catches a scorer that
  edits it in place.

What it does not do: it does not support other output types (score to a
number, or adapt the recipe with an immediate copy of your output), it does
not accept inputs `structuredClone` cannot copy faithfully (class instances,
functions), it awaits calls one at a time, and a rejected call propagates
as-is without naming the scenario. It cannot see side effects outside
`baseInput` (a cache, a database row).

```ts
import { assertInvariance, deepEqual } from "mutation-invariance-kit";
import type { InvarianceResult, MutationScenario } from "mutation-invariance-kit";

/**
 * Check an async scorer that resolves to a number.
 *
 * Limits: `baseInput` must be structured-clonable plain data (objects,
 * arrays, strings, numbers, booleans, null); the scorer must resolve to a
 * number; calls are awaited one at a time; a rejected call propagates as-is.
 */
async function assertAsyncScoreInvariance<Input>(
  score: (input: Input) => Promise<number>,
  baseInput: Input,
  scenarios: MutationScenario<Input>[],
): Promise<InvarianceResult<Input, number>> {
  // A copy taken before any call, to catch a scorer that edits baseInput.
  const pristine = structuredClone(baseInput);

  // Synchronous pass: assertInvariance validates the scenarios, runs each
  // mutate once, rejects in-place edits and Promises from mutate, and flags
  // vacuous scenarios. Each call returns a distinct number, so every
  // non-vacuous scenario comes back as a "failure" carrying its input.
  let calls = 0;
  const plan = assertInvariance(() => calls++, baseInput, scenarios);

  // Async pass: await one call at a time. A number cannot be edited or
  // reused later, so what is recorded is what the scorer returned.
  const scoreOf = async (input: Input): Promise<number> => {
    const value: unknown = await score(input);
    if (typeof value !== "number") throw new TypeError("score must resolve to a number.");
    return value;
  };

  const baseline = await scoreOf(baseInput);
  const failures: InvarianceResult<Input, number>["failures"] = [];
  for (const { scenario, category, mutatedInput } of plan.failures) {
    const actual = await scoreOf(mutatedInput);
    if (!Object.is(actual, baseline)) failures.push({ scenario, category, mutatedInput, expected: baseline, actual });
  }
  if (!deepEqual(pristine, baseInput)) throw new Error("score modified baseInput in place.");

  return { passed: failures.length === 0 && plan.vacuous.length === 0, baseline, failures, vacuous: plan.vacuous };
}
```

`examples/async-scoring.test.ts` runs this exact code (a test checks that the
README copy matches) against an honest scorer, a biased one, one that returns
a shared object, and ones that edit `baseInput`.

### Randomness

The kit has no randomized mutations. If your function or your `mutate`
closures need randomness, create a seeded generator inside the call (or pass a
fixed clock), so the same input always gives the same output. A generator
shared across calls produces a different value each time, and that shows up as
a failure.

## Runnable examples

`examples/` holds three self-contained files with fictional data. They run as
part of `npm test`.

- `toy-loan-scoring.test.ts`: applicant name and zip code, including a
  zip-biased engine the check catches.
- `toy-ad-delivery.test.ts`: price, with a margin-favoring engine and the
  array-item getter/setter pattern.
- `async-scoring.test.ts`: the async recipe above.

## Honest limits

- **A pass covers only the mutations you ran.** It says nothing about values
  you did not try (a threshold none of your values crossed), fields you
  changed one at a time but never together, or proxy fields you never touched
  (a zip code standing in for race, a graduation year for age).
- **It checks one function call per input.** It does not see upstream data
  that already encodes the attribute (a "quality score" computed from it),
  code paths your inputs never reach, or effects that only appear in
  aggregate.
- **The default comparison is strict.** `0` and `-0` differ, there is no
  floating-point tolerance, and opaque objects are equal only to themselves.
  That can produce failures you need to handle with `isEqual`; it should not
  produce false passes, but a custom `isEqual` or `hasChanged` can.
- **In-place change detection has blind spots:** values kept by reference
  (functions, `Error`, `Promise`, private fields) are not deep-copied.
- **It trusts your getters and setters.** The preset check confirms the value
  landed where `get` reads it; it cannot tell whether `get` reads the field you
  meant.
- **Cost:** every run deep-copies `baseInput` and the baseline output and
  compares them after each call. Performance has not been benchmarked.
- **It is a regression test, not an audit.** Re-run it in CI whenever the
  function changes, and use it alongside domain expertise, not instead of it.

## Relationship to payout-invariance-kit

[`payout-invariance-kit`](https://github.com/lkopietz3-byte/payout-invariance-kit)
applies the same idea to one axis: whether a ranking depends on which option
pays the operator more. It also has a static check, `assertNoPayoutImports`.
Use it for that axis; use this kit for any other "should not depend on X"
claim. The scenario shape (`name` plus `mutate`) is the same in both. The two
packages share no code.

## License

MIT
