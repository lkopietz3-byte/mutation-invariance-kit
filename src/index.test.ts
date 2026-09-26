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

