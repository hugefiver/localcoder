import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { Language } from "./use-code-execution";
import {
  getAllRuntimeStates,
  preloadRuntime,
  subscribeRuntimeState,
} from "@/lib/runtime/worker-manager";

interface WorkerState {
  isLoading: boolean;
  isReady: boolean;
  error: string | null;
}

const languageDisplayNames: Record<Language, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  python: "Python",
  racket: "Racket",
};

export function useWorkerLoader() {
  const runtimeStates = useSyncExternalStore(
    subscribeRuntimeState,
    getAllRuntimeStates,
    getAllRuntimeStates,
  );

  const loadingToastsRef = useRef<Record<Language, string | number>>({} as Record<Language, string | number>);
  const prevStatusRef = useRef<Record<Language, string>>({} as Record<Language, string>);

  // Convert RuntimeState -> legacy WorkerState shape used by UI
  const workerStates: Record<string, WorkerState> = Object.fromEntries(
    (Object.keys(runtimeStates) as Language[]).map((lang) => {
      const s = runtimeStates[lang];
      return [
        lang,
        {
          isLoading: s.status === "loading",
          isReady: s.status === "ready",
          error: s.error,
        },
      ];
    }),
  );

  const isWorkerReady = useCallback(
    (language: Language): boolean => workerStates[language]?.isReady === true,
    [workerStates],
  );

  const isWorkerLoading = useCallback(
    (language: Language): boolean => workerStates[language]?.isLoading === true,
    [workerStates],
  );

  const preloadWorker = useCallback((language: Language) => {
    const displayName = languageDisplayNames[language];

    // Start toast immediately; preloadRuntime will update state asynchronously.
    if (!loadingToastsRef.current[language]) {
      loadingToastsRef.current[language] = toast.loading(`正在加载 ${displayName} 运行时...`, {
        duration: Infinity,
      });
    }

    void preloadRuntime(language).catch((err) => {
      const id = loadingToastsRef.current[language];
      if (id) {
        toast.dismiss(id);
        delete loadingToastsRef.current[language];
      }
      toast.error(`加载 ${displayName} 失败：${err?.message ?? String(err)}`);
    });
  }, []);

  useEffect(() => {
    for (const lang of Object.keys(runtimeStates) as Language[]) {
      const status = runtimeStates[lang].status;
      const prev = prevStatusRef.current[lang];
      if (prev === status) continue;

      prevStatusRef.current[lang] = status;
      const displayName = languageDisplayNames[lang];

      if (status === "ready") {
        const id = loadingToastsRef.current[lang];
        if (id) {
          toast.dismiss(id);
          delete loadingToastsRef.current[lang];
        }
        toast.success(`${displayName} 运行时已就绪`);
      }

      if (status === "error") {
        const id = loadingToastsRef.current[lang];
        if (id) {
          toast.dismiss(id);
          delete loadingToastsRef.current[lang];
        }
        toast.error(`${displayName} 运行时加载失败`);
      }
    }
  }, [runtimeStates]);

  return {
    preloadWorker,
    isWorkerReady,
    isWorkerLoading,
    workerStates,
  };
}
