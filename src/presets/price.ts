/**
 * priceScenarios
 * ---------------
 * Does a recommendation or ranking silently favor higher-margin or
 * higher-price options when quality/fit signals are held equal? Relevant
 * to any marketplace, ad-delivery, or recommendation engine that also
 * profits more from some options than others (see the root README.md).
 */
import type { MutationScenario } from "../types.js";
import { getSetScenarios } from "./_shared.js";

export interface PriceScenariosOptions {
  /** Label used in generated scenario names. Defaults to "price". */
  fieldLabel?: string;
}

/**
 * Build one mutation scenario per substitution value for a single
 * numeric-valued price field.
 *
 * `get`/`set` are simple, explicit, type-safe accessor closures you write
 * yourself — e.g. `(input) => input.price` and
 * `(input, v) => ({ ...input, price: v })`. For a price on one item inside
 * an array (the common case — "does the ranking favor whichever candidate
 * is pricier"), write a getter/setter pair that finds/maps by id instead
 * of by array index; see README.md's ad-delivery example. This function
 * does not parse a field-path string; see the root README.md for why.
 *
 * `substitutionValues` are the replacement prices to try — pick boundary
 * and adversarial values (a price near zero, a price far above every
 * other candidate's, ...), not just one easy case. This library
 * deliberately does NOT choose them for you. See the root README.md
 * "limits" section.
 */
export function priceScenarios<Input>(
  get: (input: Input) => number,
  set: (input: Input, value: number) => Input,
  substitutionValues: number[],
  opts: PriceScenariosOptions = {},
): MutationScenario<Input>[] {
  const label = opts.fieldLabel ?? "price";
  return getSetScenarios("price", label, get, set, substitutionValues, (v) => String(v));
}
