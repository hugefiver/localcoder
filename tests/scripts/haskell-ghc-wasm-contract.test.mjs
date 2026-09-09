import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { assertGhcWasmContract, inspectGhcWasm } from "../../scripts/lib/haskell-ghc-wasm-contract.mjs";

const source = gunzipSync(readFileSync(new URL("../../public/haskell/ghc.wasm.gz.bin", import.meta.url)));
const expectedJsffiImports = [
  ...[0, 1, 2, 3].map((n) => `ZC${n}ZCghcizm9zi15zminplaceZCGHCiziObjLinkZC`),
  ...[17, 18].map((n) => `ZC${n}ZCghczminternalZCGHCziInternalziWasmziPrimziImportsZC`),
  ...[0, 1, 2, 3, 4].map((n) => `ZC${n}ZCghczminternalZCGHCziInternalziWasmziPrimziTypesZC`),
  "ZC0ZCghczminternalZCGHCziInternalziWasmziPrimziConcziInternalZC",
  "freeJSVal", "getJSVal", "newJSVal", "scheduleWork",
].sort();

function uleb(value) {
  const result = [];
  do {
    const next = value & 127;
    value >>>= 7;
    result.push(next | (value ? 128 : 0));
  } while (value);
  return result;
}
const text = (value) => [...uleb(Buffer.byteLength(value)), ...Buffer.from(value)];
const section = (id, data) => [id, ...uleb(data.length), ...data];
const recordName = expectedJsffiImports.find((name) => name.includes("ObjLink"));
function fixture({ module = "ghc_wasm_jsffi", name = recordName, kind = 0, records = `${recordName}\0$x\0return $x;\0` } = {}) {
  return Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [1, 96, 0, 0]),
    ...section(2, [1, ...text(module), ...text(name), kind, ...(kind === 3 ? [127, 0] : [0])]),
    ...section(0, [...text("ghc_wasm_jsffi"), ...Buffer.from(records)]),
  ]);
}

test("the current GHC inventory locks source identity and the complete import/export surface", () => {
  const inventory = inspectGhcWasm(source);
  assert.equal(inventory.bytes, 146_482_240);
  assert.equal(inventory.sha256, "a4d584aec1585cdc8a4d716faa82f5750c875c930fe882fcb0e8115c79c19e4f");
  const module = new WebAssembly.Module(source);
  const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const compare = (a, b) => compareText(a.module ?? "", b.module ?? "") || compareText(a.name, b.name);
  // Compare every descriptor, not just the subset needed by the startup probe.
  assert.deepEqual(inventory.imports, WebAssembly.Module.imports(module).sort(compare));
  assert.deepEqual(inventory.exports, WebAssembly.Module.exports(module).sort(compare));
  assert.deepEqual([...new Set(inventory.imports.map((entry) => entry.module))], ["ghc_wasm_jsffi", "wasi_snapshot_preview1"]);
  assert.deepEqual(inventory.imports.filter((entry) => entry.module === "ghc_wasm_jsffi").map((entry) => entry.name).sort(), expectedJsffiImports);
  assert.deepEqual(inventory.imports.filter((entry) => entry.module === "wasi_snapshot_preview1").map((entry) => entry.name), [
    "args_get", "args_sizes_get", "clock_res_get", "clock_time_get", "environ_get", "environ_sizes_get",
    "fd_close", "fd_fdstat_get", "fd_fdstat_set_flags", "fd_filestat_get", "fd_filestat_set_size",
    "fd_prestat_dir_name", "fd_prestat_get", "fd_read", "fd_readdir", "fd_seek", "fd_write",
    "path_create_directory", "path_filestat_get", "path_open", "path_readlink", "path_remove_directory",
    "path_rename", "path_unlink_file", "poll_oneoff", "proc_exit",
  ]);
  assert.ok(inventory.imports.every((entry) => entry.kind === "function"));
  assert.deepEqual(inventory.customSections.map((entry) => entry.name), ["ghc_wasm_jsffi", "name", "producers", "target_features"]);
  const resolvers = ["Unit", "JSVal", "Char", "Int", "Int8", "Int16", "Int32", "Int64", "Word", "Word8", "Word16", "Word32", "Word64", "Ptr", "FunPtr", "Float", "Double", "StablePtr", "Bool"].map((suffix) => `rts_promiseResolve${suffix}`);
  for (const name of ["memory", "_start", "rts_schedulerLoop", "rts_freeStablePtr", "rts_promiseReject", "rts_promiseThrowTo", ...resolvers]) {
    assert.ok(inventory.exports.some((entry) => entry.name === name), `missing ${name}`);
  }
  const fields = new TextDecoder("utf-8", { fatal: true }).decode(WebAssembly.Module.customSections(module, "ghc_wasm_jsffi")[0]).split("\0");
  assert.equal(fields.pop(), "");
  const records = [];
  for (let i = 0; i < fields.length; i += 3) records.push({ name: fields[i], binders: fields[i + 1], body: fields[i + 2] });
  assert.equal(records.length, 29);
  const selected = records.filter((record) => expectedJsffiImports.includes(record.name));
  assert.equal(selected.length, 12);
  assert.equal(records.length - selected.length, 17);
  assert.deepEqual(inventory.jsffiRecords, selected.sort(compare));
});

