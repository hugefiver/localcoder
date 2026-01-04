import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function assertExists(relPath) {
  if (!exists(relPath)) {
    throw new Error(`Missing required file: ${relPath}`);
  }
}

function main() {
  const checks = [
    "package.json",
    "pnpm-lock.yaml",

    // Dev assets
    "public/js-worker.js",
    "public/python-worker.js",
    "public/racket-worker.js",
    "public/pyodide/pyodide.js",

    // Build output
    "dist/index.html",
    "dist/js-worker.js",
    "dist/python-worker.js",
    "dist/racket-worker.js",
    "dist/pyodide/pyodide.js",
  ];

  for (const p of checks) assertExists(p);

  // Quick sanity: ensure pyodide directory is non-trivial
  const pyodideFiles = fs.readdirSync(path.join(root, "dist/pyodide"));
  if (pyodideFiles.length < 5) {
    throw new Error(`dist/pyodide looks too small (${pyodideFiles.length} files)`);
  }

  console.log("Smoke check passed:");
  for (const p of checks) console.log(`  ✓ ${p}`);
}

main();
