// Consumer probe: runs from a temp project with the packed tarball installed,
// importing both public entry points by package name and asserting real
// outputs. Run by scripts/verify-package.mjs.
import assert from 'node:assert/strict';

import * as root from 'mutation-invariance-kit';
import { assertInvariance, deepEqual, priceScenarios as rootPriceScenarios } from 'mutation-invariance-kit';
import { geographyScenarios, priceScenarios, protectedAttributeScenarios } from 'mutation-invariance-kit/presets';

// The root re-exports the same preset functions as the ./presets subpath.
assert.equal(rootPriceScenarios, priceScenarios);
assert.equal(root.geographyScenarios, geographyScenarios);
assert.equal(root.protectedAttributeScenarios, protectedAttributeScenarios);

const base = { name: 'Base Applicant', zip: '00000', income: 85_000 };
const scoreLoan = (app) => ({ approved: app.income >= 40_000, rateBps: 900 - Math.round(app.income / 1000) });
const scoreLoanWithZipBias = (app) => {
  const honest = scoreLoan(app);
  return { ...honest, rateBps: honest.rateBps + (app.zip.startsWith('9') ? 0 : 75) };
};

const zipScenarios = geographyScenarios(
  (app) => app.zip,
  (app, value) => ({ ...app, zip: value }),
  ['02138', '90210', '00000'],
  { fieldLabel: 'zip code' },
);
assert.deepEqual(zipScenarios.map((s) => s.name), ['zip code -> "02138"', 'zip code -> "90210"', 'zip code -> "00000"']);
assert.deepEqual(zipScenarios.map((s) => s.category), ['geography', 'geography', 'geography']);

// Honest engine: no failures, but the unchanged "00000" value is vacuous, so it is not a pass.
const honest = assertInvariance(scoreLoan, base, zipScenarios);
assert.deepEqual(honest.baseline, { approved: true, rateBps: 815 });
assert.deepEqual(honest.failures, []);
assert.deepEqual(honest.vacuous, ['zip code -> "00000"']);
assert.equal(honest.passed, false);

// Only the real changes: the honest engine passes.
assert.equal(assertInvariance(scoreLoan, base, zipScenarios.slice(0, 2)).passed, true);

// Biased engine: the 9-prefixed zip changes the rate.
const biased = assertInvariance(scoreLoanWithZipBias, base, zipScenarios.slice(0, 2));
assert.equal(biased.passed, false);
assert.equal(biased.failures.length, 1);
assert.equal(biased.failures[0].scenario, 'zip code -> "90210"');
assert.equal(biased.failures[0].category, 'geography');
assert.deepEqual(biased.failures[0].expected, { approved: true, rateBps: 890 });
assert.deepEqual(biased.failures[0].actual, { approved: true, rateBps: 815 });

// Presets from the subpath work end to end.
const names = protectedAttributeScenarios((a) => a.name, (a, v) => ({ ...a, name: v }), ['Wei Chen']);
assert.equal(assertInvariance(scoreLoan, base, names).passed, true);
const prices = priceScenarios((l) => l.price, (l, v) => ({ ...l, price: v }), [0, -0]);
assert.deepEqual(prices.map((s) => s.name), ['price -> 0', 'price -> -0']);

// Runs that cannot be trusted throw instead of passing.
assert.throws(() => assertInvariance(scoreLoan, base, []), /scenarios is empty/);
assert.throws(() => assertInvariance(async (a) => a.zip, base, names), /fn returned a Promise/);
assert.throws(
  () => assertInvariance((a) => { a.cached = true; return 1; }, { ...base }, names),
  /modified baseInput in place/,
);
assert.throws(
  () => assertInvariance((a) => { if (a.name !== base.name) throw new Error('boom'); return 1; }, base, names),
  (error) => error.message.includes('scenario "protected attribute -> "Wei Chen""') && error.cause.message === 'boom',
);
assert.throws(() => priceScenarios((l) => l.price, (l, v) => ({ ...l, price: v }), ['9.99']), TypeError);

// Comparison semantics.
assert.equal(deepEqual({ score: NaN }, { score: NaN }), true);
assert.equal(deepEqual(0, -0), false);
assert.equal(deepEqual(new Set([{ a: 1 }, { a: 1 }]), new Set([{ a: 1 }, { a: 2 }])), false);
assert.equal(deepEqual(new Error('a'), new Error('b')), false);

console.log('consumer probe passed');
