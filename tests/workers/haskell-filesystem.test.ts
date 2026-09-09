import assert from "node:assert/strict";
import test from "node:test";
import {
  createHaskellOperationFilesystem,
  parseHaskellLibdirTar,
  type HaskellWasiFilesystemShim,
} from "../../src/workers/haskell/tar-filesystem.js";

test("the Haskell libdir tar parser accepts regular files, directories, and GNU long names", () => {
  const longName = `${"nested/".repeat(20)}package.conf`;
  const archive = tar([
    { name: "ghc/", type: "5" },
    { name: "ghc/settings", data: "setting" },
    { name: "././@LongLink", type: "L", data: `${longName}\0` },
    { name: "ignored-name", data: "long" },
  ]);

  assert.deepEqual(parseHaskellLibdirTar(archive), [
    { kind: "directory", path: "ghc" },
    { kind: "file", path: "ghc/settings", data: new TextEncoder().encode("setting") },
    { kind: "file", path: longName, data: new TextEncoder().encode("long") },
  ]);
});

test("the Haskell libdir tar parser normalizes only a producer's leading archive root", () => {
  const longName = `${"nested/".repeat(20)}package.conf`;
  const archive = tar([
    { name: "./", type: "5" },
    { name: "./ghc/", type: "5" },
    { name: "./ghc/settings", data: "setting" },
    { name: "././@LongLink", type: "L", data: `./${longName}\0` },
    { name: "ignored-name", data: "long" },
  ]);

  assert.deepEqual(parseHaskellLibdirTar(archive), [
    { kind: "directory", path: "ghc" },
    { kind: "file", path: "ghc/settings", data: new TextEncoder().encode("setting") },
    { kind: "file", path: longName, data: new TextEncoder().encode("long") },
  ]);
});

test("the Haskell libdir tar parser rejects traversal, links, devices, and malformed archives", () => {
  for (const entry of [
    { name: "../escape", data: "bad" },
    { name: "./../escape", data: "bad" },
    { name: "./ghc/../escape", data: "bad" },
    { name: "./ghc/./settings", data: "bad" },
    { name: "/absolute", data: "bad" },
    { name: "windows\\escape", data: "bad" },
    { name: "link", type: "2" },
  ]) {
    assert.throws(() => parseHaskellLibdirTar(tar([entry])), /unsafe|unsupported/i);
  }
  assert.throws(() => parseHaskellLibdirTar(new Uint8Array(513)), /truncated|aligned/i);
});

test("the Haskell operation filesystem isolates writable work and creates readonly libdir files", () => {
  const entries = parseHaskellLibdirTar(tar([{ name: "ghc/settings", data: "immutable" }]));
  const first = createHaskellOperationFilesystem(fakeShim, entries, { libdirPath: "/ghc", workDir: "/work" });
  const second = createHaskellOperationFilesystem(fakeShim, entries, { libdirPath: "/ghc", workDir: "/work" });
  const firstLibdir = directory(first.root, "ghc");
  const secondLibdir = directory(second.root, "ghc");
  const firstSettings = file(directory(firstLibdir, "ghc"), "settings");
  const secondSettings = file(directory(secondLibdir, "ghc"), "settings");

  assert.deepEqual(firstSettings.options, { readonly: true });
  assert.notStrictEqual(first.work, second.work);
  assert.notStrictEqual(firstLibdir, secondLibdir);
  assert.notStrictEqual(firstSettings.data, secondSettings.data);
  first.work.contents.set("submission.txt", new FakeFile(new TextEncoder().encode("first")));
  firstSettings.data[0] = "X".charCodeAt(0);
  assert.equal(second.work.contents.has("submission.txt"), false);
  assert.equal(new TextDecoder().decode(secondSettings.data), "immutable");
});

class FakeFile {
  constructor(readonly data: Uint8Array, readonly options?: { readonly?: boolean }) {}
}

class FakeDirectory {
  constructor(readonly contents: Map<string, FakeFile | FakeDirectory>) {}
}

const fakeShim = { File: FakeFile, Directory: FakeDirectory } as unknown as HaskellWasiFilesystemShim;

function directory(root: FakeDirectory, name: string): FakeDirectory {
  const entry = root.contents.get(name);
  if (!(entry instanceof FakeDirectory)) throw new Error(`expected directory ${name}`);
  return entry;
}

function file(root: FakeDirectory, name: string): FakeFile {
  const entry = root.contents.get(name);
  if (!(entry instanceof FakeFile)) throw new Error(`expected file ${name}`);
  return entry;
}

function tar(entries: readonly { readonly name: string; readonly type?: string; readonly data?: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const entry of entries) {
    const data = encoder.encode(entry.data ?? "");
    const header = new Uint8Array(512);
    header.set(encoder.encode(entry.name).slice(0, 100), 0);
    header.set(encoder.encode(data.length.toString(8).padStart(11, "0").concat("\0")), 124);
    header[156] = (entry.type ?? "0").charCodeAt(0);
    chunks.push(header, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  chunks.push(new Uint8Array(1024));
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const archive = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, offset);
    offset += chunk.length;
  }
  return archive;
}
