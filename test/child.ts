/**
 * Test helper: compile the library (as it is in this working tree) into a
 * temporary directory once, so a case can run in a child Node process where an
 * unhandled rejection would really kill the process.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let built: string | undefined;

export function builtLibrary(): string {
  if (built !== undefined) return built;
  const root = new URL("..", import.meta.url).pathname;
  const out = mkdtempSync(join(tmpdir(), "mik-child-"));
  mkdirSync(join(out, "lib"));
  writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
  execFileSync(join(root, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.build.json", "--outDir", join(out, "lib")], {
    cwd: root,
    stdio: "pipe",
  });
  built = out;
  return out;
}

export interface ChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run an ESM script (it can `import "./lib/index.js"`) in a fresh Node process. */
export function runChild(script: string): ChildResult {
  const dir = builtLibrary();
  const file = join(dir, `case-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(file, script);
  const result = spawnSync(process.execPath, [file], { encoding: "utf8", timeout: 60_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}
