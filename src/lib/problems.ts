import matter from "gray-matter";
import { marked } from "marked";
import type { Language } from "@/hooks/use-code-execution";

export type Difficulty = "Easy" | "Medium" | "Hard";

export interface ProblemExample {
  input: string;
  output: string;
  explanation?: string;
}

export interface TestCase {
  input: any;
  expected: any;
}

export interface Problem {
  id: number;
  slug: string;
  title: string;
  difficulty: Difficulty;
  /** Short summary used in list view */
  description: string;
  /** Full markdown body */
  markdown: string;
  /** Rendered HTML for the markdown body */
  html: string;
  examples: ProblemExample[];
  constraints?: string[];
  testCases: TestCase[];
  templates?: Partial<Record<Language, string>>;
}

type ProblemFrontmatter = Partial<{
  id: number;
  title: string;
  difficulty: Difficulty;
  description: string;
  examples: ProblemExample[];
  constraints: string[];
  testCases: TestCase[];
  templates: Partial<Record<Language, string>>;
}>;

const modules = import.meta.glob("../problems/*.md", {
  query: "?raw",
  import: "default",
});

let problemsCache: Promise<Problem[]> | null = null;

function slugFromPath(path: string): string {
  const filename = path.split("/").pop() ?? path;
  return filename.replace(/\.md$/i, "");
}

function assertDifficulty(value: any): Difficulty {
  if (value === "Easy" || value === "Medium" || value === "Hard") return value;
  return "Easy";
}

export async function loadProblems(): Promise<Problem[]> {
  if (problemsCache) return problemsCache;

  problemsCache = (async () => {
    const entries = Object.entries(modules);
    const loaded = await Promise.all(
      entries.map(async ([path, loader]) => {
        const raw = await (loader as () => Promise<string>)();
        const { data, content } = matter(raw);
        const fm = data as ProblemFrontmatter;

        const slug = slugFromPath(path);
        const id = typeof fm.id === "number" ? fm.id : Number(slug.match(/^\d+/)?.[0] ?? NaN);
        const title = fm.title ?? slug;
        const difficulty = assertDifficulty(fm.difficulty);
        const description = fm.description ?? "";
        const html = marked.parse(content) as string;

        return {
          id: Number.isFinite(id) ? id : 0,
          slug,
          title,
          difficulty,
          description,
          markdown: content,
          html,
          examples: fm.examples ?? [],
          constraints: fm.constraints ?? [],
          testCases: fm.testCases ?? [],
          templates: fm.templates ?? {},
        } satisfies Problem;
      }),
    );

    return loaded
      .filter((p) => p.id > 0)
      .sort((a, b) => a.id - b.id);
  })();

  return problemsCache;
}

export async function getProblemById(problemId: number): Promise<Problem | undefined> {
  const all = await loadProblems();
  return all.find((p) => p.id === problemId);
}

export const languageInfo = {
  javascript: {
    name: 'JavaScript',
    description: 'Run JavaScript code directly in the browser',
  },
  typescript: {
    name: 'TypeScript',
    description: 'TypeScript with basic type stripping',
  },
  python: {
    name: 'Python',
    description: 'CPython via Pyodide WebAssembly',
  },
  rustpython: {
    name: 'RustPython',
    description: 'Python via RustPython (WASI WebAssembly)',
  },
  racket: {
    name: 'Racket',
    description: 'Racket Scheme (simulated)',
  },
  haskell: {
    name: 'Haskell',
    description: 'Haskell via WebAssembly runtime (WASI)',
  },
};
