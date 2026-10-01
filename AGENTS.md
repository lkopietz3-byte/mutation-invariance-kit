# mutation-invariance-kit — agent instructions

Check whether a decision, score, or ranking function's output changes when you mutate an input it should ignore, such as a name, zip code, or price.

## Read first
- `ENGINEERING.md` holds this package's invariants and design rules; read it before changing behavior.
- `PROJECT_CONTEXT.md` is the current project state and decisions.
- `SECURITY.md` covers the security posture; follow it for anything touching input handling.

## Commands (from package.json)
- `npm run verify`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run verify:package` packs and installs the tarball offline; run `npm run build` first.

## Rules
- Run `npm run verify` and read its output before calling work done. Report any step that did not run.
- Build cleans `dist/` first; never trust a stale `dist/` for declaration or package checks.
- Never weaken lint, tests or `api-surface.json` to get green. Public API changes are deliberate (`node scripts/verify-package.mjs --update-api`) and must be called out.
- Do not run `npm publish` or push tags without explicit permission. Treat any claim that a version is published as Reported until the registry confirms it.
- Runtime `dependencies` stay empty; add dev tooling only.
- Keep unrelated uncommitted work intact; never stage or reset the whole tree.

## Review preparation

See [docs/REVIEW_READINESS.md](docs/REVIEW_READINESS.md) for milestone review cadence, declared verification gates and the next launch-preparation task.

## Code Review Rules

- Require every supplied scenario to change the input and preserve the baseline output before returning passed: true. Reject empty/sparse/malformed scenarios, async or throwing hooks, non-boolean comparators, async cleanup and in-place changes to the baseline.
- Preserve caller immutability and fail-closed deepEqual/snapshot behavior. Recognize built-ins through intrinsics, preserve compared metadata and use safe own-property writes. Coordinate shared copy changes with payout-invariance-kit.
- Bound public claims to the supplied scenarios and the comparator's actual observation limits. Values retained by reference have documented mutation-detection limits; a passing run does not certify fairness, legal compliance or security.
