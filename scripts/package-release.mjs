#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_FILES = [
  ".gitignore",
  ".node-version",
  ".nvmrc",
  "README.md",
  "eslint.config.mjs",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "postcss.config.mjs",
  "scripts/launch-workbench.mjs",
  "scripts/package-release.mjs",
  "scripts/run-vinext.mjs",
  "tsconfig.json",
  "vite.config.ts",
  "交付包内容与Windows验收.md",
  "启动工作台.bat",
  "启动工作台.command",
  "授权协议.md",
  "销售部署说明.md",
];

const TREE_RULES = [
  { directory: "app", extensions: new Set([".css", ".ts", ".tsx"]), required: true },
  { directory: "public", extensions: new Set([".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp", ".woff", ".woff2"]), required: true },
  { directory: "tests", extensions: new Set([".mjs"]), filePattern: /\.test\.mjs$/u, required: true },
  { directory: "worker", extensions: new Set([".ts"]), required: true },
  { directory: ".github/workflows", extensions: new Set([".yaml", ".yml"]), required: false },
];

const FORBIDDEN_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".vinext",
  ".wrangler",
  "dist",
  "node_modules",
  "outputs",
  "work",
]);

const FORBIDDEN_FILE_PATTERNS = [
  /^\.env(?:\.|$)/u,
  /^\.dev\.vars$/u,
  /(?:^|[-_.])credentials?(?:[-_.]|$)/iu,
  /(?:^|[-_.])secrets?(?:[-_.]|$)/iu,
  /(?:^|[-_.])(?:backup|export|snapshot)(?:[-_.]|$).*\.json$/iu,
  /\.teacher-mobile\.json$/iu,
  /(?:\.key|\.p12|\.pem|\.pfx)$/iu,
  /^(?:id_dsa|id_ecdsa|id_ed25519|id_rsa)$/iu,
];

const OBVIOUS_SECRET_PATTERNS = [
  { label: "private key", pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u },
  { label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u },
  { label: "OpenAI-style API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/u },
  { label: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/u },
  { label: "Slack token", pattern: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/u },
];

const TEXT_EXTENSIONS = new Set([
  ".bat",
  ".command",
  ".css",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

function toPosixPath(value) {
  return value.split(sep).join("/");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function parseArguments(argv) {
  const supported = new Set(["--dry-run", "--force"]);
  for (const argument of argv) {
    if (!supported.has(argument)) {
      throw new Error(`不支持的参数：${argument}。可用参数为 --dry-run、--force。`);
    }
  }
  return {
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
  };
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function assertSafeRelativePath(relativePath) {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error(`不安全的打包路径：${relativePath || "<empty>"}`);
  }

  const normalized = toPosixPath(relativePath);
  const parts = normalized.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`不安全的打包路径：${relativePath}`);
  }
  if (parts.some((part) => FORBIDDEN_DIRECTORY_NAMES.has(part))) {
    throw new Error(`白名单意外命中禁止目录：${relativePath}`);
  }

  const fileName = parts.at(-1);
  if (FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(fileName))) {
    throw new Error(`白名单意外命中敏感文件名：${relativePath}`);
  }
}

async function listTreeFiles(rule) {
  const root = resolve(projectRoot, rule.directory);
  if (!(await pathExists(root))) {
    if (rule.required) throw new Error(`缺少必须目录：${rule.directory}`);
    return [];
  }

  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const relativePath = toPosixPath(relative(projectRoot, absolutePath));
      assertSafeRelativePath(relativePath);
      if (entry.isSymbolicLink()) {
        throw new Error(`白名单目录中不允许符号链接：${relativePath}`);
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!rule.extensions.has(extname(entry.name).toLowerCase())) continue;
      if (rule.filePattern && !rule.filePattern.test(entry.name)) continue;
      files.push(relativePath);
    }
  }

  await visit(root);
  if (rule.required && files.length === 0) {
    throw new Error(`必须目录没有可打包文件：${rule.directory}`);
  }
  return files;
}

