/**
 * mutation-invariance-kit — types
 * --------------------------------
 * Generic types shared by the core engine (assertInvariance) and every
 * preset scenario generator in `presets/`. Nothing in this file is
 * domain-specific — no payout, no protected attribute, no geography, no
 * price. Those live only in `presets/`.
 */

/**
 * Loose, informational label for which "should not depend on X" axis a
 * scenario is testing. The engine never branches on this value; it is
 * attached to failures purely so a report can group or filter them by
 * axis. Set automatically by the built-in preset generators; use
 * `"custom"` (or omit `category` entirely) for anything you write by hand.
 */
export type ScenarioCategory =
  | "protected-attribute"
  | "geography"
  | "price"
  | "payout"
  | "custom";

/**
 * One named, adversarial way of rewriting some field on an input before
 * re-running the function under test.
 *
 * `mutate` must return a NEW input and leave its argument untouched, and it
 * must be deterministic (same argument, same result, nothing read from the
 * clock, random numbers, or other outside state). `assertInvariance` calls it
 * exactly once per run and throws if it modified the base input in place or
 * returned a Promise. A mutation whose result equals the base input is
 * reported as `vacuous`.
 *
 * The shape (`name` + `mutate`) matches `PayoutMutationScenario` in the
 * sibling `payout-invariance-kit`, plus the optional `category`.
 */
export interface MutationScenario<Input> {
  /** Short, descriptive name for this mutation — shown in failure output. */
  name: string;
  /** Pure, synchronous function: base input -> new mutated input. */
  mutate: (input: Input) => Input;
  /** Optional label for which axis this scenario tests. */
  category?: ScenarioCategory;
}

/** One scenario whose mutated output differed from the baseline. */
export interface InvarianceFailure<Input, Output> {
  /** The scenario's name. */
  scenario: string;
  /** The scenario's category, if it had one. */
  category?: ScenarioCategory;
  /** The mutated input that produced a different result. */
  mutatedInput: Input;
  /** The baseline (unmutated) output. */
  expected: Output;
  /** The output produced after the mutation. */
  actual: Output;
}

/** What `assertInvariance` returns when it could run every scenario. */
export interface InvarianceResult<Input, Output> {
  /**
   * True only if every scenario ran (none were vacuous) AND every one
   * produced an output equal to the baseline. A run with zero failures but
   * one or more vacuous scenarios is NOT `passed: true`: a vacuous scenario
   * tested nothing, so it cannot count as a pass. `true` means "no
   * difference in the scenarios supplied", not that the function ignores the
   * mutated field.
   */
  passed: boolean;
  /** The output for the unmutated base input (the same reference `fn` returned). */
  baseline: Output;
  /** Scenarios whose mutated output differed from the baseline. */
  failures: InvarianceFailure<Input, Output>[];
  /**
   * Names of scenarios whose `mutate` did not actually change the input
   * (per `hasChanged` / the default deep-equal check), so `fn` was never
   * re-run for them. Neither a pass nor a failure: it means "this scenario
   * tested nothing."
   */
  vacuous: string[];
}
