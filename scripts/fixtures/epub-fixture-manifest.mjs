import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_TEXT_FIELDS = ["id", "path", "category", "license", "source"];

function isInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export async function validateEpubFixtureManifest(manifest, fixtureRoot) {
  const errors = [];
  const root = path.resolve(fixtureRoot);

  if (manifest?.schemaVersion !== 1) {
    errors.push(`unsupported manifest schemaVersion: ${String(manifest?.schemaVersion)}`);
  }
  if (!Array.isArray(manifest?.fixtures)) {
    return [...errors, "fixtures must be an array"];
  }

  const seenIds = new Set();
  for (const fixture of manifest.fixtures) {
    const id = typeof fixture?.id === "string" && fixture.id.trim() ? fixture.id : "<unknown>";
    for (const field of REQUIRED_TEXT_FIELDS) {
      if (typeof fixture?.[field] !== "string" || !fixture[field].trim()) {
        errors.push(`${field} is required: ${id}`);
      }
    }

    if (seenIds.has(id)) errors.push(`duplicate fixture id: ${id}`);
    seenIds.add(id);

    if (!Array.isArray(fixture?.expectations) || fixture.expectations.length === 0) {
      errors.push(`expectations are required: ${id}`);
    }
    if (
      fixture?.category === "security" &&
      !fixture?.expectations?.some(
        (expectation) => typeof expectation === "string" && expectation.startsWith("blocked:"),
      )
    ) {
      errors.push(`security fixture requires a blocked:* expectation: ${id}`);
    }
    if (typeof fixture?.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(fixture.sha256)) {
      errors.push(`valid sha256 is required: ${id}`);
    }

    if (typeof fixture?.path !== "string" || !fixture.path.trim()) continue;
    const absolutePath = path.resolve(root, fixture.path);
    if (!isInsideRoot(root, absolutePath)) {
      errors.push(`path escapes fixture root: ${fixture.path}`);
      continue;
    }

    let bytes;
    try {
      const stat = await lstat(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        errors.push(`fixture path must be a regular file: ${fixture.path}`);
        continue;
      }
      bytes = await readFile(absolutePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        errors.push(`fixture file is missing: ${fixture.path}`);
        continue;
      }
      throw error;
    }

    if (/^[a-f0-9]{64}$/i.test(fixture.sha256)) {
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== fixture.sha256.toLowerCase()) {
        errors.push(`sha256 mismatch: ${fixture.path}`);
      }
    }
  }

  return errors;
}

async function main() {
  const manifestPath = path.resolve(process.argv[2] ?? "tests/fixtures/epub/manifest.json");
  const fixtureRoot = path.dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const errors = await validateEpubFixtureManifest(manifest, fixtureRoot);
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Validated ${manifest.fixtures.length} EPUB fixture entries.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
