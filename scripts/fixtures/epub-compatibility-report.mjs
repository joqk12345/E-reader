import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OBSERVED_STATUSES = new Set(["pass", "fail", "blocked", "not-run"]);

function requireNonEmptyText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function observationKey(fixtureId, expectation) {
  return `${fixtureId} :: ${expectation}`;
}

function validateContext(context) {
  return {
    readerCommit: requireNonEmptyText(context?.readerCommit, "readerCommit"),
    generatedAt: requireNonEmptyText(context?.generatedAt, "generatedAt"),
  };
}

export function buildCompatibilityReport(manifest, ledger, context) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest?.fixtures)) {
    throw new Error("fixture manifest schemaVersion 1 with fixtures is required");
  }
  if (ledger?.schemaVersion !== 1 || !Array.isArray(ledger?.observations)) {
    throw new Error("observation ledger schemaVersion 1 with observations is required");
  }

  const reportContext = validateContext(context);
  const fixtures = new Map();
  for (const fixture of manifest.fixtures) {
    const fixtureId = requireNonEmptyText(fixture?.id, "fixture id");
    if (fixtures.has(fixtureId)) throw new Error(`duplicate fixture: ${fixtureId}`);
    if (!Array.isArray(fixture.expectations) || fixture.expectations.length === 0) {
      throw new Error(`expectations are required: ${fixtureId}`);
    }
    const expectations = new Set();
    for (const rawExpectation of fixture.expectations) {
      const expectation = requireNonEmptyText(rawExpectation, `expectation: ${fixtureId}`);
      if (expectations.has(expectation)) {
        throw new Error(`duplicate expectation: ${observationKey(fixtureId, expectation)}`);
      }
      expectations.add(expectation);
    }
    fixtures.set(fixtureId, {
      category: requireNonEmptyText(fixture?.category, `category: ${fixtureId}`),
      expectations,
    });
  }

  const observations = new Map();
  for (const observation of ledger.observations) {
    const fixtureId = requireNonEmptyText(observation?.fixtureId, "observation fixtureId");
    const expectation = requireNonEmptyText(observation?.expectation, "observation expectation");
    const key = observationKey(fixtureId, expectation);
    const fixture = fixtures.get(fixtureId);
    if (!fixture) throw new Error(`unknown fixture: ${fixtureId}`);
    if (!fixture.expectations.has(expectation)) throw new Error(`unknown expectation: ${key}`);
    if (observations.has(key)) throw new Error(`duplicate observation: ${key}`);
    if (!OBSERVED_STATUSES.has(observation?.status)) {
      throw new Error(`invalid status for ${key}: ${String(observation?.status)}`);
    }

    const evidence = typeof observation.evidence === "string" ? observation.evidence.trim() : "";
    if (observation.status !== "not-run" && !evidence) {
      throw new Error(`evidence is required for ${key}`);
    }

    let environment;
    if (observation.status !== "not-run") {
      environment = {
        platform: requireNonEmptyText(observation?.environment?.platform, `platform for ${key}`),
        webview: requireNonEmptyText(observation?.environment?.webview, `webview for ${key}`),
      };
    }
    observations.set(key, { status: observation.status, evidence, environment });
  }

  const results = [];
  for (const [fixtureId, fixture] of fixtures) {
    for (const expectation of fixture.expectations) {
      const observation = observations.get(observationKey(fixtureId, expectation));
      results.push({
        fixtureId,
        category: fixture.category,
        expectation,
        status: observation?.status ?? "not-run",
        evidence: observation?.evidence ?? "",
        ...(observation?.environment ? { environment: observation.environment } : {}),
      });
    }
  }
  results.sort(
    (left, right) =>
      left.fixtureId.localeCompare(right.fixtureId) || left.expectation.localeCompare(right.expectation),
  );

  const summary = { total: results.length, pass: 0, fail: 0, blocked: 0, notRun: 0 };
  for (const result of results) {
    if (result.status === "not-run") summary.notRun += 1;
    else summary[result.status] += 1;
  }

  return {
    schemaVersion: 1,
    ...reportContext,
    summary,
    results,
  };
}

function markdownCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll(/\r?\n/g, " ");
}

export function renderCompatibilityMarkdown(report) {
  const lines = [
    "# EPUB Compatibility Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Commit: \`${report.readerCommit}\``,
    "",
    "> This report records evidence, not inferred support. `not-run` is not a passing result, and configuration/unit evidence is not a substitute for a real WebView probe.",
    "",
    "## Summary",
    "",
    "| Total | Pass | Fail | Blocked | Not run |",
    "|---:|---:|---:|---:|---:|",
    `| ${report.summary.total} | ${report.summary.pass} | ${report.summary.fail} | ${report.summary.blocked} | ${report.summary.notRun} |`,
    "",
    "## Matrix",
    "",
    "| Fixture | Category | Expectation | Status | Environment | Evidence |",
    "|---|---|---|---|---|---|",
  ];

  for (const result of report.results) {
    const environment = result.environment
      ? `${result.environment.platform} / ${result.environment.webview}`
      : "—";
    lines.push(
      `| ${markdownCell(result.fixtureId)} | ${markdownCell(result.category)} | ${markdownCell(result.expectation)} | ${markdownCell(result.status)} | ${markdownCell(environment)} | ${markdownCell(result.evidence || "—")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function writeCompatibilityReports({
  manifestPath,
  observationsPath,
  jsonOutputPath,
  markdownOutputPath,
}) {
  const [manifest, ledger] = await Promise.all([
    readFile(manifestPath, "utf8").then(JSON.parse),
    readFile(observationsPath, "utf8").then(JSON.parse),
  ]);
  const report = buildCompatibilityReport(manifest, ledger, {
    readerCommit: ledger.readerCommit,
    generatedAt: ledger.generatedAt,
  });
  await Promise.all([
    writeFile(jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(markdownOutputPath, renderCompatibilityMarkdown(report)),
  ]);
  return report;
}

async function main() {
  const [manifestPath, observationsPath, jsonOutputPath, markdownOutputPath] = process.argv.slice(2);
  if (!manifestPath || !observationsPath || !jsonOutputPath || !markdownOutputPath) {
    throw new Error(
      "usage: node epub-compatibility-report.mjs <manifest> <observations> <report.json> <report.md>",
    );
  }
  const report = await writeCompatibilityReports({
    manifestPath: path.resolve(manifestPath),
    observationsPath: path.resolve(observationsPath),
    jsonOutputPath: path.resolve(jsonOutputPath),
    markdownOutputPath: path.resolve(markdownOutputPath),
  });
  console.log(
    `Generated EPUB compatibility report: ${report.summary.pass}/${report.summary.total} passing, ${report.summary.notRun} not run.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
