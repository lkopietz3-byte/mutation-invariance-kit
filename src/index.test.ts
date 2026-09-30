import { describe, expect, it } from "vitest";

import { assertInvariance, deepEqual } from "./index.js";
import type { MutationScenario } from "./index.js";

interface Item {
  id: string;
  score: number;
  label: string;
}
interface RankInput {
  items: Item[];
}
type RankOutput = string[];

/** The function under test: ranks purely on score. */
function rankByScore(input: RankInput): RankOutput {
  return [...input.items].sort((a, b) => b.score - a.score).map((i) => i.id);
}

const baseInput: RankInput = {
  items: [
    { id: "a", score: 90, label: "alpha" },
    { id: "b", score: 70, label: "beta" },
    { id: "c", score: 50, label: "gamma" },
  ],
};

const relabelScenario: MutationScenario<RankInput> = {
  name: "relabel every item",
  mutate: (input) => ({ items: input.items.map((i) => ({ ...i, label: `${i.label}-x` })) }),
};

describe("assertInvariance", () => {
  it("passes when the function under test really is invariant to the mutated field", () => {
    const result = assertInvariance(rankByScore, baseInput, [relabelScenario]);

    expect(result.vacuous).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.baseline).toEqual(["a", "b", "c"]);
  });

  it("fails when the function under test DOES depend on the mutated field", () => {
    // A deliberately label-sensitive ranker, to prove the check has teeth.
    function rankFavoringLabelAlpha(input: RankInput): RankOutput {
      return [...input.items]
        .sort(
          (a, b) =>
            b.score + (b.label === "alpha" ? 1000 : 0) - (a.score + (a.label === "alpha" ? 1000 : 0)),
        )
        .map((i) => i.id);
    }

    const giveLowestScorerTheAlphaLabel: MutationScenario<RankInput> = {
      name: "give the lowest-scoring item the alpha label",
      mutate: (input) => ({
        items: input.items.map((i) => (i.id === "c" ? { ...i, label: "alpha" } : { ...i, label: "none" })),
      }),
    };

    const result = assertInvariance(rankFavoringLabelAlpha, baseInput, [giveLowestScorerTheAlphaLabel]);

    expect(result.vacuous).toEqual([]);
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    const [failure] = result.failures;
    expect(failure).toBeDefined();
    expect(failure?.scenario).toBe("give the lowest-scoring item the alpha label");
    // The lowest-scoring item jumped to the top once it got the "alpha"
    // label bonus — exactly what the check exists to catch.
    expect(failure?.actual[0]).toBe("c");
    expect(failure?.expected[0]).toBe("a");
  });

  it("flags a no-op mutation as vacuous instead of a silent pass", () => {
    // This mutation forgets to actually change anything — a common
    // copy-paste bug when writing new scenarios. The precondition guard
    // must catch it.
    const noOpMutation: MutationScenario<RankInput> = {
      name: "forgot to change anything",
      mutate: (input) => ({ items: input.items.map((i) => ({ ...i })) }),
    };

    const result = assertInvariance(rankByScore, baseInput, [noOpMutation]);

    expect(result.vacuous).toEqual(["forgot to change anything"]);
    expect(result.failures).toEqual([]); // it wasn't even run against rankByScore
    // A vacuous scenario means the check proved nothing, so passed is
    // false even though nothing "failed" in the ordinary sense.
    expect(result.passed).toBe(false);
  });

  it("calls opts.cleanup once after the baseline run and once per non-vacuous scenario", () => {
    let externalCallCount = 0;
    function statefulRank(input: RankInput): RankOutput {
      externalCallCount += 1;
      return rankByScore(input);
    }

    let cleanupCalls = 0;
    const vacuousMutation: MutationScenario<RankInput> = {
      name: "no-op (should not trigger cleanup)",
      mutate: (input) => ({ items: input.items.map((i) => ({ ...i })) }),
    };

    const result = assertInvariance(statefulRank, baseInput, [relabelScenario, vacuousMutation], {
      cleanup: () => {
        cleanupCalls += 1;
      },
    });

    // passed is false purely because of the vacuous scenario — no failures.
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([]);
    expect(result.vacuous).toEqual(["no-op (should not trigger cleanup)"]);
    // 1 baseline call + 1 call for the non-vacuous "relabel" scenario = 2.
    // The vacuous scenario never invokes fn, so it never triggers cleanup.
    expect(externalCallCount).toBe(2);
    expect(cleanupCalls).toBe(2);
  });

  it("still runs cleanup if the function under test throws", () => {
    let cleanupCalls = 0;
    function throwingRank(): RankOutput {
      throw new Error("boom");
    }

    expect(() =>
      assertInvariance(throwingRank, baseInput, [relabelScenario], {
        cleanup: () => {
          cleanupCalls += 1;
        },
      }),
    ).toThrow("boom");
    expect(cleanupCalls).toBe(1);
  });

  it("supports a custom isEqual and a custom hasChanged", () => {
    const result = assertInvariance(rankByScore, baseInput, [relabelScenario], {
      isEqual: (expected, actual) => expected.join(",") === actual.join(","),
      hasChanged: (base, mutated) => !deepEqual(base, mutated),
    });

    expect(result.passed).toBe(true);
  });
});


