#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { computeWorkingTreeFingerprint, coverageDidDecrease, coveragePercentages } from "./lib.mjs";

const cwd = process.cwd();
const stateDir = path.join(cwd, ".tdd-guardian");
const configPath = path.join(stateDir, "config.json");
const statePath = path.join(stateDir, "state.json");

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

const config = await readJson(configPath);
if (!config?.enabled) {
  console.error("Pi TDD gate is not configured or is disabled.");
  process.exit(2);
}

const result = spawnSync("npm", ["run", "test:tdd:verify"], {
  cwd,
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);

const coveragePath = path.join(cwd, config.coverageSummaryPath);
const coverage = coveragePercentages(await readJson(coveragePath));
const previous = await readJson(statePath);
const decreases = config.coverageMode === "no-decrease" ? coverageDidDecrease(previous?.coverage, coverage) : [];
if (decreases.length > 0) {
  console.error(`Coverage decreased for: ${decreases.join(", ")}. Previous=${JSON.stringify(previous.coverage)} Current=${JSON.stringify(coverage)}`);
  process.exit(1);
}

const current = await computeWorkingTreeFingerprint(cwd);
const state = {
  schemaVersion: 1,
  result: "passed",
  passedAt: new Date().toISOString(),
  headSha: current.head,
  fingerprint: current.fingerprint,
  coverage,
  lanes: ["guardian-unit", "fixture-validation", "frontend-unit", "rust-unit"],
  agent: process.env.PI_CODING_AGENT === "true"
    ? { ecosystem: "pi", sessionId: process.env.PI_SESSION_ID ?? null, model: process.env.PI_MODEL ?? null }
    : { ecosystem: "shell" },
};
await mkdir(stateDir, { recursive: true });
const temporaryPath = `${statePath}.${process.pid}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
await rename(temporaryPath, statePath);
console.log(`\nPi TDD gate receipt recorded for ${current.fingerprint.slice(0, 12)}.`);
