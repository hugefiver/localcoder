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

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary FallbackComponent={ErrorFallback}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <Toaster position="bottom-right" />
    </ThemeProvider>
   </ErrorBoundary>
)
