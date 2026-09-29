/**
 * Runnable example: a narrow recipe for checking an ASYNC scoring function.
 *
 * assertInvariance is synchronous and throws if fn returns a Promise. The
 * recipe below (copied verbatim into README.md, "Async functions"; a test
 * keeps the two in sync) covers one shape only: an async scorer that
 * resolves to a number, on plain-data input. It is not a general async
 * engine.
 *
 * Entirely fictional/toy data. Run with: npx vitest run
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { assertInvariance, deepEqual } from "../src/index.js";
import type { InvarianceResult, MutationScenario } from "../src/index.js";
import { protectedAttributeScenarios } from "../src/presets/index.js";

// README:async-recipe:start
/**
 * Check an async scorer that resolves to a number.
 *
 * Limits: `baseInput` must be structured-clonable plain data (objects,
 * arrays, strings, numbers, booleans, null); the scorer must resolve to a
 * number; calls are awaited one at a time; a rejected call propagates as-is.
 */
async function assertAsyncScoreInvariance<Input>(
  score: (input: Input) => Promise<number>,
  baseInput: Input,
  scenarios: MutationScenario<Input>[],
): Promise<InvarianceResult<Input, number>> {
  // A copy taken before any call, to catch a scorer that edits baseInput.
  const pristine = structuredClone(baseInput);

  // Synchronous pass: assertInvariance validates the scenarios, runs each
  // mutate once, rejects in-place edits and Promises from mutate, and flags
  // vacuous scenarios. Each call returns a distinct number, so every
  // non-vacuous scenario comes back as a "failure" carrying its input.
  let calls = 0;
  const plan = assertInvariance(() => calls++, baseInput, scenarios);

  // Async pass: await one call at a time. A number cannot be edited or
  // reused later, so what is recorded is what the scorer returned.
  const scoreOf = async (input: Input): Promise<number> => {
    const value: unknown = await score(input);
    if (typeof value !== "number") throw new TypeError("score must resolve to a number.");
    return value;
  };

  const baseline = await scoreOf(baseInput);
  const failures: InvarianceResult<Input, number>["failures"] = [];
  for (const { scenario, category, mutatedInput } of plan.failures) {
    const actual = await scoreOf(mutatedInput);
    if (!Object.is(actual, baseline)) failures.push({ scenario, category, mutatedInput, expected: baseline, actual });
  }
  if (!deepEqual(pristine, baseInput)) throw new Error("score modified baseInput in place.");

  return { passed: failures.length === 0 && plan.vacuous.length === 0, baseline, failures, vacuous: plan.vacuous };
}
// README:async-recipe:end

interface Applicant {
  name: string;
  income: number;
}

/** Stand-in for a scorer that awaits something (a model call, a DB read). */
async function scoreApplicant(applicant: Applicant): Promise<number> {
  await Promise.resolve();
  return Math.min(850, 300 + Math.floor(applicant.income / 200));
}

/** A deliberately biased async scorer, to show the recipe still catches it. */
async function scoreApplicantWithNameBias(applicant: Applicant): Promise<number> {
  const honest = await scoreApplicant(applicant);
  return applicant.name.startsWith("W") ? honest - 40 : honest;
}

const base = (): Applicant => ({ name: "Base Applicant", income: 60_000 });
const nameScenarios = protectedAttributeScenarios<Applicant>(
  (applicant) => applicant.name,
  (applicant, value) => ({ ...applicant, name: value }),
  ["Wei Chen", "Aisha Osei"],
  { fieldLabel: "name" },
);

describe("async decision function", () => {
  it("passing the async function straight in is rejected, not silently passed", () => {
    expect(() => assertInvariance(scoreApplicant, base(), nameScenarios)).toThrow(/fn returned a Promise/);
  });

  it("the recipe passes the honest scorer", async () => {
    const result = await assertAsyncScoreInvariance(scoreApplicant, base(), nameScenarios);
    expect(result).toEqual({ passed: true, baseline: 600, failures: [], vacuous: [] });
  });

  it("the recipe catches the biased scorer and keeps the scenario category", async () => {
    const result = await assertAsyncScoreInvariance(scoreApplicantWithNameBias, base(), nameScenarios);
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      {
        scenario: 'name -> "Wei Chen"',
        category: "protected-attribute",
        mutatedInput: { name: "Wei Chen", income: 60_000 },
        expected: 600,
        actual: 560,
      },
    ]);
  });

  it("rejects a scorer that resolves to a shared object instead of a number (MIK-F005)", async () => {
    const shared = { score: 0 };
    const reusing = async (applicant: Applicant): Promise<number> => {
      shared.score = await scoreApplicantWithNameBias(applicant);
      return shared as unknown as number;
    };
    await expect(assertAsyncScoreInvariance(reusing, base(), nameScenarios)).rejects.toThrow(
      /score must resolve to a number/,
    );
  });

  it("rejects a mutate that edits baseInput before any async call runs (MIK-F005)", async () => {
    let scoreCalls = 0;
    const editing: MutationScenario<Applicant> = {
      name: "edits in place",
      mutate: (applicant) => {
        applicant.income = 1;
        return { ...applicant };
      },
    };
    const counted = async (applicant: Applicant): Promise<number> => {
      scoreCalls += 1;
      return scoreApplicant(applicant);
    };
    await expect(assertAsyncScoreInvariance(counted, base(), [editing])).rejects.toThrow(
      /mutate\(\) modified baseInput in place/,
    );
    expect(scoreCalls).toBe(0);
  });

  it("rejects a scorer that edits baseInput and propagates a rejection", async () => {
    const editing = async (applicant: Applicant): Promise<number> => {
      applicant.income += 1;
      return scoreApplicant({ ...applicant });
    };
    await expect(assertAsyncScoreInvariance(editing, base(), nameScenarios)).rejects.toThrow(
      /score modified baseInput in place/,
    );
    const rejecting = async (): Promise<number> => {
      throw new Error("model timeout");
    };
    await expect(assertAsyncScoreInvariance(rejecting, base(), nameScenarios)).rejects.toThrow("model timeout");
  });

  it("reports a vacuous scenario without awaiting the scorer for it", async () => {
    let scoreCalls = 0;
    const counted = async (applicant: Applicant): Promise<number> => {
      scoreCalls += 1;
      return scoreApplicant(applicant);
    };
    const noOp: MutationScenario<Applicant> = { name: "changes nothing", mutate: (applicant) => ({ ...applicant }) };
    const result = await assertAsyncScoreInvariance(counted, base(), [noOp]);
    expect(result).toEqual({ passed: false, baseline: 600, failures: [], vacuous: ["changes nothing"] });
    expect(scoreCalls).toBe(1);
  });

  it("README.md shows exactly this recipe", () => {
    const between = (text: string, start: string, end: string): string =>
      text.slice(text.indexOf(start) + start.length, text.indexOf(end)).trim();
    const source = readFileSync(new URL(import.meta.url), "utf8");
    const recipe = between(source, "// README:async-recipe:start", "// README:async-recipe:end");
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(recipe).toMatch(/^\/\*\*[\s\S]*async function assertAsyncScoreInvariance[\s\S]*\}$/);
    expect(readme).toContain(recipe);
  });
});