test("inventory is recursively immutable and never evaluates JSFFI bodies", () => {
  const inventory = inspectGhcWasm(fixture({ records: `${recordName}\0$x\0throw new Error('must not execute');\0` }));
  function frozen(value) {
    if (value === null || typeof value !== "object") return;
    assert.ok(Object.isFrozen(value));
    Object.values(value).forEach(frozen);
  }
  frozen(inventory);
  assert.throws(() => { inventory.imports[0].name = "changed"; }, TypeError);
});

test("unknown import namespaces, names and kinds are rejected loudly", () => {
  assert.throws(() => inspectGhcWasm(fixture({ module: "env" })), /UNSUPPORTED_IMPORT/);
  assert.throws(() => inspectGhcWasm(fixture({ name: "unknown" })), /UNSUPPORTED_IMPORT/);
  assert.throws(() => inspectGhcWasm(fixture({ module: "wasi_snapshot_preview1", name: "unknown" })), /UNSUPPORTED_IMPORT/);
  assert.throws(() => inspectGhcWasm(fixture({ kind: 3 })), /UNSUPPORTED_IMPORT/);
});

test("JSFFI triples reject malformed UTF-8, missing NUL, missing fields and duplicates", () => {
  for (const records of [`${recordName}\0$x\0body`, `${recordName}\0$x\0`, `${recordName}\0$x\0body\0${recordName}\0$x\0body\0`, `\0$x\0body\0`]) {
    assert.throws(() => inspectGhcWasm(fixture({ records })), /JSFFI/);
  }
  const bytes = fixture();
  bytes[bytes.length - 2] = 255;
  assert.throws(() => inspectGhcWasm(bytes), /JSFFI/);
});

test("only prelude-owned imports may lack records and final binding excludes unselected raw records", () => {
  assert.throws(() => inspectGhcWasm(fixture({ records: "" })), /JSFFI.*missing/);
  assert.deepEqual(inspectGhcWasm(fixture({ name: "newJSVal" })).jsffiRecords, []);
  for (const name of ["newJSVal", "getJSVal", "freeJSVal", "scheduleWork"]) {
    assert.deepEqual(inspectGhcWasm(fixture({ name, records: "" })).jsffiRecords, []);
  }
});

test("post-link selection validates ignored raw records before excluding them", () => {
  const live = `${recordName}\0$x\0return $x;\0`;
  const dead = "notImported\0$x\0throw new Error('never evaluated');\0";
  assert.deepEqual(inspectGhcWasm(fixture({ records: live + dead })).jsffiRecords, [
    { name: recordName, binders: "$x", body: "return $x;" },
  ]);
  assert.throws(() => inspectGhcWasm(fixture({ records: live + dead + dead })), /JSFFI duplicate/);
  assert.throws(() => inspectGhcWasm(fixture({ records: live + dead.slice(0, -1) })), /JSFFI missing NUL/);
  assert.throws(() => inspectGhcWasm(fixture({ records: live + "notImported\0\0body\0" })), /JSFFI malformed/);
  assert.throws(() => inspectGhcWasm(fixture({ name: "newJSVal", records: "newJSVal\0$x\0$x\0" })), /JSFFI prelude-owned/);
});

test("contract validation compares every field and requires an observed numeric version", () => {
  const inventory = inspectGhcWasm(fixture());
  assertGhcWasmContract(inventory, { inventory, ghcNumericVersion: "9.15.20260901" });
  for (const ghcNumericVersion of [undefined, null, 9.15, "", "9", "9.15\n", "9.15\r", "9.15-dev", "9.15.1.2"]) {
    assert.throws(() => assertGhcWasmContract(inventory, { inventory, ghcNumericVersion }), /numeric version/);
  }
  assert.throws(() => assertGhcWasmContract(inventory, { inventory: { ...inventory, bytes: 1 }, ghcNumericVersion: "9.15" }));
});

const contractUrl = new URL("../../runtimes/haskell-ghc/ghc-wasm-contract.json", import.meta.url);
test("the browser-approved durable contract matches the actual source", () => {
  assertGhcWasmContract(inspectGhcWasm(source), JSON.parse(readFileSync(contractUrl, "utf8")));
});
