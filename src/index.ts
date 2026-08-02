/**
 * mutation-invariance-kit
 * ------------------------
 * The general mechanism behind payout-invariance-kit's
 * `assertPayoutInvariance`, stripped of every payout-specific assumption:
 * mutate a variable a system claims NOT to depend on, re-run the system,
 * and assert the output is unchanged. Works for any "should not depend on
 * X" claim — a protected attribute, geography, price, payout, or anything
 * else you name.
 *
 * `assertInvariance` is the fully domain-agnostic core: inputs are just
 * `Input`, outputs are just `Output`, mutations are just functions. It
 * carries the same discipline as the payout-specific original — a
 * precondition guard that flags a mutation which didn't actually change
 * anything as `vacuous` rather than a silent pass, deep-equal comparison of
 * outputs, and an optional `cleanup` hook for functions under test that
 * touch external state.
 *
 * `presets/` supplies three ready-made scenario generators for real-world
 * axes (protected-attribute, geography, price) built on simple, explicit,
 * type-safe getter/setter closures — not a generic path-parsing utility.
 * See README.md for why.
 *
 * Zero runtime dependencies. Pure TypeScript. `assertInvariance` returns
 * plain data rather than calling a test framework's `expect()`, so it works
 * with vitest, jest, node:test, or a one-off script. See README.md for
 * adapter examples and how this package relates to payout-invariance-kit.
 */

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

// ---------------------------------------------------------------------------
// Shared: a small, dependency-free structural deep-equal.
//
// Same algorithm as payout-invariance-kit's `deepEqual` — reimplemented
// here (not imported) so this package has zero dependency on that one and
// stands entirely on its own.
// ---------------------------------------------------------------------------

/**
 * Structural deep equality for plain JS values: primitives, Date, RegExp,
 * arrays, Maps, Sets, and plain objects. Good enough for comparing
 * decisions/scores/rankings (arrays/objects of candidates, scores, ids)
 * without pulling in a dependency. NaN === NaN is treated as equal
 * (matches Object.is semantics for that one case), which is usually what
 * you want when comparing scores.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;

  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false; // primitives already handled by Object.is

  const objA = a as object;
  const objB = b as object;

  if (objA instanceof Date || objB instanceof Date) {
    return objA instanceof Date && objB instanceof Date && objA.getTime() === objB.getTime();
  }

  if (objA instanceof RegExp || objB instanceof RegExp) {
    return objA instanceof RegExp && objB instanceof RegExp && String(objA) === String(objB);
  }

  if (Array.isArray(objA) || Array.isArray(objB)) {
    if (!Array.isArray(objA) || !Array.isArray(objB)) return false;
    if (objA.length !== objB.length) return false;
    return objA.every((item, i) => deepEqual(item, objB[i]));
  }

  if (objA instanceof Map || objB instanceof Map) {
    if (!(objA instanceof Map) || !(objB instanceof Map)) return false;
    if (objA.size !== objB.size) return false;
    for (const [key, val] of objA) {
      if (!objB.has(key) || !deepEqual(val, objB.get(key))) return false;
    }
    return true;
  }

  if (objA instanceof Set || objB instanceof Set) {
    if (!(objA instanceof Set) || !(objB instanceof Set)) return false;
    if (objA.size !== objB.size) return false;
    for (const val of objA) {
      let found = false;
      for (const other of objB) {
        if (deepEqual(val, other)) {
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
    return true;
  }

  const keysA = Object.keys(objA as Record<string, unknown>);
  const keysB = Object.keys(objB as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(objB, key) &&
      deepEqual((objA as Record<string, unknown>)[key], (objB as Record<string, unknown>)[key]),
  );
}

// ---------------------------------------------------------------------------
// assertInvariance — the core, fully domain-agnostic engine.
// ---------------------------------------------------------------------------

export interface AssertInvarianceOptions<Input, Output> {
  /**
   * How to compare two outputs for equality. Defaults to a structural
   * deep-equal (see `deepEqual` above), which is byte-identical comparison
   * for plain data. Override this if your function returns something with
   * non-comparable fields (timestamps, random ids) that you want to
   * ignore — project those out before comparing, or supply a custom
   * comparator.
   */
  isEqual?: (expected: Output, actual: Output) => boolean;
  /**
   * How to decide whether a mutation actually changed the input at all.
   * Defaults to "the mutated input is not deep-equal to the base input" —
   * a whole-object comparison, not field-path introspection. If `mutate()`
   * produced something indistinguishable from the baseline, it clearly
   * didn't change anything relevant either, and re-running the function
   * under test would just be comparing an input to itself: a vacuous check
   * that would pass no matter how sensitive the function secretly is to
   * the thing you meant to mutate.
   *
   * Supply your own to be more precise (e.g. compare only the specific
   * field you intended to mutate) if you want a tighter guarantee that the
   * CHANGED part is specifically the thing under test and not some
   * unrelated field.
   */
  hasChanged?: (baseInput: Input, mutatedInput: Input) => boolean;
  /**
   * Optional hook called after every invocation of `fn` — the baseline
   * call and once per non-vacuous scenario — inside a `finally` block, so
   * it still runs even if `fn` throws. Use this only if `fn` touches
   * external state (a shared cache, a database row, a module-level
   * counter) that needs to be reset between runs for the comparison to
   * stay meaningful. A pure function never needs this.
   */
  cleanup?: () => void;
}

/**
 * Re-run a function once per mutation scenario and confirm its output is
 * unchanged from the unmutated baseline.
 *
 * `fn` must be pure (same input -> same output, no hidden state) or the
 * comparison is meaningless — unless it touches external state that you
 * reset via `opts.cleanup` between calls. This library never calls `fn`
 * more than once per scenario and never mutates its result.
 *
 * Returns a plain result object rather than throwing or calling a test
 * framework's `expect()`, so it works with any test runner (or none). See
 * README.md for a vitest adapter example.
 */
export function assertInvariance<Input, Output>(
  fn: (input: Input) => Output,
  baseInput: Input,
  scenarios: MutationScenario<Input>[],
  opts: AssertInvarianceOptions<Input, Output> = {},
): InvarianceResult<Input, Output> {
  const isEqual = opts.isEqual ?? deepEqual;
  const hasChanged = opts.hasChanged ?? ((base, mutated) => !deepEqual(base, mutated));

  let baseline: Output;
  try {
    baseline = fn(baseInput);
  } finally {
    opts.cleanup?.();
  }

  const failures: InvarianceResult<Input, Output>["failures"] = [];
  const vacuous: string[] = [];

  for (const { name, mutate, category } of scenarios) {
    const mutatedInput = mutate(baseInput);

    // Precondition guard: a mutation that changed nothing can't prove
    // invariance. Flag it instead of letting it silently count as a pass.
    if (!hasChanged(baseInput, mutatedInput)) {
      vacuous.push(name);
      continue;
    }

    let actual: Output;
    try {
      actual = fn(mutatedInput);
    } finally {
      opts.cleanup?.();
    }

    if (!isEqual(baseline, actual)) {
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
