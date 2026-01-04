import { useEffect, useState } from "react";
import type { Problem } from "@/lib/problems";
import { loadProblems } from "@/lib/problems";

export function useProblems() {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await loadProblems();
        if (cancelled) return;
        setProblems(data);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  return { problems, isLoading, error };
}
