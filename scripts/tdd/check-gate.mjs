#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { computeWorkingTreeFingerprint, evaluateGate } from "./lib.mjs";

const cwd = process.cwd();
const action = process.argv[2] ?? "protected action";

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

const config = await readJson(path.join(cwd, ".tdd-guardian", "config.json"));
const state = await readJson(path.join(cwd, ".tdd-guardian", "state.json"));
if (!config?.enabled) {
  console.error("Pi TDD guard is not configured or is disabled.");
  process.exit(1);
}
const current = await computeWorkingTreeFingerprint(cwd);
const verdict = evaluateGate({ state, current, maxAgeMinutes: config.gateFreshnessMinutes });
if (!verdict.ok) {
  console.error(`${action} blocked: ${verdict.reason}\nRun npm run test:tdd:gate, then retry without changing files.`);
  process.exit(1);
}
console.log(verdict.reason);
