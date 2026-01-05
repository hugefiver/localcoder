export type AppMode = "all" | "executor" | "problems";

function normalizeMode(value: unknown): AppMode {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v || v === "all") return "all";
  if (v === "executor" || v === "exec") return "executor";
  if (v === "problems" || v === "problem" || v === "leetcode") return "problems";
  // Fail safe: keep all modes if env is invalid.
  return "all";
}

/**
 * Configure via Vite env:
 * - VITE_APP_MODE=all|executor|problems
 */
export const APP_MODE: AppMode = normalizeMode(import.meta.env.VITE_APP_MODE);

export const ENABLE_EXECUTOR = APP_MODE === "all" || APP_MODE === "executor";
export const ENABLE_PROBLEMS = APP_MODE === "all" || APP_MODE === "problems";