describe("assertInvariance: results it must never fake", () => {
  const base = { zip: "00000", income: 5 };
  const zipScenario: MutationScenario<typeof base> = {
    name: "zip -> 90210",
    mutate: (input) => ({ ...input, zip: "90210" }),
  };

  it("throws on an async fn instead of comparing two Promises (a false pass before the fix)", () => {
    const zipSensitive = async (input: typeof base) => (input.zip === "00000" ? 1 : 2);
    expect(() => assertInvariance(zipSensitive, base, [zipScenario])).toThrow(TypeError);
    expect(() => assertInvariance(zipSensitive, base, [zipScenario])).toThrow(/fn returned a Promise/);
    expect(() => assertInvariance(zipSensitive, base, [zipScenario])).toThrow(/each Promise is equal only to itself/);
  });

  it("throws when mutate returns a Promise", () => {
    const asyncMutate = {
      name: "async mutate",
      mutate: async (input: typeof base) => ({ ...input, zip: "1" }),
    } as unknown as MutationScenario<typeof base>;
    expect(() => assertInvariance((input) => input.income, base, [asyncMutate])).toThrow(
      /scenario "async mutate": mutate\(\) returned a Promise/,
    );
  });

  it("throws on an empty scenario list instead of passing with nothing tested", () => {
    let calls = 0;
    const fn = (input: typeof base) => {
      calls += 1;
      return input.income;
    };
    expect(() => assertInvariance(fn, base, [])).toThrow(/scenarios is empty/);
    expect(calls).toBe(0);
  });

  it("throws when isEqual returns a Promise (always truthy, so it used to pass everything)", () => {
    const zipSensitive = (input: typeof base) => (input.zip === "00000" ? 1 : 2);
    const asyncIsEqual = (async () => false) as unknown as (a: number, b: number) => boolean;
    expect(() => assertInvariance(zipSensitive, base, [zipScenario], { isEqual: asyncIsEqual })).toThrow(
      /isEqual must return a boolean, got a Promise/,
    );
  });

  it("throws when hasChanged forgets to return a boolean", () => {
    const noReturn = (() => undefined) as unknown as (a: typeof base, b: typeof base) => boolean;
    expect(() => assertInvariance((input) => input.income, base, [zipScenario], { hasChanged: noReturn })).toThrow(
      /hasChanged must return a boolean, got undefined for scenario "zip -> 90210"/,
    );
  });

  it("throws when cleanup returns a Promise", () => {
    const asyncCleanup = (async () => undefined) as unknown as () => void;
    expect(() => assertInvariance((input) => input.income, base, [zipScenario], { cleanup: asyncCleanup })).toThrow(
      /cleanup must be synchronous/,
    );
  });
});

describe("assertInvariance: argument validation (checked before fn runs)", () => {
  it.each([
    ["not an array", undefined, /scenarios must be an array/],
    ["a null entry", [null], /scenarios\[0\] must be an object/],
    ["a scenario without a name", [{ mutate: (n: number) => n + 1 }], /scenarios\[0\] must be an object with a string "name"/],
    ["a scenario without mutate", [{ name: "x" }], /scenarios\[0\] must be an object with a string "name" and a "mutate" function/],
  ])("rejects %s", (_label, scenarios, message) => {
    let calls = 0;
    const counted = (input: number) => {
      calls += 1;
      return input;
    };
    expect(() => assertInvariance(counted, 1, scenarios as unknown as MutationScenario<number>[])).toThrow(message);
    expect(calls).toBe(0);
  });

  it("rejects a non-function fn", () => {
    expect(() =>
      assertInvariance<number, number>(undefined as unknown as (input: number) => number, 1, [{ name: "x", mutate: (n) => n + 1 }]),
    ).toThrow(/fn must be a function/);
  });
});

