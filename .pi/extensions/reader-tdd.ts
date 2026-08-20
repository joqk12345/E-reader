import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { classifyProtectedCommand, classifyRedRun } from "../../scripts/tdd/lib.mjs";

const STATUS_KEY = "reader-tdd";

function tail(text: string, limit = 12_000): string {
  return text.length <= limit ? text : `[output truncated]\n${text.slice(-limit)}`;
}

async function configured(cwd: string): Promise<boolean> {
  try {
    const config = JSON.parse(await readFile(path.join(cwd, ".tdd-guardian", "config.json"), "utf8"));
    return config.enabled === true;
  } catch {
    return false;
  }
}

async function checkGate(pi: ExtensionAPI, cwd: string, action: string, signal?: AbortSignal) {
  const result = await pi.exec(process.execPath, [path.join(cwd, "scripts/tdd/check-gate.mjs"), action], {
    cwd,
    signal,
    timeout: 30_000,
  });
  return { ok: result.code === 0, output: `${result.stdout}${result.stderr}`.trim() };
}

async function runGate(pi: ExtensionAPI, cwd: string, signal?: AbortSignal) {
  return pi.exec("npm", ["run", "test:tdd:gate"], { cwd, signal, timeout: 900_000 });
}

async function allowExplicitBypass(command: string, ctx: ExtensionContext): Promise<boolean> {
  if (!/\bTDD_GUARD_BYPASS=1\b/.test(command)) return false;
  if (!ctx.hasUI) return false;
  return ctx.ui.confirm(
    "Bypass Reader TDD gate?",
    "Only continue if the user explicitly authorized this bypass. The action will have no valid gate receipt.",
  );
}

export default function readerTdd(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!(await configured(ctx.cwd))) return;
    const gate = await checkGate(pi, ctx.cwd, "status");
    ctx.ui.setStatus(STATUS_KEY, gate.ok ? "TDD ✓" : "TDD stale");
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!(await configured(ctx.cwd))) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n## Reader Pi-native TDD guard\nFor behavior changes, load the reader-tdd skill and follow plan → test design → tdd_red receipt → green → refactor → tdd_gate. Never claim completion or run a protected release action after changing files unless tdd_gate passed for the exact current working tree. Infrastructure-only changes may omit behavioral red but still require tdd_gate.`,
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!(await configured(ctx.cwd))) return;

    if (event.toolName === "bash") {
      const command = String((event.input as { command?: unknown }).command ?? "");
      const action = classifyProtectedCommand(command);
      if (!action) return;
      if (await allowExplicitBypass(command, ctx)) return;
      const gate = await checkGate(pi, ctx.cwd, action, ctx.signal);
      if (!gate.ok) return { block: true, reason: gate.output, terminate: true };
      return;
    }

    if (event.toolName === "goal_complete") {
      const gate = await checkGate(pi, ctx.cwd, "goal completion", ctx.signal);
      if (!gate.ok) return { block: true, reason: gate.output, terminate: true };
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError || !["edit", "write"].includes(event.toolName)) return;
    if (await configured(ctx.cwd)) ctx.ui.setStatus(STATUS_KEY, "TDD stale");
  });

  pi.registerTool({
    name: "tdd_red",
    label: "TDD Red Receipt",
    description: "Run a focused test command and record a Reader TDD red receipt only when a behavioral assertion fails.",
    promptSnippet: "Validate and record a behavioral failing test before implementing Reader behavior",
    promptGuidelines: [
      "Use tdd_red after adding a focused failing test and before editing product implementation for a Reader behavior change.",
    ],
    parameters: Type.Object({
      workItem: Type.String({ description: "Work item identifier, for example WI-1" }),
      command: Type.String({ description: "Focused test command expected to fail for the missing behavior" }),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      if (!(await configured(ctx.cwd))) throw new Error("Reader TDD guard is not configured.");
      onUpdate?.({ content: [{ type: "text", text: `Running red test for ${params.workItem}…` }], details: {} });
      const result = await pi.exec("sh", ["-lc", params.command], { cwd: ctx.cwd, signal, timeout: 600_000 });
      const output = `${result.stdout}${result.stderr}`;
      const verdict = classifyRedRun(result.code, output);
      if (!verdict.valid) throw new Error(`${verdict.reason}\n\n${tail(output)}`);

      const receiptPath = path.join(ctx.cwd, ".tdd-guardian", "receipts.json");
      let store: { schemaVersion: number; receipts: unknown[] } = { schemaVersion: 1, receipts: [] };
      try {
        store = JSON.parse(await readFile(receiptPath, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      store.receipts = [
        ...store.receipts,
        {
          workItem: params.workItem,
          command: params.command,
          recordedAt: new Date().toISOString(),
          sessionId: process.env.PI_SESSION_ID ?? null,
          result: "behavioral-red",
        },
      ].slice(-100);
      await mkdir(path.dirname(receiptPath), { recursive: true });
      const temporaryPath = `${receiptPath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
      await rename(temporaryPath, receiptPath);
      return { content: [{ type: "text", text: `${verdict.reason}\nReceipt recorded for ${params.workItem}.\n\n${tail(output)}` }], details: { workItem: params.workItem } };
    },
  });

  pi.registerTool({
    name: "tdd_gate",
    label: "Reader TDD Gate",
    description: "Run all Reader build, check, unit, coverage, and guardian lanes and bind the result to the exact working tree.",
    promptSnippet: "Run the final Reader quality gate and create an exact-working-tree receipt",
    promptGuidelines: ["Use tdd_gate immediately before goal_complete or protected Git actions after all file changes are finished."],
    parameters: Type.Object({}),
    async execute(_id, _params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Running Reader TDD gate…" }], details: {} });
      const result = await runGate(pi, ctx.cwd, signal);
      const output = `${result.stdout}${result.stderr}`;
      if (result.code !== 0) {
        ctx.ui.setStatus(STATUS_KEY, "TDD failed");
        throw new Error(tail(output));
      }
      ctx.ui.setStatus(STATUS_KEY, "TDD ✓");
      return { content: [{ type: "text", text: `Reader TDD gate passed.\n\n${tail(output)}` }], details: {} };
    },
  });

  pi.registerCommand("tdd-status", {
    description: "Check whether the Reader TDD gate matches the exact working tree",
    handler: async (_args, ctx) => {
      const gate = await checkGate(pi, ctx.cwd, "status");
      ctx.ui.setStatus(STATUS_KEY, gate.ok ? "TDD ✓" : "TDD stale");
      ctx.ui.notify(gate.output, gate.ok ? "info" : "warning");
    },
  });

  pi.registerCommand("tdd-gate", {
    description: "Run the complete Reader TDD gate",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus(STATUS_KEY, "TDD running");
      const result = await runGate(pi, ctx.cwd, ctx.signal);
      ctx.ui.setStatus(STATUS_KEY, result.code === 0 ? "TDD ✓" : "TDD failed");
      ctx.ui.notify(result.code === 0 ? "Reader TDD gate passed." : tail(`${result.stdout}${result.stderr}`, 2_000), result.code === 0 ? "info" : "error");
    },
  });
}
