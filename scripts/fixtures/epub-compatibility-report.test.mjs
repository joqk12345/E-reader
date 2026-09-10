import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildCompatibilityReport,
  renderCompatibilityMarkdown,
} from "./epub-compatibility-report.mjs";

const manifest = {
  schemaVersion: 1,
  fixtures: [
    {
      id: "minimal-epub3",
      category: "epub3",
      expectations: ["open", "nested-toc"],
    },
    {
      id: "active-content-epub3",
      category: "security",
      expectations: ["open", "blocked:inline-script-csp"],
    },
  ],
};

const context = {
  readerCommit: "abc1234",
  generatedAt: "2026-08-20T12:00:00.000Z",
};

test("builds a complete matrix without treating missing observations as passing evidence", () => {
  const report = buildCompatibilityReport(
    manifest,
    {
      schemaVersion: 1,
      observations: [
        {
          fixtureId: "minimal-epub3",
          expectation: "open",
          status: "pass",
          evidence: "cargo test publication::store",
          environment: { platform: "automated", webview: "none" },
        },
        {
          fixtureId: "active-content-epub3",
          expectation: "blocked:inline-script-csp",
          status: "blocked",
          evidence: "WKWebView probe has not been run",
          environment: { platform: "macos", webview: "WKWebView" },
        },
      ],
    },
    context,
  );

  assert.deepEqual(report.summary, {
    total: 4,
    pass: 1,
    fail: 0,
    blocked: 1,
    notRun: 2,
  });
  assert.deepEqual(
    report.results.map(({ fixtureId, expectation, status }) => ({
      fixtureId,
      expectation,
      status,
    })),
    [
      { fixtureId: "active-content-epub3", expectation: "blocked:inline-script-csp", status: "blocked" },
      { fixtureId: "active-content-epub3", expectation: "open", status: "not-run" },
      { fixtureId: "minimal-epub3", expectation: "nested-toc", status: "not-run" },
      { fixtureId: "minimal-epub3", expectation: "open", status: "pass" },
    ],
  );
  assert.equal(report.readerCommit, context.readerCommit);
  assert.equal(report.generatedAt, context.generatedAt);
});

test("rejects observations that cannot be tied uniquely to registered evidence", () => {
  assert.throws(
    () =>
      buildCompatibilityReport(
        manifest,
        {
          schemaVersion: 1,
          observations: [
            {
              fixtureId: "unknown",
              expectation: "open",
              status: "pass",
              evidence: "claim",
              environment: { platform: "automated", webview: "none" },
            },
          ],
        },
        context,
      ),
    /unknown fixture: unknown/,
  );

  const duplicate = {
    fixtureId: "minimal-epub3",
    expectation: "open",
    status: "pass",
    evidence: "test receipt",
    environment: { platform: "automated", webview: "none" },
  };
  assert.throws(
    () =>
      buildCompatibilityReport(
        manifest,
        { schemaVersion: 1, observations: [duplicate, duplicate] },
        context,
      ),
    /duplicate observation: minimal-epub3 :: open/,
  );
  assert.throws(
    () =>
      buildCompatibilityReport(
        manifest,
        {
          schemaVersion: 1,
          observations: [{ ...duplicate, expectation: "invented-capability" }],
        },
        context,
      ),
    /unknown expectation: minimal-epub3 :: invented-capability/,
  );
  assert.throws(
    () =>
      buildCompatibilityReport(
        manifest,
        { schemaVersion: 1, observations: [{ ...duplicate, status: "probably" }] },
        context,
      ),
    /invalid status for minimal-epub3 :: open: probably/,
  );
});

test("requires actionable evidence for every claimed outcome", () => {
  for (const status of ["pass", "fail", "blocked"]) {
    assert.throws(
      () =>
        buildCompatibilityReport(
          manifest,
          {
            schemaVersion: 1,
            observations: [
              {
                fixtureId: "minimal-epub3",
                expectation: "open",
                status,
                evidence: "",
                environment: { platform: "automated", webview: "none" },
              },
            ],
          },
          context,
        ),
      /evidence is required.*minimal-epub3 :: open/,
    );
  }
});

test("renders a deterministic Markdown report with evidence limits", () => {
  const report = buildCompatibilityReport(manifest, { schemaVersion: 1, observations: [] }, context);
  const markdown = renderCompatibilityMarkdown(report);

  assert.match(markdown, /^# EPUB Compatibility Report/m);
  assert.match(markdown, /Commit: `abc1234`/);
  assert.match(markdown, /\| active-content-epub3 \| security \| blocked:inline-script-csp \| not-run \|/);
  assert.match(markdown, /`not-run` is not a passing result/);
  assert.equal(markdown, renderCompatibilityMarkdown(report));
});

test("keeps checked-in JSON and Markdown reports synchronized with the evidence ledger", async () => {
  const [fixtureManifest, ledger, checkedJson, checkedMarkdown] = await Promise.all([
    readFile("tests/fixtures/epub/manifest.json", "utf8").then(JSON.parse),
    readFile("tests/fixtures/epub/compatibility-observations.json", "utf8").then(JSON.parse),
    readFile("docs/development/compatibility/epub-phase0.json", "utf8").then(JSON.parse),
    readFile("docs/development/compatibility/epub-phase0.md", "utf8"),
  ]);
  const generated = buildCompatibilityReport(fixtureManifest, ledger, ledger);

  assert.deepEqual(checkedJson, generated);
  assert.equal(checkedMarkdown, renderCompatibilityMarkdown(generated));
});
