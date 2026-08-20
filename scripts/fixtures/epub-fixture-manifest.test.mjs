import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateEpubFixtureManifest } from "./epub-fixture-manifest.mjs";

async function fixtureWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "reader-epub-fixtures-"));
  const fixtureDirectory = path.join(root, "tests", "fixtures", "epub");
  await mkdir(fixtureDirectory, { recursive: true });
  const bytes = Buffer.from("fixture epub bytes");
  await writeFile(path.join(fixtureDirectory, "minimal.epub"), bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { root, fixtureDirectory, sha256 };
}

function manifest(sha256) {
  return {
    schemaVersion: 1,
    fixtures: [
      {
        id: "minimal-epub3",
        path: "minimal.epub",
        category: "epub3",
        license: "CC0-1.0",
        source: "Reader project minimal fixture",
        sha256,
        expectations: ["open", "navigation", "resources"],
      },
    ],
  };
}

test("accepts a complete fixture registry whose files and hashes match", async () => {
  const workspace = await fixtureWorkspace();
  try {
    assert.deepEqual(
      await validateEpubFixtureManifest(manifest(workspace.sha256), workspace.fixtureDirectory),
      [],
    );
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
});

test("reports duplicate IDs, unsafe paths, missing files, and digest mismatches together", async () => {
  const workspace = await fixtureWorkspace();
  try {
    const invalid = manifest("0".repeat(64));
    invalid.fixtures.push(
      { ...invalid.fixtures[0], path: "../outside.epub" },
      { ...invalid.fixtures[0], id: "missing", path: "missing.epub" },
    );

    const errors = await validateEpubFixtureManifest(invalid, workspace.fixtureDirectory);
    assert.ok(errors.some((error) => error.includes("duplicate fixture id: minimal-epub3")));
    assert.ok(errors.some((error) => error.includes("path escapes fixture root: ../outside.epub")));
    assert.ok(errors.some((error) => error.includes("fixture file is missing: missing.epub")));
    assert.ok(errors.some((error) => error.includes("sha256 mismatch: minimal.epub")));
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
});

test("requires security fixtures to declare explicit blocked outcomes", async () => {
  const workspace = await fixtureWorkspace();
  try {
    const invalid = manifest(workspace.sha256);
    invalid.fixtures[0].category = "security";
    invalid.fixtures[0].expectations = ["open"];

    const errors = await validateEpubFixtureManifest(invalid, workspace.fixtureDirectory);
    assert.ok(
      errors.some((error) => error.includes("security fixture requires a blocked:* expectation")),
    );
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
});

test("rejects malformed registry metadata before treating it as compatibility evidence", async () => {
  const workspace = await fixtureWorkspace();
  try {
    const invalid = manifest(workspace.sha256);
    invalid.schemaVersion = 2;
    invalid.fixtures[0].license = "";
    invalid.fixtures[0].expectations = [];

    const errors = await validateEpubFixtureManifest(invalid, workspace.fixtureDirectory);
    assert.ok(errors.some((error) => error.includes("unsupported manifest schemaVersion: 2")));
    assert.ok(errors.some((error) => error.includes("license is required: minimal-epub3")));
    assert.ok(errors.some((error) => error.includes("expectations are required: minimal-epub3")));
  } finally {
    await rm(workspace.root, { recursive: true, force: true });
  }
});
