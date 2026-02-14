#!/usr/bin/env node
/**
 * UserPromptSubmit hook: refine prompts for better Claude Code interaction.
 *
 * Trigger: prefix your prompt with "::" or ">>"
 *   :: 把这个函数改成异步的
 *   >> make the thing work better
 *
 * The refined prompt is copied to clipboard. Paste it back to send.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function loadProjectContext() {
  try {
    const hookDir = dirname(fileURLToPath(import.meta.url));
    const contextPath = resolve(hookDir, "project-context.txt");
    const text = readFileSync(contextPath, "utf-8").trim();
    return `\n\nProject context:\n${text}`;
  } catch {
    return "";
  }
}

const PROJECT_CONTEXT = loadProjectContext();

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

function readStdin() {
  return new Promise((resolvePromise) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf-8")));
  });
}

function copyToClipboard(text) {
  try {
    execSync("pbcopy", { input: text, stdio: ["pipe", "ignore", "ignore"] });
  } catch {
    // Non-macOS or pbcopy unavailable.
  }
}

const data = JSON.parse(await readStdin());
const raw = (data.prompt || "").trimStart();

const match = raw.match(/^(::|>>|：：)\s*/);
if (!match) process.exit(0);

const text = raw.slice(match[0].length).trim();

if (!text) {
  block("Nothing to refine. Add text after :: or >>, or submit normally.");
}

if (text.length < 6 || /^(go ahead|ok|okay|yes|no|continue|next|option\s*\d+|\d+)$/i.test(text)) {
  block("Skipped: too short or low-signal input. Re-send without prefix.");
}

// 翻译功能配置
const TRANSLATION_ENABLED = true; // 是否启用翻译功能
const TRANSLATION_API = "https://api.siliconflow.cn/v1/chat/completions";
const TRANSLATION_MODEL = "tencent/Hunyuan-MT-7B";
const SILICONFLOW_APPKEY = process.env.SILICONFLOW_APPKEY || ""; // 支持环境变量配置

// 翻译函数
async function translateText(text, targetLang = "English") {
  // 如果是纯英文文本，直接返回
  if (/^[a-zA-Z\s.,!?;:'"()[\]{}]*$/.test(text)) {
    return text;
  }

  // 如果没有配置 API key，跳过翻译
  if (!SILICONFLOW_APPKEY) {
    return text;
  }

  try {
    const response = await fetch(TRANSLATION_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SILICONFLOW_APPKEY}`
      },
      body: JSON.stringify({
        model: TRANSLATION_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a professional translator. Translate the following text to ${targetLang}.
            Keep technical terms unchanged (e.g., function names, file paths, commands, library names).
            Do not add or remove any content. Return only the translated text.`
          },
          {
            role: "user",
            content: text
          }
        ],
        temperature: 0.1,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      throw new Error(`Translation API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || text;
  } catch (error) {
    console.error("Translation error:", error);
    return text; // 翻译失败时返回原始文本
  }
}

// 简单但有效的提示词优化逻辑
async function optimizePrompt(text) {
  // 1. 翻译（如果启用）
  let optimized = text.trim();

  if (TRANSLATION_ENABLED) {
    optimized = await translateText(optimized, "English");
  }

  // 常见优化模式
  const replacements = [
    // 中文模式
    { from: /^看看(\s+)?(一下)?\s*(.*)$/, to: "查看并分析$3" },
    { from: /^帮我(\s+)?(一下)?\s*(.*)$/, to: "帮我$3" },
    { from: /^试试(\s+)?(一下)?\s*(.*)$/, to: "尝试$3" },
    { from: /^研究(\s+)?(一下)?\s*(.*)$/, to: "研究并分析$3" },
    { from: /^解决(\s+)?(一下)?\s*(.*)$/, to: "解决$3问题" },
    { from: /^修复(\s+)?(一下)?\s*(.*)$/, to: "修复$3" },
    { from: /^实现(\s+)?(一下)?\s*(.*)$/, to: "实现$3" },
    { from: /^添加(\s+)?(一下)?\s*(.*)$/, to: "添加$3" },
    { from: /^删除(\s+)?(一下)?\s*(.*)$/, to: "删除$3" },
    { from: /^修改(\s+)?(一下)?\s*(.*)$/, to: "修改$3" },

    // 英文模式
    { from: /^check(\s+)?(out)?\s*(.*)$/i, to: "Check and analyze $3" },
    { from: /^try(\s+)?(to)?\s*(.*)$/i, to: "Try to $3" },
    { from: /^look(\s+)?(at)?\s*(.*)$/i, to: "Look at and analyze $3" },
    { from: /^help(\s+)?(me)?\s*(.*)$/i, to: "Help me $3" },
    { from: /^fix(\s+)?(the)?\s*(.*)$/i, to: "Fix $3" },
    { from: /^implement(\s+)?(the)?\s*(.*)$/i, to: "Implement $3" },
    { from: /^add(\s+)?(the)?\s*(.*)$/i, to: "Add $3" },
    { from: /^remove(\s+)?(the)?\s*(.*)$/i, to: "Remove $3" },
    { from: /^update(\s+)?(the)?\s*(.*)$/i, to: "Update $3" },
  ];

  for (const replacement of replacements) {
    if (replacement.from.test(optimized)) {
      optimized = optimized.replace(replacement.from, replacement.to);
      break;
    }
  }

  // 通用优化：使用祈使语气，明确范围
  if (!/^(Check|Try|Look|Help|Fix|Implement|Add|Remove|Update|查看|尝试|研究|解决|修复|实现|添加|删除|修改)/.test(optimized)) {
    // 对于简单查询，添加明确动词
    if (text.length < 20) {
      // 判断翻译后的文本语言
      if (/^[a-zA-Z\s.,!?;:'"()[\]{}]*$/.test(optimized)) {
        // 如果已经包含动词短语，避免重复添加
        if (/^(look at|take a look|check out)/i.test(optimized)) {
          // 直接使用翻译结果
        } else {
          optimized = `Analyze and ${optimized}`;
        }
      } else {
        // 对于中文文本
        if (/^(看看|查看)/.test(optimized)) {
          // 直接使用翻译结果
        } else {
          optimized = `查看并分析${optimized}`;
        }
      }
    }
  }

  // 移除冗余词汇
  optimized = optimized.replace(/\s*一下\s*/g, "");
  optimized = optimized.replace(/\s*帮我\s*/g, "");
  optimized = optimized.replace(/\s*请\s*/g, "");
  optimized = optimized.replace(/\s*可以\s*吗\s*/g, "");
  optimized = optimized.replace(/\s*能\s*吗\s*/g, "");

  // 确保输出简洁
  optimized = optimized.trim().slice(0, 200);

  return optimized;
}

try {
  const result = await optimizePrompt(text);

  if (!result) block("Refinement produced empty output.");

  copyToClipboard(result);
  block(`Refined prompt (copied to clipboard):\n${result}`);
} catch (err) {
  block(`Refinement error: ${err.message || err}`);
}
