/**
 * geographyScenarios
 * -------------------
 * Does the same input get a different (or worse) result purely because of
 * a zip code or region, holding everything else equal? Relevant to
 * insurance pricing, loan terms, ad delivery, and service availability.
 */
import type { MutationScenario } from "../types.js";
import { getSetScenarios, validatePresetArguments } from "./_shared.js";

/** Options for `geographyScenarios`. They affect scenario names only, never behavior. */
export interface GeographyScenariosOptions {
  /** Label used in generated scenario names. Defaults to "geography". */
  fieldLabel?: string;
}

/**
 * Build one mutation scenario per substitution value for a single
 * string-valued geography field (zip/postal code, region, city, ...).
 * Kept as a string type so leading zeros in zip codes (e.g. "02138")
 * survive round-tripping.
 *
 * `get`/`set` are accessor closures you write yourself, e.g.
 * `(input) => input.zipCode` and `(input, v) => ({ ...input, zipCode: v })`.
 * `set` must return a new input and leave its argument untouched
 * (`assertInvariance` throws if it does not). Nothing here parses a
 * field-path string.
 *
 * Each scenario is named `<fieldLabel> -> "<value>"` (the value JSON-quoted).
 * Its `mutate` throws an Error if `get(set(input, value))` is not the same
 * value (`Object.is`), which catches a getter/setter pair that reads and
 * writes different fields. A value equal to the input's current value makes
 * `assertInvariance` report the scenario as `vacuous`.
 *
 * `substitutionValues` are the replacement zip/region codes to try. The kit
 * ships no default list; choosing them is the caller's job. An empty list
 * returns no scenarios. Throws a TypeError if `get` or `set` is not a
 * function or `substitutionValues` is not an array of strings.
 */
export function geographyScenarios<Input>(
  get: (input: Input) => string,
  set: (input: Input, value: string) => Input,
  substitutionValues: string[],
  opts: GeographyScenariosOptions = {},
): MutationScenario<Input>[] {
  validatePresetArguments("geographyScenarios", get, set, substitutionValues, "string");
  const label = opts.fieldLabel ?? "geography";
  return getSetScenarios("geography", label, get, set, substitutionValues, (v) => JSON.stringify(v));
}
