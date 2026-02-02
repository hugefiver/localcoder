import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const srcDir = path.join(root, "racket-src");
const distDir = path.join(root, "dist");
const racketDir = path.join(srcDir, "racket");
const configureScript = path.join(racketDir, "src", "configure");
const hostBuildDir = path.join(racketDir, "src", "build-host");
const targetBuildDir = path.join(racketDir, "src", "build-wasm");
const defsPath = path.join(root, "emscripten-defs.h");
fs.writeFileSync(
  defsPath,
  "#ifndef RACKET_WASM_DEFS\n#define RACKET_WASM_DEFS\n" +
    "#ifndef scheme_extract_pointer\n#define scheme_extract_pointer(x) NULL\n#endif\n" +
    "#endif\n",
);

const platformDefines = `-DSCHEME_OS=\\\"emscripten\\\" -DSCHEME_ARCH=\\\"wasm32\\\" -DSYSTEM_TYPE_NAME=\\\"emscripten\\\" -include ${defsPath}`;
const hostEnv = {
  CC_FOR_BUILD: process.env.CC_FOR_BUILD ?? "cc",
};
const targetEnv = {
  CC_FOR_BUILD: process.env.CC_FOR_BUILD ?? "cc",
  CPPFLAGS: [process.env.CPPFLAGS, platformDefines]
    .filter(Boolean)
    .join(" ")
    .trim(),
};

function exec(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...(opts.env ?? {}) },
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (exit ${res.status})`);
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function findHostRacket(buildDir) {
  const exeSuffix = process.platform === "win32" ? ".exe" : "";
  const candidates = [
    path.join(buildDir, `bc/racketcgc${exeSuffix}`),
    path.join(buildDir, `bc/racket3m${exeSuffix}`),
    path.join(buildDir, `bc/racket${exeSuffix}`),
    path.join(buildDir, `bin/racket${exeSuffix}`),
    path.join(buildDir, `bin/racketcgc${exeSuffix}`),
    path.join(buildDir, `bin/racket3m${exeSuffix}`),
    path.join(buildDir, `racketcgc${exeSuffix}`),
    path.join(buildDir, `racket3m${exeSuffix}`),
    path.join(buildDir, `racket${exeSuffix}`),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function findEmscriptenArtifacts(buildDir) {
  const bases = ["racket", "racketcgc", "racket3m"];
  const searchDirs = [
    buildDir,
    path.join(buildDir, "bc"),
    path.join(buildDir, "bin"),
  ];
  for (const dir of searchDirs) {
    for (const base of bases) {
      const wasmPath = path.join(dir, `${base}.wasm`);
      if (!fs.existsSync(wasmPath)) continue;
      const jsCandidates = [path.join(dir, base), path.join(dir, `${base}.js`)];
      const jsPath = jsCandidates.find((p) => fs.existsSync(p));
      if (jsPath) return { jsPath, wasmPath, base };
    }
  }

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const wasmFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".wasm"));
    for (const wasmFile of wasmFiles) {
      const base = wasmFile.slice(0, -".wasm".length);
      const jsCandidates = [path.join(dir, base), path.join(dir, `${base}.js`)];
      const jsPath = jsCandidates.find((p) => fs.existsSync(p));
      if (jsPath) return { jsPath, wasmPath: path.join(dir, wasmFile), base };
    }
  }
  return null;
}

function rewriteWasmReference(jsPath, fromBase, toBase) {
  if (fromBase === toBase) return;
  const fromName = `${fromBase}.wasm`;
  const toName = `${toBase}.wasm`;
  const content = fs.readFileSync(jsPath, "utf8");
  if (!content.includes(fromName)) return;
  fs.writeFileSync(jsPath, content.split(fromName).join(toName));
}

if (!fs.existsSync(srcDir)) {
  throw new Error(
    "Missing racket-src. Clone official Racket sources into runtimes/racket-runtime/racket-src before building.",
  );
}

if (!fs.existsSync(configureScript)) {
  throw new Error(
    "Missing racket-src/racket/src. Ensure the Racket repository is cloned correctly before building.",
  );
}

const pbDir = path.join(racketDir, "src", "ChezScheme", "boot", "pb");
if (!fs.existsSync(pbDir)) {
  exec("make", ["--directory", srcDir, "pb-fetch"], { env: hostEnv });
}

ensureDir(distDir);

// Build native host Racket for cross-compilation
ensureDir(hostBuildDir);
exec(configureScript, ["--enable-bconly", "--disable-jit"], {
  cwd: hostBuildDir,
  env: hostEnv,
});
exec("make", [`CC_FOR_BUILD=${hostEnv.CC_FOR_BUILD}`], {
  cwd: hostBuildDir,
  env: hostEnv,
});

const hostRacket = findHostRacket(hostBuildDir);
if (!hostRacket) {
  throw new Error("Unable to locate host Racket binary in build-host.");
}

// Configure & build Racket with Emscripten (interpreter mode)
ensureDir(targetBuildDir);
exec(
  "emconfigure",
  [
    configureScript,
    "--host=wasm32-unknown-emscripten",
    "--enable-bconly",
    "--disable-foreign",
    "--disable-jit",
    "--disable-pthread",
    "--disable-futures",
    "--disable-places",
    `--enable-racket=${hostRacket}`,
  ],
  { cwd: targetBuildDir, env: targetEnv },
);

const zuoPath = path.join(targetBuildDir, "bin", "zuo");
if (fs.existsSync(zuoPath)) {
  fs.rmSync(zuoPath, { force: true });
}

exec("emmake", ["make", `CC_FOR_BUILD=${targetEnv.CC_FOR_BUILD}`], {
  cwd: targetBuildDir,
  env: targetEnv,
});

const artifacts = findEmscriptenArtifacts(targetBuildDir);
if (!artifacts) {
  throw new Error(
    "Unable to locate Emscripten output (racket*.wasm/js) in build-wasm.",
  );
}

const outJs = path.join(distDir, "racket.js");
const outWasm = path.join(distDir, "racket.wasm");
copyFile(artifacts.jsPath, outJs);
copyFile(artifacts.wasmPath, outWasm);
rewriteWasmReference(outJs, artifacts.base, "racket");

if (!fs.existsSync(outJs)) {
  throw new Error("Racket output missing: dist/racket.js");
}

if (!fs.existsSync(outWasm)) {
  throw new Error("Racket output missing: dist/racket.wasm");
}
