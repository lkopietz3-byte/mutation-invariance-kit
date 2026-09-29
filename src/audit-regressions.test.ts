/**
 * Regressions for the 2026-09-28 audit findings (MIK-F001..F004) and the
 * bug-class sweep. Most of these failed on 0.1.1; the rest pin behavior the
 * fixes must keep (real in-place edits are still detected).
 */
import { describe, expect, it } from "vitest";

import { assertInvariance } from "./index.js";
import type { MutationScenario } from "./index.js";
import { geographyScenarios, priceScenarios, protectedAttributeScenarios } from "./presets/index.js";

interface Input {
  x: number;
  score?: number;
  items?: Uint8Array & { label?: string };
}

const bumpX: MutationScenario<Input> = { name: "x changes", mutate: (input) => ({ ...input, x: input.x + 1 }) };

describe("assertInvariance: one dense, validated scenario snapshot (MIK-F004)", () => {
  it("runs every scenario even when the array's Symbol.iterator is overridden", () => {
    const seen: number[] = [];
    const scenarios = [bumpX];
    Object.defineProperty(scenarios, Symbol.iterator, { value: function* () {} });
    const result = assertInvariance(
      (input: Input) => {
        seen.push(input.x);
        return input.x;
      },
      { x: 0 },
      scenarios,
    );
    expect(seen).toEqual([0, 1]);
    expect(result.passed).toBe(false);
  });

  it("rejects a sparse scenarios array before fn runs", () => {
    let calls = 0;
    const fn = (): number => (calls += 1);
    expect(() => assertInvariance(fn, { x: 0 }, new Array<MutationScenario<Input>>(1))).toThrow(TypeError);
    expect(() => assertInvariance(fn, { x: 0 }, new Array<MutationScenario<Input>>(1))).toThrow(
      /scenarios\[0\] is missing \(a hole/,
    );
    const late = [bumpX, bumpX];
    Reflect.deleteProperty(late, 1);
    expect(() => assertInvariance(fn, { x: 0 }, late)).toThrow(/scenarios\[1\] is missing/);
    expect(calls).toBe(0);
  });

  it("reads each scenario's name, mutate and category once, before fn runs", () => {
    let reads = 0;
    const scenario = {
      get name(): string {
        reads += 1;
        return "x changes";
      },
      get mutate(): (input: Input) => Input {
        reads += 1;
        return reads > 3 ? (input: Input) => input : (input: Input) => ({ ...input, x: 1 });
      },
      get category(): "custom" {
        reads += 1;
        return "custom";
      },
    };
    const result = assertInvariance((input: Input) => input.x, { x: 0 }, [scenario]);
    expect(reads).toBe(3);
    expect(result.failures).toEqual([
      { scenario: "x changes", category: "custom", mutatedInput: { x: 1 }, expected: 0, actual: 1 },
    ]);
  });
});

describe("assertInvariance: comparator and snapshot (MIK-F001, MIK-F002, MIK-F003)", () => {
  it("reports a score attached to a returned ArrayBuffer, DataView or SharedArrayBuffer", () => {
    const makers: ((input: Input) => object)[] = [
      (input: Input) => Object.assign(new ArrayBuffer(1), { score: input.x }),
      (input: Input) => Object.assign(new DataView(new ArrayBuffer(1)), { score: input.x }),
      (input: Input) => Object.assign(new SharedArrayBuffer(1), { score: input.x }),
      (input: Input) => Object.assign(new ArrayBuffer(1), { [Symbol.for("score")]: input.x }),
    ];
    for (const fn of makers) expect(assertInvariance(fn, { x: 0 }, [bumpX]).passed).toBe(false);
  });

  it("sees through a masked Map tag, an overridden getTime and an overridden valueOf", () => {
    class FrozenDate extends Date {
      override getTime(): number {
        return 0;
      }
    }
    class ZeroNumber extends Number {
      override valueOf(): number {
        return 0;
      }
    }
    const masked = (input: Input): Map<string, number> =>
      Object.defineProperty(new Map([["score", input.x]]), Symbol.toStringTag, { value: undefined, enumerable: true });
    expect(assertInvariance(masked, { x: 0 }, [bumpX]).passed).toBe(false);
    expect(assertInvariance((input: Input) => new FrozenDate(input.x), { x: 0 }, [bumpX]).passed).toBe(false);
    expect(assertInvariance((input: Input) => new ZeroNumber(input.x), { x: 0 }, [bumpX]).passed).toBe(false);
  });

  it("does not accuse a pure fn that reads an annotated typed array", () => {
    const items = Object.assign(new Uint8Array([1, 2]), { label: "input" });
    const result = assertInvariance((input: Input) => input.items?.[0] ?? 0, { x: 0, items }, [bumpX]);
    expect(result.passed).toBe(true);
  });

  it("still detects an fn that edits the typed array's metadata in place", () => {
    const items = Object.assign(new Uint8Array([1, 2]), { label: "input" });
    const fn = (input: Input): number => {
      if (input.items) input.items.label = "changed";
      return 0;
    };
    expect(() => assertInvariance(fn, { x: 0, items }, [bumpX])).toThrow(/modified baseInput in place/);
  });
});

describe("assertInvariance: options (bug class 1, 6 and 9)", () => {
  const fn = (input: Input): number => input.x;

  it("rejects options that are not a plain object, before fn runs", () => {
    let calls = 0;
    const counted = (input: Input): number => {
      calls += 1;
      return input.x;
    };
    for (const opts of [null, new Map(), [], "x", new Date()]) {
      expect(() => assertInvariance(counted, { x: 0 }, [bumpX], opts as never)).toThrow(/opts must be a plain object/);
    }
    expect(calls).toBe(0);
    expect(assertInvariance(fn, { x: 0 }, [bumpX], Object.create(null) as object).passed).toBe(false);
  });

  it("rejects hooks that are not functions, before fn runs", () => {
    for (const hook of ["isEqual", "hasChanged", "cleanup"]) {
      expect(() => assertInvariance(fn, { x: 0 }, [bumpX], { [hook]: true })).toThrow(
        new RegExp(`opts.${hook} must be a function`),
      );
    }
  });

  it("reads cleanup once", () => {
    let reads = 0;
    let cleaned = 0;
    const opts = {
      get cleanup(): () => void {
        reads += 1;
        return () => {
          cleaned += 1;
        };
      },
    };
    assertInvariance(fn, { x: 0 }, [bumpX, { name: "x again", mutate: (input) => ({ ...input, x: 5 }) }], opts);
    expect(reads).toBe(1);
    expect(cleaned).toBe(3);
  });
});

describe("assertInvariance: error text built from caller strings (bug class 3 and 8)", () => {
  it("escapes newlines, control and bidi characters in scenario names inside error messages", () => {
    const name = "line\nFAKE: passed\u001b[2J\u202Eevil";
    const throwing = {
      name,
      mutate: (): Input => {
        throw new Error("boom\nsecond line");
      },
    };
    let message = "";
    try {
      assertInvariance((input: Input) => input.x, { x: 0 }, [throwing]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(String.raw`"line\nFAKE: passed\u001b[2J\u202eevil"`);
    expect(message).toContain(String.raw`boom\nsecond line`);
    for (const raw of ["\n", "\u001b", "\u202E"]) expect(message).not.toContain(raw);
  });

  it("keeps its own message when a thrown value cannot be printed", () => {
    const error = Object.assign(new Error("x"), {
      message: {
        toString: (): string => {
          throw new Error("no");
        },
      },
    });
    const fn = (): number => {
      throw error;
    };
    expect(() => assertInvariance(fn, { x: 0 }, [bumpX])).toThrow(
      /fn threw on the baseline input: \(unprintable thrown value\)/,
    );
  });
});

describe("presets: dense values, safe messages (bug class 2, 3, 6, 7 and 8)", () => {
  interface Row {
    zip: string;
    price: number;
  }
  const getZip = (row: Row): string => row.zip;
  const setZip = (row: Row, zip: string): Row => ({ ...row, zip });

  it("rejects a sparse substitutionValues array instead of skipping the hole", () => {
    const values = new Array<string>(2);
    values[1] = "90210";
    expect(() => geographyScenarios(getZip, setZip, values)).toThrow(/substitutionValues\[0\] is missing/);
    const prices = [1, 2];
    Reflect.deleteProperty(prices, 0);
    expect(() => priceScenarios((row: Row) => row.price, (row: Row, price: number) => ({ ...row, price }), prices)).toThrow(
      /substitutionValues\[0\] is missing/,
    );
  });

  it("reports a broken setter with its own message even when the getter returns a BigInt or an unprintable value", () => {
    for (const odd of [1n, Object.create(null) as object]) {
      const [scenario] = geographyScenarios((() => odd) as unknown as (row: Row) => string, setZip, ["90210"]);
      expect(() => scenario?.mutate({ zip: "10001", price: 1 })).toThrow(/geography: setter did not apply "90210"/);
    }
  });

  it("escapes control and bidi characters of a label in the setter error", () => {
    const [scenario] = protectedAttributeScenarios(
      () => "unchanged",
      (row: { name: string }) => row,
      ["Wei Chen"],
      { fieldLabel: "name\nFAKE\u202E" },
    );
    let message = "";
    try {
      scenario?.mutate({ name: "x" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(String.raw`name\nFAKE\u202e: setter did not apply`);
  });

  it("rejects options that are not a plain object and labels that are not non-blank strings", () => {
    expect(() => geographyScenarios(getZip, setZip, ["1"], new Map() as never)).toThrow(/opts must be a plain object/);
    for (const fieldLabel of [1, "", "  ", "\u200B"]) {
      expect(() => geographyScenarios(getZip, setZip, ["1"], { fieldLabel: fieldLabel as never })).toThrow(
        /fieldLabel must be a non-blank string/,
      );
    }
  });
});

describe("remaining branches (tests audit)", () => {
  it("names null as the bad hook result", () => {
    expect(() => assertInvariance((input: Input) => input.x, { x: 0 }, [bumpX], { hasChanged: () => null as never })).toThrow(
      /hasChanged must return a boolean, got null/,
    );
  });

  it("describes what a broken getter returned without running caller code", () => {
    const cases: [unknown, string][] = [
      [-0, "-0"],
      [7, "7"],
      ["x\ny", String.raw`"x\ny"`],
      [{ toString: (): string => "never called" }, "an object"],
      [() => 1, "a function"],
      [Symbol("s"), "a symbol"],
      [undefined, "undefined"],
      [null, "null"],
    ];
    for (const [returned, shown] of cases) {
      const [scenario] = priceScenarios((() => returned) as unknown as (row: { p: number }) => number, (row) => row, [0]);
      expect(() => scenario?.mutate({ p: 1 })).toThrow(`(get() returned ${shown} right after set())`);
    }
  });
});
