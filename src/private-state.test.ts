/**
 * Private `#fields` cannot be read from outside the class, so the default
 * comparison cannot see them (README, "Honest limits"). These tests pin that
 * documented behavior and the recipe that closes the gap, plus an end-to-end
 * check that a disguised built-in output cannot pass.
 */
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { assertInvariance } from "./index.js";
import type { MutationScenario } from "./index.js";

interface Applicant {
  zip: string;
  income: number;
}

class Decision {
  #approved: boolean;
  constructor(approved: boolean) {
    this.#approved = approved;
  }
  get approved(): boolean {
    return this.#approved;
  }
}

const base: Applicant = { zip: "10001", income: 50 };
const zip: MutationScenario<Applicant> = { name: "zip changes", mutate: (input) => ({ ...input, zip: "02138" }) };
const byZip = (input: Applicant): boolean => input.zip === "10001";

describe("class instances whose state lives only in #private fields", () => {
  it("documented limit: a biased function that returns only private state passes the default comparison", () => {
    const biased = (input: Applicant): Decision => new Decision(byZip(input));
    expect(biased(base).approved).toBe(true);
    expect(biased(zip.mutate(base)).approved).toBe(false);
    expect(assertInvariance(biased, base, [zip]).passed).toBe(true);
  });

  it("an isEqual that compares the getters you care about catches the bias", () => {
    const biased = (input: Applicant): Decision => new Decision(byZip(input));
    const result = assertInvariance(biased, base, [zip], { isEqual: (a, b) => a.approved === b.approved });
    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.scenario)).toEqual(["zip changes"]);
  });

  it("returning plain data instead also catches the bias", () => {
    const biased = (input: Applicant): { approved: boolean } => ({ approved: byZip(input) });
    expect(assertInvariance(biased, base, [zip]).passed).toBe(false);
  });
});

describe("a disguised built-in output cannot pass", () => {
  it("fails a function whose output is a Proxy around a Date from another realm", () => {
    const realm: object = createContext({});
    const biased = (input: Applicant): object => ({
      when: runInContext(`new Proxy(new Date(${byZip(input) ? 1 : 2}), {})`, realm) as object,
    });
    expect(assertInvariance(biased, base, [zip]).passed).toBe(false);
  });
});

describe("documented limit: one shared output object edited on every call", () => {
  it("a reused Error, DataView or boxed primitive with an extra property passes (kept by reference)", () => {
    const error = new Error("x");
    const reuseError = (input: Applicant): { reason: Error } => {
      error.message = input.zip;
      return { reason: error };
    };
    const view = new DataView(new ArrayBuffer(1));
    const reuseView = (input: Applicant): { view: DataView } => {
      view.setUint8(0, byZip(input) ? 1 : 0);
      return { view };
    };
    const boxed = Object.assign(new Number(1), { tag: "" });
    const reuseBoxed = (input: Applicant): { boxed: typeof boxed } => {
      boxed.tag = input.zip;
      return { boxed };
    };
    expect(assertInvariance(reuseError, base, [zip]).passed).toBe(true);
    expect(assertInvariance(reuseView, base, [zip]).passed).toBe(true);
    expect(assertInvariance(reuseBoxed, base, [zip]).passed).toBe(true);
    // A fresh object per call is compared by content and fails.
    expect(assertInvariance((input: Applicant) => ({ reason: new Error(input.zip) }), base, [zip]).passed).toBe(false);
  });
});
