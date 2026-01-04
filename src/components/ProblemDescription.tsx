import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Problem } from '@/lib/problems';

interface ProblemDescriptionProps {
  problem: Problem;
}

export function ProblemDescription({ problem }: ProblemDescriptionProps) {
  const difficultyColor = {
    Easy: 'bg-success text-success-foreground hover:bg-success/90',
    Medium: 'bg-yellow-500 text-white hover:bg-yellow-500/90',
    Hard: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  };

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 pr-4">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold">{problem.title}</h2>
            <Badge className={difficultyColor[problem.difficulty]}>{problem.difficulty}</Badge>
          </div>
          {problem.html ? (
            <div
              className="text-sm leading-relaxed text-foreground/90 space-y-3 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_pre]:mt-2 [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:bg-muted/60 [&_pre]:border [&_pre]:border-border/50 [&_pre]:overflow-x-auto [&_code]:font-mono [&_code]:text-xs [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-primary [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: problem.html }}
            />
          ) : (
            <p className="text-sm text-foreground/90 leading-relaxed">{problem.description}</p>
          )}
        </div>

        <div className="space-y-4">
          <h3 className="text-base font-semibold">Examples</h3>
          {problem.examples.map((example, index) => (
            <div key={index} className="space-y-2">
              <div className="font-medium text-sm">Example {index + 1}:</div>
              <div className="space-y-1">
                <div>
                  <span className="text-muted-foreground text-xs">Input:</span>
                  <pre className="console-output mt-1 p-2 bg-muted/50 rounded overflow-x-auto text-xs">
                    {example.input}
                  </pre>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">Output:</span>
                  <pre className="console-output mt-1 p-2 bg-muted/50 rounded overflow-x-auto text-xs">
                    {example.output}
                  </pre>
                </div>
                {example.explanation && (
                  <div>
                    <span className="text-muted-foreground text-xs">Explanation:</span>
                    <p className="mt-1 text-xs text-foreground/80">{example.explanation}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {problem.constraints && problem.constraints.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-base font-semibold">Constraints</h3>
            <ul className="space-y-1 text-xs text-foreground/80">
              {problem.constraints.map((constraint, index) => (
                <li key={index} className="ml-4 list-disc">
                  {constraint}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
