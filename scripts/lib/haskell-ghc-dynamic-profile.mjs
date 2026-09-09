import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, writeFile, readdir, mkdir, mkdtemp, lstat, readlink, stat, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { generateStaticBindings, selectedLibraryRecords, transformLocalDyld } from "./haskell-ghc-profile-bindings.mjs";

export { transformLocalDyld } from "./haskell-ghc-profile-bindings.mjs";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const compare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const defaultRun = (command, args, options) => spawnSync(command, args, { ...options, encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
const cleanEnvironment = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "GHC_PACKAGE_PATH"));
async function hashFile(file) { const hash = createHash("sha256"); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest("hex"); }

export async function checkHaskellProfileToolchain({ command, expectedVersion, run = defaultRun, hashFile: digest = hashFile }) {
  if (!command || !path.isAbsolute(command)) throw Error("toolchain requires an absolute executable path");
  const executable = await realpath(command).catch((cause) => { throw Error("toolchain executable missing", { cause }); });
  const result = await run(executable, ["--version"], { env: cleanEnvironment() });
  const match = /^GHC package manager version (\d+\.\d+(?:\.\d+)?)(?:\r?\n)?$/.exec(result.stdout ?? "");
  if (result.error || result.status !== 0 || result.stderr || !match || match[0].length !== result.stdout.length || match[1] !== expectedVersion) throw Error(`toolchain version mismatch: ${JSON.stringify(result)}`);
  return { path: executable, version: match[1], sha256: await digest(executable) };
}

export function assertProfileBudget(contract, packageCount, payloadBytes) {
  if (contract.fullLibdirFallback) throw Error("full-libdir fallback prohibited");
  if (!Number.isSafeInteger(payloadBytes) || payloadBytes < 0 || packageCount >= Math.min(contract.packageCountStop, 33) || payloadBytes >= Math.min(contract.profilePayloadStopBytes, 916339975)) throw Error(`profile budget exceeded: ${packageCount} packages, ${payloadBytes} bytes`);
}

function inside(root, candidate) {
  const rel = path.relative(root, candidate);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw Error(`profile path escapes source: ${candidate}`);
  return rel.split(path.sep).join("/");
}

function safeRelative(name) {
  if (!name || name.includes("\\") || name.includes(":") || name.startsWith("/") || name.split("/").some((p) => !p || p === "." || p === "..")) throw Error(`unsafe profile path: ${name}`);
  return name;
}

async function sourceEntry(root, relative) {
  safeRelative(relative);
  const logical = path.join(root, relative);
  let current = root, firstLink, resolvedSource;
  const remaining = relative.split("/"), seen = new Set();
  while (remaining.length) {
    current = path.resolve(current, remaining.shift()); inside(root, current);
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      if (seen.has(current)) throw Error(`symlink cycle: ${relative}`);
      seen.add(current);
      const linkTarget = await readlink(current);
      firstLink ??= linkTarget;
      const target = path.resolve(path.dirname(current), linkTarget);
      const targetRel = inside(root, target);
      current = root; remaining.unshift(...targetRel.split("/"));
    }
  }
  resolvedSource = inside(root, current);
  const info = await stat(current);
  return { logical, resolved: current, info, provenance: firstLink === undefined ? { sourceKind: "file", resolvedSource } : { sourceKind: "symlink", linkTarget: firstLink, resolvedSource } };
}

function parseConf(text) {
  const fields = new Map(); let key;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([a-z][a-z0-9-]*):\s*(.*)$/.exec(line);
    if (match) { key = match[1]; if (fields.has(key)) throw Error(`duplicate package field ${key}`); fields.set(key, match[2]); }
    else if (/^\s/.test(line) && key) fields.set(key, fields.get(key) + "\n" + line.trim());
    else throw Error(`invalid package description line: ${line}`);
  }
  for (const field of ["name", "id"]) if (!fields.get(field)) throw Error(`package missing ${field}`);
  return fields;
}

