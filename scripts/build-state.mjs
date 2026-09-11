import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildStamp = join(projectRoot, "dist", ".workbench-build.json");
const sourceDirectories = ["app", "public", "worker"];
const sourceFiles = [
  "package.json", "package-lock.json", "next.config.ts", "postcss.config.mjs",
  "tsconfig.json", "vite.config.ts", "scripts/run-vinext.mjs", "scripts/build-state.mjs",
];

export async function sourceFingerprint() {
  const files = [...sourceFiles];
  async function collect(relativeDirectory) {
    if (!existsSync(join(projectRoot, relativeDirectory))) return;
    for (const entry of await readdir(join(projectRoot, relativeDirectory), { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue;
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) await collect(relativePath);
      else if (entry.isFile()) files.push(relativePath);
    }
  }
  for (const directory of sourceDirectories) await collect(directory);
  const hash = createHash("sha256");
  for (const relativePath of files.sort()) {
    hash.update(relativePath).update("\0");
    hash.update(await readFile(join(projectRoot, relativePath))).update("\0");
  }
  return hash.digest("hex");
}

export async function hasCurrentBuild() {
  if (!existsSync(join(projectRoot, "dist", "server", "index.js"))) return false;
  try {
    const saved = JSON.parse(await readFile(buildStamp, "utf8"));
    return saved.fingerprint === await sourceFingerprint();
  } catch {
    return false;
  }
}

export async function recordBuild(fingerprint) {
  if (fingerprint !== await sourceFingerprint()) {
    throw new Error("生成运行文件期间代码发生了变化，请重新运行 npm run build。");
  }
  await mkdir(dirname(buildStamp), { recursive: true });
  await writeFile(buildStamp, JSON.stringify({ fingerprint }), "utf8");
}
