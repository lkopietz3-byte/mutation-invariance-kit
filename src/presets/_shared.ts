/**
 * Internal helper shared by the three built-in preset generators
 * (protectedAttribute.ts, geography.ts, price.ts). Not part of the public
 * API — not re-exported from `presets/index.ts` or the package root.
 *
 * Deliberately NOT a path-parsing utility. An earlier attempt at this
 * library got tangled trying to support arbitrary bracket-index path
 * syntax (e.g. `ads[2].price`) in a generic get/set-by-path helper and
 * never finished. This helper instead takes the simple, explicit,
 * type-safe getter/setter closures the caller already wrote — see
 * README.md, "why getters/setters, not path strings."
 */
import type { MutationScenario, ScenarioCategory } from "../types.js";

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
