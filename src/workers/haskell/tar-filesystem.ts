export type HaskellTarEntry =
  | { readonly kind: "directory"; readonly path: string }
  | { readonly kind: "file"; readonly path: string; readonly data: Uint8Array };

export interface HaskellWasiFile {
  readonly data: Uint8Array;
}

export interface HaskellWasiDirectory {
  readonly contents: Map<string, HaskellWasiFile | HaskellWasiDirectory>;
}

export interface HaskellWasiFilesystemShim {
  readonly File: new (data: Uint8Array, options?: { readonly?: boolean }) => HaskellWasiFile;
  readonly Directory: new (contents: Map<string, HaskellWasiFile | HaskellWasiDirectory>) => HaskellWasiDirectory;
}

export interface HaskellOperationFilesystem {
  readonly root: HaskellWasiDirectory;
  readonly work: HaskellWasiDirectory;
}

const BLOCK_BYTES = 512;
const decoder = new TextDecoder();

export function parseHaskellLibdirTar(bytes: Uint8Array): readonly HaskellTarEntry[] {
  if (bytes.byteLength % BLOCK_BYTES !== 0) throw new TypeError("Haskell libdir tar is truncated or not block aligned");
  const entries: HaskellTarEntry[] = [];
  let offset = 0;
  let longName: string | undefined;
  while (offset < bytes.byteLength) {
    const header = bytes.subarray(offset, offset + BLOCK_BYTES);
    if (isZeroBlock(header)) {
      if (!remainingZero(bytes, offset)) throw new TypeError("Haskell libdir tar has data after its terminator");
      break;
    }
    const size = parseTarSize(header);
    const dataStart = offset + BLOCK_BYTES;
    const dataEnd = dataStart + size;
    const nextOffset = dataStart + paddedSize(size);
    if (dataEnd > bytes.byteLength || nextOffset > bytes.byteLength) throw new TypeError("Haskell libdir tar is truncated");

    const type = String.fromCharCode(header[156] === 0 ? 48 : header[156] ?? 0);
    const name = longName ?? tarPath(header);
    const data = bytes.slice(dataStart, dataEnd);
    if (type === "L") {
      if (longName !== undefined) throw new TypeError("Haskell libdir tar has consecutive GNU long names");
      longName = parseLongName(data);
    } else {
      if (name.length === 0) throw new TypeError("Haskell libdir tar entry has no path");
      const entryPath = safePath(name);
      if (type === "0") {
        if (entryPath === undefined) throw new TypeError("Haskell libdir tar has an unsafe path");
        entries.push({ kind: "file", path: entryPath, data });
      } else if (type === "5") {
        if (entryPath !== undefined) entries.push({ kind: "directory", path: entryPath });
      }
      else throw new TypeError(`Haskell libdir tar has unsupported entry type ${JSON.stringify(type)}`);
      longName = undefined;
    }
    offset = nextOffset;
  }
  if (longName !== undefined) throw new TypeError("Haskell libdir tar GNU long name has no following entry");
  return entries;
}

export function createHaskellOperationFilesystem(
  shim: HaskellWasiFilesystemShim,
  entries: readonly HaskellTarEntry[],
  options: { readonly libdirPath: string; readonly workDir: string },
): HaskellOperationFilesystem {
  const libdir = new shim.Directory(new Map());
  for (const entry of entries) addEntry(shim, libdir, entry);
  const work = new shim.Directory(new Map());
  const root = new shim.Directory(new Map());
  mount(shim, root, absoluteParts(options.libdirPath), libdir);
  mount(shim, root, absoluteParts(options.workDir), work);
  return { root, work };
}

