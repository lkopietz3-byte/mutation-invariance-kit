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
import type { DeepEqualOptions } from "./deepEqual.js";
import { describeError, hasOwn, isPlainRecord, quote } from "./internal.js";
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
export type { DeepEqualOptions };

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
   * Make iteration order count in the default comparisons. Default false:
   * the order of `Map` entries, `Set` members and object keys is ignored, so
   * a ranking returned as a `Map`, `Set` or object that reorders after a
   * mutation still passes. If your function returns a Map, Set or object in
   * rank order, pass `orderSensitive: true` or return an array. It applies to
   * the default `isEqual` and the default `hasChanged` (a mutation that only
   * reorders a `Map` then counts as a change); a custom `isEqual` or
   * `hasChanged` is used as written. See `deepEqual`'s `orderSensitive`.
   */
  orderSensitive?: boolean;
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

const ignore = (): void => undefined;
const promiseThen = Reflect.get(Promise.prototype, "then") as (...args: unknown[]) => unknown;

/**
 * True if `value` is a Promise or other thenable. A genuine Promise we are
 * about to refuse is also detached: a rejecting Promise nobody handles would
 * otherwise end the Node process with an unhandled rejection, hiding the
 * TypeError we throw about it. That is done with the built-in `Promise.prototype.then`
 * and no-op handlers; the value's own `then` is never called.
 */
function refuseThenable(value: unknown): boolean {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  if (typeof (value as { then?: unknown }).then !== "function") return false;
  try {
    // The built-in then, not the value's own: it succeeds only on a genuine
    // Promise (any subclass), and a thenable's own then() is never called,
    // because calling it could itself create a rejecting Promise nobody handles.
    Reflect.apply(promiseThen, value, [ignore, ignore]);
  } catch {
    // Not a genuine Promise: nothing to detach. The caller gets the TypeError below.
  }
  return true;
}

