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

const platformDefines = `-DSCHEME_OS=\\"emscripten\\" -DSCHEME_ARCH=\\"wasm32\\" -DSYSTEM_TYPE_NAME=\\"emscripten\\" -include ${defsPath}`;
const hostEnv = {
  CC_FOR_BUILD: process.env.CC_FOR_BUILD ?? "cc",
};
const baseEmccFlags = ["-sFORCE_FILESYSTEM=1", "-sALLOW_MEMORY_GROWTH=1"];

const runtimeEmccFlags = [
  "-sEXPORTED_FUNCTIONS=['_main','___main_argc_argv']",
  "-sEXPORTED_RUNTIME_METHODS=['FS','callMain']",
  "-sERROR_ON_UNDEFINED_SYMBOLS=0",
];

const baseEmccFlagsStr = baseEmccFlags.join(" ");
const extraEmccFlags = process.env.RACKET_EMCC_FLAGS;
const configureEmccFlags = [
  baseEmccFlagsStr,
  process.env.RACKET_EMCC_CONFIGURE_FLAGS,
]
  .filter(Boolean)
  .join(" ")
  .trim();
const buildEmccFlags = [
  baseEmccFlagsStr,
  runtimeEmccFlags.join(" "),
  extraEmccFlags,
]
  .filter(Boolean)
  .join(" ")
  .trim();

const targetConfigureEnv = {
  CC_FOR_BUILD: process.env.CC_FOR_BUILD ?? "cc",
  CPPFLAGS: [process.env.CPPFLAGS, platformDefines]
    .filter(Boolean)
    .join(" ")
    .trim(),
  CFLAGS: [process.env.CFLAGS, configureEmccFlags]
    .filter(Boolean)
    .join(" ")
    .trim(),
  LDFLAGS: [process.env.LDFLAGS, configureEmccFlags]
    .filter(Boolean)
    .join(" ")
    .trim(),
};

const targetBuildEnv = {
  CC_FOR_BUILD: targetConfigureEnv.CC_FOR_BUILD,
  CPPFLAGS: targetConfigureEnv.CPPFLAGS,
  CFLAGS: [process.env.CFLAGS, buildEmccFlags].filter(Boolean).join(" ").trim(),
  LDFLAGS: [process.env.LDFLAGS, buildEmccFlags]
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

function isDirEmpty(dirPath) {
  if (!fs.existsSync(dirPath)) return true;
  return fs.readdirSync(dirPath).length === 0;
}

function ensureRacketSource() {
  if (fs.existsSync(configureScript)) return;

  const repoUrl =
    process.env.RACKET_REPO_URL ?? "https://github.com/racket/racket.git";
  const repoRef =
    process.env.RACKET_REPO_REF ?? process.env.RACKET_REPO_BRANCH ?? "master";
  const repoDepth = process.env.RACKET_GIT_DEPTH ?? "1";

  if (fs.existsSync(srcDir)) {
    if (isDirEmpty(srcDir)) {
      fs.rmSync(srcDir, { recursive: true, force: true });
    } else {
      throw new Error(
        "Missing racket-src/racket/src. Existing racket-src is not a valid Racket clone. " +
          "Remove it or set RACKET_REPO_URL/RACKET_REPO_REF to re-clone.",
      );
    }
  }

  const cloneArgs = ["clone"];
  if (repoDepth && repoDepth !== "0") {
    cloneArgs.push("--depth", repoDepth);
  }
  if (repoRef) {
    cloneArgs.push("--branch", repoRef, "--single-branch");
  }
  cloneArgs.push(repoUrl, srcDir);

  console.log(
    `[racket-runtime] Cloning Racket sources from ${repoUrl} (${repoRef})...`,
  );
  exec("git", cloneArgs, { cwd: root });

  if (!fs.existsSync(configureScript)) {
    throw new Error(
      "Missing racket-src/racket/src after clone. Verify repository URL/ref.",
    );
  }
}

ensureRacketSource();

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
  { cwd: targetBuildDir, env: targetConfigureEnv },
);

const zuoPath = path.join(targetBuildDir, "bin", "zuo");
if (fs.existsSync(zuoPath)) {
  fs.rmSync(zuoPath, { force: true });
}

exec(
  "emmake",
  [
    "make",
    `CC_FOR_BUILD=${targetBuildEnv.CC_FOR_BUILD}`,
    `CFLAGS=${targetBuildEnv.CFLAGS}`,
    `LDFLAGS=${targetBuildEnv.LDFLAGS}`,
  ],
  {
    cwd: targetBuildDir,
    env: targetBuildEnv,
  },
);

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

const jsContents = fs.readFileSync(outJs, "utf8");
if (!jsContents.includes("callMain") || !jsContents.includes("FS")) {
  console.warn(
    "[racket-runtime] Warning: Generated runtime lacks callMain/FS. " +
      "Ensure Emscripten flags include FORCE_FILESYSTEM and EXPORTED_RUNTIME_METHODS.",
  );
}
