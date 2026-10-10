/**
 * Verdict regression table. Each case names the verdict a user should get
 * (passed, failed, or a clear error) for a realistic input, so a wrong
 * verdict on normal use shows up here first.
 *
 * Part 1 (fixes): cases that returned a wrong verdict before the fixes.
 * Part 2 (guards): behavior that already held and must keep holding.
 * Part 3 (self-hunt): probes written against the fast paths.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { assertInvariance, deepEqual } from "../src/index.js";
import type { MutationScenario } from "../src/index.js";
import { geographyScenarios } from "../src/presets/index.js";
import { runChild } from "./child.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  price: number;
}
interface Catalog {
  rows: Row[];
}

const catalog: Catalog = {
  rows: [
    { id: "a", price: 1 },
    { id: "b", price: 2 },
  ],
};

/** Flips the order the function ranks the two rows in (a cheaper than b becomes b cheaper than a). */
const flipPrices: MutationScenario<Catalog> = {
  name: "swap prices",
  mutate: (input) => ({ rows: input.rows.map((row) => ({ ...row, price: row.id === "a" ? 2 : 1 })) }),
};

const ranked = (input: Catalog): Row[] => [...input.rows].sort((x, y) => x.price - y.price);

const rankAsArray = (input: Catalog): string[] => ranked(input).map((row) => row.id);
const rankAsMap = (input: Catalog): Map<string, true> => new Map(ranked(input).map((row) => [row.id, true]));
const rankAsSet = (input: Catalog): Set<string> => new Set(ranked(input).map((row) => row.id));
const rankAsObject = (input: Catalog): Record<string, true> =>
  Object.fromEntries(ranked(input).map((row) => [row.id, true]));

/** A chain of `depth` single-key objects ending in `leaf`. Built in a loop, so building never recurses. */
function chain(depth: number, leaf: unknown = 1): unknown {
  let node: unknown = { leaf };
  for (let i = 0; i < depth; i += 1) node = { next: node };
  return node;
}
function arrayChain(depth: number, leaf: unknown = 1): unknown {
  let node: unknown = [leaf];
  for (let i = 0; i < depth; i += 1) node = [node];
  return node;
}
function setChain(depth: number, leaf: unknown = 1): unknown {
  let node: unknown = new Set([{ leaf }]);
  for (let i = 0; i < depth; i += 1) node = new Set([node]);
  return node;
}

/**
 * CPU time (user + system, in ms) a run used. CPU time, not wall time, so a
 * busy machine that starves the test process does not fail a speed check.
 */
function elapsedMs(run: () => unknown): number {
  const start = process.cpuUsage();
  run();
  const used = process.cpuUsage(start);
  return (used.user + used.system) / 1000;
}

/** The fastest of a few runs, so one slow garbage collection does not decide the verdict. */
function bestOf(runs: number, run: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < runs; i += 1) best = Math.min(best, elapsedMs(run));
  return best;
}

// ---------------------------------------------------------------------------
// Part 1: verdicts that were wrong before the fixes
// ---------------------------------------------------------------------------

describe("verdict table 1a: order of a returned Map, Set or keyed object", () => {
  const outputs = [
    ["Map", rankAsMap],
    ["Set", rankAsSet],
    ["keyed object", rankAsObject],
  ] as const;

  it("control: the same ranking as an Array fails (order is the whole point of a ranking)", () => {
    const result = assertInvariance(rankAsArray, catalog, [flipPrices]);
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
  });

  for (const [label, fn] of outputs) {
    it(`${label}: passes by default (order is not compared; documented in Honest limits)`, () => {
      const result = assertInvariance(fn as (input: Catalog) => unknown, catalog, [flipPrices]);
      expect(result.passed).toBe(true);
    });

    it(`${label}: fails with orderSensitive: true`, () => {
      const result = assertInvariance(fn as (input: Catalog) => unknown, catalog, [flipPrices], {
        orderSensitive: true,
      });
      expect(result.passed).toBe(false);
      expect(result.failures.map((failure) => failure.scenario)).toEqual(["swap prices"]);
    });

    it(`${label}: orderSensitive: true still passes when the order does not change`, () => {
      const keepOrder: MutationScenario<Catalog> = {
        name: "raise both prices",
        mutate: (input) => ({ rows: input.rows.map((row) => ({ ...row, price: row.price + 10 })) }),
      };
      const result = assertInvariance(fn as (input: Catalog) => unknown, catalog, [keepOrder], {
        orderSensitive: true,
      });
      expect(result.passed).toBe(true);
    });
  }

  it("deepEqual takes the same option: order ignored by default, significant with orderSensitive: true", () => {
    const pairs: [unknown, unknown][] = [
      [new Map([["a", 1], ["b", 2]]), new Map([["b", 2], ["a", 1]])],
      [new Set(["a", "b"]), new Set(["b", "a"])],
      [{ a: 1, b: 2 }, { b: 2, a: 1 }],
      [new Set([{ id: "a" }, { id: "b" }]), new Set([{ id: "b" }, { id: "a" }])],
      [new Map([[{ id: "a" }, 1], [{ id: "b" }, 2]]), new Map([[{ id: "b" }, 2], [{ id: "a" }, 1]])],
    ];
    for (const [left, right] of pairs) {
      expect(deepEqual(left, right)).toBe(true);
      expect(deepEqual(left, right, { orderSensitive: false })).toBe(true);
      expect(deepEqual(left, right, { orderSensitive: true })).toBe(false);
      expect(deepEqual(left, left, { orderSensitive: true })).toBe(true);
    }
  });

  it("orderSensitive: true also applies when the order is nested inside the output", () => {
    const nested = (input: Catalog) => ({ summary: { ranking: rankAsMap(input) } });
    expect(assertInvariance(nested, catalog, [flipPrices]).passed).toBe(true);
    expect(assertInvariance(nested, catalog, [flipPrices], { orderSensitive: true }).passed).toBe(false);
  });

  it("rejects an orderSensitive value that is not a boolean", () => {
    const run = (orderSensitive: unknown) =>
      assertInvariance(rankAsArray, catalog, [flipPrices], { orderSensitive } as never);
    expect(() => run("yes")).toThrow(/opts\.orderSensitive must be a boolean/);
    expect(() => run(1)).toThrow(TypeError);
    expect(() => run(undefined)).not.toThrow();
    expect(() => run(false)).not.toThrow();
    expect(() => deepEqual({}, {}, { orderSensitive: "yes" } as never)).toThrow(TypeError);
  });

  it("README states the default and the option in plain words", () => {
    expect(readme).toContain("orderSensitive: true");
    expect(readme).toContain("If your function returns a Map, Set or object in rank order, pass orderSensitive: true or return an array.");
  });
});

