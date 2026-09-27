/**
 * priceScenarios
 * ---------------
 * Does a recommendation or ranking silently favor higher-margin or
 * higher-price options when quality/fit signals are held equal? Relevant
 * to any marketplace, ad-delivery, or recommendation engine that also
 * profits more from some options than others.
 */
import type { MutationScenario } from "../types.js";
import { getSetScenarios, validatePresetArguments } from "./_shared.js";

/** Options for `priceScenarios`. They affect scenario names only, never behavior. */
export interface PriceScenariosOptions {
  /** Label used in generated scenario names. Defaults to "price". */
  fieldLabel?: string;
}

/**
 * Build one mutation scenario per substitution value for a single
 * numeric-valued price field.
 *
 * `get`/`set` are accessor closures you write yourself, e.g.
 * `(input) => input.price` and `(input, v) => ({ ...input, price: v })`.
 * For a price on one item inside an array (the common case), write a pair
 * that finds and maps by id rather than by array index; see
 * `examples/toy-ad-delivery.test.ts`. `set` must return a new input and leave
 * its argument untouched (`assertInvariance` throws if it does not).
 *
 * Each scenario is named `<fieldLabel> -> <value>`; `-0` is written `-0` so it
 * does not collide with `0`. Its `mutate` throws an Error if
 * `get(set(input, value))` is not the same number (`Object.is`, so a setter
 * that rounds or clamps is caught). A value equal to the input's current value
 * makes `assertInvariance` report the scenario as `vacuous`.
 *
 * `substitutionValues` are the replacement prices to try. Any number is
 * accepted, including `0`, negatives, `NaN`, and `Infinity`; pick boundary and
 * adversarial values, not one easy case. The kit chooses none for you. An
 * empty list returns no scenarios. Throws a TypeError if `get` or `set` is not
 * a function or `substitutionValues` is not an array of numbers.
 */
export function priceScenarios<Input>(
  get: (input: Input) => number,
  set: (input: Input, value: number) => Input,
  substitutionValues: number[],
  opts: PriceScenariosOptions = {},
): MutationScenario<Input>[] {
  validatePresetArguments("priceScenarios", get, set, substitutionValues, "number");
  const label = opts.fieldLabel ?? "price";
  return getSetScenarios("price", label, get, set, substitutionValues, (v) => (Object.is(v, -0) ? "-0" : String(v)));
}
