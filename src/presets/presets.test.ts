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

describe("preset boundaries and error paths", () => {
  interface Listing {
    price: number;
    zip: string;
    name: string;
  }
  const base: Listing = { price: 0, zip: "00000", name: "Base" };
  const getPrice = (l: Listing) => l.price;
  const setPrice = (l: Listing, value: number): Listing => ({ ...l, price: value });
  const getZip = (l: Listing) => l.zip;
  const setZip = (l: Listing, value: string): Listing => ({ ...l, zip: value });

  it("gives 0 and -0 distinct scenario names, and treats -0 as a real change from 0", () => {
    const scenarios = priceScenarios(getPrice, setPrice, [0, -0]);
    expect(scenarios.map((s) => s.name)).toEqual(["price -> 0", "price -> -0"]);
    const result = assertInvariance((l: Listing) => Object.is(l.price, -0), base, scenarios);
    expect(result.vacuous).toEqual(["price -> 0"]);
    expect(result.failures.map((f) => f.scenario)).toEqual(["price -> -0"]);
  });

  it("accepts NaN, Infinity and negative prices as substitution values", () => {
    const scenarios = priceScenarios(getPrice, setPrice, [NaN, Infinity, -1]);
    expect(scenarios.map((s) => s.name)).toEqual(["price -> NaN", "price -> Infinity", "price -> -1"]);
    expect(scenarios.map((s) => getPrice(s.mutate(base)))).toEqual([NaN, Infinity, -1]);
  });

  it("catches a setter that rounds or clamps the value it was given", () => {
    const [scenario] = priceScenarios(getPrice, (l, value) => ({ ...l, price: Math.round(value) }), [9.99]);
    expect(() => scenario!.mutate(base)).toThrow(/price: setter did not apply 9.99 to the input \(get\(\) returned 10/);
  });

  it("uses the default labels and JSON-quotes string values in scenario names", () => {
    expect(geographyScenarios(getZip, setZip, ["02138"])[0]?.name).toBe('geography -> "02138"');
    expect(priceScenarios(getPrice, setPrice, [5])[0]?.name).toBe("price -> 5");
    expect(
      protectedAttributeScenarios((l: Listing) => l.name, (l, v) => ({ ...l, name: v }), ['Zoë "Z" Ødegaard'])[0]?.name,
    ).toBe('protected attribute -> "Zoë \\"Z\\" Ødegaard"');
  });

  it("returns no scenarios for an empty value list, which assertInvariance then refuses to run", () => {
    const scenarios = geographyScenarios(getZip, setZip, []);
    expect(scenarios).toEqual([]);
    expect(() => assertInvariance((l: Listing) => l.price, base, scenarios)).toThrow(/scenarios is empty/);
  });

  it.each([
    ["substitutionValues is not an array", () => priceScenarios(getPrice, setPrice, undefined as unknown as number[]), /priceScenarios: substitutionValues must be an array of numbers/],
    ["a zip is passed as a number (would drop its leading zero)", () => geographyScenarios(getZip, setZip, [2138] as unknown as string[]), /geographyScenarios: substitutionValues\[0\] must be a string, got number/],
    ["a price is passed as a string", () => priceScenarios(getPrice, setPrice, ["9.99"] as unknown as number[]), /priceScenarios: substitutionValues\[0\] must be a number, got string/],
    ["a name is null", () => protectedAttributeScenarios((l: Listing) => l.name, (l, v) => ({ ...l, name: v }), [null] as unknown as string[]), /protectedAttributeScenarios: substitutionValues\[0\] must be a string, got null/],
    ["get is not a function", () => priceScenarios(undefined as unknown as typeof getPrice, setPrice, [1]), /priceScenarios: get must be a function/],
    ["set is not a function", () => geographyScenarios(getZip, "zip" as unknown as typeof setZip, ["1"]), /geographyScenarios: set must be a function/],
  ])("throws a TypeError when %s", (_label, call, message) => {
    expect(call).toThrow(TypeError);
    expect(call).toThrow(message);
  });

  it("rejects a setter that writes into the input instead of returning a copy (via assertInvariance)", () => {
    const scenarios = geographyScenarios(getZip, (l: Listing, value) => Object.assign(l, { zip: value }), ["90210"]);
    expect(() => assertInvariance((l: Listing) => l.price, { ...base }, scenarios)).toThrow(
      /scenario "geography -> \\"90210\\"": mutate\(\) modified baseInput in place/,
    );
  });
});
