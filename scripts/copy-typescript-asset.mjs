import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

const src = resolve(projectRoot, 'node_modules', 'typescript', 'lib', 'typescript.js');
const dest = resolve(projectRoot, 'public', 'typescript', 'typescript.js');

if (!existsSync(src)) {
  console.error('TypeScript not found in node_modules. Please run: npm install typescript');
  process.exit(1);
}

const destDir = dirname(dest);
if (!existsSync(destDir)) {
  mkdirSync(destDir, { recursive: true });
}

console.log(`Copying TypeScript compiler from: ${src}`);
console.log(`Copying to: ${dest}`);
copyFileSync(src, dest);
console.log('TypeScript compiler asset copied!');