function addEntry(shim: HaskellWasiFilesystemShim, root: HaskellWasiDirectory, entry: HaskellTarEntry): void {
  const parts = entry.path.split("/");
  const name = parts.pop();
  if (name === undefined) throw new TypeError("Haskell libdir tar entry has no name");
  const parent = ensureDirectories(shim, root, parts);
  if (entry.kind === "directory") {
    const existing = parent.contents.get(name);
    if (existing === undefined) parent.contents.set(name, new shim.Directory(new Map()));
    else if (!isDirectory(existing)) throw new TypeError(`Haskell libdir tar path conflicts with a file: ${entry.path}`);
    return;
  }
  if (parent.contents.has(name)) throw new TypeError(`Haskell libdir tar contains duplicate path: ${entry.path}`);
  parent.contents.set(name, new shim.File(entry.data.slice(), { readonly: true }));
}

function ensureDirectories(
  shim: HaskellWasiFilesystemShim,
  root: HaskellWasiDirectory,
  parts: readonly string[],
): HaskellWasiDirectory {
  let directory = root;
  for (const part of parts) {
    const entry = directory.contents.get(part);
    if (entry === undefined) {
      const created = new shim.Directory(new Map());
      directory.contents.set(part, created);
      directory = created;
    } else if (isDirectory(entry)) {
      directory = entry;
    } else {
      throw new TypeError(`Haskell libdir tar path conflicts with a file: ${part}`);
    }
  }
  return directory;
}

function mount(
  shim: HaskellWasiFilesystemShim,
  root: HaskellWasiDirectory,
  parts: readonly string[],
  directory: HaskellWasiDirectory,
): void {
  const name = parts[parts.length - 1];
  if (name === undefined) throw new TypeError("Haskell filesystem mount path must not be root");
  const parent = ensureDirectories(shim, root, parts.slice(0, -1));
  if (parent.contents.has(name)) throw new TypeError(`Haskell filesystem mount collides at /${parts.join("/")}`);
  parent.contents.set(name, directory);
}

function isDirectory(value: HaskellWasiFile | HaskellWasiDirectory): value is HaskellWasiDirectory {
  return "contents" in value;
}

function absoluteParts(path: string): readonly string[] {
  if (!/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(path)) {
    throw new TypeError("Haskell filesystem mount path must be an absolute safe path");
  }
  return path.slice(1).split("/");
}

function isZeroBlock(block: Uint8Array): boolean {
  return block.every((byte) => byte === 0);
}

function remainingZero(bytes: Uint8Array, offset: number): boolean {
  return bytes.subarray(offset).every((byte) => byte === 0);
}

function parseTarSize(header: Uint8Array): number {
  const raw = text(header, 124, 12).trim();
  if (raw.length === 0) return 0;
  if (!/^[0-7]+$/.test(raw)) throw new TypeError("Haskell libdir tar has an invalid size");
  const size = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(size) || size < 0) throw new TypeError("Haskell libdir tar has an unsafe size");
  return size;
}

function tarPath(header: Uint8Array): string {
  const name = text(header, 0, 100);
  const prefix = text(header, 345, 155);
  return prefix.length === 0 ? name : `${prefix}/${name}`;
}

function parseLongName(bytes: Uint8Array): string {
  const value = decoder.decode(bytes).replace(/\0.*$/s, "").replace(/\n$/, "");
  const path = safePath(value);
  if (path === undefined) throw new TypeError("Haskell libdir tar has an unsafe path");
  return path;
}

function safePath(path: string): string | undefined {
  if (path.length === 0 || path.includes("\\") || path.startsWith("/") || path.includes("\0")) {
    throw new TypeError("Haskell libdir tar has an unsafe path");
  }
  if (path === "./") return undefined;
  const parts = path.replace(/\/$/, "").split("/");
  if (parts[0] === ".") parts.shift();
  if (parts.length === 0) throw new TypeError("Haskell libdir tar has an unsafe path");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new TypeError("Haskell libdir tar has an unsafe path");
  }
  return parts.join("/");
}

function paddedSize(size: number): number {
  return Math.ceil(size / BLOCK_BYTES) * BLOCK_BYTES;
}

function text(bytes: Uint8Array, offset: number, length: number): string {
  const field = bytes.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return decoder.decode(end === -1 ? field : field.subarray(0, end));
}
