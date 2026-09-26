# mutation-invariance-kit

A small, zero-dependency, framework-agnostic TypeScript library for testing
whether a decision, score, or ranking function's output changes when a
claimed-irrelevant input changes. It runs as an automated test, not a written
policy.

The mechanism is simple: take a real input, mutate one thing you claim
doesn't matter (a name, a zip code, a price, anything), re-run the real
function, and diff the output against the unmutated baseline. If the output
changes, the function depends on that input for this scenario. If it doesn't,
the result is evidence only for the specific mutation you tried (see "Limits"
below).

This is the same mechanism as
[`payout-invariance-kit`](https://github.com/lkopietz3-byte/payout-invariance-kit)'s
`assertPayoutInvariance`, generalized. **payout-invariance-kit is the
sharpest, most specific instance of this pattern, kept as its own focused
package on purpose** — if what you need is to test whether payout changes
affect your rankings in specified scenarios, use that package; it has a
tighter pitch and a companion static check (`assertNoPayoutImports`) built
around that one axis. **Use this package when you need the general
mechanism for an axis payout-invariance-kit doesn't cover** — a protected
attribute, geography, price, or something specific to your own domain.

## Why this exists

Comparison sites, lenders, insurers, hiring tools, and ad platforms
routinely say some version of "our algorithm doesn't take X into account."
Usually that's a sentence in a policy document, not something checked by
CI. This library makes part of that claim testable: if the output changes
under one of your configured mutations, the test fails. A passing result is
evidence for those scenarios, not proof of broader independence from X.

The library tests the scenarios you specify. It does not establish legal
compliance, a complete fairness audit, or whether a product is suitable for a
regulated decision. Those questions require domain-specific review and tests
beyond this package.

## Install

```bash
npm install --save-dev mutation-invariance-kit vitest
```

Zero runtime dependencies — `dependencies: {}` in package.json.

## The core insight, in code

```ts
import { assertInvariance } from "mutation-invariance-kit";

const result = assertInvariance(
  scoreLoan, // your real function: Input -> Output
  baseApplication, // a real (or realistic) input
  [
    {
      name: "applicant name -> a different name",
      mutate: (app) => ({ ...app, applicantName: "Someone Else" }),
    },
  ],
);

// result: { passed, baseline, failures, vacuous }
```

`assertInvariance` re-runs `scoreLoan` once per named mutation scenario and
compares each result to the unmutated baseline. It is completely
domain-agnostic: it has no idea what "applicant name" means, what a payout
is, or what a zip code is. All of that domain knowledge lives in the
`mutate` function you (or a preset — see below) supply.

## API

### `assertInvariance(fn, baseInput, scenarios, opts?)`

```ts
function assertInvariance<Input, Output>(
  fn: (input: Input) => Output,
  baseInput: Input,
  scenarios: MutationScenario<Input>[],
  opts?: AssertInvarianceOptions<Input, Output>,
): InvarianceResult<Input, Output>;
```

- **`fn`** — the real function under test. Must be pure (same input, same
  output) unless it touches external state you reset via `opts.cleanup`.
- **`baseInput`** — a real or realistic input.
- **`scenarios`** — `MutationScenario<Input>[]`, each `{ name, mutate,
category? }`. `mutate` takes the base input and returns a mutated one.
- **`opts.isEqual`** — custom output comparator. Defaults to a
  dependency-free structural deep-equal (`deepEqual`, also exported).
- **`opts.hasChanged`** — custom precondition check ("did this mutation
  actually change anything"). Defaults to "the mutated input isn't
  deep-equal to the base input" — a whole-object comparison, not
  field-path introspection.
- **`opts.cleanup`** — optional hook called after every call to `fn` (the
  baseline call and each non-vacuous scenario), inside a `finally` block.
  Only needed if `fn` touches external state (a cache, a DB row, a
  module-level counter) that must be reset between runs for the comparison
  to mean anything. Pure functions never need this.

Returns a plain object, never calls a test framework's `expect()` itself:

```ts
interface InvarianceResult<Input, Output> {
  passed: boolean; // true only if zero failures AND zero vacuous scenarios
  baseline: Output;
  failures: InvarianceFailure<Input, Output>[]; // scenario, mutatedInput, expected, actual
  vacuous: string[]; // names of scenarios whose mutate() changed nothing
}
```

A scenario whose `mutate()` didn't actually change the input relative to
`baseInput` is flagged in `vacuous`, not silently counted as a pass — a
mutation that changes nothing proves nothing about the function's
sensitivity to that field. `passed` is `true` only when `failures` and
`vacuous` are both empty.

**vitest adapter** — the library returns data, so wiring it in is one line:

```ts
import { describe, expect, it } from "vitest";
import { assertInvariance } from "mutation-invariance-kit";

it("the decision is invariant to applicant name", () => {
  const result = assertInvariance(scoreLoan, baseApplication, scenarios);
  expect(result.vacuous, `vacuous: ${result.vacuous.join(", ")}`).toEqual([]);
  expect(result.failures).toEqual([]);
});
```

(Same pattern for jest / `node:test` / plain `assert` — swap `expect` for
whatever your framework provides.)

### Presets

Three ready-made scenario generators for the axes called out in this
library's brief, each built the same way: **you** write a trivial
getter/setter closure pair for the field under test, and the preset turns a
list of substitution values into `MutationScenario[]`.

```ts
import { protectedAttributeScenarios, geographyScenarios, priceScenarios } from "mutation-invariance-kit";
```

- **`protectedAttributeScenarios(get, set, substitutionValues, opts?)`** —
  does a decision/score/ranking change when a name, an inferred-ethnicity
  signal, a gender-coded name, or an age-coded detail changes? Relevant to
  hiring, lending, insurance, and housing algorithms.
- **`geographyScenarios(get, set, substitutionValues, opts?)`** — does the
  same input get a different/worse result purely because of a zip code or
  region? Relevant to insurance pricing, loan terms, ad delivery, service
  availability. `substitutionValues` are strings (not numbers) so a zip
  code's leading zero survives.
- **`priceScenarios(get, set, substitutionValues, opts?)`** — does a
  recommendation/ranking silently favor a higher-price/higher-margin
  option when quality/fit signals are held equal?

Every preset has the same shape:

```ts
function protectedAttributeScenarios<Input>(
  get: (input: Input) => string,
  set: (input: Input, value: string) => Input,
  substitutionValues: string[],
  opts?: { fieldLabel?: string },
): MutationScenario<Input>[];
```

(`geographyScenarios` is identical but string-typed for the same reason;
`priceScenarios` is the numeric equivalent.) `opts.fieldLabel` only affects
generated scenario names — it has no effect on behavior.

```ts
const scenarios = protectedAttributeScenarios<LoanApplication>(
  (app) => app.applicantName,
  (app, value) => ({ ...app, applicantName: value }),
  ["Jordan Smith", "Wei Chen", "Aisha Osei", "Maria Garcia-Lopez", "Connor O'Brien"],
  { fieldLabel: "applicant name" },
);

const result = assertInvariance(scoreLoan, baseApplication, scenarios);
```

Each generated scenario's `mutate` also runs a small runtime sanity check —
it confirms `get(set(input, value)) === value` — and throws a clear error
if it doesn't, so a copy-paste bug in your getter/setter closures fails
loudly instead of silently producing a misleading (or vacuous) result.

#### Why getters/setters, not path strings

An earlier attempt at a library like this tried to support a generic
"get/set by path string" utility (e.g. `"ads[2].price"`) so callers
wouldn't have to write their own accessors — and got tangled in bracket-index
parsing edge cases badly enough that it never shipped. This library doesn't
try: `get`/`set` are just plain functions you write. For a field on the
input's top level, that's one line:

```ts
(input) => input.applicantName;
(input, v) => ({ ...input, applicantName: v });
```

For a field on one item inside an array (e.g. "this candidate's price"),
it's still just a function — find/map, addressed by id, not by a parsed
path:

```ts
const get = (input: RankInput) => input.candidates.find((c) => c.id === targetId)!.price;
const set = (input: RankInput, value: number): RankInput => ({
  candidates: input.candidates.map((c) => (c.id === targetId ? { ...c, price: value } : c)),
});
```

This keeps the core (and every preset) fully generic and type-safe with no
parsing logic anywhere in this library, at the cost of a couple of extra
lines in your test file. See `examples/toy-ad-delivery.test.ts` for a full
working version of the array case.

### Types

```ts
type ScenarioCategory = "protected-attribute" | "geography" | "price" | "payout" | "custom";

interface MutationScenario<Input> {
  name: string;
  mutate: (input: Input) => Input;
  category?: ScenarioCategory; // informational only; the engine never branches on it
}
```

`deepEqual` (the default comparator/precondition-check building block) is
also exported, in case you want to reuse it in a custom `isEqual` or
`hasChanged`.

## Runnable examples

`examples/` has two fully self-contained, runnable example files using
clearly fictional/toy data — no real people, addresses, or products:

- **`examples/toy-loan-scoring.test.ts`** — a toy loan-scoring function,
  exercising `protectedAttributeScenarios` (applicant name) and
  `geographyScenarios` (zip code), including a deliberately biased variant
  that lets zip code nudge the offered rate, to prove the check actually
  catches something.
- **`examples/toy-ad-delivery.test.ts`** — a toy ad-ranking function,
  exercising `priceScenarios`, including a deliberately margin-favoring
  variant, and demonstrating the array-of-objects getter/setter pattern
  described above.

Run them with:

```bash
npx vitest run
```

## Limits — read this before trusting a green check

**This proves invariance only for the specific mutations you tested. It is
not a formal fairness proof, and it is not a certification of
non-discrimination.** A function could still be sensitive to the field you
mutated in a way none of your scenarios happened to trigger — e.g. it only
reacts once a value crosses some threshold your substitution values never
hit, or it reacts to a combination of two fields you mutated independently
but never together, or it's sensitive to a correlated proxy field you never
touched at all (a zip code standing in for race, a graduation year standing
in for age).

- **Choosing genuinely adversarial, legally-relevant test values is your
  job.** This library deliberately does not ship default substitution
  values for any preset — no built-in list of names, zip codes, or prices.
  A generic name swap or an arbitrary price bump is a much weaker test than
  one built from values a domain expert (fair-lending counsel, a
  fair-housing specialist, whoever owns the actual regulatory exposure)
  would consider a real adversarial case.
- **Test boundary and combined cases, not just one easy substitution.**
  Every candidate getting the same value, the worst-scoring option getting
  the most favorable value, values inverted relative to quality, and
  multiple related fields mutated together rather than one at a time.
- **A `vacuous` result means the test proved nothing** — it means your
  `mutate()` didn't actually change anything the default (or your custom)
  `hasChanged` check considers meaningful. Fix the scenario; don't ignore
  the flag.
- **Re-run this whenever the function's logic changes.** It's a regression
  guard, not a one-time certificate — put it in CI.
- **This is a runtime check on the function you actually call it with.** It
  says nothing about code paths the check never exercises, upstream data
  pipelines that might already bake in the effect you're testing for
  (e.g. a "quality score" that was itself computed in a way that already
  encodes the protected attribute), or effects that only show up in
  aggregate across many decisions rather than a single input/output pair.

Use this together with actual domain expertise and, where the stakes
justify it, a real audit — not instead of one.
