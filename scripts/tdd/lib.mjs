import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

function git(cwd, args, encoding = "utf8") {
  const result = spawnSync("git", args, {
    cwd,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).toString().trim());
  }
  return result.stdout;
}

export async function computeWorkingTreeFingerprint(cwd) {
  const hash = createHash("sha256");
  const head = git(cwd, ["rev-parse", "HEAD"]).trim();
  const trackedDiff = git(cwd, ["diff", "--binary", "--no-ext-diff", "HEAD", "--"], "buffer");
  const untrackedOutput = git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"], "buffer");
  const untracked = untrackedOutput
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();

  hash.update("head\0").update(head).update("\0tracked\0").update(trackedDiff);
  for (const relativePath of untracked) {
    const absolutePath = path.join(cwd, relativePath);
    const stat = await lstat(absolutePath);
    hash.update("\0untracked\0").update(relativePath).update("\0").update(stat.mode.toString(8)).update("\0");
    hash.update(stat.isSymbolicLink() ? await readlink(absolutePath) : await readFile(absolutePath));
  }

  return { head, fingerprint: hash.digest("hex") };
}

export function evaluateGate({ state, current, now = Date.now(), maxAgeMinutes = 120 }) {
  if (!state || state.schemaVersion !== 1 || state.result !== "passed") {
    return { ok: false, reason: "No successful Pi TDD gate receipt exists." };
  }
  if (state.fingerprint !== current.fingerprint || state.headSha !== current.head) {
    return { ok: false, reason: "The working tree changed after the last successful TDD gate." };
  }
  const passedAt = Date.parse(state.passedAt);
  if (!Number.isFinite(passedAt)) {
    return { ok: false, reason: "The TDD gate receipt has an invalid timestamp." };
  }
  const ageMinutes = (now - passedAt) / 60_000;
  if (ageMinutes > maxAgeMinutes) {
    return { ok: false, reason: `The TDD gate is stale (${Math.floor(ageMinutes)} minutes old).` };
  }
  return { ok: true, reason: `Gate passed ${Math.max(0, Math.floor(ageMinutes))} minutes ago for this exact working tree.` };
}

export function classifyProtectedCommand(command) {
  const normalized = command.replace(/\\\n/g, " ");
  const patterns = [
    ["commit", /(?:^|[;&|]\s*)\s*(?:env\s+[^;&|]+\s+)?git(?:\s+-C\s+\S+)?\s+commit\b/m],
    ["push", /(?:^|[;&|]\s*)\s*(?:env\s+[^;&|]+\s+)?git(?:\s+-C\s+\S+)?\s+push\b/m],
    ["pull-request", /(?:^|[;&|]\s*)\s*gh\s+pr\s+(?:create|merge)\b/m],
    ["publish", /(?:^|[;&|]\s*)\s*(?:npm|cargo)\s+publish\b/m],
  ];
  return patterns.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null;
}

export function classifyRedRun(exitCode, output) {
  if (exitCode === 0) return { valid: false, reason: "The test command passed; no red state was observed." };
  if (/command not found|Cannot find module|failed to resolve import|No test files found|no tests? (?:ran|found)|TS\d{4}:|error\[E\d+\]|could not compile/i.test(output)) {
    return { valid: false, reason: "The failure is an environment, discovery, dependency, or compilation failure—not a behavioral red." };
  }
  const hasFailedTest = /(?:Test Files|Tests)\s+\d+\s+failed|test result:\s*FAILED|AssertionError|assertion .* failed|panicked at|\bFAIL(?:ED)?\b/i.test(output);
  if (!hasFailedTest) return { valid: false, reason: "No recognizable failing test assertion was found." };
  return { valid: true, reason: "A behavioral test failure was observed." };
}

export function coveragePercentages(summary) {
  const total = summary?.total;
  if (!total) throw new Error("Coverage summary has no total section.");
  return Object.fromEntries(["lines", "functions", "branches", "statements"].map((key) => [key, Number(total[key]?.pct)]));
}

export function coverageDidDecrease(previous, current, tolerance = 0.0001) {
  if (!previous) return [];
  return Object.keys(current).filter((key) => Number.isFinite(previous[key]) && current[key] + tolerance < previous[key]);
}
