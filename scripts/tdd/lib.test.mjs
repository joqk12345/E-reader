import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyProtectedCommand,
  classifyRedRun,
  computeWorkingTreeFingerprint,
  coverageDidDecrease,
  evaluateGate,
} from "./lib.mjs";

function git(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

async function repository() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "reader-tdd-"));
  git(cwd, "init", "-q");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  await writeFile(path.join(cwd, ".gitignore"), "ignored.txt\n");
  await writeFile(path.join(cwd, "tracked.txt"), "one\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "initial");
  return cwd;
}

test("working-tree receipt changes for tracked and untracked content but ignores generated files", async () => {
  const cwd = await repository();
  try {
    const baseline = await computeWorkingTreeFingerprint(cwd);
    await writeFile(path.join(cwd, "ignored.txt"), "generated\n");
    assert.deepEqual(await computeWorkingTreeFingerprint(cwd), baseline);
    await writeFile(path.join(cwd, "tracked.txt"), "two\n");
    assert.notEqual((await computeWorkingTreeFingerprint(cwd)).fingerprint, baseline.fingerprint);
    git(cwd, "checkout", "--", "tracked.txt");
    await writeFile(path.join(cwd, "new.txt"), "new\n");
    assert.notEqual((await computeWorkingTreeFingerprint(cwd)).fingerprint, baseline.fingerprint);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("gate requires the exact tree and a fresh successful receipt", () => {
  const current = { head: "abc", fingerprint: "tree-1" };
  const state = { schemaVersion: 1, result: "passed", passedAt: "2026-01-01T00:00:00.000Z", headSha: "abc", fingerprint: "tree-1" };
  assert.equal(evaluateGate({ state, current, now: Date.parse("2026-01-01T00:05:00Z"), maxAgeMinutes: 10 }).ok, true);
  assert.match(evaluateGate({ state, current: { ...current, fingerprint: "tree-2" }, now: Date.parse("2026-01-01T00:05:00Z") }).reason, /changed/);
  assert.match(evaluateGate({ state, current, now: Date.parse("2026-01-01T03:00:00Z"), maxAgeMinutes: 10 }).reason, /stale/);
});

test("protected shell actions are recognized without blocking ordinary git inspection", () => {
  assert.equal(classifyProtectedCommand("git commit -m test"), "commit");
  assert.equal(classifyProtectedCommand("npm test && git push origin main"), "push");
  assert.equal(classifyProtectedCommand("git status --short"), null);
  assert.equal(classifyProtectedCommand("echo 'git commit'"), null);
});

test("red receipt accepts assertion failures and rejects infrastructure failures", () => {
  assert.equal(classifyRedRun(1, "Test Files 1 failed\nAssertionError: expected true").valid, true);
  assert.equal(classifyRedRun(1, "error[E0425]: cannot find value\ncould not compile").valid, false);
  assert.equal(classifyRedRun(0, "Tests 1 passed").valid, false);
});

test("coverage no-decrease identifies only regressed metrics", () => {
  assert.deepEqual(coverageDidDecrease({ lines: 10, branches: 5 }, { lines: 10.1, branches: 4.9 }), ["branches"]);
});