function words(value = "") {
  const tokens = value.match(/"(?:[^"\\]|\\.)*"|[^\s]+/g) ?? [];
  return tokens.map((token) => token.startsWith('"') ? JSON.parse(token) : token);
}

function packageRelative(value, contract) {
  const { from, to } = contract.packagePathRelocation;
  if (value.startsWith(from)) value = to + value.slice(from.length);
  if (!value.startsWith("${pkgroot}/")) throw Error(`package path is not relocatable: ${value}`);
  return safeRelative(value.slice("${pkgroot}/".length));
}

function tarHeader(name, size) {
  const h = Buffer.alloc(512);
  let short = name, prefix = "";
  if (Buffer.byteLength(short) > 100) {
    const cut = name.lastIndexOf("/", name.length - 1);
    prefix = name.slice(0, cut); short = name.slice(cut + 1);
  }
  if (Buffer.byteLength(short) > 100 || Buffer.byteLength(prefix) > 155) throw Error(`tar path too long: ${name}`);
  h.write(short, 0); h.write(prefix, 345);
  const oct = (n, at, width) => h.write(n.toString(8).padStart(width - 1, "0") + "\0", at, width);
  oct(0o644, 100, 8); oct(0, 108, 8); oct(0, 116, 8); oct(size, 124, 12); oct(0, 136, 12);
  h.fill(32, 148, 156); h[156] = 48; h.write("ustar\0", 257); h.write("00", 263);
  const checksum = h.reduce((total, b) => total + b, 0);
  h.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return h;
}

