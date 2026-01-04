import { useState, useEffect } from 'react';
import { Play, ArrowLeft, Terminal, Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { CodeEditor } from '@/components/CodeEditor';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { type Language } from '@/hooks/use-code-execution';
import { useWorkerLoader } from '@/hooks/use-worker-loader';
import { useCodeExecution } from '@/hooks/use-code-execution';
import { useLocalStorageState, localStorageGet, localStorageSet } from '@/hooks/use-local-storage';

interface ExecutorViewProps {
  onBack: () => void;
}

interface ExecutionOutput {
  type: 'stdout' | 'stderr' | 'result' | 'error';
  content: string;
}

const defaultCode: Record<Language, string> = {
  javascript: `// JavaScript Executor
console.log("Hello, World!");

// Try some examples:
const numbers = [1, 2, 3, 4, 5];
console.log("Sum:", numbers.reduce((a, b) => a + b, 0));

function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log("Fibonacci(10):", fibonacci(10));`,
  
  typescript: `// TypeScript Executor
console.log("Hello, World!");

// Try some examples:
const numbers: number[] = [1, 2, 3, 4, 5];
console.log("Sum:", numbers.reduce((a, b) => a + b, 0));

function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log("Fibonacci(10):", fibonacci(10));`,
  
  python: `# Python Executor
print("Hello, World!")

# Try some examples:
numbers = [1, 2, 3, 4, 5]
print("Sum:", sum(numbers))

def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

print("Fibonacci(10):", fibonacci(10))`,
  
  racket: `; Racket Executor
(displayln "Hello, World!")

; Try some examples:
(define numbers '(1 2 3 4 5))
(displayln (string-append "Sum: " (number->string (apply + numbers))))

(define (fibonacci n)
  (if (<= n 1)
      n
      (+ (fibonacci (- n 1)) (fibonacci (- n 2)))))

(displayln (string-append "Fibonacci(10): " (number->string (fibonacci 10))))`
};

export function ExecutorView({ onBack }: ExecutorViewProps) {
  const [selectedLanguage, setSelectedLanguage] = useLocalStorageState<Language>('executor-language', 'javascript');
  const [code, setCode] = useState<string>('');
  const [codeLoaded, setCodeLoaded] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [outputs, setOutputs] = useState<ExecutionOutput[]>([]);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const { preloadWorker, isWorkerReady, isWorkerLoading } = useWorkerLoader();
  const { executeCode } = useCodeExecution();

  const language = selectedLanguage || 'javascript';

  useEffect(() => {
    let cancelled = false;

    const loadCodeForLanguage = async () => {
      const savedCode = await localStorageGet<string>(`executor-code-${language}`);

      if (cancelled) return;

      if (savedCode) {
        setCode(savedCode);
      } else {
        setCode(defaultCode[language]);
      }
      setCodeLoaded(true);
    };

    setCodeLoaded(false);
    void loadCodeForLanguage();

    return () => {
      cancelled = true;
    };
  }, [language]);

  useEffect(() => {
    if (!codeLoaded) return;
    void localStorageSet(`executor-code-${language}`, code);
  }, [code, language, codeLoaded]);

  const handleLanguageChange = (lang: Language) => {
    setSelectedLanguage(lang);
    preloadWorker(lang);
  };

  useEffect(() => {
    preloadWorker(language);
  }, [language, preloadWorker]);

  const handleRunCode = async () => {
    if (!code || code.trim() === '') {
      toast.error('Please write some code first');
      return;
    }

    if (isWorkerLoading(language)) {
      toast.error('Runtime is still loading, please wait...');
      return;
    }

    if (!isWorkerReady(language)) {
      toast.error('Runtime is not ready. Please try changing language or refresh the page.');
      return;
    }

    setIsRunning(true);
    setOutputs([]);
    setExecutionTime(null);
    
    const startTime = performance.now();

    toast.info('Executing code...');

    const data = await executeCode(code, language, [], { executorMode: true });

    const endTime = performance.now();
    setExecutionTime(endTime - startTime);

    const newOutputs: ExecutionOutput[] = [];

    if (data.success) {
      if (data.logs) {
        newOutputs.push({ type: 'stdout', content: data.logs });
      }

      if ((data as any).result !== undefined && (data as any).result !== null) {
        const r = (data as any).result;
        newOutputs.push({
          type: 'result',
          content: typeof r === 'object' ? JSON.stringify(r, null, 2) : String(r),
        });
      }

      if (newOutputs.length === 0) {
        newOutputs.push({ type: 'stdout', content: '(No output)' });
      }
      toast.success('Execution completed');
    } else {
      if (data.logs) {
        newOutputs.push({ type: 'stdout', content: data.logs });
      }

      newOutputs.push({ type: 'error', content: data.error || 'Unknown error' });

      if (data.stack) {
        newOutputs.push({ type: 'stderr', content: data.stack });
      }

      toast.error('Execution failed');
    }

    setOutputs(newOutputs);
    setIsRunning(false);
  };

  const handleClearOutput = () => {
    setOutputs([]);
    setExecutionTime(null);
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="border-b border-border bg-card px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
              <ArrowLeft size={18} />
              Back
            </Button>
            <div className="h-6 w-px bg-border" />
            <Terminal size={24} weight="bold" className="text-primary" />
            <span className="font-semibold">自由代码执行</span>
          </div>

          <div className="flex items-center gap-3">
            <Select value={language} onValueChange={handleLanguageChange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="javascript">JavaScript</SelectItem>
                <SelectItem value="typescript">TypeScript</SelectItem>
                <SelectItem value="python">Python</SelectItem>
                <SelectItem value="racket">Racket</SelectItem>
              </SelectContent>
            </Select>

            <Button 
              onClick={handleRunCode} 
              disabled={isRunning || isWorkerLoading(language) || !isWorkerReady(language)} 
              className="gap-2"
            >
              <Play size={18} weight="fill" />
              {isRunning ? 'Running...' : isWorkerLoading(language) ? 'Loading Runtime...' : 'Execute'}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="vertical">
          <ResizablePanel defaultSize={60} minSize={30}>
            <div className="h-full flex flex-col p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Code Editor</h3>
                <div className="text-xs text-muted-foreground">
                  Write and execute {language} code
                </div>
              </div>
              <CodeEditor 
                value={code || ''} 
                onChange={setCode} 
                language={language} 
                className="flex-1" 
              />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={40} minSize={20}>
            <div className="h-full flex flex-col overflow-hidden">
              <div className="border-b border-border px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal size={18} />
                  <span className="text-sm font-semibold">Output</span>
                  {executionTime !== null && (
                    <span className="text-xs text-muted-foreground">
                      ({executionTime.toFixed(2)}ms)
                    </span>
                  )}
                </div>
                {outputs.length > 0 && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleClearOutput}
                    className="gap-2"
                  >
                    <Trash size={16} />
                    Clear
                  </Button>
                )}
              </div>

              <ScrollArea className="flex-1">
                <div className="p-4">
                  {outputs.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <div className="text-center space-y-2 py-12">
                        <Terminal size={48} className="mx-auto opacity-30" />
                        <p className="text-sm">Execute your code to see output</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {outputs.map((output, index) => (
                        <div key={index}>
                          {output.type === 'error' ? (
                            <Alert variant="destructive">
                              <AlertDescription className="console-output whitespace-pre-wrap break-words">
                                {output.content}
                              </AlertDescription>
                            </Alert>
                          ) : output.type === 'stderr' ? (
                            <div className="bg-muted p-3 rounded-md">
                              <div className="text-xs text-destructive font-semibold mb-1">Stack Trace:</div>
                              <pre className="console-output text-xs text-muted-foreground whitespace-pre-wrap break-words">
                                {output.content}
                              </pre>
                            </div>
                          ) : output.type === 'result' ? (
                            <div className="bg-muted p-3 rounded-md">
                              <div className="text-xs text-muted-foreground font-semibold mb-1">Return Value:</div>
                              <pre className="console-output text-sm whitespace-pre-wrap break-words">
                                {output.content}
                              </pre>
                            </div>
                          ) : (
                            <div className="bg-card border border-border p-3 rounded-md">
                              <pre className="console-output text-sm whitespace-pre-wrap break-words">
                                {output.content}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
