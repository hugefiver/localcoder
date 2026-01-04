import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, type Plugin } from "vite";
import { resolve } from 'path'
import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from 'fs'

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname

/**
 * Plugin to generate SPA fallback HTML files for GitHub Pages.
 * Creates copies of index.html for each route so that direct navigation works.
 * Adjusts relative paths based on directory depth.
 */
function ghPagesSpaFallback(): Plugin {
  const isGitHubPages = process.env.GITHUB_PAGES === "true";
  
  /**
   * Create an HTML file with adjusted relative paths for the given depth.
   * @param sourceHtml - The original index.html content
   * @param depth - How many directories deep (1 = /foo/, 2 = /foo/bar/)
   */
  function createAdjustedHtml(sourceHtml: string, depth: number): string {
    if (depth === 0) return sourceHtml;
    
    const prefix = '../'.repeat(depth);
    
    // Replace relative paths like ./assets/, ./pyodide/, ./js-worker.js etc.
    return sourceHtml
      .replace(/href="\.\/(?!\/)/g, `href="${prefix}`)
      .replace(/src="\.\/(?!\/)/g, `src="${prefix}`);
  }
  
  return {
    name: 'gh-pages-spa-fallback',
    apply: 'build',
    closeBundle() {
      if (!isGitHubPages) return;
      
      const distDir = resolve(projectRoot, 'dist');
      const indexHtmlPath = resolve(distDir, 'index.html');
      
      if (!existsSync(indexHtmlPath)) return;
      
      const indexHtml = readFileSync(indexHtmlPath, 'utf-8');
      
      // Routes that need fallback HTML files: [path, depth]
      const routes: [string, number][] = [
        ['problems', 1],
        ['executor', 1],
        ['404.html', 0],
      ];
      
      // Create fallback HTML files
      for (const [route, depth] of routes) {
        if (route.endsWith('.html')) {
          // Direct HTML file (like 404.html)
          writeFileSync(resolve(distDir, route), createAdjustedHtml(indexHtml, depth));
        } else {
          // Directory with index.html
          const routeDir = resolve(distDir, route);
          if (!existsSync(routeDir)) {
            mkdirSync(routeDir, { recursive: true });
          }
          writeFileSync(resolve(routeDir, 'index.html'), createAdjustedHtml(indexHtml, depth));
        }
      }
      
      // Generate problem pages for each problem ID
      const problemsDir = resolve(distDir, 'problems');
      if (!existsSync(problemsDir)) {
        mkdirSync(problemsDir, { recursive: true });
      }
      
      // Read actual problem files to get IDs
      const srcProblemsDir = resolve(projectRoot, 'src', 'problems');
      if (existsSync(srcProblemsDir)) {
        const problemFiles = readdirSync(srcProblemsDir).filter(f => f.endsWith('.md'));
        for (const file of problemFiles) {
          // Extract ID from filename like "001-two-sum.md"
          const match = file.match(/^(\d+)-/);
          if (match) {
            const id = match[1];
            const problemIdDir = resolve(problemsDir, id);
            if (!existsSync(problemIdDir)) {
              mkdirSync(problemIdDir, { recursive: true });
            }
            // Depth 2: /problems/{id}/
            writeFileSync(resolve(problemIdDir, 'index.html'), createAdjustedHtml(indexHtml, 2));
          }
        }
      }
      
      console.log('[gh-pages-spa-fallback] Generated SPA fallback HTML files');
    }
  };
}

// https://vite.dev/config/
export default defineConfig(() => {
  // Use relative paths for GitHub Pages compatibility
  // Assets will be loaded relative to the HTML file location
  const isGitHubPages = process.env.GITHUB_PAGES === "true";
  const base = process.env.VITE_BASE ?? (isGitHubPages ? "./" : "/");

  return {
  base,
  plugins: [
    react(),
    tailwindcss(),
    ghPagesSpaFallback(),
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
