#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const minimumNode = [22, 13, 0];
const currentNode = process.versions.node.split(".").map(Number);
const supported = currentNode.some((part, index) => part > minimumNode[index] && currentNode.slice(0, index).every((value, previous) => value === minimumNode[previous]))
  || currentNode.every((part, index) => part === minimumNode[index]);

if (!supported) {
  console.error(`需要 Node.js 22.13.0 或更高版本，当前为 ${process.versions.node}。`);
  process.exit(1);
}

const port = process.env.TEACHER_WORKBENCH_PORT ?? "3002";
const portNumber = Number(port);
const vinextLauncher = fileURLToPath(new URL("./run-vinext.mjs", import.meta.url));
const checkOnly = process.argv.slice(2).includes("--check");

if (process.argv.slice(2).some((argument) => argument !== "--check")) {
  console.error("不支持的启动参数。可用参数为 --check。");
  process.exit(1);
}
if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
  console.error(`端口设置无效：${port}。请输入 1 到 65535 之间的整数。`);
  process.exit(1);
}

function run(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vinextLauncher, command, ...args], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) return reject(new Error(`进程被信号 ${signal} 中止。`));
      if (code !== 0) return reject(new Error(`命令执行失败，退出码 ${code ?? "未知"}。`));
      resolve();
    });
  });
}

try {
  if (!existsSync(new URL("../node_modules/vinext/dist/cli.js", import.meta.url))) {
    throw new Error("尚未安装运行依赖，请先在项目目录执行 npm ci。 ");
  }
  if (!existsSync(new URL("../dist/server/index.js", import.meta.url))) {
    if (checkOnly) throw new Error("尚未生成运行文件，请先执行 npm run build。 ");
    console.log("首次启动需要生成本机运行文件，请稍候……");
    await run("build");
  }
  if (checkOnly) {
    console.log(`启动检查通过：Node.js ${process.versions.node}，端口 ${port} 可用于启动。`);
  } else {
    console.log(`教师工作台将在 http://localhost:${port} 启动。按 Ctrl+C 可以关闭。`);
    await run("start", ["--port", port]);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "工作台启动失败。 ");
  process.exit(1);
}
