import { describe, expect, it } from "vitest";

import { assertInvariance, deepEqual } from "./index.js";

/** Build a sparse array of `length` with only the given indices set. */
function sparse(length: number, entries: Record<number, unknown>): unknown[] {
  const array = new Array<unknown>(length);
  for (const [index, value] of Object.entries(entries)) array[Number(index)] = value;
  return array;
}

describe("deepEqual: equal values", () => {
  it("treats structurally identical plain objects/arrays as equal", () => {
    expect(deepEqual({ a: [1, 2, { b: "x" }] }, { a: [1, 2, { b: "x" }] })).toBe(true);
  });

  it("treats NaN as equal to NaN, at the top level and nested", () => {
    expect(deepEqual(NaN, NaN)).toBe(true);
    expect(deepEqual({ score: NaN }, { score: NaN })).toBe(true);
  });

  it("treats two invalid dates as equal (they hold the same NaN time value)", () => {
    expect(deepEqual(new Date(NaN), new Date(NaN))).toBe(true);
    expect(deepEqual({ at: new Date("not a date") }, { at: new Date("also not") })).toBe(true);
  });

  it("matches Map entries whose keys are structurally equal objects", () => {
    expect(deepEqual(new Map([[{ id: 1 }, "a"]]), new Map([[{ id: 1 }, "a"]]))).toBe(true);
  });

  it("compares Dates, RegExps, typed arrays, ArrayBuffers and boxed primitives by value", () => {
    expect(deepEqual(new Date(5), new Date(5))).toBe(true);
    expect(deepEqual(/a/gi, /a/gi)).toBe(true);
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(deepEqual(new Uint8Array([7]).buffer, new Uint8Array([7]).buffer)).toBe(true);
    expect(deepEqual(Object(1), Object(1))).toBe(true);
  });

  it("handles circular references instead of overflowing the stack", () => {
    const a: Record<string, unknown> = { id: 1 };
    a.self = a;
    const b: Record<string, unknown> = { id: 1 };
    b.self = b;
    expect(deepEqual(a, b)).toBe(true);

    const c: Record<string, unknown> = { id: 2 };
    c.self = c;
    expect(deepEqual(a, c)).toBe(false);
  });

  it("compares own __proto__, constructor and prototype keys as ordinary data without polluting Object.prototype", () => {
    const text = '{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"prototype":1}';
    expect(deepEqual(JSON.parse(text), JSON.parse(text))).toBe(true);
    expect(deepEqual(JSON.parse('{"__proto__":{"a":1}}'), JSON.parse('{"__proto__":{"a":2}}'))).toBe(false);
    expect(deepEqual(JSON.parse('{"__proto__":{"a":1}}'), {})).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("deepEqual: different values (each of these returned true before the fix)", () => {
  it("treats structurally different values as unequal", () => {
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it("does not treat an array hole as equal to a value", () => {
    expect(deepEqual(sparse(2, { 1: 1 }), [2, 1])).toBe(false);
    expect(deepEqual(new Array(3), [1, 2, 3])).toBe(false);
    expect(deepEqual(sparse(2, { 1: 1 }), [undefined, 1])).toBe(false);
  });

  it("matches Set members one-to-one, so duplicates cannot cover for a missing member", () => {
    expect(deepEqual(new Set([{ a: 1 }, { a: 1 }]), new Set([{ a: 1 }, { a: 2 }]))).toBe(false);
  });

  it("compares Error name, message and cause", () => {
    expect(deepEqual(new Error("declined"), new Error("approved"))).toBe(false);
    expect(deepEqual(new Error("x"), new TypeError("x"))).toBe(false);
    expect(deepEqual(new Error("x", { cause: 1 }), new Error("x", { cause: 2 }))).toBe(false);
    expect(deepEqual(new Error("x"), new Error("x"))).toBe(true);
  });

  it("compares ArrayBuffer and DataView bytes, and typed array element types", () => {
    expect(deepEqual(new ArrayBuffer(4), new ArrayBuffer(8))).toBe(false);
    expect(deepEqual(new Uint8Array([1]).buffer, new Uint8Array([2]).buffer)).toBe(false);
    expect(deepEqual(new DataView(new Uint8Array([1]).buffer), new DataView(new Uint8Array([2]).buffer))).toBe(false);
    expect(deepEqual(new Uint8Array([1, 2]), new Uint16Array([1, 2]))).toBe(false);
  });

  it("compares boxed primitives by their value", () => {
    expect(deepEqual(Object(1), Object(2))).toBe(false);
    expect(deepEqual(Object("a"), Object("b"))).toBe(false);
  });

  it("compares own enumerable symbol keys", () => {
    const key = Symbol("rank");
    expect(deepEqual({ [key]: 1 }, { [key]: 2 })).toBe(false);
  });

  it("requires the same prototype, so a class instance is not a plain object and null-prototype objects are distinct", () => {
    class Offer {
      constructor(public rate: number) {}
    }
    expect(deepEqual(new Offer(1), { rate: 1 })).toBe(false);
    expect(deepEqual(Object.create(null), {})).toBe(false);
    expect(deepEqual(new Offer(1), new Offer(1))).toBe(true);
  });

  it("compares extra own properties on arrays", () => {
    expect(deepEqual(Object.assign([1], { note: "x" }), [1])).toBe(false);
  });

  it("treats Promises, WeakMaps and objects with a custom Symbol.toStringTag as equal only to themselves", () => {
    const promise = Promise.resolve(1);
    expect(deepEqual(Promise.resolve(1), Promise.resolve(1))).toBe(false);
    expect(deepEqual(promise, promise)).toBe(true);
    expect(deepEqual(new WeakMap(), new WeakMap())).toBe(false);
    class Money {
      constructor(public cents: number) {}
      get [Symbol.toStringTag](): string {
        return "Money";
      }
    }
    expect(deepEqual(new Money(1), new Money(1))).toBe(false);
  });

  it("does not trust a spoofed Symbol.toStringTag (and does not throw on one)", () => {
    const fakeMap = { [Symbol.toStringTag]: "Map", size: 0 };
    expect(() => deepEqual(fakeMap, { [Symbol.toStringTag]: "Map", size: 0 })).not.toThrow();
    expect(deepEqual(fakeMap, { [Symbol.toStringTag]: "Map", size: 0 })).toBe(false);
    expect(deepEqual(fakeMap, fakeMap)).toBe(true);
  });

  it("keeps 0 and -0 distinct and applies no floating-point tolerance", () => {
    expect(deepEqual(0, -0)).toBe(false);
    expect(deepEqual({ a: 0 }, { a: -0 })).toBe(false);
    expect(deepEqual(0.1 + 0.2, 0.3)).toBe(false);
  });
});

describe("deepEqual inside assertInvariance", () => {
  it("catches a decision that differs only in an Error message (a false pass before the fix)", () => {
    const decide = (input: { zip: string }) => ({
      approved: false,
      reason: new Error(input.zip.startsWith("9") ? "outside service area" : "insufficient income"),
    });
    const result = assertInvariance(decide, { zip: "00000" }, [
      { name: "zip -> 90210", mutate: (input) => ({ ...input, zip: "90210" }) },
    ]);
    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.scenario)).toEqual(["zip -> 90210"]);
  });

  it("no longer reports a false failure for an output keyed by object Map keys", () => {
    const tally = (input: { names: string[] }) => new Map([[{ bucket: "all" }, input.names.length]]);
    const result = assertInvariance(tally, { names: ["a", "b"] }, [
      { name: "rename", mutate: () => ({ names: ["c", "d"] }) },
    ]);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });
});
