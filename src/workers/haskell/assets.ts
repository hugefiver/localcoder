export type HaskellExecutionMode = "ghc-e" | "ghc-compile" | "ghci";

export interface HaskellRunnerMetadata {
  readonly protocol: "ghc-wasi-v1";
  readonly executorMode: HaskellExecutionMode;
  readonly testMode: HaskellExecutionMode;
  readonly ghcWasm: string;
  readonly ghciWasm?: string;
  readonly libdirTar: string;
  readonly libdirPath: string;
  readonly workDir: string;
  readonly wasiShim: "haskell/wasi-shim.js";
}

export interface HaskellLoadedAssets {
  readonly metadata: HaskellRunnerMetadata;
  readonly ghcWasm: ArrayBuffer;
  readonly ghciWasm?: ArrayBuffer;
  readonly libdirTar: ArrayBuffer;
  readonly wasiShimUrl: string;
}

export interface HaskellAssetScope {
  readonly location: { readonly href: string };
  fetch(input: RequestInfo | URL): Promise<Response>;
}

const GHC_WASM = ["haskell/ghc.wasm.gz.bin", "haskell/ghc.wasm"] as const;
const GHCi_WASM = ["haskell/ghci.wasm.gz.bin", "haskell/ghci.wasm"] as const;
const LIBDIR_TAR = ["haskell/libdir.tar.gz.bin", "haskell/libdir.tar"] as const;
const metadataFields = [
  "protocol",
  "executorMode",
  "testMode",
  "ghcWasm",
  "ghciWasm",
  "libdirTar",
  "libdirPath",
  "workDir",
  "wasiShim",
] as const;

export function createHaskellAssetLoader(scope: HaskellAssetScope): () => Promise<HaskellLoadedAssets> {
  let loading: Promise<HaskellLoadedAssets> | undefined;
  return (): Promise<HaskellLoadedAssets> => {
    if (loading === undefined) loading = loadHaskellAssets(scope).catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
    return loading;
  };
}

export async function loadHaskellAssets(scope: HaskellAssetScope): Promise<HaskellLoadedAssets> {
  const metadata = parseHaskellRunnerMetadata(parseMetadataText(await fetchText(scope, "haskell/runner.meta.json")));
  const [ghcWasm, libdirTar, ghciWasm] = await Promise.all([
    fetchCompressedOrRaw(scope, metadata.ghcWasm, GHC_WASM),
    fetchCompressedOrRaw(scope, metadata.libdirTar, LIBDIR_TAR),
    requiresGhci(metadata) ? fetchCompressedOrRaw(scope, metadata.ghciWasm!, GHCi_WASM) : Promise.resolve(undefined),
  ]);
  return {
    metadata,
    ghcWasm,
    libdirTar,
    ...(ghciWasm === undefined ? {} : { ghciWasm }),
    wasiShimUrl: assetUrl(scope, metadata.wasiShim).href,
  };
}

export function parseHaskellRunnerMetadata(value: unknown): HaskellRunnerMetadata {
  if (!isPlainRecord(value)) throw new TypeError("Haskell runner metadata must be a plain object");
  const keys = Object.keys(value);
  if (keys.some((key) => !(metadataFields as readonly string[]).includes(key))) {
    throw new TypeError("Haskell runner metadata contains an unknown field");
  }
  for (const key of ["protocol", "executorMode", "testMode", "ghcWasm", "libdirTar", "libdirPath", "workDir", "wasiShim"] as const) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new TypeError(`Haskell runner metadata is missing ${key}`);
  }
  if (value.protocol !== "ghc-wasi-v1") throw new TypeError("Haskell runner metadata has an unsupported protocol");
  const executorMode = executionMode(value.executorMode, "executorMode");
  const testMode = executionMode(value.testMode, "testMode");
  const ghciSelected = executorMode === "ghci" || testMode === "ghci";
  const ghciWasm = value.ghciWasm;
  if (ghciSelected && !isAsset(ghciWasm, GHCi_WASM)) {
    throw new TypeError("Haskell runner metadata requires ghciWasm when GHCi is selected");
  }
  if (!ghciSelected && ghciWasm !== undefined) {
    throw new TypeError("Haskell runner metadata must not declare ghciWasm when GHCi is not selected");
  }
  return {
    protocol: "ghc-wasi-v1",
    executorMode,
    testMode,
    ghcWasm: asset(value.ghcWasm, GHC_WASM, "ghcWasm"),
    ...(ghciSelected ? { ghciWasm: ghciWasm as string } : {}),
    libdirTar: asset(value.libdirTar, LIBDIR_TAR, "libdirTar"),
    libdirPath: mountPath(value.libdirPath, "libdirPath"),
    workDir: mountPath(value.workDir, "workDir"),
    wasiShim: wasiShim(value.wasiShim),
  };
}

