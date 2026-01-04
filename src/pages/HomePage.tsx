import { Link } from "react-router-dom";
import { Terminal, ListChecks } from "@phosphor-icons/react";
import { Card } from "@/components/ui/card";

export function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-5xl px-6 py-10">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">LocalCoder</h1>
          <p className="text-sm text-muted-foreground">
            本地运行的浏览器代码执行与刷题小站（无需后端）。
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <Link to="/executor" className="block">
            <Card className="p-6 h-full transition-all hover:shadow-lg hover:border-primary/50">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Terminal size={22} weight="bold" className="text-primary" />
                </div>
                <div>
                  <div className="font-semibold">自由代码执行</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    JavaScript / TypeScript / Python / Racket
                  </div>
                </div>
              </div>
            </Card>
          </Link>

          <Link to="/problems" className="block">
            <Card className="p-6 h-full transition-all hover:shadow-lg hover:border-primary/50">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <ListChecks size={22} weight="bold" className="text-primary" />
                </div>
                <div>
                  <div className="font-semibold">试题</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    从本地 Markdown 题库加载
                  </div>
                </div>
              </div>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