/** Build a candidate directory atomically. Gate B alone authorizes copying it into public. */
export async function buildDynamicEvalProfile({ sourceLibdir, ghcContract, profileContract, ghcPkg, outputDirectory, run = defaultRun }) {
  const toolchain = await checkHaskellProfileToolchain({ command: ghcPkg, expectedVersion: ghcContract.ghcNumericVersion, run });
  assertProfileBudget(profileContract, profileContract.packages.length, 0);
  if (profileContract.schemaVersion !== 1 || profileContract.executionMode !== "ghc-e" || profileContract.symlinkPolicy !== "dereference-within-libdir" || profileContract.packageCachePolicy !== "matching-ghc-pkg-recache-only") throw Error("unsupported profile contract");
  if (JSON.stringify(profileContract.packages) !== JSON.stringify(["base", "ghc-internal", "ghc-prim", "rts"])) throw Error("package closure requires explicitly reviewed four-package contract");
  const root = await realpath(sourceLibdir), files = [], selected = new Map(), commands = [];
  const db = "package.conf.d";
  await sourceEntry(root, db);
  for (const filename of (await readdir(path.join(root, db))).sort(compare)) {
    if (!filename.endsWith(".conf")) continue;
    const relative = `${db}/${filename}`, entry = await sourceEntry(root, relative);
    const text = await readFile(entry.resolved, "utf8"), fields = parseConf(text);
    const name = fields.get("name");
    if (profileContract.packages.includes(name)) {
      if (selected.has(name)) throw Error(`ambiguous package closure: ${name}`);
      selected.set(name, { name, id: fields.get("id"), version: fields.get("version"), license: fields.get("license"), fields, text, relative });
    }
  }
  const packages = profileContract.packages.map((name) => { const p = selected.get(name); if (!p) throw Error(`missing package closure ${name}`); return p; });
  const ids = new Set(packages.map((p) => p.id));
  for (const p of packages) for (const id of words(p.fields.get("depends"))) if (!ids.has(id)) throw Error(`package closure escapes allowlist: ${p.id} -> ${id}`);
  const parent = path.dirname(path.resolve(outputDirectory)); await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(path.join(parent, ".haskell-profile-"));
  const stagedRoot = path.join(staging, "ghc"), output = path.join(staging, "output");
  await mkdir(path.join(stagedRoot, db), { recursive: true }); await mkdir(output);
  let payloadBytes = 0;
  const taken = new Set();
  try {
    const add = async (relative, kind, packageName, generated) => {
      if (taken.has(relative)) return;
      if (!profileContract.includeKinds.includes(kind) || profileContract.excludeSuffixes.some((suffix) => relative.endsWith(suffix)) || /_p(?:-ghc[\d.]+)?\.so$/.test(relative)) throw Error(`excluded profile input: ${relative}`);
      taken.add(relative);
      const entry = await sourceEntry(root, relative);
      if (!entry.info.isFile()) throw Error(`profile input not a regular file: ${relative}`);
      const original = await readFile(entry.resolved), bytes = generated ?? original;
      payloadBytes += bytes.length; assertProfileBudget(profileContract, packages.length, payloadBytes);
      const dest = path.join(stagedRoot, relative); await mkdir(path.dirname(dest), { recursive: true }); await writeFile(dest, bytes);
      files.push({ path: relative, kind, ...(packageName ? { package: packageName } : {}), ...entry.provenance, ...(generated ? { sourceSha256: sha256(original), transformation: "relocate-package-libdir" } : {}), sha256: sha256(bytes), bytes: bytes.length });
    };
    const walkInterfaces = async (relative, packageName, ancestors = new Set()) => {
      const entry = await sourceEntry(root, relative);
      if (!entry.info.isDirectory()) throw Error(`import-dir is not a directory: ${relative}`);
      if (ancestors.has(entry.resolved)) throw Error(`directory symlink cycle: ${relative}`);
      const next = new Set([...ancestors, entry.resolved]);
      for (const name of (await readdir(entry.resolved)).sort(compare)) {
        const rel = `${relative}/${name}`, child = await sourceEntry(root, rel);
        if (child.info.isDirectory()) await walkInterfaces(rel, packageName, next);
        else if (name.endsWith(".dyn_hi") && !name.endsWith(".p_dyn_hi")) await add(rel, "dyn-hi", packageName);
      }
    };
    for (const p of packages) {
      const { from, to } = profileContract.packagePathRelocation;
      const relocated = p.text.replaceAll(from, to);
      await add(p.relative, "package-conf", p.name, Buffer.from(relocated));
      for (const dir of words(p.fields.get("import-dirs"))) await walkInterfaces(packageRelative(dir, profileContract), p.name);
      let found = 0;
      const names = words(p.fields.get("hs-libraries"));
      for (const dir of words(p.fields.get("dynamic-library-dirs"))) {
        const relative = packageRelative(dir, profileContract), entry = await sourceEntry(root, relative);
        for (const name of (await readdir(entry.resolved)).sort(compare)) {
          if (!names.some((lib) => name === `lib${lib}.so` || name === `lib${lib}-ghc${toolchain.version}.so` || (p.name === "rts" && name === `libHSrts-ghc${toolchain.version}.so`))) continue;
          await add(`${relative}/${name}`, "non-profiling-shared-library", p.name); found++;
        }
      }
      if (names.length && !found) throw Error(`missing shared library closure: ${p.id}`);
    }
    for (const locked of profileContract.lockedFiles) {
      await add(locked.path, locked.kind);
      if (files.find((f) => f.path === locked.path).sha256 !== locked.sha256) throw Error(`locked input hash mismatch: ${locked.path}`);
    }
    const licenses = profileContract.lockedFiles.filter((f) => f.kind === "license");
    if (!licenses.length) throw Error("upstream licenses required");
    const sourceCache = await sourceEntry(root, `${db}/package.cache`).catch((err) => { if (err.code === "ENOENT") return undefined; throw err; });
    const cache = path.join(stagedRoot, db, "package.cache");
    const started = Date.now();
    for (const action of ["recache", "check"]) {
      const args = ["--no-user-package-db", "--package-db", path.join(stagedRoot, db), action];
      const result = await run(toolchain.path, args, { env: cleanEnvironment() });
      const record = { command: toolchain.path, args, exitCode: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
      commands.push(record);
      if (result.error || result.status !== 0) throw Object.assign(Error(`matching ghc-pkg ${action} failed: ${record.stderr}`), { commands, candidateFiles: files, payloadBytes });
      if (action === "recache") {
        const info = await lstat(cache), digest = await hashFile(cache);
        if (!info.isFile() || info.size === 0 || info.mtimeMs < started - 2000 || (sourceCache && (digest === await hashFile(sourceCache.resolved) || info.mtimeMs === sourceCache.info.mtimeMs))) throw Error("copied or stale package.cache rejected");
        payloadBytes += info.size; assertProfileBudget(profileContract, packages.length, payloadBytes);
        files.push({ path: `${db}/package.cache`, kind: "package-cache", sourceKind: "generated", generator: "matching-ghc-pkg-recache-only", sha256: digest, bytes: info.size });
      }
    }
    files.sort((a, b) => compare(a.path, b.path));
    for (const file of files) {
      const stagedFile = path.join(stagedRoot, file.path);
      if ((await stat(stagedFile)).size !== file.bytes || await hashFile(stagedFile) !== file.sha256) throw Error(`staged profile changed after recache/check: ${file.path}`);
    }
    const libraries = [];
    for (const file of files.filter((f) => f.kind === "non-profiling-shared-library")) {
      const bytes = await readFile(path.join(stagedRoot, file.path));
      libraries.push({ soname: path.posix.basename(file.path), sha256: file.sha256, records: selectedLibraryRecords(bytes) });
    }
    const prelude = await readFile(path.join(stagedRoot, "prelude.mjs"), "utf8");
    const jsffi = generateStaticBindings(prelude, ghcContract, libraries);
    const dyldSource = await readFile(path.join(stagedRoot, "dyld.mjs"), "utf8");
    const dyld = transformLocalDyld(dyldSource, profileContract.lockedFiles.find((f) => f.kind === "dyld").sha256);
    await writeFile(path.join(output, "ghc-jsffi-imports.mjs"), jsffi);
    await writeFile(path.join(output, "dyld-browser-local.mjs"), dyld);
    async function* tar() {
      for (const file of files) {
        yield tarHeader(file.path, file.bytes);
        yield* createReadStream(path.join(stagedRoot, file.path));
        if (file.bytes % 512) yield Buffer.alloc(512 - file.bytes % 512);
      }
      yield Buffer.alloc(1024);
    }
    const archive = path.join(output, "dynamic-e-profile.tar.gz.bin");
    await pipeline(Readable.from(tar()), createGzip({ level: 9 }), createWriteStream(archive));
    const manifest = {
      schemaVersion: 1, executionMode: "ghc-e", ghcSha256: ghcContract.inventory.sha256,
      profileContractSha256: sha256(json(profileContract)), toolchain,
      packages: packages.map(({ name, id, version, license }) => ({ name, id, version, license })),
      packageCount: packages.length, payloadBytes, compressedBytes: (await stat(archive)).size,
      archiveSha256: await hashFile(archive), files, licenses,
      generated: { jsffi: { sha256: sha256(jsffi), source: "Gate A custom records + locked prelude + selected shared-library custom records", libraries: libraries.map(({ soname, sha256, records }) => ({ soname, sha256, selectedRecords: records.length })) }, dyld: { sha256: sha256(dyld), upstreamSha256: sha256(dyldSource) } },
      recache: commands.map(({ args, exitCode }) => ({ args: args.map((a) => a === path.join(stagedRoot, db) ? "<staged-package-db>" : a), exitCode })),
    };
    await writeFile(path.join(output, "dynamic-e-profile.manifest.json"), json(manifest));
    const outputHashes = {};
    for (const name of (await readdir(output)).sort(compare)) outputHashes[name] = await hashFile(path.join(output, name));
    // Refuse replacement: a previously published directory is never partial-overwritten.
    try { await lstat(outputDirectory); throw Error("profile output already exists"); } catch (err) { if (err.code !== "ENOENT") throw err; }
    await rename(output, outputDirectory);
    return { manifest, outputHashes, commands };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