function requiresGhci(metadata: HaskellRunnerMetadata): boolean {
  return metadata.executorMode === "ghci" || metadata.testMode === "ghci";
}

function parseMetadataText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new TypeError("Haskell runner metadata is not valid JSON");
  }
}

async function fetchText(scope: HaskellAssetScope, relativePath: string): Promise<string> {
  const response = await fetchResponse(scope, relativePath);
  return response.text();
}

async function fetchCompressedOrRaw(
  scope: HaskellAssetScope,
  configured: string,
  allowed: readonly [string, string],
): Promise<ArrayBuffer> {
  const candidates = configured.endsWith(".gz.bin") ? [configured, allowed[1]] : [allowed[0], configured];
  for (const candidate of candidates) {
    try {
      const bytes = await (await fetchResponse(scope, candidate)).arrayBuffer();
      return candidate.endsWith(".gz.bin") ? await decompressGzip(bytes) : bytes;
    } catch {
      // The alternate packaged representation is required to be tried next.
    }
  }
  throw new TypeError(`Haskell runtime asset could not be loaded: ${configured}`);
}

async function fetchResponse(scope: HaskellAssetScope, relativePath: string): Promise<Response> {
  const requested = assetUrl(scope, relativePath);
  const response = await scope.fetch(requested);
  if (!response.ok) throw new TypeError(`Haskell runtime asset request failed with ${response.status}`);
  if (response.url.length > 0 && new URL(response.url).origin !== requested.origin) {
    throw new TypeError("Haskell runtime asset redirect left the local origin");
  }
  return response;
}

function assetUrl(scope: HaskellAssetScope, relativePath: string): URL {
  if (!/^[A-Za-z0-9._/-]+$/.test(relativePath) || !relativePath.startsWith("haskell/") || relativePath.includes("..")) {
    throw new TypeError("Haskell runtime metadata has an unsafe asset path");
  }
  const base = new URL("./", scope.location.href);
  const url = new URL(relativePath, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new TypeError("Haskell runtime asset must be same-origin and local");
  }
  return url;
}

async function decompressGzip(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof DecompressionStream !== "function") throw new TypeError("DecompressionStream is unavailable");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

function executionMode(value: unknown, field: string): HaskellExecutionMode {
  if (value === "ghc-e" || value === "ghc-compile" || value === "ghci") return value;
  throw new TypeError(`Haskell runner metadata ${field} is unsupported`);
}

function asset(value: unknown, allowed: readonly string[], field: string): string {
  if (!isAsset(value, allowed)) throw new TypeError(`Haskell runner metadata ${field} is inconsistent`);
  return value;
}

function isAsset(value: unknown, allowed: readonly string[]): value is string {
  return typeof value === "string" && allowed.includes(value);
}

function mountPath(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(value)) {
    throw new TypeError(`Haskell runner metadata ${field} must be an absolute safe path`);
  }
  return value;
}

function wasiShim(value: unknown): "haskell/wasi-shim.js" {
  if (value !== "haskell/wasi-shim.js") throw new TypeError("Haskell runner metadata wasiShim is inconsistent");
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
