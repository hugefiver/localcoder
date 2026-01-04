import { CheckCircle, Terminal } from '@phosphor-icons/react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useProblems } from '@/hooks/use-problems';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ProblemListProps {
  onSelectProblem: (problemId: number) => void;
  onOpenExecutor: () => void;
  solvedProblems: Set<number>;
}

export function ProblemList({ onSelectProblem, onOpenExecutor, solvedProblems }: ProblemListProps) {
  const { problems, isLoading, error } = useProblems();
  const difficultyColor = {
    Easy: 'bg-success text-success-foreground hover:bg-success/90',
    Medium: 'bg-yellow-500 text-white hover:bg-yellow-500/90',
    Hard: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">试题</h1>
            <p className="text-sm text-muted-foreground mt-1">
              选择一个试题开始编写与运行
            </p>
          </div>
          <Button onClick={onOpenExecutor} variant="outline" className="gap-2">
            <Terminal size={20} weight="bold" />
            自由代码执行
          </Button>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="container mx-auto px-6 py-6 max-w-5xl">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">正在加载题目...</div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertDescription>题目加载失败：{error}</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              {problems.map((problem) => {
              const isSolved = solvedProblems.has(problem.id);
              
              return (
                <Card
                  key={problem.id}
                  className="p-4 cursor-pointer transition-all hover:shadow-lg hover:border-primary/50 group"
                  onClick={() => onSelectProblem(problem.id)}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 mt-1">
                      {isSolved ? (
                        <CheckCircle size={24} weight="fill" className="text-success" />
                      ) : (
                        <div className="w-6 h-6 rounded-full border-2 border-muted-foreground/30" />
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-muted-foreground font-mono text-sm">
                          #{problem.id}
                        </span>
                        <h3 className="text-lg font-semibold group-hover:text-primary transition-colors">
                          {problem.title}
                        </h3>
                        <Badge className={difficultyColor[problem.difficulty]}>
                          {problem.difficulty}
                        </Badge>
                      </div>
                      
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {problem.description}
                      </p>
                    </div>
                  </div>
                </Card>
              );
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
