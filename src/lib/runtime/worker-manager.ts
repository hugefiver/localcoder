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
  haskell: "haskell-worker.js",
  rustpython: "rustpython-worker.js",
};

const workerTypeMap: Partial<Record<Language, WorkerType>> = {
  haskell: "module",
};

const preloadTimeoutMap: Partial<Record<Language, number>> = {
  haskell: 5 * 60_000,
  python: 90_000,
  rustpython: 90_000,
  racket: 90_000,
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
      kind: "preload" | "execute";
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

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (typeof err === "object" && err != null && (err as any).name === "AbortError")
  );
}

function buildRuntimeStatesSnapshot(): Record<Language, RuntimeState> {
  const result: Record<Language, RuntimeState> = {
    javascript: { status: "idle", error: null },
    typescript: { status: "idle", error: null },
    python: { status: "idle", error: null },
    racket: { status: "idle", error: null },
    haskell: { status: "idle", error: null },
    rustpython: { status: "idle", error: null },
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
  const workerType = workerTypeMap[language];
  const worker = new Worker(workerPath, workerType ? { type: workerType } : undefined);

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
      } else {
        // If ready arrives without requestId, clear any preload markers.
        for (const [pendingId, pending] of entry.pending.entries()) {
          if (pending.kind !== "preload") continue;
          window.clearTimeout(pending.timeoutId);
          entry.pending.delete(pendingId);
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
      if (data?.success === false) {
        const errMsg = data?.error ?? "Runtime error";
        entry.state = { status: "error", error: errMsg };
        entry.readyReject(new Error(errMsg));
        notify();
      }
      return;
    }

    const pending = entry.pending.get(requestId);
    if (!pending) return;

    if (pending.kind === "preload" && data?.success === false) {
      const errMsg = data?.error ?? "Runtime failed to load";
      if (entry.loadTimeoutId != null) {
        window.clearTimeout(entry.loadTimeoutId);
        entry.loadTimeoutId = null;
      }
      window.clearTimeout(pending.timeoutId);
      entry.pending.delete(requestId);
      entry.state = { status: "error", error: errMsg };
      entry.readyReject(new Error(errMsg));
      notify();
      return;
    }

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

export function terminateRuntime(
  language: Language,
  opts?: { reason?: string; nextState?: RuntimeState },
): void {
  const entry = entries.get(language);
  if (!entry) return;

  try {
    entry.worker.terminate();
  } catch {
    // ignore
  }

  const reason = opts?.reason ?? "Runtime terminated";

  // Reject all pending requests so callers can unblock.
  for (const pending of entry.pending.values()) {
    window.clearTimeout(pending.timeoutId);
    pending.reject(new Error(reason));
  }
  entry.pending.clear();

  if (entry.loadTimeoutId != null) {
    window.clearTimeout(entry.loadTimeoutId);
    entry.loadTimeoutId = null;
  }

  // If runtime was loading, ensure readyPromise doesn't hang.
  try {
    entry.readyReject(new Error(reason));
  } catch {
    // ignore
  }

  // Remove entry so next request recreates a fresh worker.
  entries.delete(language);

  // Update snapshot state (idle by default; abort shouldn't be a hard error).
  runtimeStatesSnapshot = buildRuntimeStatesSnapshot();
  if (opts?.nextState) {
    runtimeStatesSnapshot = { ...runtimeStatesSnapshot, [language]: opts.nextState };
  }
  notify();
}

export async function preloadRuntime(language: Language): Promise<void> {
  const entry = ensureEntry(language);

  if (entry.state.status === "ready") return;
  if (entry.state.status === "loading") return entry.readyPromise;

  entry.state = { status: "loading", error: null };
  notify();

  // Ask worker to warm up runtime (especially Pyodide)
  const requestId = makeRequestId();

  const loadTimeoutMs = preloadTimeoutMap[language] ?? 60_000;
  entry.loadTimeoutId = window.setTimeout(() => {
    entry.state = { status: "error", error: "Runtime loading timeout" };
    entry.readyReject(new Error("Runtime loading timeout"));
    notify();
  }, loadTimeoutMs);

  // Keep a pending entry so we can correlate/cleanup if the worker echoes requestId.
  const noopTimeoutId = window.setTimeout(() => {}, 0);
  window.clearTimeout(noopTimeoutId);
  entry.pending.set(requestId, {
    kind: "preload",
    resolve: () => {},
    reject: (err) => entry.readyReject(err instanceof Error ? err : new Error(String(err))),
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
  opts?: { timeoutMs?: number; signal?: AbortSignal; terminateOnAbort?: boolean },
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

    let aborted = false;
    const onAbort = () => {
      aborted = true;
      entry.pending.delete(requestId);
      window.clearTimeout(timeoutId);

      const terminate = opts?.terminateOnAbort !== false;
      if (terminate) {
        terminateRuntime(language, {
          reason: "Execution aborted",
          nextState: { status: "idle", error: null },
        });
      }

      const abortErr = new DOMException("Execution aborted", "AbortError");
      reject(abortErr);
    };

    if (opts?.signal) {
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    entry.pending.set(requestId, {
      kind: "execute",
      resolve: (data) => {
        if (opts?.signal) opts.signal.removeEventListener("abort", onAbort);
        if (aborted) return;
        resolve(data as T);
      },
      reject: (err) => {
        if (opts?.signal) opts.signal.removeEventListener("abort", onAbort);
        if (aborted) return;
        reject(err);
      },
      timeoutId,
    });

    entry.worker.postMessage({ ...payload, requestId, language });
  });
}
