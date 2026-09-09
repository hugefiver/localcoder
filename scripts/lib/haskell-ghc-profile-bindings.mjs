import { createHash } from "node:crypto";
import { Script } from "node:vm";

const hash = (data) => createHash("sha256").update(data).digest("hex");
const preludeImports = new Set(["newJSVal", "getJSVal", "freeJSVal", "scheduleWork"]);

function replaceOnce(source, expression, replacement, label) {
  const matches = [...source.matchAll(new RegExp(expression.source, "g"))];
  if (matches.length !== 1) throw Error(`locked ${label} branch mismatch (${matches.length})`);
  return source.replace(expression, replacement);
}

export function browserPrelude(source) {
  source = source.replace(/^\s*\/\/.*$/gm, "");
  if (source.includes('import("node:timers")')) {
    source = replaceOnce(source, / {2}if \(globalThis.setImmediate\) \{[\s\S]*? {2}if \(globalThis.scheduler\)/, "  if (globalThis.scheduler)", "prelude scheduler");
  }
  return source;
}

function arrow({ name, binders, body }) {
  // Syntax validation happens at build time, never in a Worker.
  for (const expression of [`${binders} => (${body})`, `${binders} => {${body}}`]) {
    try { new Script(`(${expression})`); return `${JSON.stringify(name)}: ${expression}`; } catch { /* Try the upstream statement form. */ }
  }
  throw Error(`invalid JSFFI record ${name}`);
}

export function selectedLibraryRecords(bytes) {
  const mod = new WebAssembly.Module(bytes);
  const imports = new Set(WebAssembly.Module.imports(mod).filter((i) => i.module === "ghc_wasm_jsffi").map((i) => i.name));
  const records = [], seen = new Set(), decoder = new TextDecoder("utf-8", { fatal: true });
  for (const section of WebAssembly.Module.customSections(mod, "ghc_wasm_jsffi")) {
    const data = new Uint8Array(section), fields = [];
    for (let at = 0; at < data.length;) {
      const end = data.indexOf(0, at); if (end < 0) throw Error("JSFFI missing NUL");
      fields.push(decoder.decode(data.subarray(at, end))); at = end + 1;
    }
    if (fields.length % 3) throw Error("JSFFI malformed triple");
    for (let i = 0; i < fields.length; i += 3) {
      const [name, binders, body] = fields.slice(i, i + 3);
      if (!name || !binders || seen.has(name)) throw Error("JSFFI invalid or duplicate record");
      seen.add(name); if (imports.has(name)) records.push({ name, binders, body });
    }
  }
  for (const name of imports) if (!preludeImports.has(name) && !seen.has(name)) throw Error(`JSFFI missing ${name}`);
  return records.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

export function generateStaticBindings(prelude, contract, libraries) {
  const staticRecords = (records) => records.map(arrow).join(",\n");
  const text = `${browserPrelude(prelude)}
export const compilerSha256 = ${JSON.stringify(contract.inventory.sha256)};
export default function createCompilerBindings(__exports, __ghc_wasm_jsffi_dyld) {
  const manager = new JSValManager();
  const __ghc_wasm_jsffi_finalization_registry = new FinalizationRegistry(sp => __exports.rts_freeStablePtr(sp));
  return { newJSVal: v => manager.newJSVal(v), getJSVal: k => manager.getJSVal(k), freeJSVal: k => manager.freeJSVal(k), scheduleWork: () => setImmediate(__exports.rts_schedulerLoop),
${staticRecords(contract.inventory.jsffiRecords)} };
}
export function createLibraryBindings(soname, __exports, __ghc_wasm_jsffi_dyld, __ghc_wasm_jsffi_finalization_registry) {
  switch (soname) {
${libraries.map((lib) => `case ${JSON.stringify(lib.soname)}: return {${staticRecords(lib.records)}};`).join("\n")}
  default: throw new Error('undeclared JSFFI library: ' + soname);
  }
}
`;
  assertLocalGenerated(text);
  return text;
}

export function assertLocalGenerated(text) {
  if (/https?:|esm\.sh|\bimport\s*\(|\beval\s*\(|new\s+Function\b/.test(text)) throw Error("generated binding contains remote import or runtime code generation");
}

/** Keep only the locked browser/parser/linker slices; inject the local shim explicitly. */
export function transformLocalDyld(source, expectedSha256) {
  if (hash(source) !== expectedSha256) throw Error("dyld upstream hash mismatch");
  if (source.split('wasi = await import("https://esm.sh/gh/haskell-wasm/browser_wasi_shim");').length !== 2) throw Error("dyld browser branch mismatch");
  const slice = (start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    if (a < 0 || b < 0 || source.indexOf(start, a + 1) >= 0) throw Error("dyld source branch layout mismatch");
    return source.slice(a, b);
  };
  let code = slice("function makeBufferConsumer", "// Formats a server.address()")
    + slice("export class DyLDBrowserHost", "// Fulfill the same functionality as DyLDHost")
    + slice("class DyLD {", "// The main entry point of dyld");
  code = code.replace(/^\s*\/\/.*$/gm, "");
  code = replaceOnce(code, / {4}if \(isNode\) \{[\s\S]*? {4}\} else \{([\s\S]*?)\n {4}\}\n/, "$1\n", "WASI constructor");
  code = replaceOnce(code, / {8}new Function\([\s\S]*?\)\(this.exportFuncs, this, this.#finalizationRegistry\)/, "        createLibraryBindings(soname, this.exportFuncs, this, this.#finalizationRegistry)", "static JSFFI");
  code = `import { JSValManager, setImmediate, createLibraryBindings } from './ghc-jsffi-imports.mjs';\nexport const upstreamSha256 = ${JSON.stringify(expectedSha256)};\nexport function createLocalDyldModule(wasi) {\nif (!wasi?.WASI || !wasi?.File || !wasi?.PreopenDirectory) throw new Error('local WASI shim required');\n${code.replaceAll("export class", "class")}\nreturn { DyLD, DyLDBrowserHost };\n}\n`;
  assertLocalGenerated(code);
  return code;
}