async function collectWhitelistedFiles() {
  const files = new Set();
  for (const relativePath of REQUIRED_FILES) {
    assertSafeRelativePath(relativePath);
    const absolutePath = resolve(projectRoot, relativePath);
    if (!(await pathExists(absolutePath))) {
      throw new Error(`缺少必须文件：${relativePath}`);
    }
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`必须文件不是普通文件：${relativePath}`);
    }
    files.add(toPosixPath(relativePath));
  }

  for (const rule of TREE_RULES) {
    for (const relativePath of await listTreeFiles(rule)) files.add(relativePath);
  }
  return [...files].sort((left, right) => left.localeCompare(right, "en"));
}

async function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

async function assertNoObviousSecrets(relativePath, absolutePath) {
  const extension = extname(relativePath).toLowerCase();
  const isExtensionlessText = relativePath === ".gitignore" || relativePath === ".node-version" || relativePath === ".nvmrc";
  if (!TEXT_EXTENSIONS.has(extension) && !isExtensionlessText) return;

  const text = await readFile(absolutePath, "utf8");
  for (const { label, pattern } of OBVIOUS_SECRET_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(`检测到疑似 ${label}，已停止打包：${relativePath}`);
    }
  }
}

async function inspectSources(relativePaths) {
  const records = [];
  for (const relativePath of relativePaths) {
    const absolutePath = resolve(projectRoot, relativePath);
    const metadata = await lstat(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`打包源不是普通文件：${relativePath}`);
    }
    await assertNoObviousSecrets(relativePath, absolutePath);
    records.push({
      relativePath,
      absolutePath,
      bytes: metadata.size,
      mode: metadata.mode & 0o777,
      modifiedAt: metadata.mtimeMs,
      sha256: await sha256File(absolutePath),
    });
  }
  return records;
}

async function assertSourcesUnchanged(records) {
  for (const record of records) {
    const metadata = await lstat(record.absolutePath);
    if (
      !metadata.isFile()
      || metadata.isSymbolicLink()
      || metadata.size !== record.bytes
      || metadata.mtimeMs !== record.modifiedAt
      || await sha256File(record.absolutePath) !== record.sha256
    ) {
      throw new Error(`打包期间源文件发生变化，请重新运行：${record.relativePath}`);
    }
  }
}

async function copyPayload(records, archiveRoot) {
  for (const record of records) {
    const destination = resolve(archiveRoot, record.relativePath);
    const destinationRelative = relative(archiveRoot, destination);
    if (destinationRelative.startsWith("..") || resolve(archiveRoot, destinationRelative) !== destination) {
      throw new Error(`目标路径越出临时目录：${record.relativePath}`);
    }
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(record.absolutePath, destination);
    await chmod(destination, record.mode);
    if (await sha256File(destination) !== record.sha256) {
      throw new Error(`临时副本校验失败：${record.relativePath}`);
    }
  }
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function createLocalZipHeader(entry) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6); // Language encoding flag: path is UTF-8.
  header.writeUInt16LE(entry.method, 8);
  header.writeUInt16LE(0, 10); // Reproducible 1980-01-01 00:00 DOS timestamp.
  header.writeUInt16LE(0x0021, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressed.length, 18);
  header.writeUInt32LE(entry.uncompressedSize, 22);
  header.writeUInt16LE(entry.nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function createCentralZipHeader(entry, localOffset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4); // ZIP 2.0, Unix permissions in external attrs.
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0x0021, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressed.length, 20);
  header.writeUInt32LE(entry.uncompressedSize, 24);
  header.writeUInt16LE(entry.nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(entry.externalAttributes >>> 0, 38);
  header.writeUInt32LE(localOffset, 42);
  return header;
}

