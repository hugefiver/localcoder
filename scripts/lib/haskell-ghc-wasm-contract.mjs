import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const preludeNames = new Set(["freeJSVal", "getJSVal", "newJSVal", "scheduleWork"]);
const jsffiNames = new Set([
  ...[0, 1, 2, 3].map((n) => `ZC${n}ZCghcizm9zi15zminplaceZCGHCiziObjLinkZC`),
  ...[17, 18].map((n) => `ZC${n}ZCghczminternalZCGHCziInternalziWasmziPrimziImportsZC`),
  ...[0, 1, 2, 3, 4].map((n) => `ZC${n}ZCghczminternalZCGHCziInternalziWasmziPrimziTypesZC`),
  "ZC0ZCghczminternalZCGHCziInternalziWasmziPrimziConcziInternalZC",
  ...preludeNames,
]);
const wasiNames = new Set([
  "args_get", "args_sizes_get", "environ_get", "environ_sizes_get",
  "clock_res_get", "clock_time_get", "fd_close", "fd_fdstat_get",
  "fd_fdstat_set_flags", "fd_filestat_get", "fd_filestat_set_size",
  "fd_prestat_get", "fd_prestat_dir_name", "fd_read", "fd_readdir",
  "fd_seek", "fd_write", "path_create_directory", "path_filestat_get",
  "path_open", "path_readlink", "path_remove_directory", "path_rename",
  "path_unlink_file", "poll_oneoff", "proc_exit",
]);
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const compareDescriptor = (a, b) => compareText(a.module ?? "", b.module ?? "") || compareText(a.name, b.name);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const freezeRecords = (records) => Object.freeze(records.map((record) => Object.freeze(record)).sort(compareDescriptor));

function customSectionInventory(bytes) {
  // WebAssembly.Module has already validated section sizes and LEB encodings.
  // Walk only headers; code/data sections are neither copied nor interpreted.
  let offset = 8;
  const readUleb = () => {
    let value = 0, shift = 0, byte;
    do {
      byte = bytes[offset++];
      value += (byte & 127) * 2 ** shift;
      shift += 7;
    } while (byte & 128);
    return value;
  };
  const sections = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  while (offset < bytes.length) {
    const id = bytes[offset++];
    const length = readUleb();
    const end = offset + length;
    if (id === 0) {
      const nameLength = readUleb();
      const name = decoder.decode(bytes.subarray(offset, offset + nameLength));
      offset += nameLength;
      const payload = bytes.subarray(offset, end);
      sections.push({ name, bytes: payload.length, sha256: sha256(payload) });
    }
    offset = end;
  }
  return freezeRecords(sections);
}

function parseJsffiRecords(module, imports) {
  const selectedNames = new Set(imports.filter((entry) => entry.module === "ghc_wasm_jsffi").map((entry) => entry.name));
  const records = [];
  const seen = new Set();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const section of WebAssembly.Module.customSections(module, "ghc_wasm_jsffi")) {
    const bytes = new Uint8Array(section);
    const fields = [];
    for (let offset = 0; offset < bytes.length;) {
      const end = bytes.indexOf(0, offset);
      if (end < 0) throw new Error("JSFFI missing NUL terminator");
      try {
        fields.push(decoder.decode(bytes.subarray(offset, end)));
      } catch (cause) {
        throw new Error("JSFFI malformed UTF-8", { cause });
      }
      offset = end + 1;
    }
    if (fields.length % 3 !== 0) throw new Error("JSFFI malformed triple");
    for (let index = 0; index < fields.length; index += 3) {
      const [name, binders, body] = fields.slice(index, index + 3);
      if (!name || !binders) throw new Error("JSFFI malformed record");
      if (seen.has(name)) throw new Error(`JSFFI duplicate record: ${name}`);
      seen.add(name);
      // Match the locked post-link: validate every raw record, then select only
      // actual imports. The complete section hash binds dead-stripped records.
      if (selectedNames.has(name)) {
        if (preludeNames.has(name)) throw new Error(`JSFFI prelude-owned record: ${name}`);
        records.push({ name, binders, body });
      }
    }
  }
  for (const name of selectedNames) {
    if (!preludeNames.has(name) && !seen.has(name)) throw new Error(`JSFFI missing record: ${name}`);
  }
  return freezeRecords(records);
}

/** Inspect, never instantiate a compiler or evaluate its embedded JavaScript. */
export function inspectGhcWasm(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("GHC bytes must be a Uint8Array");
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module);
  for (const entry of imports) {
    const names = entry.module === "ghc_wasm_jsffi" ? jsffiNames
      : entry.module === "wasi_snapshot_preview1" ? wasiNames : undefined;
    if (entry.kind !== "function" || !names?.has(entry.name)) {
      throw new Error(`UNSUPPORTED_IMPORT: ${entry.module}.${entry.name} (${entry.kind})`);
    }
  }
  return Object.freeze({
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    imports: freezeRecords(imports),
    exports: freezeRecords(WebAssembly.Module.exports(module)),
    customSections: customSectionInventory(bytes),
    jsffiRecords: parseJsffiRecords(module, imports),
  });
}

/** A durable contract is only written after an actual browser startup PASS. */
export function assertGhcWasmContract(inventory, contract) {
  assert.deepEqual(inventory, contract.inventory);
  if (typeof contract.ghcNumericVersion !== "string" || !/^\d+\.\d+(?:\.\d+)?$/.test(contract.ghcNumericVersion) || /[\r\n]/.test(contract.ghcNumericVersion)) {
    throw new Error("GHC numeric version is not locked");
  }
}
