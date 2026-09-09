import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { buildDynamicEvalProfile, checkHaskellProfileToolchain, assertProfileBudget, transformLocalDyld } from "../../scripts/lib/haskell-ghc-dynamic-profile.mjs";

const hash = (b) => createHash("sha256").update(b).digest("hex");
const contract = JSON.parse(await readFile(new URL("../../runtimes/haskell-ghc/dynamic-e-profile.json", import.meta.url)));
const version = "9.15.20260202";
const banner = { status: 0, stdout: `GHC package manager version ${version}\n`, stderr: "" };
const fixtureDyld = `function makeBufferConsumer() {}
// Formats a server.address()
wasi = await import("https://esm.sh/gh/haskell-wasm/browser_wasi_shim");
export class DyLDBrowserHost {}
// Fulfill the same functionality as DyLDHost
class DyLD {
  #finalizationRegistry;
  constructor() {
    if (isNode) {
      throw Error('node');
    } else {
      this.exportFuncs = {};
    }
  }
  load(soname) {
    return (
        new Function('') (this.exportFuncs, this, this.#finalizationRegistry)
    );
  }
}
// The main entry point of dyld
`.replace("new Function('') (", "new Function('')(");

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "localcoder-profile-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceLibdir = path.join(root, "source");
  const put = async (name, bytes) => { const p = path.join(sourceLibdir, name); await mkdir(path.dirname(p), { recursive: true }); await writeFile(p, bytes); };
  const ghcContract = { ghcNumericVersion: version, inventory: { sha256: "a".repeat(64), jsffiRecords: [], imports: [] } };
  const profileContract = structuredClone(contract);
  profileContract.lockedFiles = [];
  for (const name of ["settings", "prelude.mjs", "post-link.mjs", "dyld.mjs", "LICENSE"]) {
    const content = name === "dyld.mjs" ? fixtureDyld : name === "prelude.mjs" ? "export class JSValManager {}\nexport const setImmediate = () => {};\n" : name;
    await put(name, content);
    profileContract.lockedFiles.push({ path: name, kind: name === "LICENSE" ? "license" : name.split(".")[0], sha256: hash(content) });
  }
  for (const [i, name] of contract.packages.entries()) {
    await put(`package.conf.d/${name}.conf`, `name: ${name}\nid: ${name}-id\nversion: 1\nlicense: BSD-3-Clause\nimport-dirs: \u0024{pkgroot}/${name}\nlibrary-dirs: \u0024{pkgroot}/${name}\ndynamic-library-dirs: \u0024{pkgroot}/${name}\nhs-libraries: HS${name}\ndepends: ${contract.packages.slice(i + 1).map((p) => p + "-id").join(" ")}\n`);
    await put(`${name}/A.dyn_hi`, name);
    await put(`${name}/libHS${name}.so`, Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
    for (const suffix of [".a", ".p_dyn_hi", "_p.so"]) await put(`${name}/excluded${suffix}`, "excluded");
  }
  await put("package.conf.d/other.conf", "name: other\nid: other-id\n");
  await put("package.conf.d/package.cache", "source cache");
  await utimes(path.join(sourceLibdir, "package.conf.d/package.cache"), 1, 1);
  const command = path.join(root, "ghc-pkg.exe"); await writeFile(command, "unit fake executable");
  const calls = [];
  const run = async (cmd, args, options) => {
    calls.push({ cmd, args, options });
    if (args[0] === "--version") return banner;
    if (args.at(-1) === "recache") await writeFile(path.join(args[2], "package.cache"), "new deterministic cache");
    return { status: 0, stdout: "", stderr: "" };
  };
  return { root, sourceLibdir, ghcContract, profileContract, ghcPkg: command, outputDirectory: path.join(root, "output"), run, calls, put };
}

