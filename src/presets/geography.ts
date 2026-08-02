/**
 * geographyScenarios
 * -------------------
 * Does the same input get a different (or worse) result purely because of
 * a zip code or region, holding everything else equal? Relevant to
 * insurance pricing, loan terms, ad delivery, and service availability
 * (see the root README.md).
 */
import type { MutationScenario } from "../types.js";
import { getSetScenarios } from "./_shared.js";

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
 * `get`/`set` are simple, explicit, type-safe accessor closures you write
 * yourself — e.g. `(input) => input.zipCode` and
 * `(input, v) => ({ ...input, zipCode: v })`. This function does not parse
 * a field-path string; see the root README.md for why.
 *
 * `substitutionValues` are the replacement zip/region codes to try. This
 * library deliberately does NOT ship a default list of real, legally
 * meaningful zip codes to test (e.g. historically redlined areas) —
 * choosing those is the caller's responsibility. See the root README.md
 * "limits" section.
 */
export function geographyScenarios<Input>(
  get: (input: Input) => string,
  set: (input: Input, value: string) => Input,
  substitutionValues: string[],
  opts: GeographyScenariosOptions = {},
): MutationScenario<Input>[] {
  const label = opts.fieldLabel ?? "geography";
  return getSetScenarios("geography", label, get, set, substitutionValues, (v) => JSON.stringify(v));
}