async function createZip(archiveRoot, archiveRootName, records, zipPath) {
  const directoryNames = new Set([`${archiveRootName}/`]);
  for (const record of records) {
    const parts = record.relativePath.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directoryNames.add(`${archiveRootName}/${parts.slice(0, index).join("/")}/`);
    }
  }

  const entries = [];
  for (const name of directoryNames) {
    const nameBuffer = Buffer.from(name, "utf8");
    entries.push({
      name,
      nameBuffer,
      method: 0,
      crc: 0,
      compressed: Buffer.alloc(0),
      uncompressedSize: 0,
      externalAttributes: (((0o040000 | 0o755) << 16) | 0x10) >>> 0,
    });
  }

  for (const record of records) {
    const name = `${archiveRootName}/${record.relativePath}`;
    const nameBuffer = Buffer.from(name, "utf8");
    const payload = await readFile(resolve(archiveRoot, record.relativePath));
    const deflated = deflateRawSync(payload, { level: 9 });
    const useDeflate = deflated.length < payload.length;
    entries.push({
      name,
      nameBuffer,
      method: useDeflate ? 8 : 0,
      crc: crc32(payload),
      compressed: useDeflate ? deflated : payload,
      uncompressedSize: payload.length,
      externalAttributes: ((0o100000 | record.mode) << 16) >>> 0,
    });
  }

  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  if (entries.length > 0xffff) throw new Error("ZIP 文件数超过经典格式上限。");

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    if (
      entry.nameBuffer.length > 0xffff
      || entry.compressed.length > 0xffffffff
      || entry.uncompressedSize > 0xffffffff
      || localOffset > 0xffffffff
    ) {
      throw new Error(`文件超过经典 ZIP 格式上限：${entry.name}`);
    }
    const localHeader = createLocalZipHeader(entry);
    localParts.push(localHeader, entry.nameBuffer, entry.compressed);
    const centralHeader = createCentralZipHeader(entry, localOffset);
    centralParts.push(centralHeader, entry.nameBuffer);
    localOffset += localHeader.length + entry.nameBuffer.length + entry.compressed.length;
  }

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  if (localOffset > 0xffffffff || centralSize > 0xffffffff) {
    throw new Error("候选包超过经典 ZIP 格式上限。");
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  await writeFile(zipPath, Buffer.concat([...localParts, ...centralParts, end]));
}

function buildManifest({ packageName, version, archiveName, archiveRootName, archiveHash, generatedAt, records }) {
  const totalBytes = records.reduce((total, record) => total + record.bytes, 0);
  const rows = records.map((record) => (
    `| \`${archiveRootName}/${record.relativePath}\` | ${record.bytes} | \`${record.sha256}\` |`
  ));

  return [
    "# 教师个人工作台 · 候选交付清单",
    "",
    `- 包名：\`${packageName}\``,
    `- 版本：\`${version}\`（读取自 \`package.json\`）`,
    `- 生成时间：\`${generatedAt}\``,
    `- ZIP：\`${archiveName}\``,
    `- ZIP SHA-256：\`${archiveHash}\``,
    `- 解压根目录：\`${archiveRootName}/\``,
    `- 文件数：${records.length}`,
    `- 源文件总大小：${formatBytes(totalBytes)}`,
    "- 状态：候选交付物；本脚本不会创建标签、提交或推送。",
    "",
    "## 白名单范围",
    "",
    "仅包含运行所需源码、配置、自动化测试、公开静态资源、交付文档与跨平台启动器。",
    "",
    "明确排除：`.git/`、`node_modules/`、`.next/`、`.vinext/`、`.wrangler/`、`dist/`、`outputs/` 历史产物、`work/`、环境变量文件、密钥文件、备份/导出/手机快照文件与浏览器本地数据。",
    "",
    "## 文件清单",
    "",
    "| 路径 | 字节数 | SHA-256 |",
    "|---|---:|---|",
    ...rows,
    "",
  ].join("\n");
}

