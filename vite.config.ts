import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import { resolve } from 'path'

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname

// https://vite.dev/config/
export default defineConfig(() => {
  // For GitHub Pages, the site is usually served from /<repo>/.
  // You can override by setting VITE_BASE (e.g. "/browser-code-runner/").
  const repoName = process.env.GITHUB_REPOSITORY?.split("/")?.[1];
  const base = process.env.VITE_BASE
    ?? (process.env.GITHUB_PAGES === "true" && repoName ? `/${repoName}/` : "/");

  return {
  base,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'src')
    }
  },
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.wasm')) {
            return 'pyodide/[name][extname]';
          }
          if (assetInfo.name?.includes('pyodide')) {
            return 'pyodide/[name][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
        chunkFileNames: (chunkInfo) => {
          if (chunkInfo.name?.includes('worker')) {
            return '[name].js';
          }
          return 'assets/[name]-[hash].js';
        },
      },
    },
    copyPublicDir: true,
    assetsInlineLimit: 0,
  },
  publicDir: 'public',
  };
});
