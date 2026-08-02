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
 * scenario is testing. The engine never branches on this value — it's
 * attached to results purely so a report can group or filter failures by
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
 * re-running the function under test. `mutate` must be pure: given the
 * same `input` it must always return the same (new) value, and it must
 * not depend on anything outside its argument — otherwise the invariance
 * check stops being reproducible.
 *
 * This is deliberately the same shape as payout-invariance-kit's
 * `PayoutMutationScenario`, minus the payout-specific name — see
 * README.md for how the two packages relate.
 */
export interface MutationScenario<Input> {
  /** Short, descriptive name for this mutation — shown in failure output. */
  name: string;
  /** Pure function: base input -> mutated input. */
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

export interface InvarianceResult<Input, Output> {
  /**
   * True only if every scenario ran (none were vacuous) AND every one
   * produced an output identical to the baseline. A run with zero
   * failures but one or more vacuous scenarios is NOT `passed: true` — a
   * vacuous scenario proves nothing, so it cannot count as a pass.
   */
  passed: boolean;
  /** The unmutated baseline output, for reference. */
  baseline: Output;
  /** Scenarios whose mutated output differed from the baseline. */
  failures: InvarianceFailure<Input, Output>[];
  /**
   * Names of scenarios whose `mutate` did not actually change the input
   * (per `hasChanged` / the default deep-equal check) — i.e. the
   * precondition that makes the invariance check meaningful was never
   * satisfied. Neither a pass nor a failure: it means "this scenario
   * tested nothing."
   */
  vacuous: string[];
}
