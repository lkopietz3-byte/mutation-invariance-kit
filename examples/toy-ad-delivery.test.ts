/**
 * Runnable example: priceScenarios exercised against a tiny, self-contained
 * toy ad-delivery ranking engine.
 *
 * Entirely fictional/toy data — no real advertisers or products.
 * Illustrative only.
 *
 * Run with: npx vitest run
 */
import { describe, expect, it } from "vitest";

import { assertInvariance } from "../src/index.js";
import { priceScenarios } from "../src/presets/index.js";

interface AdCandidate {
  id: string;
  relevanceScore: number; // 0-100, how well this ad matches the query/user
  price: number; // dollars the advertiser charges — NOT relevance
}

interface AdRankInput {
  candidates: AdCandidate[];
}

type AdRankResult = string[]; // ordered candidate ids

const baseInput: AdRankInput = {
  candidates: [
    { id: "ad-budget-fit", relevanceScore: 91, price: 12.99 },
    { id: "ad-midrange", relevanceScore: 74, price: 39.99 },
    { id: "ad-premium", relevanceScore: 55, price: 129.99 },
  ],
};

/** The engine under test: ranks purely on relevance. */
function rankAds(input: AdRankInput): AdRankResult {
  return [...input.candidates].sort((a, b) => b.relevanceScore - a.relevanceScore).map((c) => c.id);
}

/**
 * A deliberately margin-favoring variant, used below to prove the check has
 * teeth: it adds a small price-weighted term to the ranking score, so a
 * large-enough price bump can override relevance.
 */
function rankAdsFavoringHigherPrice(input: AdRankInput): AdRankResult {
  return [...input.candidates]
    .sort((a, b) => b.relevanceScore + b.price * 0.1 - (a.relevanceScore + a.price * 0.1))
    .map((c) => c.id);
}

/**
 * A getter/setter pair for one candidate's price, addressed by id — the
 * way to reach into an array-of-objects without a path-parsing utility:
 * write the trivial find/map closures yourself.
 */
function priceOf(id: string) {
  const get = (input: AdRankInput): number => {
    const found = input.candidates.find((c) => c.id === id);
    if (!found) throw new Error(`no candidate with id "${id}"`);
    return found.price;
  };
  const set = (input: AdRankInput, value: number): AdRankInput => ({
    candidates: input.candidates.map((c) => (c.id === id ? { ...c, price: value } : c)),
  });
  return { get, set };
}

describe("toy ad delivery: price invariance", () => {
  it("the honest engine's order doesn't change when any single candidate's price changes", () => {
    const scenarios = baseInput.candidates.flatMap(({ id }) => {
      const { get, set } = priceOf(id);
      return priceScenarios<AdRankInput>(get, set, [0.01, 9999.99], { fieldLabel: `${id} price` });
    });

    const result = assertInvariance(rankAds, baseInput, scenarios);

    expect(result.vacuous).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("catches an engine that DOES let price influence the ranking", () => {
    const { get, set } = priceOf("ad-premium");
    const scenarios = priceScenarios<AdRankInput>(get, set, [9999.99], {
      fieldLabel: "ad-premium price",
    });

    const result = assertInvariance(rankAdsFavoringHigherPrice, baseInput, scenarios);

    expect(result.vacuous).toEqual([]);
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    // Bumping ad-premium's price way up pushes it to the top once the
    // biased engine's price term dominates — exactly what the check exists
    // to catch. (At the original price, relevance still wins: 91, 74, 55
    // beat the small price-weighted nudges.)
    expect(result.baseline[0]).toBe("ad-budget-fit");
    expect(result.failures[0]?.actual[0]).toBe("ad-premium");
  });
});
