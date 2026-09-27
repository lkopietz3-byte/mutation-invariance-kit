import { describe, expect, it } from "vitest";

import { assertInvariance } from "./index.js";
import type { MutationScenario } from "./index.js";

interface Applicant {
  name: string;
  zip: string;
  score?: number;
}

/** Deep-freeze a value so any write by the kit would throw in strict mode. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key));
  }
  return value;
}

describe("assertInvariance: fn or mutate modifying inputs in place", () => {
  it("catches an fn that memoizes onto its input (this produced a false pass before the fix)", () => {
    // Scores depend on zip, but the first call caches the score on the input
    // object, and every scenario's spread copy carries the cached value along.
    const scoreWithCache = (applicant: Applicant): number => {
      applicant.score ??= applicant.zip.startsWith("9") ? 500 : 700;
      return applicant.score;
    };
    const base: Applicant = { name: "A", zip: "00000" };
    const scenarios: MutationScenario<Applicant>[] = [
      { name: "zip -> 90210", mutate: (input) => ({ ...input, zip: "90210" }) },
    ];
    expect(() => assertInvariance(scoreWithCache, base, scenarios)).toThrow(
      /fn \(on the baseline input\) modified baseInput in place/,
    );
  });

  it("catches a mutate that writes through a shallow copy into the shared nested object", () => {
    const base = { applicant: { name: "A" }, income: 5 };
    const scenario: MutationScenario<typeof base> = {
      name: "rename via shallow copy",
      mutate: (input) => {
        const copy = { ...input };
        copy.applicant.name = "B";
        return copy;
      },
    };
    expect(() => assertInvariance((input) => input.income, base, [scenario])).toThrow(
      /scenario "rename via shallow copy": mutate\(\) modified baseInput in place/,
    );
  });

  it("catches an fn that sorts an array it shares with baseInput", () => {
    const base = { items: [3, 1, 2], label: "x" };
    const rankInPlace = (input: typeof base) => input.items.sort((a, b) => a - b)[0];
    // The baseline call already sorts base.items in place.
    expect(() =>
      assertInvariance(rankInPlace, base, [{ name: "relabel", mutate: (i) => ({ ...i, label: "y" }) }]),
    ).toThrow(/fn \(on the baseline input\) modified baseInput in place/);
  });

  it("names the scenario when fn changes shared state only on a mutated input", () => {
    const base = { items: [1, 2, 3], label: "x" };
    const fn = (input: typeof base) => {
      if (input.label === "y") input.items.reverse();
      return input.items.length;
    };
    expect(() => assertInvariance(fn, base, [{ name: "relabel", mutate: (i) => ({ ...i, label: "y" }) }])).toThrow(
      /scenario "relabel": fn modified baseInput in place/,
    );
  });

  it.each([
    ["a Set", (b: Nested) => b.tags.add("new")],
    ["a Map", (b: Nested) => b.limits.set("daily", 1)],
    ["a Date", (b: Nested) => b.since.setUTCFullYear(1999)],
    ["a class instance", (b: Nested) => (b.account.balance = 0)],
    ["a typed array", (b: Nested) => (b.bytes[0] = 9)],
  ])("detects an in-place change inside %s", (_label, write) => {
    const base = nested();
    const scenario: MutationScenario<Nested> = {
      name: "writes in place",
      mutate: (input) => {
        write(input);
        return { ...input, flag: !input.flag };
      },
    };
    expect(() => assertInvariance((input) => input.flag, base, [scenario])).toThrow(/modified baseInput in place/);
  });

  it("catches an fn that reuses and rewrites its returned array (a false pass before the fix)", () => {
    const buffer: string[] = [];
    const rankIntoBuffer = (input: { zip: string }) => {
      buffer.length = 0;
      buffer.push(input.zip.startsWith("9") ? "premium-first" : "budget-first");
      return buffer;
    };
    expect(() =>
      assertInvariance(rankIntoBuffer, { zip: "00000" }, [{ name: "zip -> 90210", mutate: () => ({ zip: "90210" }) }]),
    ).toThrow(/fn modified its earlier \(baseline\) output in place during scenario "zip -> 90210"/);
  });

  it("never writes to the caller's input: a deep-frozen base input with Map, Set, Date and nested arrays works", () => {
    const base = deepFreeze({ name: "A", tags: new Set(["x"]), limits: new Map([["d", 1]]), at: new Date(0), list: [[1]] });
    const result = assertInvariance((input: typeof base) => input.list.length, base, [
      { name: "rename", mutate: (input) => ({ ...input, name: "B" }) },
    ]);
    expect(result.passed).toBe(true);
  });

  it("does not false-alarm on inputs holding functions, errors, promises, cycles and sparse arrays", () => {
    const cyclic: Record<string, unknown> = { id: 1 };
    cyclic.self = cyclic;
    const base = {
      name: "A",
      callback: () => 1,
      error: new Error("kept"),
      pending: Promise.resolve(1),
      cyclic,
      holes: new Array<number>(3),
    };
    const result = assertInvariance((input: typeof base) => input.holes.length, base, [
      { name: "rename", mutate: (input) => ({ ...input, name: "B" }) },
    ]);
    expect(result.passed).toBe(true);
  });

  it("handles own __proto__, constructor and prototype keys in the input without polluting Object.prototype", () => {
    const base = JSON.parse(
      '{"name":"A","__proto__":{"isAdmin":true},"constructor":{"prototype":{"polluted":true}},"prototype":1}',
    ) as { name: string };
    const result = assertInvariance((input: { name: string }) => Object.keys(input).length, base, [
      { name: "rename", mutate: (input) => ({ ...input, name: "B" }) },
    ]);
    expect(result.passed).toBe(true);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does NOT detect in-place changes inside values it keeps by reference, such as an Error (documented limit)", () => {
    const base = { error: new Error("original"), flag: false };
    const scenario: MutationScenario<typeof base> = {
      name: "edits the error",
      mutate: (input) => {
        input.error.message = "edited";
        return { ...input, flag: true };
      },
    };
    expect(() => assertInvariance(() => 1, base, [scenario])).not.toThrow();
  });
});

class Account {
  constructor(public balance: number) {}
}

interface Nested {
  flag: boolean;
  tags: Set<string>;
  limits: Map<string, number>;
  since: Date;
  account: Account;
  bytes: Uint8Array;
}

function nested(): Nested {
  return {
    flag: false,
    tags: new Set(["a"]),
    limits: new Map([["daily", 5]]),
    since: new Date(Date.UTC(2020, 0, 1)),
    account: new Account(10),
    bytes: new Uint8Array([1, 2]),
  };
}
