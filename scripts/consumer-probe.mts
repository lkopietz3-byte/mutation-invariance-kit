// Strict NodeNext type probe: compiled (not run) by scripts/verify-package.mjs
// against the installed declarations. Type-level usage only.
import {
  assertInvariance,
  deepEqual,
  type AssertInvarianceOptions,
  type InvarianceFailure,
  type InvarianceResult,
  type MutationScenario,
  type ScenarioCategory,
} from 'mutation-invariance-kit';
import {
  geographyScenarios,
  priceScenarios,
  protectedAttributeScenarios,
  type GeographyScenariosOptions,
  type PriceScenariosOptions,
  type ProtectedAttributeScenariosOptions,
} from 'mutation-invariance-kit/presets';

interface Application {
  name: string;
  zip: string;
  price: number;
}
interface Decision {
  approved: boolean;
  rateBps: number;
}

const score = (app: Application): Decision => ({ approved: app.price < 100, rateBps: 500 });
const base: Application = { name: 'A', zip: '02138', price: 10 };

const nameOptions: ProtectedAttributeScenariosOptions = { fieldLabel: 'name' };
const zipOptions: GeographyScenariosOptions = { fieldLabel: 'zip' };
const priceOptions: PriceScenariosOptions = {};

const scenarios: MutationScenario<Application>[] = [
  ...protectedAttributeScenarios<Application>((a) => a.name, (a, v) => ({ ...a, name: v }), ['B'], nameOptions),
  ...geographyScenarios<Application>((a) => a.zip, (a, v) => ({ ...a, zip: v }), ['90210'], zipOptions),
  ...priceScenarios<Application>((a) => a.price, (a, v) => ({ ...a, price: v }), [0], priceOptions),
  { name: 'custom', mutate: (a) => ({ ...a, name: 'C' }), category: 'custom' },
];

const options: AssertInvarianceOptions<Application, Decision> = {
  isEqual: (expected, actual) => expected.approved === actual.approved,
  hasChanged: (before, after) => !deepEqual(before, after),
  cleanup: () => undefined,
};

const result: InvarianceResult<Application, Decision> = assertInvariance(score, base, scenarios, options);
const passed: boolean = result.passed;
const baseline: Decision = result.baseline;
const vacuous: string[] = result.vacuous;
const firstFailure: InvarianceFailure<Application, Decision> | undefined = result.failures[0];
const category: ScenarioCategory | undefined = firstFailure?.category;
const mutatedZip: string | undefined = firstFailure?.mutatedInput.zip;

// @ts-expect-error mutate must return the same Input type.
const wrongShape: MutationScenario<Application> = { name: 'bad', mutate: () => 42 };
// @ts-expect-error geography values are strings (to keep leading zeros).
geographyScenarios<Application>((a) => a.zip, (a, v) => ({ ...a, zip: v }), [2138]);
// @ts-expect-error not a ScenarioCategory.
const badCategory: ScenarioCategory = 'zip';

export { passed, baseline, vacuous, category, mutatedZip, wrongShape, badCategory };
