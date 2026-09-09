import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export const WORKER_IDENTITY_DOMAIN = "localcoder-worker-identity-v2";

export function compareIdentityText(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareIdentityRecords(left, right) {
  return compareIdentityText(left.tag, right.tag) || compareIdentityText(left.name, right.name);
}

const esbuildPlatformPackages = Object.freeze({
  "aix:ppc64": ["@esbuild/aix-ppc64", "bin/esbuild"],
  "android:arm": ["@esbuild/android-arm", "bin/esbuild"],
  "android:arm64": ["@esbuild/android-arm64", "bin/esbuild"],
  "android:x64": ["@esbuild/android-x64", "bin/esbuild"],
  "darwin:arm64": ["@esbuild/darwin-arm64", "bin/esbuild"],
  "darwin:x64": ["@esbuild/darwin-x64", "bin/esbuild"],
  "freebsd:arm64": ["@esbuild/freebsd-arm64", "bin/esbuild"],
  "freebsd:x64": ["@esbuild/freebsd-x64", "bin/esbuild"],
  "linux:arm": ["@esbuild/linux-arm", "bin/esbuild"],
  "linux:arm64": ["@esbuild/linux-arm64", "bin/esbuild"],
  "linux:ia32": ["@esbuild/linux-ia32", "bin/esbuild"],
  "linux:loong64": ["@esbuild/linux-loong64", "bin/esbuild"],
  "linux:mips64el": ["@esbuild/linux-mips64el", "bin/esbuild"],
  "linux:ppc64": ["@esbuild/linux-ppc64", "bin/esbuild"],
  "linux:riscv64": ["@esbuild/linux-riscv64", "bin/esbuild"],
  "linux:s390x": ["@esbuild/linux-s390x", "bin/esbuild"],
  "linux:x64": ["@esbuild/linux-x64", "bin/esbuild"],
  "netbsd:arm64": ["@esbuild/netbsd-arm64", "bin/esbuild"],
  "netbsd:x64": ["@esbuild/netbsd-x64", "bin/esbuild"],
  "openharmony:arm64": ["@esbuild/openharmony-arm64", "bin/esbuild"],
  "openbsd:arm64": ["@esbuild/openbsd-arm64", "bin/esbuild"],
  "openbsd:x64": ["@esbuild/openbsd-x64", "bin/esbuild"],
  "sunos:x64": ["@esbuild/sunos-x64", "bin/esbuild"],
  "win32:arm64": ["@esbuild/win32-arm64", "esbuild.exe"],
  "win32:ia32": ["@esbuild/win32-ia32", "esbuild.exe"],
  "win32:x64": ["@esbuild/win32-x64", "esbuild.exe"],
});

function normalizeName(name) {
  return name.replaceAll("\\", "/");
}

function inputPath(root, relativePath) {
  return path.join(root, ...relativePath.split("/"));
}

function nonEmptyFile(absolutePath) {
  const stat = fs.statSync(absolutePath);
  return stat.isFile() && stat.size > 0;
}

function requiredRecord(root, tag, relativePath) {
  const absolutePath = inputPath(root, relativePath);
  try {
    if (!nonEmptyFile(absolutePath)) throw new Error("not a non-empty file");
  } catch (error) {
    throw new Error(`Required worker identity input is missing or empty: ${relativePath}`, { cause: error });
  }
  return { tag, name: normalizeName(relativePath), bytes: fs.readFileSync(absolutePath) };
}

function optionalGroupRecords(root, tag, group, candidates) {
  const names = new Set();
  const records = [];
  for (const relativePath of candidates) {
    const normalizedPath = normalizeName(relativePath);
    if (names.has(normalizedPath)) throw new Error(`Optional worker identity group has a duplicate candidate: ${normalizedPath}`);
    names.add(normalizedPath);
    const absolutePath = inputPath(root, relativePath);
    try {
      if (nonEmptyFile(absolutePath)) {
        records.push({ tag, name: normalizedPath, bytes: fs.readFileSync(absolutePath) });
      }
    } catch (error) {
      if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) continue;
      throw error;
    }
  }
  return records.length > 0 ? records : [{ tag: "missing", name: `missing:${group}`, bytes: Buffer.alloc(0) }];
}

