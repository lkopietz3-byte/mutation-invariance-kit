/**
 * Runnable example: checking an ASYNC decision function.
 *
 * assertInvariance is synchronous and throws if fn returns a Promise. To check
 * an async function, build each mutated input once, await every output
 * yourself (one at a time, so the order is deterministic), then hand
 * assertInvariance a synchronous lookup plus scenarios that return those same
 * prebuilt inputs.
 *
 * Entirely fictional/toy data. Run with: npx vitest run
 */
import { describe, expect, it } from "vitest";

import { assertInvariance } from "../src/index.js";
import type { InvarianceResult, MutationScenario } from "../src/index.js";
import { protectedAttributeScenarios } from "../src/presets/index.js";

interface Applicant {
  name: string;
  income: number;
}

/** Stand-in for a scorer that awaits something (a model call, a DB read). */
async function scoreApplicant(applicant: Applicant): Promise<number> {
  await Promise.resolve();
  return Math.min(850, 300 + Math.floor(applicant.income / 200));
}

/** A deliberately biased async scorer, to show the pattern still catches it. */
async function scoreApplicantWithNameBias(applicant: Applicant): Promise<number> {
  const honest = await scoreApplicant(applicant);
  return applicant.name.startsWith("W") ? honest - 40 : honest;
}

async function assertAsyncInvariance<Input, Output>(
  fn: (input: Input) => Promise<Output>,
  baseInput: Input,
  scenarios: MutationScenario<Input>[],
): Promise<InvarianceResult<Input, Output>> {
  const mutatedInputs = scenarios.map((scenario) => scenario.mutate(baseInput));
  const outputs = new Map<Input, Output>();
  for (const input of [baseInput, ...mutatedInputs]) outputs.set(input, await fn(input));

  return assertInvariance(
    (input: Input) => {
      if (!outputs.has(input)) throw new Error("input was not precomputed");
      return outputs.get(input) as Output;
    },
    baseInput,
    scenarios.map((scenario, index) => ({ ...scenario, mutate: () => mutatedInputs[index] as Input })),
  );
}

const base: Applicant = { name: "Base Applicant", income: 60_000 };
const nameScenarios = protectedAttributeScenarios<Applicant>(
  (applicant) => applicant.name,
  (applicant, value) => ({ ...applicant, name: value }),
  ["Wei Chen", "Aisha Osei"],
  { fieldLabel: "name" },
);

describe("async decision function", () => {
  it("passing the async function straight in is rejected, not silently passed", () => {
    expect(() => assertInvariance(scoreApplicant, base, nameScenarios)).toThrow(/fn returned a Promise/);
  });

  it("the precompute pattern passes the honest scorer", async () => {
    const result = await assertAsyncInvariance(scoreApplicant, base, nameScenarios);
    expect(result.vacuous).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("the precompute pattern catches the biased scorer", async () => {
    const result = await assertAsyncInvariance(scoreApplicantWithNameBias, base, nameScenarios);
    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.scenario)).toEqual(['name -> "Wei Chen"']);
  });
});
