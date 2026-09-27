/**
 * mutation-invariance-kit
 * ------------------------
 * Change one thing a function claims not to depend on, re-run the function,
 * and compare the output to the unmutated baseline. `assertInvariance` is the
 * domain-agnostic engine; `presets/` adds three ready-made scenario
 * generators (protected attribute, geography, price) built on plain
 * getter/setter closures, with no path-string parsing anywhere.
 *
 * A passing result means "no difference in the scenarios you supplied", not
 * "the function ignores this input". See README.md, "Honest limits".
 *
 * Zero runtime dependencies. `assertInvariance` returns plain data rather
 * than calling a test framework's `expect()`, so it works with vitest, jest,
 * node:test, or a one-off script.
 */

import { deepEqual } from "./deepEqual.js";
import { snapshot } from "./snapshot.js";
import type { InvarianceResult, MutationScenario } from "./types.js";

export type {
  ScenarioCategory,
  MutationScenario,
  InvarianceFailure,
  InvarianceResult,
} from "./types.js";

export {
  protectedAttributeScenarios,
  geographyScenarios,
  priceScenarios,
} from "./presets/index.js";
export type {
  ProtectedAttributeScenariosOptions,
  GeographyScenariosOptions,
  PriceScenariosOptions,
} from "./presets/index.js";

export { deepEqual };

/** Optional hooks for `assertInvariance`. Every hook must be synchronous. */
export interface AssertInvarianceOptions<Input, Output> {
  /**
   * How to compare two outputs for equality. Defaults to `deepEqual`
   * (structural, strict: `NaN` equals `NaN`, `0` and `-0` differ, no
   * floating-point tolerance). Override it to ignore fields such as
   * timestamps or generated ids, or to compare with a tolerance.
   */
  isEqual?: (expected: Output, actual: Output) => boolean;
  /**
   * How to decide whether a mutation actually changed the input at all.
   * Defaults to "the mutated input is not `deepEqual` to the base input", a
   * whole-object comparison. A mutation that changed nothing would compare
   * an input to itself and pass no matter how sensitive the function is, so
   * it is reported in `vacuous` instead.
   *
   * Supply your own to check that the part that changed is the part you meant
   * to test (for example, compare only the one field), because the default
   * also treats a change to some unrelated field as a real mutation.
   */
  hasChanged?: (baseInput: Input, mutatedInput: Input) => boolean;
  /**
   * Called after every invocation of `fn` (the baseline call and once per
   * non-vacuous scenario), even when `fn` throws. Use it only if `fn` touches
   * external state (a shared cache, a database row, a module-level counter)
   * that must be reset between runs for the comparison to mean anything. A
   * pure function does not need it. If `cleanup` itself throws, that error is
   * reported, unless `fn` also threw, in which case the `fn` error is the one
   * thrown and the cleanup failure is mentioned in its message.
   */
  cleanup?: () => void;
}

function isThenable(value: unknown): boolean {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function describeError(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "(unprintable thrown value)";
  }
}

function validateScenarios<Input>(scenarios: unknown): MutationScenario<Input>[] {
  if (!Array.isArray(scenarios)) {
    throw new TypeError("assertInvariance: scenarios must be an array of { name, mutate } objects.");
  }
  if (scenarios.length === 0) {
    throw new Error(
      "assertInvariance: scenarios is empty, so nothing would be tested. Pass at least one scenario.",
    );
  }
  scenarios.forEach((scenario: unknown, index) => {
    const candidate = scenario as Partial<MutationScenario<Input>> | null;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof candidate.name !== "string" ||
      typeof candidate.mutate !== "function"
    ) {
      throw new TypeError(
        `assertInvariance: scenarios[${index}] must be an object with a string "name" and a "mutate" function.`,
      );
    }
  });
  return [...(scenarios as MutationScenario<Input>[])];
}

/**
 * Re-run `fn` once per mutation scenario and compare each output to the
 * output for the unmutated `baseInput`.
 *
 * Returns `{ passed, baseline, failures, vacuous }`. `passed` is true only when
 * every scenario actually changed the input (none `vacuous`) and every changed
 * input produced an output equal to the baseline. Passing means "no
 * difference in these scenarios", not that the function ignores the mutated
 * field. `fn` runs once for the baseline and once per non-vacuous scenario, in
 * scenario order; each scenario's `mutate` runs once.
 *
 * Throws, rather than returning a result, when the run cannot be trusted:
 * - `scenarios` is not a non-empty array of `{ name, mutate }` (checked before
 *   anything runs, so `fn` is never called on a bad call).
 * - `fn` throws on the baseline or on a mutated input. The error names the
 *   scenario and keeps the original as `cause`; a throw on a mutated input is
 *   never counted as "no difference".
 * - `mutate` throws.
 * - `fn` or `mutate` returns a Promise (or any thenable). This function is
 *   synchronous; see README.md for how to check an async function.
 * - `fn` or `mutate` modified `baseInput` in place (detected by comparing
 *   against a deep copy taken before the first call). Copy before you sort or
 *   edit; every later scenario starts from the same `baseInput`. In-place
 *   changes inside values the copy keeps by reference (functions, `Error`,
 *   `Promise`, private `#fields`, ...) are not detected.
 * - a later `fn` call modified the object `fn` returned for the baseline.
 * - `isEqual` or `hasChanged` returns anything but a boolean (for example a
 *   Promise), or `cleanup` returns a Promise.
 *
 * Never mutates `baseInput` or the result of `fn` itself, and does not clone
 * inputs it passes to your code. Never uses randomness or the clock: if `fn`
 * or `mutate` does, pass a seeded generator or fixed clock in via the
 * closure, or nondeterminism will show up as failures.
 */
