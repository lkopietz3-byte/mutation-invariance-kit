/**
 * protectedAttributeScenarios
 * ----------------------------
 * Does a decision, score, or ranking change when a name, an inferred
 * ethnicity signal, a gender-coded name, or an age-coded detail changes,
 * with everything else held equal? Relevant to hiring, lending, insurance,
 * and housing algorithms — all currently under real regulatory scrutiny
 * (see the root README.md).
 */
import type { MutationScenario } from "../types.js";
import { getSetScenarios } from "./_shared.js";

export interface ProtectedAttributeScenariosOptions {
  /** Label used in generated scenario names. Defaults to "protected attribute". */
  fieldLabel?: string;
}

/**
 * Build one mutation scenario per substitution value for a single
 * string-valued protected-attribute field.
 *
 * `get`/`set` are simple, explicit, type-safe accessor closures you write
 * yourself — e.g. `(input) => input.applicantName` and
 * `(input, v) => ({ ...input, applicantName: v })`. This function does not
 * parse a field-path string; see the root README.md for why.
 *
 * `substitutionValues` are the replacement values to try (alternate names,
 * inferred-ethnicity-coded names, gender-coded names, age-coded details,
 * ...). This library deliberately does NOT ship a default list — choosing
 * genuinely adversarial, legally-relevant values is the caller's
 * responsibility. See the root README.md "limits" section.
 */
export function protectedAttributeScenarios<Input>(
  get: (input: Input) => string,
  set: (input: Input, value: string) => Input,
  substitutionValues: string[],
  opts: ProtectedAttributeScenariosOptions = {},
): MutationScenario<Input>[] {
  const label = opts.fieldLabel ?? "protected attribute";
  return getSetScenarios("protected-attribute", label, get, set, substitutionValues, (v) =>
    JSON.stringify(v),
  );
}