describe("verdict table 1b: a rejecting Promise from fn must not kill the process", { timeout: 180_000 }, () => {
  const harness = (body: string): string => `
    import { assertInvariance } from "./lib/index.js";
    const base = { v: 1 };
    const scenarios = [{ name: "s", mutate: (x) => ({ v: x.v + 1 }) }];
    let outcome = "no error";
    try {
      ${body}
    } catch (error) {
      outcome = error.constructor.name + ": " + error.message.slice(0, 300);
    }
    console.log(outcome);
    // Give a stray unhandled rejection time to fire (it is raised on a later turn).
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log("still alive");
  `;

  const cases: [string, string, RegExp][] = [
    ["fn rejects on the baseline call", `assertInvariance(() => Promise.reject(new Error("boom")), base, scenarios);`, /^TypeError: .*fn returned a Promise/m],
    [
      "fn rejects on a mutated call",
      `let n = 0; assertInvariance(() => (n++ === 0 ? 1 : Promise.reject(new Error("boom"))), base, scenarios);`,
      /^TypeError: .*fn returned a Promise/m,
    ],
    [
      "mutate returns a rejecting Promise",
      `assertInvariance((x) => x.v, base, [{ name: "s", mutate: () => Promise.reject(new Error("boom")) }]);`,
      /^TypeError: .*mutate\(\) returned a Promise/m,
    ],
    [
      "cleanup returns a rejecting Promise",
      `assertInvariance((x) => x.v, base, scenarios, { cleanup: () => Promise.reject(new Error("boom")) });`,
      /^Error: .*cleanup\(\) returned a Promise/m,
    ],
    [
      "isEqual returns a rejecting Promise",
      `assertInvariance((x) => x.v, base, scenarios, { isEqual: () => Promise.reject(new Error("boom")) });`,
      /^TypeError: .*isEqual must return a boolean/m,
    ],
    [
      "hasChanged returns a rejecting Promise",
      `assertInvariance((x) => x.v, base, scenarios, { hasChanged: () => Promise.reject(new Error("boom")) });`,
      /^TypeError: .*hasChanged must return a boolean/m,
    ],
    [
      "fn is an async function",
      `assertInvariance(async () => { throw new Error("boom"); }, base, scenarios);`,
      /^TypeError: .*fn returned a Promise/m,
    ],
  ];

  for (const [name, body, expected] of cases) {
    it(`${name}: the documented error is thrown and the process survives`, () => {
      const result = runChild(harness(body));
      expect(result.stderr).not.toMatch(/Unhandled|unhandled|boom/);
      expect(result.stdout).toMatch(expected);
      expect(result.stdout).toContain("still alive");
      expect(result.code).toBe(0);
    });
  }

  it("a thenable whose then() throws does not hide the documented error", () => {
    const result = runChild(
      harness(
        `assertInvariance(() => ({ then() { throw new Error("hostile"); } }), base, scenarios);`,
      ),
    );
    expect(result.stdout).toMatch(/^TypeError: .*fn returned a Promise/m);
    expect(result.code).toBe(0);
  });
});