async function publishArtifacts({ outputBase, outputDirectory, deliveryDirectory, force }) {
  const expectedParent = resolve(projectRoot, "outputs");
  if (resolve(outputBase) !== expectedParent || dirname(resolve(outputDirectory)) !== expectedParent) {
    throw new Error(`拒绝写入非预期输出目录：${outputDirectory}`);
  }

  await mkdir(outputBase, { recursive: true });
  const publishDirectory = join(outputBase, `.${basename(outputDirectory)}.tmp-${process.pid}-${Date.now()}`);
  const backupDirectory = join(outputBase, `.${basename(outputDirectory)}.previous-${process.pid}-${Date.now()}`);
  await mkdir(publishDirectory, { recursive: false });

  try {
    for (const fileName of await readdir(deliveryDirectory)) {
      await copyFile(join(deliveryDirectory, fileName), join(publishDirectory, fileName));
    }

    if (!(await pathExists(outputDirectory))) {
      await rename(publishDirectory, outputDirectory);
      return;
    }
    if (!force) {
      throw new Error(`输出目录已存在：${toPosixPath(relative(projectRoot, outputDirectory))}。确认覆盖时使用 --force。`);
    }

    await rename(outputDirectory, backupDirectory);
    try {
      await rename(publishDirectory, outputDirectory);
      await rm(backupDirectory, { recursive: true, force: true });
    } catch (error) {
      if (!(await pathExists(outputDirectory)) && await pathExists(backupDirectory)) {
        await rename(backupDirectory, outputDirectory);
      }
      throw error;
    }
  } finally {
    await rm(publishDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  const packageName = packageJson.name;
  const version = packageJson.version;
  if (typeof packageName !== "string" || !/^[a-z0-9][a-z0-9._-]*$/u.test(packageName)) {
    throw new Error("package.json 的 name 不是安全的包名。");
  }
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error("package.json 的 version 不是可用于交付目录的版本号。");
  }

  const archiveRootName = `${packageName}-v${version}`;
  const archiveName = `${archiveRootName}.zip`;
  const outputBase = resolve(projectRoot, "outputs");
  const outputDirectory = resolve(outputBase, `release-v${version}`);
  if (dirname(outputDirectory) !== outputBase) throw new Error("版本号生成了不安全的输出目录。");

  if (!options.force && !options.dryRun && await pathExists(outputDirectory)) {
    throw new Error(`输出目录已存在：${toPosixPath(relative(projectRoot, outputDirectory))}。确认覆盖时使用 --force。`);
  }

  const relativePaths = await collectWhitelistedFiles();
  const records = await inspectSources(relativePaths);
  const totalBytes = records.reduce((total, record) => total + record.bytes, 0);

  if (options.dryRun) {
    console.log(`白名单检查通过：${records.length} 个文件，${formatBytes(totalBytes)}。`);
    console.log(`候选版本：v${version}`);
    console.log(`计划输出：${toPosixPath(relative(projectRoot, outputDirectory))}/${archiveName}`);
    return;
  }

  const tempRoot = await mkdtemp(join(tmpdir(), `${packageName}-release-`));
  try {
    const archiveRoot = join(tempRoot, archiveRootName);
    const deliveryDirectory = join(tempRoot, "delivery");
    const zipPath = join(deliveryDirectory, archiveName);
    await mkdir(archiveRoot, { recursive: true });
    await mkdir(deliveryDirectory, { recursive: true });

    await copyPayload(records, archiveRoot);
    await assertSourcesUnchanged(records);
    await createZip(archiveRoot, archiveRootName, records, zipPath);
    const archiveMetadata = await lstat(zipPath);
    if (!archiveMetadata.isFile() || archiveMetadata.size === 0) {
      throw new Error("ZIP 未生成或为空。");
    }

    const generatedAt = new Date().toISOString();
    const archiveHash = await sha256File(zipPath);
    const manifest = buildManifest({
      packageName,
      version,
      archiveName,
      archiveRootName,
      archiveHash,
      generatedAt,
      records,
    });
    const manifestPath = join(deliveryDirectory, "MANIFEST.md");
    await writeFile(manifestPath, manifest, "utf8");
    const manifestHash = await sha256File(manifestPath);

    const checksumLines = [
      `${archiveHash}  ${archiveName}`,
      `${manifestHash}  MANIFEST.md`,
      ...records.map((record) => `${record.sha256}  ${archiveRootName}/${record.relativePath}`),
      "",
    ];
    await writeFile(join(deliveryDirectory, "SHA256SUMS.txt"), checksumLines.join("\n"), "utf8");

    await assertSourcesUnchanged(records);
    await publishArtifacts({ outputBase, outputDirectory, deliveryDirectory, force: options.force });

    console.log(`候选交付包已生成：${toPosixPath(relative(projectRoot, outputDirectory))}`);
    console.log(`ZIP：${archiveName}`);
    console.log(`SHA-256：${archiveHash}`);
    console.log(`白名单文件：${records.length} 个（${formatBytes(totalBytes)}）`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "候选交付打包失败。");
  process.exitCode = 1;
});
