import { describe, expect, it } from "vitest";

import { assertInvariance } from "../index.js";
import { geographyScenarios, priceScenarios, protectedAttributeScenarios } from "./index.js";

interface LoanApplication {
  applicantName: string;
  zipCode: string;
  income: number;
}

describe("protectedAttributeScenarios", () => {
  const get = (app: LoanApplication) => app.applicantName;
  const set = (app: LoanApplication, value: string): LoanApplication => ({
    ...app,
    applicantName: value,
  });

  it("produces one correctly-shaped, correctly-categorized scenario per substitution value", () => {
    const scenarios = protectedAttributeScenarios(get, set, ["Jordan Smith", "Wei Chen"], {
      fieldLabel: "applicant name",
    });

    expect(scenarios).toHaveLength(2);
    for (const s of scenarios) {
      expect(typeof s.name).toBe("string");
      expect(s.category).toBe("protected-attribute");
      expect(typeof s.mutate).toBe("function");
    }

    const base: LoanApplication = { applicantName: "Base Name", zipCode: "00000", income: 50_000 };
    const mutated = scenarios[0]!.mutate(base);
    expect(get(mutated)).toBe("Jordan Smith");
    // Only the targeted field changed.
    expect(mutated.zipCode).toBe(base.zipCode);
    expect(mutated.income).toBe(base.income);
  });

  it("defaults fieldLabel to 'protected attribute' when none is given", () => {
    const [scenario] = protectedAttributeScenarios(get, set, ["Sam Lee"]);
    expect(scenario?.name).toContain("protected attribute");
  });

  it("throws a clear error if the setter doesn't actually apply the value (mismatched get/set pair)", () => {
    const brokenSet = (app: LoanApplication): LoanApplication => ({ ...app }); // forgets to write
    const [scenario] = protectedAttributeScenarios(get, brokenSet, ["Someone Else"]);

    expect(() =>
      scenario!.mutate({ applicantName: "Base", zipCode: "00000", income: 1 }),
    ).toThrow(/setter did not apply/);
  });
});

describe("geographyScenarios", () => {
  it("produces geography-categorized scenarios from a zip getter/setter", () => {
    const get = (app: LoanApplication) => app.zipCode;
    const set = (app: LoanApplication, value: string): LoanApplication => ({ ...app, zipCode: value });

    const scenarios = geographyScenarios(get, set, ["10001", "90210"], { fieldLabel: "zip code" });

    expect(scenarios.map((s) => s.category)).toEqual(["geography", "geography"]);
    const base: LoanApplication = { applicantName: "Base", zipCode: "00000", income: 1 };
    expect(get(scenarios[1]!.mutate(base))).toBe("90210");
  });

  it("preserves a zip code's leading zero (string, not number)", () => {
    const get = (app: LoanApplication) => app.zipCode;
    const set = (app: LoanApplication, value: string): LoanApplication => ({ ...app, zipCode: value });

    const [scenario] = geographyScenarios(get, set, ["02138"]);
    const base: LoanApplication = { applicantName: "Base", zipCode: "00000", income: 1 };
    expect(get(scenario!.mutate(base))).toBe("02138");
  });
});

describe("priceScenarios", () => {
  interface Listing {
    price: number;
    quality: number;
  }

  it("produces price-categorized scenarios from a numeric getter/setter", () => {
    const get = (l: Listing) => l.price;
    const set = (l: Listing, value: number): Listing => ({ ...l, price: value });

    const scenarios = priceScenarios(get, set, [9.99, 999.99]);

    expect(scenarios).toHaveLength(2);
    expect(scenarios.every((s) => s.category === "price")).toBe(true);
    const base: Listing = { price: 19.99, quality: 5 };
    expect(get(scenarios[0]!.mutate(base))).toBe(9.99);
  });

  it("wires into assertInvariance end-to-end, including a vacuous substitution value", () => {
    const base: Listing = { price: 10, quality: 5 };
    // Function under test intentionally ignores price.
    const qualityOnly = (l: Listing) => l.quality;

    const scenarios = priceScenarios<Listing>(
      (l) => l.price,
      (l, value) => ({ ...l, price: value }),
      [0, 10, 99_999], // 10 matches the base price exactly -> vacuous
    );

    const result = assertInvariance(qualityOnly, base, scenarios);

    expect(result.vacuous).toEqual(["price -> 10"]);
    expect(result.failures).toEqual([]);
    // passed is false purely because of the vacuous scenario, not a failure.
    expect(result.passed).toBe(false);
  });
});