function findPackageRootFrom(resolverPath, packageName, resolvedRequest = packageName) {
  const requireFromResolver = createRequire(resolverPath);
  let currentDirectory;
  try {
    currentDirectory = path.dirname(requireFromResolver.resolve(resolvedRequest));
  } catch (error) {
    throw new Error(`Required worker identity input package cannot be resolved: ${packageName}`, { cause: error });
  }

  while (true) {
    const packageJsonPath = path.join(currentDirectory, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        if (JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).name === packageName) return currentDirectory;
      } catch (error) {
        throw new Error(`Required worker identity input package metadata is invalid: ${packageName}`, { cause: error });
      }
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
  }
  throw new Error(`Required worker identity input package metadata is missing: ${packageName}`);
}

function findPackageRoot(toolchainRoot, packageName, resolvedRequest = packageName) {
  return findPackageRootFrom(path.join(toolchainRoot, "package.json"), packageName, resolvedRequest);
}

function recordsFromDirectory(root, tag, relativeDirectory, extension) {
  const directory = inputPath(root, relativeDirectory);
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Required worker identity input directory is missing: ${relativeDirectory}`, { cause: error });
  }

  const records = entries
    .flatMap((entry) => {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) return recordsFromDirectory(root, tag, relativePath, extension);
      return entry.isFile() && entry.name.endsWith(extension) ? [requiredRecord(root, tag, relativePath)] : [];
    })
    .sort((left, right) => compareIdentityText(left.name, right.name));
  if (records.length === 0) throw new Error(`Required worker identity input directory has no ${extension} files: ${relativeDirectory}`);
  return records;
}

function packageRelativePath(toolchainRoot, packageRoot, packageRelativePath) {
  return normalizeName(path.relative(toolchainRoot, path.join(packageRoot, packageRelativePath)));
}

function packageRecords(toolchainRoot, packageName, tag, relativePaths) {
  const packageRoot = findPackageRoot(toolchainRoot, packageName);
  return relativePaths.map((relativePath) => requiredRecord(
    toolchainRoot,
    tag,
    packageRelativePath(toolchainRoot, packageRoot, relativePath),
  ));
}

function esbuildPlatformRecords(toolchainRoot) {
  const platformKey = `${process.platform}:${process.arch}`;
  const selected = esbuildPlatformPackages[platformKey];
  if (selected === undefined) {
    throw new Error(`Required worker identity input has unsupported esbuild platform: ${platformKey}`);
  }
  const [packageName, binaryRelativePath] = selected;
  const esbuildPackageRoot = findPackageRoot(toolchainRoot, "esbuild");
  const packageRoot = findPackageRootFrom(
    path.join(esbuildPackageRoot, "package.json"),
    packageName,
    `${packageName}/${binaryRelativePath}`,
  );
  return ["package.json", binaryRelativePath].map((relativePath) => requiredRecord(
    toolchainRoot,
    "toolchain/esbuild-platform",
    packageRelativePath(toolchainRoot, packageRoot, relativePath),
  ));
}

function haskellAssetCandidates(metadata, field, compressedPath, rawPath) {
  const configuredValue = metadata !== null && typeof metadata[field] === "string" ? metadata[field] : undefined;
  const configured = configuredValue !== undefined
    && configuredValue.startsWith("haskell/")
    && !configuredValue.includes("..")
    ? `public/${configuredValue}`
    : undefined;
  if (configured?.endsWith(".gz.bin")) return [configured, rawPath];
  return [compressedPath, configured ?? rawPath];
}

function readOptionalMetadata(root) {
  const metadataPath = inputPath(root, "public/haskell/runner.meta.json");
  try {
    if (!nonEmptyFile(metadataPath)) return null;
    const value = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR" || error instanceof SyntaxError)) return null;
    throw error;
  }
}

export function resolvedEsbuild(toolchainRoot) {
  const requireFromToolchain = createRequire(path.join(toolchainRoot, "package.json"));
  try {
    return requireFromToolchain("esbuild");
  } catch (error) {
    throw new Error("Required worker toolchain package cannot be loaded: esbuild", { cause: error });
  }
}

export function esbuildIdentityRecords(toolchainRoot) {
  return [
    ...packageRecords(toolchainRoot, "esbuild", "toolchain/esbuild", ["package.json", "lib/main.js"]),
    ...esbuildPlatformRecords(toolchainRoot),
  ];
}

export function wasiShimIdentityRecords(toolchainRoot) {
  const packageRoot = findPackageRoot(toolchainRoot, "@bjorn3/browser_wasi_shim");
  const packageJsonRecord = requiredRecord(
    toolchainRoot,
    "toolchain/wasi-shim",
    packageRelativePath(toolchainRoot, packageRoot, "package.json"),
  );
  const distDirectory = packageRelativePath(toolchainRoot, packageRoot, "dist");
  return [packageJsonRecord, ...recordsFromDirectory(toolchainRoot, "toolchain/wasi-shim", distDirectory, ".js")];
}

export function javascriptRuntimeIdentityRecords(root) {
  return [requiredRecord(root, "runtime-asset", "public/typescript/typescript.js")];
}

export function pyodideRuntimeIdentityRecords(root) {
  return [
    "pyodide.js",
    "pyodide.asm.js",
    "pyodide.asm.wasm",
    "python_stdlib.zip",
    "pyodide-lock.json",
  ].map((asset) => requiredRecord(root, "runtime-asset", `public/pyodide/${asset}`));
}

export function racketRuntimeIdentityRecords(root) {
  return [
    ...optionalGroupRecords(root, "runtime-asset", "racket/javascript", ["public/racket/racket.js"]),
    ...optionalGroupRecords(root, "runtime-asset", "racket/wasm", ["public/racket/racket.wasm.gz", "public/racket/racket.wasm"]),
  ];
}

export function rustPythonRuntimeIdentityRecords(root) {
  return optionalGroupRecords(root, "runtime-asset", "rustpython/runner", ["public/rustpython/runner.wasm.gz.bin", "public/rustpython/runner.wasm"]);
}

export function haskellRuntimeIdentityRecords(root) {
  const metadata = readOptionalMetadata(root);
  const records = [
    ...optionalGroupRecords(root, "runtime-asset", "haskell/metadata", ["public/haskell/runner.meta.json"]),
    ...optionalGroupRecords(root, "runtime-asset", "haskell/wasi-shim", ["public/haskell/wasi-shim.js"]),
    ...optionalGroupRecords(root, "runtime-asset", "haskell/ghc", haskellAssetCandidates(metadata, "ghcWasm", "public/haskell/ghc.wasm.gz.bin", "public/haskell/ghc.wasm")),
    ...optionalGroupRecords(root, "runtime-asset", "haskell/libdir", haskellAssetCandidates(metadata, "libdirTar", "public/haskell/libdir.tar.gz.bin", "public/haskell/libdir.tar")),
  ];
  if (metadata?.executorMode === "ghci" || metadata?.testMode === "ghci") {
    records.push(...optionalGroupRecords(
      root,
      "runtime-asset",
      "haskell/ghci",
      haskellAssetCandidates(metadata, "ghciWasm", "public/haskell/ghci.wasm.gz.bin", "public/haskell/ghci.wasm"),
    ));
  }
  return records;
}

export function workerBuildIdentity(records) {
  const hash = createHash("sha256");
  hash.update(WORKER_IDENTITY_DOMAIN);
  hash.update("\0");
  for (const record of [...records].sort(compareIdentityRecords)) {
    hash.update(record.tag);
    hash.update("\0");
    hash.update(record.name);
    hash.update("\0");
    hash.update(String(record.bytes.byteLength));
    hash.update("\0");
    hash.update(record.bytes);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}