test("the Haskell profile builder blocks before output when matching ghc-pkg is absent or mismatched", async (t) => {
  const f = await fixture(t);
  await assert.rejects(buildDynamicEvalProfile({ ...f, ghcPkg: path.join(f.root, "missing.exe") }), /toolchain executable missing/);
  await assert.rejects(stat(f.outputDirectory), { code: "ENOENT" });
  for (const result of [{ status: 1, stdout: "", stderr: "missing" }, { ...banner, stdout: "GHC package manager version 9.14.1\n" }, { ...banner, stdout: banner.stdout + "\n" }]) {
    await assert.rejects(buildDynamicEvalProfile({ ...f, run: async () => result }), /toolchain|version/i);
    await assert.rejects(stat(f.outputDirectory), { code: "ENOENT" });
  }
  await assert.rejects(checkHaskellProfileToolchain({ command: f.ghcPkg, expectedVersion: version, run: async () => ({ ...banner, stderr: "warning" }), hashFile: async () => "a".repeat(64) }), /toolchain|version/i);
});

test("the Haskell profile builder selects only base ghc-internal ghc-prim and rts dynamic closure", async (t) => {
  const f = await fixture(t); const result = await buildDynamicEvalProfile(f);
  assert.deepEqual(result.manifest.packages.map((p) => p.name), contract.packages);
  assert.equal(result.manifest.files.filter((p) => p.kind === "package-conf").length, 4);
  assert.equal(result.manifest.files.filter((p) => p.kind === "dyn-hi").length, 4);
  assert.ok(result.manifest.files.every((p) => !/excluded|other/.test(p.path)));
  await f.put("package.conf.d/base.conf", "name: base\nid: base-id\ndepends: other-id\n");
  await assert.rejects(buildDynamicEvalProfile({ ...f, outputDirectory: path.join(f.root, "bad") }), /closure/);
});

test("the Haskell profile builder dereferences safe symlinks and rejects escaping or cyclic links", async (t) => {
  const f = await fixture(t);
  await symlink("A.dyn_hi", path.join(f.sourceLibdir, "base/B.dyn_hi"));
  const result = await buildDynamicEvalProfile(f);
  const link = result.manifest.files.find((p) => p.path === "base/B.dyn_hi");
  assert.equal(link.sourceKind, "symlink"); assert.equal(link.linkTarget, "A.dyn_hi"); assert.equal(link.resolvedSource, "base/A.dyn_hi");
  await symlink("../../outside", path.join(f.sourceLibdir, "base/C.dyn_hi"));
  await assert.rejects(buildDynamicEvalProfile({ ...f, outputDirectory: path.join(f.root, "bad") }), /escape|outside/);
  await rm(path.join(f.sourceLibdir, "base/C.dyn_hi"));
  await symlink("C.dyn_hi", path.join(f.sourceLibdir, "base/C.dyn_hi"));
  await assert.rejects(buildDynamicEvalProfile({ ...f, outputDirectory: path.join(f.root, "cycle") }), /cycle|ELOOP/);
});

test("the Haskell profile builder invokes matching ghc-pkg recache and rejects copied or stale package.cache", async (t) => {
  const f = await fixture(t); await buildDynamicEvalProfile(f);
  assert.deepEqual(f.calls.slice(1).map((c) => [c.args[0], c.args[1], c.args.at(-1)]), [["--no-user-package-db", "--package-db", "recache"], ["--no-user-package-db", "--package-db", "check"]]);
  assert.ok(f.calls.every((c) => !("GHC_PACKAGE_PATH" in c.options.env)));
  await assert.rejects(buildDynamicEvalProfile({ ...f, outputDirectory: path.join(f.root, "stale"), run: async (cmd, args) => { if (args[0] === "--version") return banner; if (args.at(-1) === "recache") await writeFile(path.join(args[2], "package.cache"), "source cache"); return { status: 0, stdout: "", stderr: "" }; } }), /cache/);
  await assert.rejects(buildDynamicEvalProfile({ ...f, outputDirectory: path.join(f.root, "stale-time"), run: async (cmd, args) => { if (args[0] === "--version") return banner; if (args.at(-1) === "recache") { const cache = path.join(args[2], "package.cache"); await writeFile(cache, "different but stale"); await utimes(cache, 1, 1); } return { status: 0, stdout: "", stderr: "" }; } }), /cache/);
  await assert.rejects(buildDynamicEvalProfile({ ...f, outputDirectory: path.join(f.root, "no-cache"), run: async () => banner }), /package.cache/);
});

