/**
 * Runnable example: protectedAttributeScenarios + geographyScenarios
 * exercised against a tiny, self-contained toy loan-scoring engine.
 *
 * Entirely fictional/toy data — no real applicants, zip codes, income
 * figures, or lenders. Illustrative only.
 *
 * Run with: npx vitest run
 */
import { describe, expect, it } from "vitest";

import { assertInvariance } from "../src/index.js";
import { geographyScenarios, protectedAttributeScenarios } from "../src/presets/index.js";

interface LoanApplication {
  applicantName: string; // protected-attribute axis
  zipCode: string; // geography axis
  annualIncome: number;
  creditScoreBand: "poor" | "fair" | "good" | "excellent";
  requestedAmount: number;
}

interface LoanDecision {
  approved: boolean;
  offeredRateBps: number; // basis points; lower is better for the applicant
}

const baseApplication: LoanApplication = {
  applicantName: "Base Applicant",
  zipCode: "00000",
  annualIncome: 85_000,
  creditScoreBand: "good",
  requestedAmount: 20_000,
};

/** The engine under test: scores purely on income, credit band, and requested amount. */
function scoreLoan(app: LoanApplication): LoanDecision {
  const incomeToRequestRatio = app.annualIncome / app.requestedAmount;
  const bandBonus = { poor: -400, fair: -100, good: 0, excellent: 150 }[app.creditScoreBand];
  const approved = incomeToRequestRatio >= 2 && app.creditScoreBand !== "poor";
  const offeredRateBps = Math.max(200, 900 - Math.round(incomeToRequestRatio * 20) - bandBonus);
  return { approved, offeredRateBps };
}

/**
 * A deliberately biased variant, used below to prove the check has teeth:
 * it lets zip code nudge the offered rate — a toy stand-in for redlining.
 */
function scoreLoanWithZipBias(app: LoanApplication): LoanDecision {
  const honest = scoreLoan(app);
  const zipPenaltyBps = app.zipCode.startsWith("9") ? 0 : 75; // arbitrary, biased
  return { ...honest, offeredRateBps: honest.offeredRateBps + zipPenaltyBps };
}

describe("toy loan scoring: protected-attribute invariance", () => {
  it("the decision doesn't change when only the applicant's name changes", () => {
    const scenarios = protectedAttributeScenarios<LoanApplication>(
      (app) => app.applicantName,
      (app, value) => ({ ...app, applicantName: value }),
      ["Jordan Smith", "Wei Chen", "Aisha Osei", "Maria Garcia-Lopez", "Connor O'Brien"],
      { fieldLabel: "applicant name" },
    );

    const result = assertInvariance(scoreLoan, baseApplication, scenarios);

    expect(result.vacuous).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("toy loan scoring: geography invariance", () => {
  it("the honest engine doesn't change the decision when only zip code changes", () => {
    const scenarios = geographyScenarios<LoanApplication>(
      (app) => app.zipCode,
      (app, value) => ({ ...app, zipCode: value }),
      ["10001", "90210", "60601", "94110", "73301"],
      { fieldLabel: "zip code" },
    );

    const result = assertInvariance(scoreLoan, baseApplication, scenarios);

    expect(result.vacuous).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("catches an engine that DOES let zip code influence the offered rate", () => {
    // Both substitution zips start with "9" (no penalty under the biased
    // engine below); baseApplication's zip "00000" does not (gets the
    // penalty) — so both mutations should flip the offered rate.
    const scenarios = geographyScenarios<LoanApplication>(
      (app) => app.zipCode,
      (app, value) => ({ ...app, zipCode: value }),
      ["90210", "94110"],
      { fieldLabel: "zip code" },
    );

    const result = assertInvariance(scoreLoanWithZipBias, baseApplication, scenarios);

    expect(result.vacuous).toEqual([]);
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(2);
    const failureZips = result.failures.map((f) => f.mutatedInput.zipCode).sort();
    expect(failureZips).toEqual(["90210", "94110"]);
  });
});
