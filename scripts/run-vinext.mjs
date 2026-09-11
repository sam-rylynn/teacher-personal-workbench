#!/usr/bin/env node
/**
 * Cross-platform vinext launcher.
 *
 * Replaces the Unix-only `WRANGLER_LOG_PATH=... vinext <cmd>` shell syntax so
 * the same npm scripts work in Windows cmd/PowerShell and macOS/Linux shells.
 * Usage: node scripts/run-vinext.mjs <dev|build|start> [...extra args]
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { recordBuild, sourceFingerprint } from "./build-state.mjs";

process.env.WRANGLER_LOG_PATH = process.env.WRANGLER_LOG_PATH ?? ".wrangler/wrangler.log";

// vinext's package exports do not expose ./dist/cli.js, so resolve it from
// the project's own node_modules directory instead of package resolution.
const vinextCli = fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url));
if (!existsSync(vinextCli)) {
  console.error("没有找到运行依赖，请先在项目目录运行 npm ci。");
  process.exit(1);
}

const [, , command, ...rest] = process.argv;
const allowedCommands = new Set(["dev", "build", "start"]);
if (!command || !allowedCommands.has(command)) {
  console.error("用法: node scripts/run-vinext.mjs <dev|build|start> [参数]");
  process.exit(1);
}

const fingerprint = command === "build" ? await sourceFingerprint() : null;
const child = spawn(process.execPath, [vinextCli, command, ...rest], {
  stdio: "inherit",
  env: process.env,
});

child.on("error", (error) => {
  console.error(`工作台启动失败：${error.message}`);
  process.exit(1);
});

child.on("exit", async (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  if (code === 0 && fingerprint) {
    try {
      await recordBuild(fingerprint);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "生成运行文件未完成。");
      process.exit(1);
    }
  }
  process.exit(code ?? 0);
});