export function assertInvariance<Input, Output>(
  fn: (input: Input) => Output,
  baseInput: Input,
  scenarios: MutationScenario<Input>[],
  opts: AssertInvarianceOptions<Input, Output> = {},
): InvarianceResult<Input, Output> {
  if (typeof fn !== "function") {
    throw new TypeError("assertInvariance: fn must be a function.");
  }
  const list = validateScenarios<Input>(scenarios);
  const isEqual = opts.isEqual ?? deepEqual;
  const hasChanged = opts.hasChanged ?? ((base, mutated) => !deepEqual(base, mutated));

  const pristine = snapshot(baseInput);
  const assertBaseUntouched = (who: string): void => {
    if (!deepEqual(pristine, baseInput)) {
      throw new Error(
        `assertInvariance: ${who} modified baseInput in place. Neither fn nor mutate may change its ` +
          `argument (copy before sorting or editing); every scenario starts from the same baseInput, ` +
          `so the comparison can no longer be trusted.`,
      );
    }
  };

  const callFn = (input: Input, where: string): Output => {
    let output: Output | undefined;
    let fnError: unknown;
    let fnFailed = false;
    try {
      output = fn(input);
    } catch (error) {
      fnFailed = true;
      fnError = error;
    }
    let cleanupNote = "";
    try {
      if (isThenable(opts.cleanup?.())) {
        throw new TypeError("cleanup() returned a Promise (or thenable); cleanup must be synchronous.");
      }
    } catch (cleanupError) {
      if (!fnFailed) {
        throw new Error(`assertInvariance: cleanup() threw after ${where}: ${describeError(cleanupError)}`, {
          cause: cleanupError,
        });
      }
      cleanupNote = ` (cleanup() also threw: ${describeError(cleanupError)})`;
    }
    if (fnFailed) {
      throw new Error(`assertInvariance: fn threw ${where}: ${describeError(fnError)}${cleanupNote}`, {
        cause: fnError,
      });
    }
    if (isThenable(output)) {
      throw new TypeError(
        `assertInvariance: fn returned a Promise (or thenable) ${where}. assertInvariance is ` +
          `synchronous and would compare promises, not results. See the README section on async functions.`,
      );
    }
    return output as Output;
  };

  const checkedBoolean = (hook: string, where: string, value: unknown): boolean => {
    if (typeof value !== "boolean") {
      throw new TypeError(
        `assertInvariance: ${hook} must return a boolean, got ${
          isThenable(value) ? "a Promise (or thenable)" : value === null ? "null" : typeof value
        } ${where}.`,
      );
    }
    return value;
  };

  const baseline = callFn(baseInput, "on the baseline input");
  assertBaseUntouched("fn (on the baseline input)");
  // fn may return an object it later reuses (a buffer it clears and refills).
  // If a later call rewrote the baseline in place, baseline and actual would be
  // the same object and always compare equal, so detect that too.
  const baselineCopy = snapshot(baseline);

  const failures: InvarianceResult<Input, Output>["failures"] = [];
  const vacuous: string[] = [];

  for (const { name, mutate, category } of list) {
    let mutatedInput: Input;
    try {
      mutatedInput = mutate(baseInput);
    } catch (error) {
      throw new Error(`assertInvariance: scenario "${name}": mutate() threw: ${describeError(error)}`, {
        cause: error,
      });
    }
    if (isThenable(mutatedInput)) {
      throw new TypeError(
        `assertInvariance: scenario "${name}": mutate() returned a Promise (or thenable). mutate must be synchronous.`,
      );
    }
    assertBaseUntouched(`scenario "${name}": mutate()`);

    // Precondition guard: a mutation that changed nothing can't prove
    // invariance. Flag it instead of letting it silently count as a pass.
    if (!checkedBoolean("hasChanged", `for scenario "${name}"`, hasChanged(baseInput, mutatedInput))) {
      vacuous.push(name);
      continue;
    }

    const actual = callFn(mutatedInput, `on the mutated input for scenario "${name}" (it did not throw on the baseline input)`);
    assertBaseUntouched(`scenario "${name}": fn`);
    if (!deepEqual(baselineCopy, baseline)) {
      throw new Error(
        `assertInvariance: fn modified its earlier (baseline) output in place during scenario "${name}". ` +
          `Return a fresh value from every call, or the baseline can no longer be compared.`,
      );
    }

    if (!checkedBoolean("isEqual", `for scenario "${name}"`, isEqual(baseline, actual))) {
      failures.push({ scenario: name, category, mutatedInput, expected: baseline, actual });
    }
  }

  return {
    passed: failures.length === 0 && vacuous.length === 0,
    baseline,
    failures,
    vacuous,
  };
}
