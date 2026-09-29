/**
 * Internal helper shared by the three built-in preset generators
 * (protectedAttribute.ts, geography.ts, price.ts). Not part of the public
 * API: not re-exported from `presets/index.ts` or the package root.
 *
 * It takes the getter/setter closures the caller wrote instead of parsing a
 * field-path string, so there is no path syntax to get wrong and no property
 * name from the caller is ever used to write into an object.
 */
import { describeValue, escapeText, hasOwn, isBlank, isPlainRecord } from "../internal.js";
import type { MutationScenario, ScenarioCategory } from "../types.js";

/**
 * Throws a TypeError naming `preset` unless `get`, `set`, the values and the
 * options are usable. Returns a dense copy of `substitutionValues` (one
 * indexed pass; holes rejected) and the resolved field label, read once.
 */
export function validatePresetArguments<Value>(
  preset: string,
  get: unknown,
  set: unknown,
  substitutionValues: unknown,
  valueType: "string" | "number",
  opts: unknown,
  defaultLabel: string,
): { values: Value[]; label: string } {
  if (typeof get !== "function") throw new TypeError(`${preset}: get must be a function.`);
  if (typeof set !== "function") throw new TypeError(`${preset}: set must be a function.`);
  if (!Array.isArray(substitutionValues)) {
    throw new TypeError(`${preset}: substitutionValues must be an array of ${valueType}s.`);
  }
  const values: Value[] = [];
  const length = substitutionValues.length;
  for (let index = 0; index < length; index += 1) {
    if (!hasOwn(substitutionValues, index)) {
      throw new TypeError(`${preset}: substitutionValues[${index}] is missing (a hole in a sparse array).`);
    }
    const value: unknown = substitutionValues[index];
    if (typeof value !== valueType) {
      throw new TypeError(
        `${preset}: substitutionValues[${index}] must be a ${valueType}, got ${value === null ? "null" : typeof value}.`,
      );
    }
    values.push(value as Value);
  }
  if (opts !== undefined && !isPlainRecord(opts)) {
    throw new TypeError(`${preset}: opts must be a plain object (or omitted).`);
  }
  const fieldLabel: unknown = opts === undefined ? undefined : opts.fieldLabel;
  if (fieldLabel !== undefined && (typeof fieldLabel !== "string" || isBlank(fieldLabel))) {
    throw new TypeError(`${preset}: opts.fieldLabel must be a non-blank string (or omitted).`);
  }
  return { values, label: fieldLabel ?? defaultLabel };
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
          `${escapeText(label)}: setter did not apply ${escapeText(formatValue(value))} to the input ` +
            `(get() returned ${describeValue(applied)} right after set()). ` +
            `Check that your getter and setter closures read/write the same field.`,
        );
      }
      return mutated;
    },
  }));
}
