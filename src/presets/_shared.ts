/**
 * Internal helper shared by the three built-in preset generators
 * (protectedAttribute.ts, geography.ts, price.ts). Not part of the public
 * API: not re-exported from `presets/index.ts` or the package root.
 *
 * It takes the getter/setter closures the caller wrote instead of parsing a
 * field-path string, so there is no path syntax to get wrong and no property
 * name from the caller is ever used to write into an object.
 */
import type { MutationScenario, ScenarioCategory } from "../types.js";

/** Throws a TypeError naming `preset` unless `get`, `set`, and the values are usable. */
export function validatePresetArguments(
  preset: string,
  get: unknown,
  set: unknown,
  substitutionValues: unknown,
  valueType: "string" | "number",
): void {
  if (typeof get !== "function") throw new TypeError(`${preset}: get must be a function.`);
  if (typeof set !== "function") throw new TypeError(`${preset}: set must be a function.`);
  if (!Array.isArray(substitutionValues)) {
    throw new TypeError(`${preset}: substitutionValues must be an array of ${valueType}s.`);
  }
  substitutionValues.forEach((value: unknown, index) => {
    if (typeof value !== valueType) {
      throw new TypeError(
        `${preset}: substitutionValues[${index}] must be a ${valueType}, got ${
          value === null ? "null" : typeof value
        }.`,
      );
    }
  });
}

export function getSetScenarios<Input, Value>(
  category: ScenarioCategory,
  label: string,
  get: (input: Input) => Value,
  set: (input: Input, value: Value) => Input,
  substitutionValues: Value[],
  formatValue: (value: Value) => string,
): MutationScenario<Input>[] {
  return substitutionValues.map((value) => ({
    name: `${label} -> ${formatValue(value)}`,
    category,
    mutate: (input: Input): Input => {
      const mutated = set(input, value);
      // Sanity check, not a substitute for assertInvariance's own vacuous
      // guard: confirm the setter actually wired up to the same field the
      // getter reads, so a copy-paste bug in the closures fails loudly
      // here instead of silently producing a vacuous or misleading result.
      const applied = get(mutated);
      if (!Object.is(applied, value)) {
        throw new Error(
          `${label}: setter did not apply ${formatValue(value)} to the input ` +
            `(get() returned ${formatValue(applied)} right after set()). ` +
            `Check that your getter and setter closures read/write the same field.`,
        );
      }
      return mutated;
    },
  }));
}
