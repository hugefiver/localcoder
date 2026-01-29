import js from "@eslint/js"
import globals from "globals"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "public/**",
      "**/*.min.*",
      "src/vite-end.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Node scripts (build/setup helpers)
  {
    files: ["scripts/**/*.{js,cjs,mjs}", "runtimes/**/*.{js,cjs,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      // These scripts are not React code.
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Vite + React Fast Refresh
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // Prefer TS-aware unused-vars; allow `_`-prefixed intentionally-unused.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // This codebase intentionally uses `any` in a few boundary layers (workers, markdown parsing, etc.).
      "@typescript-eslint/no-explicit-any": "off",

      // The new react-hooks plugin versions include extra rules that are too strict for this project.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/exhaustive-deps": "warn",
    },
  }
)