/** Run `run`; a RangeError (almost always a stack overflow) becomes an error that says where. */
function guarded<T>(where: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Error(
        `assertInvariance: ${where}: a value is nested too deeply to copy or compare (the comparison hit a ` +
          `RangeError, most likely a stack overflow). Flatten the nesting, or pass your own isEqual and hasChanged.`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Validate `scenarios` with one indexed pass (holes rejected, inherited
 * elements ignored), reading each scenario's `name`, `mutate` and
 * `category` exactly once, and return that snapshot. The run uses only this
 * snapshot, so what was validated is exactly what runs, whatever the
 * array's iterator or the scenario's getters do later.
 */
function snapshotScenarios<Input>(scenarios: unknown): MutationScenario<Input>[] {
  if (!Array.isArray(scenarios)) {
    throw new TypeError("assertInvariance: scenarios must be an array of { name, mutate } objects.");
  }
  const length = scenarios.length;
  if (length === 0) {
    throw new Error(
      "assertInvariance: scenarios is empty, so nothing would be tested. Pass at least one scenario.",
    );
  }
  const list: MutationScenario<Input>[] = [];
  const used = new Set<string>();
  const nextSuffix = new Map<string, number>();
  for (let index = 0; index < length; index += 1) {
    if (!hasOwn(scenarios, index)) {
      throw new TypeError(`assertInvariance: scenarios[${index}] is missing (a hole in a sparse array). Pass a dense array.`);
    }
    const candidate: unknown = scenarios[index];
    const isObject = typeof candidate === "object" && candidate !== null;
    const name: unknown = isObject ? Reflect.get(candidate, "name") : undefined;
    const mutate: unknown = isObject ? Reflect.get(candidate, "mutate") : undefined;
    if (typeof name !== "string" || typeof mutate !== "function") {
      throw new TypeError(
        `assertInvariance: scenarios[${index}] must be an object with a string "name" and a "mutate" function.`,
      );
    }
    const category = Reflect.get(candidate as object, "category") as MutationScenario<Input>["category"];
    // Two scenarios with one name (for example a preset given a repeated value)
    // would be indistinguishable in `failures`, `vacuous` and error messages.
    let unique = name;
    if (used.has(unique)) {
      // Resume at the next suffix this name has not used, so a long run of one
      // repeated name stays linear; the loop still skips a name the caller took.
      let copy = nextSuffix.get(name) ?? 2;
      while (used.has(`${name} (${copy})`)) copy += 1;
      unique = `${name} (${copy})`;
      nextSuffix.set(name, copy + 1);
    }
    used.add(unique);
    list.push({ name: unique, mutate: mutate as (input: Input) => Input, category });
  }
  return list;
}

type Hook = ((...args: never[]) => unknown) | undefined;

interface ReadOptions {
  isEqual: Hook;
  hasChanged: Hook;
  cleanup: Hook;
  orderSensitive: boolean;
}

/** Read `opts` once: undefined or a plain object whose hooks are functions or undefined. */
function readOptions(opts: unknown): ReadOptions {
  if (opts === undefined) return { isEqual: undefined, hasChanged: undefined, cleanup: undefined, orderSensitive: false };
  if (!isPlainRecord(opts)) throw new TypeError("assertInvariance: opts must be a plain object (or omitted).");
  const hooks = { isEqual: opts.isEqual, hasChanged: opts.hasChanged, cleanup: opts.cleanup };
  for (const [hook, value] of Object.entries(hooks)) {
    if (value !== undefined && typeof value !== "function") {
      throw new TypeError(`assertInvariance: opts.${hook} must be a function (or omitted).`);
    }
  }
  const orderSensitive = opts.orderSensitive;
  if (orderSensitive !== undefined && typeof orderSensitive !== "boolean") {
    throw new TypeError("assertInvariance: opts.orderSensitive must be a boolean (or omitted).");
  }
  return { ...(hooks as { isEqual: Hook; hasChanged: Hook; cleanup: Hook }), orderSensitive: orderSensitive === true };
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
 * `scenarios` is validated and copied with one indexed pass before anything
 * runs: each scenario's `name`, `mutate` and `category` are read once, and
 * the run uses only that copy, so the scenarios that were checked are exactly
 * the scenarios that run. `opts` is read once too.
 *
 * Throws, rather than returning a result, when the run cannot be trusted:
 * - `fn` is not a function, `scenarios` is not a non-empty, dense array of
 *   `{ name, mutate }` (a hole in a sparse array is rejected), or `opts` is
 *   not a plain object whose hooks are functions or undefined (all checked
 *   before anything runs, so `fn` is never called on a bad call).
 * - `fn` throws on the baseline or on a mutated input. The error names the
 *   scenario and keeps the original as `cause`; a throw on a mutated input is
 *   never counted as "no difference".
 *   Scenario names and thrown messages are escaped in the text (newlines,
 *   control and bidi characters), so they cannot fake extra lines of output.
 * - `mutate` throws.
 * - `fn` or `mutate` returns a Promise (or any thenable). This function is
 *   synchronous; see README.md for how to check an async function. The
 *   refused Promise gets a no-op rejection handler first, so a rejection
 *   cannot also end the process as an unhandled rejection.
 * - `fn` or `mutate` modified `baseInput` in place (detected by comparing
 *   against a deep copy taken before the first call). Copy before you sort or
 *   edit; every later scenario starts from the same `baseInput`. In-place
 *   changes inside values the copy keeps by reference (functions, `Error`,
 *   `Promise`, private `#fields`, ...) are not detected.
 * - a later `fn` call modified the object `fn` returned for the baseline.
 * - `isEqual` or `hasChanged` returns anything but a boolean (for example a
 *   Promise), or `cleanup` returns a Promise.
 *
 * - a value is nested so deeply that copying or comparing it overflowed the
 *   stack (see `deepEqual` for the shapes that still recurse). The error
 *   names the scenario or step and keeps the `RangeError` as `cause`; it is
 *   never reported as a difference.
 *
 * Scenarios that share a name are renamed `name (2)`, `name (3)`, ... so each
 * one is distinguishable in `failures`, `vacuous` and messages.
 *
 * By default the order of `Map` entries, `Set` members and object keys is not
 * compared. If `fn` returns a Map, Set or object in rank order, pass
 * `orderSensitive: true` or return an array.
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
  opts?: AssertInvarianceOptions<Input, Output>,
): InvarianceResult<Input, Output> {
  if (typeof fn !== "function") {
    throw new TypeError("assertInvariance: fn must be a function.");
  }
  const list = snapshotScenarios<Input>(scenarios);
  const options = readOptions(opts);
  const compareOptions: DeepEqualOptions = { orderSensitive: options.orderSensitive };
  // Checks for in-place edits are always order-sensitive: a copy and its
  // original only differ in order if something reordered the original.
  const strict: DeepEqualOptions = { orderSensitive: true };
  const customIsEqual = options.isEqual as ((expected: Output, actual: Output) => unknown) | undefined;
  const customHasChanged = options.hasChanged as ((base: Input, mutated: Input) => unknown) | undefined;
  const cleanup = options.cleanup;

  const pristine = guarded("copying baseInput", () => snapshot(baseInput));
  const assertBaseUntouched = (who: string): void => {
    if (!guarded(`comparing baseInput with its copy after ${who}`, () => deepEqual(pristine, baseInput, strict))) {
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
      if (refuseThenable(cleanup?.())) {
        throw new TypeError("cleanup() returned a Promise (or thenable); cleanup must be synchronous.");
      }
    } catch (cleanupError) {
      if (!fnFailed) {
        throw new Error(`assertInvariance: cleanup() threw after fn ran ${where}: ${describeError(cleanupError)}`, {
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
    if (refuseThenable(output)) {
      throw new TypeError(
        `assertInvariance: fn returned a Promise (or thenable) ${where}. assertInvariance is ` +
          `synchronous and would compare Promise objects, not the values they resolve to (and each Promise ` +
          `is equal only to itself, since its state cannot be read). See the README section on async functions.`,
      );
    }
    return output as Output;
  };

  const checkedBoolean = (hook: string, where: string, value: unknown): boolean => {
    if (typeof value !== "boolean") {
      throw new TypeError(
        `assertInvariance: ${hook} must return a boolean, got ${
          refuseThenable(value) ? "a Promise (or thenable)" : value === null ? "null" : typeof value
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
  const baselineCopy = guarded("copying the baseline output", () => snapshot(baseline));

  const failures: InvarianceResult<Input, Output>["failures"] = [];
  const vacuous: string[] = [];

  for (const { name, mutate, category } of list) {
    const label = `scenario ${quote(name)}`;
    let mutatedInput: Input;
    try {
      mutatedInput = mutate(baseInput);
    } catch (error) {
      throw new Error(`assertInvariance: ${label}: mutate() threw: ${describeError(error)}`, {
        cause: error,
      });
    }
    if (refuseThenable(mutatedInput)) {
      throw new TypeError(
        `assertInvariance: ${label}: mutate() returned a Promise (or thenable). mutate must be synchronous.`,
      );
    }
    assertBaseUntouched(`${label}: mutate()`);

    // Precondition guard: a mutation that changed nothing can't prove
    // invariance. Flag it instead of letting it silently count as a pass.
    const changed =
      customHasChanged !== undefined
        ? customHasChanged(baseInput, mutatedInput)
        : guarded(`${label}: comparing the mutated input with baseInput`, () => !deepEqual(baseInput, mutatedInput, compareOptions));
    if (!checkedBoolean("hasChanged", `for ${label}`, changed)) {
      vacuous.push(name);
      continue;
    }

    const actual = callFn(mutatedInput, `on the mutated input for ${label} (it did not throw on the baseline input)`);
    assertBaseUntouched(`${label}: fn`);
    if (!guarded(`${label}: comparing the baseline output with its copy`, () => deepEqual(baselineCopy, baseline, strict))) {
      throw new Error(
        `assertInvariance: fn modified its earlier (baseline) output in place during ${label}. ` +
          `Return a fresh value from every call, or the baseline can no longer be compared.`,
      );
    }

    const equal =
      customIsEqual !== undefined
        ? customIsEqual(baseline, actual)
        : guarded(`${label}: comparing the output with the baseline`, () => deepEqual(baseline, actual, compareOptions));
    if (!checkedBoolean("isEqual", `for ${label}`, equal)) {
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