test("the Haskell profile manifest records sorted paths hashes bytes packages toolchain and licenses reproducibly", async (t) => {
  const f = await fixture(t); const a = await buildDynamicEvalProfile(f); const b = await buildDynamicEvalProfile({ ...f, outputDirectory: path.join(f.root, "second") });
  assert.deepEqual(a.manifest, b.manifest); assert.deepEqual(a.outputHashes, b.outputHashes);
  assert.deepEqual(a.manifest.files.map((p) => p.path), a.manifest.files.map((p) => p.path).sort());
  assert.equal(a.manifest.payloadBytes, a.manifest.files.reduce((n, p) => n + p.bytes, 0));
  assert.equal(a.manifest.licenses.length, 1); assert.equal(a.manifest.toolchain.version, version);
  assert.ok(a.manifest.files.every((p) => /^[a-f0-9]{64}$/.test(p.sha256)));
  const tar = gunzipSync(await readFile(path.join(f.outputDirectory, "dynamic-e-profile.tar.gz.bin")));
  let offset = 0;
  for (const file of a.manifest.files) {
    const header = tar.subarray(offset, offset + 512);
    const text = (start, end) => header.subarray(start, end).toString().replace(/\0.*$/s, "");
    assert.equal([text(345, 500), text(0, 100)].filter(Boolean).join("/"), file.path);
    assert.equal(parseInt(text(100, 108), 8), 0o644);
    for (const [start, end] of [[108, 116], [116, 124], [136, 148]]) assert.equal(parseInt(text(start, end), 8), 0);
    assert.equal(hash(tar.subarray(offset + 512, offset + 512 + file.bytes)), file.sha256);
    offset += 512 + Math.ceil(file.bytes / 512) * 512;
  }
  assert.ok(tar.subarray(offset).equals(Buffer.alloc(1024)));
});

test("failed check or post-recache mutations never publish a candidate", async (t) => {
  const f = await fixture(t);
  for (const tamper of [false, true]) {
    await assert.rejects(buildDynamicEvalProfile({ ...f, run: async (cmd, args, options) => {
      const result = await f.run(cmd, args, options);
      if (args.at(-1) !== "check") return result;
      if (tamper) { await writeFile(path.join(args[2], "package.cache"), "changed after recache"); return result; }
      return { status: 1, stdout: "", stderr: "broken package" };
    } }), /check failed|changed after recache/);
    await assert.rejects(stat(f.outputDirectory), { code: "ENOENT" });
  }
});

test("the Haskell profile budget rejects 33 packages 916339975 bytes and full-libdir fallback", () => {
  assert.throws(() => assertProfileBudget(contract, 33, 1), /budget/);
  assert.throws(() => assertProfileBudget(contract, 4, 916339975), /budget/);
  assert.throws(() => assertProfileBudget({ ...contract, fullLibdirFallback: true }, 4, 1), /fallback/);
});

test("the real GHC CLI requires attached -B and the settings target closure", () => {
  assert.ok(contract.command.includes("-B/ghc"));
  assert.ok(!contract.command.includes("-B"));
  assert.ok(contract.lockedFiles.some((f) => f.path === "targets/default.target" && f.kind === "settings"));
});

test("the local dyld transform removes the esm.sh browser branch and binds the exact upstream source hash", () => {
  const source = 'const x = await import("https://esm.sh/@bjorn3/browser_wasi_shim@0.4.2");';
  assert.throws(() => transformLocalDyld(source, "0".repeat(64)), /hash/);
  assert.throws(() => transformLocalDyld(source, hash(source)), /branch/);
  const generated = transformLocalDyld(fixtureDyld, hash(fixtureDyld));
  assert.ok(generated.includes(hash(fixtureDyld)));
  assert.ok(generated.includes("createLocalDyldModule(wasi)"));
  assert.ok(!/https?:|esm\.sh|import\s*\(|new Function/.test(generated));
});
