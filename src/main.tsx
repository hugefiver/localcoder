import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from "react-error-boundary";
import { ThemeProvider } from "next-themes";
import { BrowserRouter } from 'react-router-dom';

// Some dependencies (e.g. gray-matter) expect Node-style `Buffer` to exist.
// Vite no longer polyfills it for browsers, so we provide a minimal global shim.
import { Buffer } from "buffer";

import App from './App.tsx'
import { ErrorFallback } from './ErrorFallback.tsx'
import { Toaster } from "@/components/ui/sonner";

import "./main.css"
import "./styles/theme.css"
import "./index.css"

(globalThis as any).Buffer ??= Buffer;

// Determine basename for BrowserRouter
// For GitHub Pages deployed at /repo-name/, we need to extract the base path
// from the current URL. The base path is the first segment if not a known route.
function getBasename(): string {
  const baseUrl = import.meta.env.BASE_URL;
  // If BASE_URL is set and not relative, use it directly
  if (baseUrl && baseUrl !== './' && baseUrl !== '/') {
    return baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }
  
  // For relative paths, detect from URL (e.g., /LocalCoder/problems -> /LocalCoder)
  const pathname = window.location.pathname;
  const knownRoutes = ['problems', 'executor'];
  const segments = pathname.split('/').filter(Boolean);
  
  // If first segment is not a known route, it's likely the repo name
  if (segments.length > 0 && !knownRoutes.includes(segments[0])) {
    return '/' + segments[0];
  }
  
  return '';
}

const basename = getBasename();

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary FallbackComponent={ErrorFallback}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <BrowserRouter basename={basename}>
        <App />
      </BrowserRouter>
      <Toaster position="bottom-right" />
    </ThemeProvider>
   </ErrorBoundary>
)