describe("verdict table 1c: deep nesting", { timeout: 180_000 }, () => {
  it("identical chains of depth 5000 are equal", () => {
    expect(deepEqual(chain(5000), chain(5000))).toBe(true);
    expect(deepEqual(arrayChain(5000), arrayChain(5000))).toBe(true);
  });

  it("chains that differ only at the leaf, depth 5000, are different", () => {
    expect(deepEqual(chain(5000, 1), chain(5000, 2))).toBe(false);
    expect(deepEqual(arrayChain(5000, 1), arrayChain(5000, 2))).toBe(false);
  });

  it("a depth 5000 input passes when the function ignores the mutated leaf, and is not called vacuous", () => {
    const base = { name: "x", deep: chain(5000) };
    const result = assertInvariance((input: typeof base) => input.name, base, [
      { name: "change the leaf", mutate: (input) => ({ ...input, deep: chain(5000, 2) }) },
    ]);
    expect(result.vacuous).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("a depth 5000 input where fn reads the leaf fails for the right reason", () => {
    const leafOf = (node: unknown): unknown => {
      let current = node as { next?: unknown; leaf?: unknown };
      while (current.next !== undefined) current = current.next as typeof current;
      return current.leaf;
    };
    const result = assertInvariance(leafOf, chain(5000, 1), [
      { name: "change the leaf", mutate: () => chain(5000, 2) },
    ]);
    expect(result.failures.map((failure) => failure.scenario)).toEqual(["change the leaf"]);
  });

  it("a depth 100,000 chain is compared and copied without a stack overflow", () => {
    expect(deepEqual(chain(100_000), chain(100_000))).toBe(true);
    expect(deepEqual(chain(100_000, 1), chain(100_000, 2))).toBe(false);
    const result = assertInvariance((input: { id: number; deep: unknown }) => input.id, { id: 1, deep: chain(100_000) }, [
      { name: "new id", mutate: (input) => ({ ...input, id: 2 }) },
    ]);
    expect(result.failures).toHaveLength(1);
  });

  it("a cyclic structure far deeper than the stack still terminates", () => {
    const build = (): unknown => {
      const head: { next?: unknown } = {};
      let node = head;
      for (let i = 0; i < 20_000; i += 1) node = node.next = {};
      node.next = head;
      return head;
    };
    expect(deepEqual(build(), build())).toBe(true);
  });

  it("nesting that still needs the stack (unordered Sets of objects, depth 50,000) gives an error naming the scenario, never 'different'", () => {
    // Greedy one-to-one Set matching has to compare candidates as a unit, so
    // this shape is the one place the comparison still recurses.
    const base = { label: "x", sets: setChain(50_000) };
    let error: unknown;
    try {
      assertInvariance((input: typeof base) => input.label, base, [
        { name: "rebuild the sets", mutate: (input) => ({ ...input, sets: setChain(50_000, 2) }) },
      ]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RangeError);
    expect((error as Error).message).toMatch(/assertInvariance: scenario "rebuild the sets".*nested too deeply/s);
    expect((error as Error).cause).toBeInstanceOf(RangeError);
  });

  it("deepEqual itself lets a stack overflow propagate instead of answering 'different'", () => {
    let thrown: unknown;
    try {
      deepEqual(setChain(50_000), setChain(50_000));
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBeInstanceOf(RangeError);
  });
});

describe("verdict table 1d: a rebuilt opaque value in the input (documented)", () => {
  // Opaque values (here a class with a Symbol.toStringTag) are equal only to
  // themselves, so a mutation that rebuilds one unchanged still looks like a
  // change to the default hasChanged. Documented in Honest limits; a custom
  // hasChanged is the remedy.
  class Money {
    readonly cents: number;
    constructor(cents: number) {
      this.cents = cents;
    }
    get [Symbol.toStringTag](): string {
      return "Money";
    }
  }
  const base = { name: "x", price: new Money(500) };
  const rebuild: MutationScenario<typeof base> = {
    name: "rebuild the same price",
    mutate: (input) => ({ ...input, price: new Money(input.price.cents) }),
  };

  it("the default hasChanged cannot see that nothing changed (known limit)", () => {
    const result = assertInvariance((input: typeof base) => input.name, base, [rebuild]);
    expect(result.vacuous).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("a custom hasChanged restores the vacuous flag", () => {
    const result = assertInvariance((input: typeof base) => input.name, base, [rebuild], {
      hasChanged: (before, after) => before.price.cents !== after.price.cents,
    });
    expect(result.vacuous).toEqual(["rebuild the same price"]);
    expect(result.passed).toBe(false);
  });

  it("README says so", () => {
    expect(readme).toMatch(/rebuilds? an opaque value/i);
  });
});

describe("verdict table 1e: dense arrays and typed arrays of 1,000,000 elements", { timeout: 180_000 }, () => {
  const N = 1_000_000;
  const numbers = (): number[] => Array.from({ length: N }, (_, i) => i);
  const floats = (): Float64Array => Float64Array.from({ length: N }, (_, i) => i / 2);

  it("equal dense arrays compare in well under a second, and a last-element difference is found", () => {
    const a = numbers();
    const b = numbers();
    expect(deepEqual(a, b)).toBe(true);
    expect(bestOf(3, () => deepEqual(a, b))).toBeLessThan(1000);
    b[N - 1] = -1;
    expect(deepEqual(a, b)).toBe(false);
  });

  it("equal typed arrays compare in well under a second, and a last-element difference is found", () => {
    const a = floats();
    const b = floats();
    expect(deepEqual(a, b)).toBe(true);
    expect(bestOf(3, () => deepEqual(a, b))).toBeLessThan(1000);
    b[N - 1] = -1;
    expect(deepEqual(a, b)).toBe(false);
  });

  it("assertInvariance with a 1,000,000 element array input and output stays fast", () => {
    const base = { label: "x", values: numbers() };
    const run = () =>
      assertInvariance((input: typeof base) => input.values, base, [
        { name: "relabel", mutate: (input) => ({ ...input, label: "y" }) },
      ]);
    expect(run().passed).toBe(true);
    expect(bestOf(3, run)).toBeLessThan(2000);
  });

  it("assertInvariance with a 1,000,000 element typed array input and output stays fast", () => {
    const base = { label: "x", values: floats() };
    const run = () =>
      assertInvariance((input: typeof base) => input.values, base, [
        { name: "relabel", mutate: (input) => ({ ...input, label: "y" }) },
      ]);
    expect(run().passed).toBe(true);
    expect(bestOf(3, run)).toBeLessThan(2000);
  });

  it("an array of 50,000 small objects compares and copies", () => {
    const make = () => Array.from({ length: 50_000 }, (_, i) => ({ i }));
    expect(deepEqual(make(), make())).toBe(true);
    const base = { rows: make() };
    const result = assertInvariance((input: typeof base) => input.rows.length, base, [
      { name: "drop one", mutate: (input) => ({ rows: input.rows.slice(1) }) },
    ]);
    expect(result.failures).toHaveLength(1);
  }, 120_000);

  it("a sparse array with a huge length does not loop over its holes", () => {
    const a: unknown[] = [];
    a[4_000_000_000] = 1;
    const b: unknown[] = [];
    b[4_000_000_000] = 1;
    expect(deepEqual(a, b)).toBe(true);
    b[5] = 2;
    expect(deepEqual(a, b)).toBe(false);
  });
});

describe("verdict table 1f: a non-enumerable in-place change (documented)", () => {
  it("is not detected, because the comparison only reads enumerable properties (known limit)", () => {
    const base = { a: 1 };
    Object.defineProperty(base, "hidden", { value: 1, enumerable: false, writable: true, configurable: true });
    const fn = (input: typeof base): number => {
      Object.defineProperty(input, "hidden", { value: 2 });
      return input.a;
    };
    const result = assertInvariance(fn, base, [{ name: "a -> 2", mutate: (input) => ({ ...input, a: 2 }) }]);
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
  });

  it("README no longer claims every in-place change throws", () => {
    expect(readme).toMatch(/non-enumerable property[\s\S]{0,120}is not\s+detected/i);
  });
});

describe("verdict table 1g: message grammar", () => {
  it("a cleanup failure after the baseline call reads 'after fn ran on the baseline input'", () => {
    expect(() =>
      assertInvariance((x: number) => x, 1, [{ name: "s", mutate: () => 2 }], {
        cleanup: () => {
          throw new Error("reset failed");
        },
      }),
    ).toThrow(/cleanup\(\) threw after fn ran on the baseline input: reset failed/);
  });

  it("a cleanup failure after a mutated call names the scenario in plain words", () => {
    let calls = 0;
    expect(() =>
      assertInvariance((x: number) => x, 1, [{ name: "s", mutate: () => 2 }], {
        cleanup: () => {
          calls += 1;
          if (calls === 2) throw new Error("reset failed");
        },
      }),
    ).toThrow(/cleanup\(\) threw after fn ran on the mutated input for scenario "s".*reset failed/);
  });

  it("no message contains 'after on'", () => {
    const messages: string[] = [];
    for (const failOn of [1, 2]) {
      let calls = 0;
      try {
        assertInvariance((x: number) => x, 1, [{ name: "s", mutate: () => 2 }], {
          cleanup: () => {
            calls += 1;
            if (calls === failOn) throw new Error("x");
          },
        });
      } catch (error) {
        messages.push((error as Error).message);
      }
    }
    expect(messages).toHaveLength(2);
    for (const message of messages) expect(message).not.toMatch(/after on /);
  });
});

describe("verdict table 1h: duplicate scenario names", () => {
  it("duplicate preset values get distinct names in failures", () => {
    const base = { zip: "00000" };
    const scenarios = geographyScenarios<typeof base>(
      (input) => input.zip,
      (input, zip) => ({ ...input, zip }),
      ["02138", "02138", "90210"],
      { fieldLabel: "zip" },
    );
    const result = assertInvariance((input: typeof base) => input.zip, base, scenarios);
    const names = result.failures.map((failure) => failure.scenario);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    expect(names[0]).toBe('zip -> "02138"');
    expect(names[1]).toBe('zip -> "02138" (2)');
    expect(names[2]).toBe('zip -> "90210"');
  });

  it("duplicate names get distinct entries in vacuous too", () => {
    const base = { v: 1 };
    const same: MutationScenario<typeof base> = { name: "noop", mutate: (input) => ({ ...input }) };
    const result = assertInvariance((input: typeof base) => input.v, base, [same, same, same]);
    expect(result.vacuous).toEqual(["noop", "noop (2)", "noop (3)"]);
  });

  it("a rename never collides with a name the caller already used", () => {
    const base = { v: 1 };
    const bump = (name: string, to: number): MutationScenario<typeof base> => ({ name, mutate: () => ({ v: to }) });
    const result = assertInvariance((input: typeof base) => input.v, base, [bump("s", 2), bump("s (2)", 3), bump("s", 4)]);
    const names = result.failures.map((failure) => failure.scenario);
    expect(new Set(names).size).toBe(3);
    expect(names[0]).toBe("s");
    expect(names[1]).toBe("s (2)");
  });

  it("an error names the renamed scenario, so the message points at one scenario", () => {
    const base = { v: 1 };
    const ok: MutationScenario<typeof base> = { name: "dup", mutate: () => ({ v: 2 }) };
    const boom: MutationScenario<typeof base> = {
      name: "dup",
      mutate: () => {
        throw new Error("nope");
      },
    };
    expect(() => assertInvariance((input: typeof base) => input.v, base, [ok, boom])).toThrow(/scenario "dup \(2\)"/);
  });
});

// ---------------------------------------------------------------------------
// Part 2: behavior that already held (guards)
// ---------------------------------------------------------------------------

describe("verdict table 2: guards (held up before the fixes, must keep holding)", () => {
  it("README quickstart: a zip-blind loan scorer passes and a zip-biased one fails", () => {
    interface Application {
      name: string;
      zip: string;
      income: number;
    }
    const score = (app: Application) => ({ approved: app.income >= 40_000, rateBps: 900 - Math.round(app.income / 1000) });
    const base: Application = { name: "Base Applicant", zip: "00000", income: 85_000 };
    const scenarios = geographyScenarios<Application>((app) => app.zip, (app, zip) => ({ ...app, zip }), ["02138", "90210"], {
      fieldLabel: "zip code",
    });
    const honest = assertInvariance(score, base, scenarios);
    expect(honest.passed).toBe(true);
    expect(honest.baseline).toEqual({ approved: true, rateBps: 815 });
    const biased = assertInvariance((app) => ({ ...score(app), rateBps: score(app).rateBps + (app.zip === "90210" ? 50 : 0) }), base, scenarios);
    expect(biased.failures.map((failure) => failure.scenario)).toEqual(['zip code -> "90210"']);
  });

  it("validation: bad calls throw before fn runs", () => {
    let calls = 0;
    const fn = () => (calls += 1);
    expect(() => assertInvariance(fn, 1, [])).toThrow(/scenarios is empty/);
    expect(() => assertInvariance(fn, 1, [{ name: "s" } as never])).toThrow(TypeError);
    expect(() => assertInvariance(fn, 1, new Array(2) as never)).toThrow(/missing/);
    expect(() => assertInvariance(fn, 1, [{ name: "s", mutate: () => 2 }], { isEqual: 5 } as never)).toThrow(TypeError);
    expect(() => assertInvariance(fn, 1, [{ name: "s", mutate: () => 2 }], "nope" as never)).toThrow(TypeError);
    expect(() => assertInvariance(5 as never, 1, [{ name: "s", mutate: () => 2 }])).toThrow(TypeError);
    expect(calls).toBe(0);
  });

  it("a vacuous scenario makes passed false", () => {
    const result = assertInvariance((x: { v: number }) => x.v, { v: 1 }, [{ name: "noop", mutate: (x) => ({ ...x }) }]);
    expect(result.passed).toBe(false);
    expect(result.vacuous).toEqual(["noop"]);
  });

  it("plain objects: key order never matters by default", () => {
    expect(deepEqual({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    const flip = (input: { v: number }) => (input.v > 0 ? { a: 1, b: 2 } : { b: 2, a: 1 });
    expect(assertInvariance(flip, { v: 1 }, [{ name: "neg", mutate: () => ({ v: -1 }) }]).passed).toBe(true);
  });

  it("NaN equals NaN, 0 differs from -0, Dates compare by time, invalid Dates equal each other", () => {
    expect(deepEqual({ x: NaN }, { x: NaN })).toBe(true);
    expect(deepEqual(0, -0)).toBe(false);
    expect(deepEqual(new Date(5), new Date(5))).toBe(true);
    expect(deepEqual(new Date(5), new Date(6))).toBe(false);
    expect(deepEqual(new Date(NaN), new Date(NaN))).toBe(true);
  });

  it("object Sets and Maps match by structure, one to one", () => {
    expect(deepEqual(new Set([{ a: 1 }, { a: 1 }]), new Set([{ a: 1 }, { a: 2 }]))).toBe(false);
    expect(deepEqual(new Set([{ a: 1 }, { a: 2 }]), new Set([{ a: 2 }, { a: 1 }]))).toBe(true);
    expect(deepEqual(new Map([[{ k: 1 }, "v"]]), new Map([[{ k: 1 }, "v"]]))).toBe(true);
    expect(deepEqual(new Map([[{ k: 1 }, "v"]]), new Map([[{ k: 1 }, "w"]]))).toBe(false);
    expect(deepEqual(new Set([{ a: 1 }]), new Set([{ a: 1 }, { a: 1 }]))).toBe(false);
  });

  it("circular structures compare", () => {
    const a: { self?: unknown; v: number } = { v: 1 };
    a.self = a;
    const b: { self?: unknown; v: number } = { v: 1 };
    b.self = b;
    const c: { self?: unknown; v: number } = { v: 2 };
    c.self = c;
    expect(deepEqual(a, b)).toBe(true);
    expect(deepEqual(a, c)).toBe(false);
  });

  it("holes differ from undefined; extra array keys, typed array keys and symbols count", () => {
    expect(deepEqual([, 1], [undefined, 1])).toBe(false); // eslint-disable-line no-sparse-arrays
    expect(deepEqual(Object.assign([1, 2], { tag: "x" }), [1, 2])).toBe(false);
    expect(deepEqual(Object.assign([1, 2], { tag: "x" }), Object.assign([1, 2], { tag: "x" }))).toBe(true);
    expect(deepEqual(Object.assign(new Uint8Array(2), { label: "a" }), Object.assign(new Uint8Array(2), { label: "b" }))).toBe(false);
    const sym = Symbol("s");
    expect(deepEqual(Object.assign([1], { [sym]: 1 }), Object.assign([1], { [sym]: 2 }))).toBe(false);
  });

  it("in-place changes to baseInput are caught for typed arrays, Maps, Sets, Dates and nested arrays", () => {
    const scenarios = [{ name: "s", mutate: (x: unknown) => ({ ...(x as object), n: 2 }) }];
    const cases: [string, () => unknown, (value: never) => void][] = [
      ["typed array", () => ({ n: 1, t: new Uint8Array([1, 2, 3]) }), (v: { t: Uint8Array }) => void (v.t[1] = 9)],
      ["Map", () => ({ n: 1, m: new Map([["a", 1]]) }), (v: { m: Map<string, number> }) => void v.m.set("a", 2)],
      ["Set", () => ({ n: 1, s: new Set([1, 2]) }), (v: { s: Set<number> }) => void v.s.add(3)],
      ["Date", () => ({ n: 1, d: new Date(1) }), (v: { d: Date }) => void v.d.setTime(2)],
      ["nested array", () => ({ n: 1, a: [[1, 2], [3]] }), (v: { a: number[][] }) => void v.a[0]?.push(9)],
    ];
    for (const [label, build, edit] of cases) {
      expect(
        () =>
          assertInvariance(
            (input: unknown) => {
              edit(input as never);
              return 1;
            },
            build(),
            scenarios,
          ),
        label,
      ).toThrow(/modified baseInput in place/);
    }
  });

  it("an fn that re-sorts its input Map in place is caught even without orderSensitive", () => {
    const base = { m: new Map([["b", 1], ["a", 1]]), n: 1 };
    const sortsInPlace = (input: typeof base) => {
      const entries = [...input.m].sort(([x], [y]) => x.localeCompare(y));
      input.m.clear();
      for (const [k, v] of entries) input.m.set(k, v);
      return 1;
    };
    expect(() => assertInvariance(sortsInPlace, base, [{ name: "s", mutate: (i) => ({ ...i, n: 2 }) }])).toThrow(
      /modified baseInput in place/,
    );
  });

  it("an fn that rewrites its earlier baseline output is caught", () => {
    const shared = { rank: [1, 2] };
    const fn = (input: { n: number }) => {
      shared.rank = [input.n];
      return shared;
    };
    expect(() => assertInvariance(fn, { n: 1 }, [{ name: "s", mutate: () => ({ n: 2 }) }])).toThrow(
      /fn modified its earlier \(baseline\) output in place/,
    );
  });

  it("fn throwing, mutate throwing and non-boolean hooks all throw rather than pass", () => {
    const one = [{ name: "s", mutate: (): number => 2 }];
    expect(() => assertInvariance(() => { throw new Error("bad"); }, 1, one)).toThrow(/fn threw on the baseline input: bad/);
    expect(() => assertInvariance((x: number) => x, 1, [{ name: "s", mutate: () => { throw new Error("m"); } }])).toThrow(/mutate\(\) threw: m/);
    expect(() => assertInvariance((x: number) => x, 1, one, { isEqual: (() => 1) as never })).toThrow(/isEqual must return a boolean/);
  });

  it("scenario names with newlines are escaped in error text", () => {
    expect(() =>
      assertInvariance((x: number) => x, 1, [{ name: "a\nFAKE LINE", mutate: () => { throw new Error("m"); } }]),
    ).toThrow(/a\\nFAKE LINE/);
  });
});

// ---------------------------------------------------------------------------
// Part 3: self-hunt probes against the fast paths and the new option
// ---------------------------------------------------------------------------

describe("verdict table 3: self-hunt probes (fast paths, iteration, order option)", () => {
  it("probe: a hole in the middle of a long array is still a difference", () => {
    const a = Array.from({ length: 1000 }, (_, i) => i);
    const b = Array.from({ length: 1000 }, (_, i) => i);
    // eslint-disable-next-line @typescript-eslint/no-array-delete -- a hole is the point
    delete b[500];
    expect(deepEqual(a, b)).toBe(false);
    expect(deepEqual(b, a)).toBe(false);
    const c = Array.from({ length: 1000 }, (_, i) => i);
    // eslint-disable-next-line @typescript-eslint/no-array-delete -- a hole is the point
    delete c[500];
    expect(deepEqual(b, c)).toBe(true);
  });

  it("probe: undefined elements are not holes in either direction", () => {
    const a = new Array<unknown>(100).fill(undefined);
    const b = new Array<unknown>(100);
    expect(deepEqual(a, b)).toBe(false);
    expect(deepEqual(b, a)).toBe(false);
  });

  it("probe: a hole plus an extra key has the same key count as a dense array and must still differ", () => {
    // 3 elements, one hole, one extra key: Object.keys length equals the array length.
    const sneaky = Object.assign([1, , 3], { x: 1 }); // eslint-disable-line no-sparse-arrays
    expect(deepEqual(sneaky, [1, 2, 3])).toBe(false);
    expect(deepEqual([1, 2, 3], sneaky)).toBe(false);
    expect(deepEqual(sneaky, Object.assign([1, , 3], { x: 1 }))).toBe(true); // eslint-disable-line no-sparse-arrays
    expect(deepEqual(sneaky, Object.assign([1, , 3], { x: 2 }))).toBe(false); // eslint-disable-line no-sparse-arrays
  });

  it("probe: a non-enumerable element plus an enumerable extra key must not look dense", () => {
    const sneaky = [1, 2, 3];
    Object.defineProperty(sneaky, 1, { value: 2, enumerable: false });
    Object.assign(sneaky, { x: 1 });
    expect(deepEqual(sneaky, [1, 2, 3])).toBe(false);
    expect(deepEqual([1, 2, 3], sneaky)).toBe(false);
  });

  it("probe: a non-enumerable element is ignored exactly as before (equal to a hole)", () => {
    const hidden = [1, 2, 3];
    Object.defineProperty(hidden, 1, { value: 2, enumerable: false });
    expect(deepEqual(hidden, [1, , 3])).toBe(true); // eslint-disable-line no-sparse-arrays
    expect(deepEqual(hidden, [1, 2, 3])).toBe(false);
  });

  it("probe: an enumerable symbol key on an otherwise dense array counts", () => {
    const s = Symbol("meta");
    expect(deepEqual(Object.assign([1, 2], { [s]: "a" }), [1, 2])).toBe(false);
    expect(deepEqual(Object.assign([1, 2], { [s]: "a" }), Object.assign([1, 2], { [s]: "a" }))).toBe(true);
    expect(deepEqual(Object.assign([1, 2], { [s]: "a" }), Object.assign([1, 2], { [s]: "b" }))).toBe(false);
  });

  it("probe: arrays of different lengths, and same elements with a different prototype", () => {
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    class Rank extends Array<number> {}
    expect(deepEqual(Rank.from([1, 2]), [1, 2])).toBe(false);
    expect(deepEqual(Rank.from([1, 2]), Rank.from([1, 2]))).toBe(true);
  });

  it("probe: a getter element is read, and the value it returns is what is compared", () => {
    let reads = 0;
    const a = [1, 2];
    Object.defineProperty(a, 0, { get: () => (reads += 1), enumerable: true });
    const b = [1, 2];
    expect(deepEqual(a, b)).toBe(true); // first read returns 1
    expect(deepEqual(a, b)).toBe(false); // now returns 2
  });

  it("probe: array elements that are objects, NaN, -0, nested holes", () => {
    expect(deepEqual([{ a: 1 }, NaN], [{ a: 1 }, NaN])).toBe(true);
    expect(deepEqual([{ a: 1 }, NaN], [{ a: 2 }, NaN])).toBe(false);
    expect(deepEqual([0], [-0])).toBe(false);
    expect(deepEqual([[1, , 3]], [[1, undefined, 3]])).toBe(false); // eslint-disable-line no-sparse-arrays
  });

  it("probe: typed arrays: element type, length, NaN, -0, and extra keys", () => {
    expect(deepEqual(new Float64Array([NaN]), new Float64Array([NaN]))).toBe(true);
    expect(deepEqual(new Float64Array([0]), new Float64Array([-0]))).toBe(false);
    expect(deepEqual(new Uint8Array([1]), new Int8Array([1]))).toBe(false);
    expect(deepEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
    expect(deepEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
    expect(deepEqual(Object.assign(new Uint8Array(3), { label: "a" }), new Uint8Array(3))).toBe(false);
    expect(deepEqual(new Uint8Array(3), Object.assign(new Uint8Array(3), { label: "a" }))).toBe(false);
    expect(deepEqual(Object.assign(new Uint8Array(3), { label: "a" }), Object.assign(new Uint8Array(3), { label: "a" }))).toBe(true);
    const s = Symbol("s");
    expect(deepEqual(Object.assign(new Uint8Array(3), { [s]: 1 }), new Uint8Array(3))).toBe(false);
  });

  it("probe: a typed array's extra key is found even when the extra key looks like an index past the end", () => {
    const a = Object.assign(new Uint8Array(2), { "5": 1 }); // ignored by typed arrays: not a property
    expect(deepEqual(a, new Uint8Array(2))).toBe(true);
    expect(Object.keys(a)).toEqual(["0", "1"]);
  });

  it("probe: a typed array with a detached buffer has no elements and no extra keys to compare", () => {
    const make = () => new Uint8Array(new ArrayBuffer(4));
    const a = make();
    const b = make();
    structuredClone(a.buffer, { transfer: [a.buffer] });
    expect(deepEqual(a, b)).toBe(false);
    const c = make();
    structuredClone(c.buffer, { transfer: [c.buffer] });
    expect(deepEqual(a, c)).toBe(true);
  });

  it("probe: a non-enumerable extra key on a typed array is ignored as before", () => {
    const a = new Uint8Array(3);
    Object.defineProperty(a, "hidden", { value: 1, enumerable: false });
    expect(deepEqual(a, new Uint8Array(3))).toBe(true);
  });

  it("probe: the iteration order option does not change which values are equal otherwise", () => {
    const left = { a: [1, 2, { x: new Set([1, 2]) }], b: new Map([[1, "a"]]) };
    const right = { b: new Map([[1, "a"]]), a: [1, 2, { x: new Set([2, 1]) }] };
    expect(deepEqual(left, right)).toBe(true);
    expect(deepEqual(left, right, { orderSensitive: true })).toBe(false);
    const sameOrder = { a: [1, 2, { x: new Set([1, 2]) }], b: new Map([[1, "a"]]) };
    expect(deepEqual(left, sameOrder, { orderSensitive: true })).toBe(true);
  });

  it("probe: orderSensitive on a Set of objects compares members position by position", () => {
    const x = new Set([{ id: 1 }, { id: 2 }]);
    expect(deepEqual(x, new Set([{ id: 1 }, { id: 2 }]), { orderSensitive: true })).toBe(true);
    expect(deepEqual(x, new Set([{ id: 2 }, { id: 1 }]), { orderSensitive: true })).toBe(false);
    expect(deepEqual(x, new Set([{ id: 1 }, { id: 3 }]), { orderSensitive: true })).toBe(false);
  });

  it("probe: orderSensitive covers symbol-key order and array extra-key order", () => {
    const s1 = Symbol("1");
    const s2 = Symbol("2");
    expect(deepEqual({ [s1]: 1, [s2]: 2 }, { [s2]: 2, [s1]: 1 })).toBe(true);
    expect(deepEqual({ [s1]: 1, [s2]: 2 }, { [s2]: 2, [s1]: 1 }, { orderSensitive: true })).toBe(false);
    expect(deepEqual(Object.assign([1], { p: 1, q: 2 }), Object.assign([1], { q: 2, p: 1 }), { orderSensitive: true })).toBe(false);
  });

  it("probe: orderSensitive keeps numeric-like keys equal (the engine always orders them)", () => {
    expect(deepEqual({ 2: "b", 1: "a" }, { 1: "a", 2: "b" }, { orderSensitive: true })).toBe(true);
  });

  it("probe: orderSensitive sees through an object key order flip inside an Error cause", () => {
    const a = new Error("e", { cause: { x: 1, y: 2 } });
    const b = new Error("e", { cause: { y: 2, x: 1 } });
    expect(deepEqual(a, b)).toBe(true);
    expect(deepEqual(a, b, { orderSensitive: true })).toBe(false);
  });

  it("probe: orderSensitive input mutation that only reorders a Map is a real change, not vacuous", () => {
    const base = { m: new Map([["a", 1], ["b", 2]]) };
    const reorder: MutationScenario<typeof base> = {
      name: "reorder",
      mutate: (input) => ({ m: new Map([...input.m].reverse()) }),
    };
    expect(assertInvariance((i: typeof base) => i.m.size, base, [reorder]).vacuous).toEqual(["reorder"]);
    const strict = assertInvariance((i: typeof base) => i.m.size, base, [reorder], { orderSensitive: true });
    expect(strict.vacuous).toEqual([]);
    expect(strict.passed).toBe(true);
    const dependsOnOrder = assertInvariance((i: typeof base) => [...i.m.keys()][0], base, [reorder], { orderSensitive: true });
    expect(dependsOnOrder.failures).toHaveLength(1);
  });

  it("probe: cyclic Map/Set/array structures still terminate and compare, including when ordered", () => {
    const make = () => {
      const m = new Map<string, unknown>();
      m.set("self", m);
      const s = new Set<unknown>();
      s.add(s);
      return { m, s, arr: [m, s] };
    };
    expect(deepEqual(make(), make())).toBe(true);
    expect(deepEqual(make(), make(), { orderSensitive: true })).toBe(true);
  });

  it("probe: a failed Set-member trial does not poison a later match (shared sub-objects)", () => {
    const shared = { k: 1 };
    const left = new Set([{ a: shared, t: 1 }, { a: shared, t: 2 }]);
    const right = new Set([{ a: { k: 1 }, t: 2 }, { a: { k: 1 }, t: 1 }]);
    expect(deepEqual(left, right)).toBe(true);
    const wrong = new Set([{ a: { k: 1 }, t: 2 }, { a: { k: 2 }, t: 1 }]);
    expect(deepEqual(left, wrong)).toBe(false);
  });

  it("probe: the same sub-object reached through two paths is compared against both partners", () => {
    const sharedA = { v: 1 };
    const left = { p: sharedA, q: sharedA };
    const right = { p: { v: 1 }, q: { v: 2 } };
    expect(deepEqual(left, right)).toBe(false);
    expect(deepEqual(right, left)).toBe(false);
    expect(deepEqual(left, { p: { v: 1 }, q: { v: 1 } })).toBe(true);
  });

  it("probe: the snapshot copy of a 1,000-element array with holes and an extra key still detects an in-place edit of each", () => {
    const make = () => {
      const a: unknown[] = Array.from({ length: 1000 }, (_, i) => i);
      // eslint-disable-next-line @typescript-eslint/no-array-delete -- a hole is the point
      delete a[10];
      return Object.assign(a, { tag: "t" });
    };
    const edits: [string, (a: unknown[]) => void][] = [
      ["element", (a) => void (a[999] = -1)],
      ["fill the hole", (a) => void (a[10] = 10)],
      ["extra key", (a) => void Object.assign(a, { tag: "u" })],
      ["push", (a) => void a.push(1)],
    ];
    for (const [label, edit] of edits) {
      const base = { v: make(), n: 1 };
      expect(
        () =>
          assertInvariance(
            (input: typeof base) => {
              edit(input.v);
              return 1;
            },
            base,
            [{ name: "s", mutate: (i) => ({ ...i, n: 2 }) }],
          ),
        label,
      ).toThrow(/modified baseInput in place/);
    }
  });

  it("probe: the snapshot of a dense array does not share its element objects with the live array", () => {
    const base = { rows: [{ v: 1 }, { v: 2 }], n: 1 };
    expect(() =>
      assertInvariance(
        (input: typeof base) => {
          const row = input.rows[1];
          if (row) row.v = 99;
          return 1;
        },
        base,
        [{ name: "s", mutate: (i) => ({ ...i, n: 2 }) }],
      ),
    ).toThrow(/modified baseInput in place/);
  });
});

describe("verdict table 3b: more self-hunt probes", () => {
  it("probe: a Proxy over an array that reports an extra enumerable key is not mistaken for a clean array", () => {
    const target = [1, 2];
    const lying = new Proxy(target, {
      ownKeys: () => ["0", "1", "extra", "length"],
      getOwnPropertyDescriptor: (_, key) =>
        key === "extra"
          ? { value: 9, enumerable: true, configurable: true, writable: true }
          : Reflect.getOwnPropertyDescriptor(target, key),
      get: (_, key): unknown => (key === "extra" ? 9 : (Reflect.get(target, key) as unknown)),
    });
    expect(deepEqual(lying, [1, 2])).toBe(false);
    expect(deepEqual([1, 2], lying)).toBe(false);
  });

  it("probe: a transparent Proxy over an array equals the array", () => {
    expect(deepEqual(new Proxy([1, 2, 3], {}), [1, 2, 3])).toBe(true);
    expect(deepEqual(new Proxy([1, 2, 3], {}), [1, 2, 4])).toBe(false);
  });

  it("probe: frozen arrays compare like any other", () => {
    expect(deepEqual(Object.freeze([1, { a: 2 }]), Object.freeze([1, { a: 2 }]))).toBe(true);
    expect(deepEqual(Object.freeze([1, { a: 2 }]), [1, { a: 3 }])).toBe(false);
  });

  it("probe: a getter element that throws propagates; it is not turned into 'different'", () => {
    const bad = [1, 2];
    Object.defineProperty(bad, 1, {
      get() {
        throw new Error("getter failed");
      },
      enumerable: true,
    });
    expect(() => deepEqual(bad, [1, 2])).toThrow(/getter failed/);
    expect(() => deepEqual([1, 2], bad)).toThrow(/getter failed/);
  });

  it("probe: arguments objects and arrays do not equal each other", () => {
    const makeArguments = function (): IArguments {
      // eslint-disable-next-line prefer-rest-params -- the only way to make an arguments object
      return arguments;
    };
    expect(deepEqual(makeArguments(), [])).toBe(false);
    expect(deepEqual(makeArguments(), makeArguments())).toBe(true);
  });

  it("probe: orderSensitive Map with array keys and nested Sets compares positionally", () => {
    const make = (flip: boolean) =>
      new Map<unknown, unknown>(
        flip
          ? [
              [[2], new Set([3, 4])],
              [[1], new Set([1, 2])],
            ]
          : [
              [[1], new Set([1, 2])],
              [[2], new Set([3, 4])],
            ],
      );
    expect(deepEqual(make(false), make(true))).toBe(true);
    expect(deepEqual(make(false), make(true), { orderSensitive: true })).toBe(false);
    expect(deepEqual(make(false), make(false), { orderSensitive: true })).toBe(true);
  });

  it("probe: cyclic objects inside Sets match one to one even after a failed candidate", () => {
    const node = (id: number) => {
      const o: { id: number; self?: unknown } = { id };
      o.self = o;
      return o;
    };
    expect(deepEqual(new Set([node(1), node(2)]), new Set([node(2), node(1)]))).toBe(true);
    expect(deepEqual(new Set([node(1), node(2)]), new Set([node(2), node(3)]))).toBe(false);
  });

  it("probe: a long run of equal Set members with one odd one out", () => {
    const left = new Set(Array.from({ length: 300 }, (_, i) => ({ i: i % 3 })));
    const right = new Set(Array.from({ length: 300 }, (_, i) => ({ i: i === 299 ? 7 : i % 3 })));
    expect(deepEqual(left, right)).toBe(false);
    expect(deepEqual(left, new Set(Array.from({ length: 300 }, (_, i) => ({ i: (299 - i) % 3 }))))).toBe(true);
  });

  it("probe: options must be a plain object", () => {
    expect(() => deepEqual(1, 1, null as never)).toThrow(TypeError);
    expect(() => deepEqual(1, 1, [] as never)).toThrow(TypeError);
    expect(() => deepEqual(1, 1, new Map() as never)).toThrow(TypeError);
    expect(deepEqual(1, 1, {})).toBe(true);
  });
});
