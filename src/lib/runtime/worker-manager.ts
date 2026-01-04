import type { Language } from "@/hooks/use-code-execution";

export type RuntimeStatus = "idle" | "loading" | "ready" | "error";

export interface RuntimeState {
  status: RuntimeStatus;
  error: string | null;
}

type Listener = () => void;

const workerFilenameMap: Record<Language, string> = {
  javascript: "js-worker.js",
  typescript: "js-worker.js",
  python: "python-worker.js",
  racket: "racket-worker.js",
};

function getWorkerURL(filename: string): string {
  const base = import.meta.env.BASE_URL || "/";
  // base is a path, not a full URL. Avoid collapsing "https://".
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}${filename}`.replace(/\/+/g, "/");
}

function makeRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

interface RuntimeEntry {
  worker: Worker;
  state: RuntimeState;
  pending: Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (reason: any) => void;
      timeoutId: number;
    }
  >;
  readyPromise: Promise<void>;
  readyResolve: () => void;
  readyReject: (err: Error) => void;
  loadTimeoutId: number | null;
}

const entries = new Map<Language, RuntimeEntry>();
const listeners = new Set<Listener>();

function buildRuntimeStatesSnapshot(): Record<Language, RuntimeState> {
  const result: Record<Language, RuntimeState> = {
    javascript: { status: "idle", error: null },
    typescript: { status: "idle", error: null },
    python: { status: "idle", error: null },
    racket: { status: "idle", error: null },
  };

  for (const [lang, entry] of entries.entries()) {
    result[lang] = entry.state;
  }

  return result;
}

// Cached snapshot used by React's useSyncExternalStore.
// Important: getSnapshot must return the same reference until the store actually changes.
let runtimeStatesSnapshot: Record<Language, RuntimeState> = buildRuntimeStatesSnapshot();

function notify() {
  runtimeStatesSnapshot = buildRuntimeStatesSnapshot();
  for (const l of listeners) l();
}

export function subscribeRuntimeState(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAllRuntimeStates(): Record<Language, RuntimeState> {
  return runtimeStatesSnapshot;
}

function ensureEntry(language: Language): RuntimeEntry {
  const existing = entries.get(language);
  if (existing) return existing;

  const workerPath = getWorkerURL(workerFilenameMap[language]);
  const worker = new Worker(workerPath);

  let readyResolve!: () => void;
  let readyReject!: (err: Error) => void;

  const readyPromise = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const entry: RuntimeEntry = {
    worker,
    state: { status: "idle", error: null },
    pending: new Map(),
    readyPromise,
    readyResolve,
    readyReject,
    loadTimeoutId: null,
  };

  worker.onmessage = (e: MessageEvent) => {
    const data = e.data;

    if (data?.type === "ready") {
      if (entry.loadTimeoutId != null) {
        window.clearTimeout(entry.loadTimeoutId);
        entry.loadTimeoutId = null;
      }

      const maybeRequestId: string | undefined = data?.requestId;
      if (maybeRequestId) {
        const pending = entry.pending.get(maybeRequestId);
        if (pending) {
          window.clearTimeout(pending.timeoutId);
          entry.pending.delete(maybeRequestId);
        }
      }

      entry.state = { status: "ready", error: null };
      entry.readyResolve();
      notify();
      return;
    }

    if (data?.type === "status") {
      // do not mark ready on status
      return;
    }

    const requestId: string | undefined = data?.requestId;
    if (!requestId) {
      // unknown/legacy message
      return;
    }

    const pending = entry.pending.get(requestId);
    if (!pending) return;

    window.clearTimeout(pending.timeoutId);
    entry.pending.delete(requestId);
    pending.resolve(data);
  };

  worker.onerror = (err) => {
    if (entry.loadTimeoutId != null) {
      window.clearTimeout(entry.loadTimeoutId);
      entry.loadTimeoutId = null;
    }
    entry.state = { status: "error", error: err.message || "Worker error" };
    entry.readyReject(new Error(entry.state.error ?? "Worker error"));

    for (const pending of entry.pending.values()) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(err);
    }
    entry.pending.clear();

    notify();
  };

  entries.set(language, entry);
  return entry;
}

export async function preloadRuntime(language: Language): Promise<void> {
  const entry = ensureEntry(language);

  if (entry.state.status === "ready") return;
  if (entry.state.status === "loading") return entry.readyPromise;

  entry.state = { status: "loading", error: null };
  notify();

  // Ask worker to warm up runtime (especially Pyodide)
  const requestId = makeRequestId();

  entry.loadTimeoutId = window.setTimeout(() => {
    entry.state = { status: "error", error: "Runtime loading timeout" };
    entry.readyReject(new Error("Runtime loading timeout"));
    notify();
  }, 60000);

  // Keep a pending entry so we can correlate/cleanup if the worker echoes requestId.
  const noopTimeoutId = window.setTimeout(() => {}, 0);
  window.clearTimeout(noopTimeoutId);
  entry.pending.set(requestId, {
    resolve: () => {},
    reject: () => {},
    timeoutId: entry.loadTimeoutId,
  });

  entry.worker.postMessage({ type: "preload", requestId, language });

  return entry.readyPromise;
}

export async function ensureRuntimeReady(language: Language): Promise<void> {
  await preloadRuntime(language);
}

export async function executeWorkerRequest<T>(
  language: Language,
  payload: Record<string, unknown>,
  opts?: { timeoutMs?: number },
): Promise<T> {
  const entry = ensureEntry(language);
  await ensureRuntimeReady(language);

  const requestId = makeRequestId();
  const timeoutMs = opts?.timeoutMs ?? 30000;

  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      entry.pending.delete(requestId);
      reject(new Error(`Execution timeout (${Math.round(timeoutMs / 1000)} seconds)`));
    }, timeoutMs);

    entry.pending.set(requestId, {
      resolve: (data) => resolve(data as T),
      reject: (err) => reject(err),
      timeoutId,
    });

    entry.worker.postMessage({ ...payload, requestId, language });
  });
}
