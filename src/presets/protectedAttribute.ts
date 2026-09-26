/**
 * protectedAttributeScenarios
 * ----------------------------
 * Does a decision, score, or ranking change when a name, an inferred
 * ethnicity signal, a gender-coded name, or an age-coded detail changes,
 * with everything else held equal? Relevant to hiring, lending, insurance,
 * and housing algorithms.
 */
import type { MutationScenario } from "../types.js";
import { getSetScenarios, validatePresetArguments } from "./_shared.js";

export interface ProtectedAttributeScenariosOptions {
  /** Label used in generated scenario names. Defaults to "protected attribute". */
  fieldLabel?: string;
}

/**
 * Build one mutation scenario per substitution value for a single
 * string-valued protected-attribute field.
 *
 * `get`/`set` are accessor closures you write yourself, e.g.
 * `(input) => input.applicantName` and
 * `(input, v) => ({ ...input, applicantName: v })`. `set` must return a new
 * input and leave its argument untouched (`assertInvariance` throws if it
 * does not). Nothing here parses a field-path string.
 *
 * Each scenario is named `<fieldLabel> -> "<value>"` (the value JSON-quoted).
 * Its `mutate` throws an Error if `get(set(input, value))` is not the same
 * value (`Object.is`), which catches a getter/setter pair that reads and
 * writes different fields. A value equal to the input's current value makes
 * `assertInvariance` report the scenario as `vacuous`.
 *
 * `substitutionValues` are the replacement values to try (alternate names,
 * name-coded signals, age-coded details, ...). The kit ships no default list;
 * choosing genuinely adversarial values is the caller's job. An empty list
 * returns no scenarios. Throws a TypeError if `get` or `set` is not a function
 * or `substitutionValues` is not an array of strings.
 */
export function protectedAttributeScenarios<Input>(
  get: (input: Input) => string,
  set: (input: Input, value: string) => Input,
  substitutionValues: string[],
  opts: ProtectedAttributeScenariosOptions = {},
): MutationScenario<Input>[] {
  validatePresetArguments("protectedAttributeScenarios", get, set, substitutionValues, "string");
  const label = opts.fieldLabel ?? "protected attribute";
  return getSetScenarios("protected-attribute", label, get, set, substitutionValues, (v) =>
    JSON.stringify(v),
  );
}
