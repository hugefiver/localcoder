import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeCatalog } from "./lib/runtime-catalog.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(scriptPath), "..");

function resolvePublicAsset(publicRoot, url) {
  const assetPath = path.resolve(publicRoot, ...url.split("/"));
  const relativePath = path.relative(publicRoot, assetPath);
  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Runtime catalog asset escapes public/: ${url}`);
  }
  return assetPath;
}

function nonEmptyAsset(publicRoot, url) {
  const assetPath = resolvePublicAsset(publicRoot, url);
  try {
    const stat = fs.statSync(assetPath);
    return stat.isFile() && stat.size > 0 ? { url, bytes: stat.size } : null;
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return null;
    throw error;
  }
}

function missingGroupDescription(group) {
  return group.type === "one-of"
    ? `one of ${group.urls.join(" or ")}`
    : group.urls[0];
}

function hasHaskellGhciSelection(publicRoot) {
  const metadata = nonEmptyAsset(publicRoot, "haskell/runner.meta.json");
  if (metadata === null) return false;
  try {
    const value = JSON.parse(fs.readFileSync(resolvePublicAsset(publicRoot, metadata.url), "utf8"));
    return value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      && (value.executorMode === "ghci" || value.testMode === "ghci");
  } catch {
    return false;
  }
}

function groupApplies(publicRoot, group) {
  if (group.condition === undefined) return true;
  if (group.condition === "haskell-ghci") return hasHaskellGhciSelection(publicRoot);
  throw new Error(`Runtime catalog asset group has an unsupported condition: ${group.condition}`);
}

function resolveAssetGroups(publicRoot, assetGroups) {
  const assets = [];
  const missing = [];

  for (const group of assetGroups) {
    if (!groupApplies(publicRoot, group)) continue;
    const resolved = group.urls.map((url) => nonEmptyAsset(publicRoot, url)).filter(Boolean);
    if (resolved.length > 0) {
      assets.push(...resolved);
    } else {
      missing.push(missingGroupDescription(group));
    }
  }

  return { assets, missing };
}

function buildRuntimeEntry(publicRoot, definition, typescriptVersion) {
  const { assets, missing } = resolveAssetGroups(publicRoot, definition.assetGroups);
  const present = missing.length === 0;
  const packaged = present && definition.unavailableReason === undefined;

  return {
    runtimeId: definition.runtimeId,
    languageId: definition.languageId,
    protocolVersion: 1,
    runtimeVersion: definition.runtimeId === "typescript-official" ? typescriptVersion : definition.runtimeVersion,
    worker: definition.worker,
    assets,
    required: definition.required,
    packaged,
    ...(packaged ? {} : {
      unavailableReason: definition.unavailableReason ?? `Missing asset groups: ${missing.join("; ")}`,
    }),
    reuse: definition.reuse,
    capabilities: packaged
      ? { ...definition.capabilityIntent }
      : { execute: false, judge: false },
    timeouts: { ...definition.timeouts },
    limits: { ...definition.limits },
  };
}

export function readTypeScriptRuntimeVersion(root = defaultRoot) {
  const projectRoot = path.resolve(root);
  const packagePath = path.join(projectRoot, "node_modules", "typescript", "package.json");
  const packageMetadata = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  if (typeof packageMetadata.version !== "string" || packageMetadata.version.trim().length === 0) {
    throw new Error("Installed TypeScript package metadata does not contain a compiler version");
  }
  return packageMetadata.version;
}

export async function buildManifest({ root = defaultRoot, typescriptVersion } = {}) {
  const projectRoot = path.resolve(root);
  const publicRoot = path.join(projectRoot, "public");
  const compilerVersion = typescriptVersion ?? readTypeScriptRuntimeVersion(projectRoot);
  return {
    schemaVersion: 1,
    runtimes: runtimeCatalog.map((definition) => buildRuntimeEntry(publicRoot, definition, compilerVersion)),
  };
}

export async function writeRuntimeManifest({ root = defaultRoot, typescriptVersion } = {}) {
  const projectRoot = path.resolve(root);
  const publicRoot = path.join(projectRoot, "public");
  const outputPath = path.join(publicRoot, "runtime-manifest.json");
  const tempPath = path.join(publicRoot, `.runtime-manifest-${process.pid}-${Date.now()}.tmp`);
  const manifest = await buildManifest({ root: projectRoot, ...(typescriptVersion === undefined ? {} : { typescriptVersion }) });

  fs.mkdirSync(publicRoot, { recursive: true });
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    fs.renameSync(tempPath, outputPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }

  return { manifest, outputPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const { outputPath } = await writeRuntimeManifest();
  console.log(`Generated ${path.relative(defaultRoot, outputPath)}`);
}