describe("assertInvariance: when fn, mutate or cleanup throws", () => {
  const base = { zip: "00000" };
  const scenarios: MutationScenario<typeof base>[] = [
    { name: "zip -> 11111", mutate: () => ({ zip: "11111" }) },
    { name: "zip -> 90210", mutate: () => ({ zip: "90210" }) },
  ];

  it("reports a throw on a mutated input as an error naming the scenario, never as 'no difference'", () => {
    const original = new RangeError("unknown zip prefix");
    const fn = (input: typeof base) => {
      if (input.zip.startsWith("9")) throw original;
      return "ok";
    };
    let caught: unknown;
    try {
      assertInvariance(fn, base, scenarios);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/fn threw on the mutated input for scenario "zip -> 90210"/);
    expect((caught as Error).message).toMatch(/unknown zip prefix/);
    expect((caught as Error).cause).toBe(original);
  });

  it("says when fn throws on the baseline input", () => {
    expect(() =>
      assertInvariance(() => {
        throw new Error("boom");
      }, base, scenarios),
    ).toThrow(/fn threw on the baseline input: boom/);
  });

  it("reports a non-Error thrown value", () => {
    expect(() =>
      assertInvariance(() => {
        throw "plain string"; // eslint-disable-line @typescript-eslint/only-throw-error -- testing a non-Error throw on purpose
      }, base, scenarios),
    ).toThrow(/fn threw on the baseline input: plain string/);
  });

  it("names the scenario when mutate throws and keeps the original as cause", () => {
    const original = new Error("bad fixture");
    const broken: MutationScenario<typeof base> = {
      name: "broken",
      mutate: () => {
        throw original;
      },
    };
    let caught: unknown;
    try {
      assertInvariance((input) => input.zip, base, [broken]);
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).message).toBe('assertInvariance: scenario "broken": mutate() threw: bad fixture');
    expect((caught as Error).cause).toBe(original);
  });

  it("keeps fn's error when cleanup also throws (cleanup used to replace it)", () => {
    expect(() =>
      assertInvariance(
        () => {
          throw new Error("fn-error");
        },
        base,
        scenarios,
        {
          cleanup: () => {
            throw new Error("cleanup-error");
          },
        },
      ),
    ).toThrow(/fn threw on the baseline input: fn-error \(cleanup\(\) also threw: cleanup-error\)/);
  });

  it("reports a cleanup failure after a successful fn call", () => {
    let cleanups = 0;
    expect(() =>
      assertInvariance((input) => input.zip, base, scenarios, {
        cleanup: () => {
          cleanups += 1;
          if (cleanups === 2) throw new Error("reset failed");
        },
      }),
    ).toThrow(/cleanup\(\) threw after on the mutated input for scenario "zip -> 11111".*reset failed/);
  });
});

describe("assertInvariance: call order and determinism", () => {
  it("calls fn for the baseline first, then once per non-vacuous scenario in order, and mutate once each", () => {
    const log: string[] = [];
    const fn = (input: { v: number }) => {
      log.push(`fn:${input.v}`);
      return input.v > 0;
    };
    const scenarios: MutationScenario<{ v: number }>[] = [
      { name: "a", mutate: () => (log.push("mutate:a"), { v: 2 }) },
      { name: "same", mutate: (input) => (log.push("mutate:same"), { ...input }) },
      { name: "b", mutate: () => (log.push("mutate:b"), { v: -1 }), category: "custom" },
    ];
    const result = assertInvariance(fn, { v: 1 }, scenarios);
    expect(log).toEqual(["fn:1", "mutate:a", "fn:2", "mutate:same", "mutate:b", "fn:-1"]);
    expect(result.vacuous).toEqual(["same"]);
    expect(result.failures).toEqual([
      { scenario: "b", category: "custom", mutatedInput: { v: -1 }, expected: true, actual: false },
    ]);
  });

  it("returns the exact baseline object fn produced", () => {
    const output = { ranked: ["a"] };
    const result = assertInvariance<number, typeof output>(() => output, 1, [{ name: "x", mutate: (n) => n + 1 }]);
    expect(result.baseline).toBe(output);
  });

  it("surfaces hidden nondeterminism as failures, and passes once randomness is seeded per call", () => {
    function seeded(seed: number): () => number {
      let state = seed;
      return () => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return state / 2_147_483_648;
      };
    }
    const base = { name: "A", score: 10 };
    const scenarios: MutationScenario<typeof base>[] = [{ name: "rename", mutate: (i) => ({ ...i, name: "B" }) }];

    // One generator shared across calls: every call draws a different tiebreak.
    const shared = seeded(42);
    const sharedResult = assertInvariance((i: typeof base) => i.score + shared(), base, scenarios);
    expect(sharedResult.passed).toBe(false);

    // A generator created per call from a fixed seed: same input, same output.
    const perCall = assertInvariance((i: typeof base) => i.score + seeded(42)(), base, scenarios);
    expect(perCall.passed).toBe(true);
  });
});
