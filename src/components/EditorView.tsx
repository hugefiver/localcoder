import { useState, useEffect } from 'react';
import { ArrowLeft, Play, Code } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CodeEditor } from '@/components/CodeEditor';
import { TestResults } from '@/components/TestResults';
import { ProblemDescription } from '@/components/ProblemDescription';
import { TestCaseManager } from '@/components/TestCaseManager';
import { useCodeExecution, type Language } from '@/hooks/use-code-execution';
import { useWorkerLoader } from '@/hooks/use-worker-loader';
import { languageInfo } from '@/lib/problems';
import { useProblems } from '@/hooks/use-problems';
import { useLocalStorageState, localStorageGet, localStorageSet } from '@/hooks/use-local-storage';
import { toast } from 'sonner';

interface EditorViewProps {
  problemId: number;
  onBack: () => void;
}

interface CustomTestCase {
  input: any;
  expected: any;
}

export function EditorView({ problemId, onBack }: EditorViewProps) {
  const { problems, isLoading: isProblemsLoading } = useProblems();
  const problem = problems.find((p) => p.id === problemId);
  const [selectedLanguage, setSelectedLanguage] = useLocalStorageState<Language>(`problem-${problemId}-language`, 'javascript');
  const [activeTab, setActiveTab] = useState<'description'>('description');
  const [testTab, setTestTab] = useState<'testcases' | 'results'>('testcases');
  const [customTestCases, setCustomTestCases] = useLocalStorageState<CustomTestCase[]>(`problem-${problemId}-custom-tests`, []);
  const { executeCode, cancel, isRunning, result } = useCodeExecution();
  const { preloadWorker, isWorkerReady, isWorkerLoading } = useWorkerLoader();

  const language = selectedLanguage || 'javascript';
  const [code, setCode] = useState<string>('');
  const [codeLoaded, setCodeLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadCodeForLanguage = async () => {
      const savedCode = await localStorageGet<string>(`problem-${problemId}-code-${language}`);

      if (cancelled) return;

      if (savedCode) {
        setCode(savedCode);
      } else if (problem) {
        const template = problem.templates?.[language] || `// Write your ${language} code here`;
        setCode(template);
      }
      setCodeLoaded(true);
    };

    setCodeLoaded(false);
    void loadCodeForLanguage();

    return () => {
      cancelled = true;
    };
  }, [problemId, language, problem]);

  useEffect(() => {
    if (!codeLoaded) return;
    void localStorageSet(`problem-${problemId}-code-${language}`, code);
  }, [code, language, problemId, codeLoaded]);

  const handleLanguageChange = (lang: Language) => {
    setSelectedLanguage(lang);
    preloadWorker(lang);
  };

  useEffect(() => {
    preloadWorker(language);
  }, [language, preloadWorker]);

  const handleRunCode = async () => {
    if (!problem) return;
    
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

    toast.info('Running tests...');
    setTestTab('results');

    const allTestCases = [...problem.testCases, ...(customTestCases || [])];
    const executionResult = await executeCode(code, language, allTestCases);

    if (!executionResult.success && executionResult.error === 'Execution cancelled') {
      // User cancelled; don't treat as an execution failure toast here.
      return;
    }

    if (executionResult.success && executionResult.results) {
      const passedCount = executionResult.results.filter((r) => r.passed).length;
      const totalCount = executionResult.results.length;

      if (passedCount === totalCount) {
        toast.success(`All tests passed! (${totalCount}/${totalCount})`);
      } else {
        toast.error(`Some tests failed (${passedCount}/${totalCount})`);
      }
    } else {
      toast.error('Execution failed');
    }
  };

  const handleStop = () => {
    cancel();
    toast.message('已终止执行');
  };

  if (!problem) {
    return (
      <div className="h-screen flex items-center justify-center">
        {isProblemsLoading ? (
          <div className="text-sm text-muted-foreground">正在加载题目...</div>
        ) : (
          <Alert variant="destructive">
            <AlertDescription>Problem not found</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

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
            <Code size={24} weight="bold" className="text-primary" />
            <span className="font-semibold">LocalCoder</span>
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
                <SelectItem value="rustpython">RustPython</SelectItem>
                <SelectItem value="racket">Racket</SelectItem>
                <SelectItem value="haskell">Haskell</SelectItem>
              </SelectContent>
            </Select>

            {isRunning ? (
              <Button variant="destructive" onClick={handleStop} className="gap-2">
                Stop
              </Button>
            ) : (
              <Button
                onClick={handleRunCode}
                disabled={isWorkerLoading(language) || !isWorkerReady(language)}
                className="gap-2"
              >
                <Play size={18} weight="fill" />
                {isWorkerLoading(language) ? 'Loading Runtime...' : 'Run Code'}
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={35} minSize={20} maxSize={50}>
            <div className="h-full flex flex-col p-4">
              <ProblemDescription problem={problem} />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={65} minSize={30}>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={60} minSize={30}>
                <div className="h-full flex flex-col p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold">Code Editor</h3>
                    <div className="text-xs text-muted-foreground">{languageInfo[language].description}</div>
                  </div>
                  <CodeEditor value={code || ''} onChange={setCode} language={language} className="flex-1" />
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel defaultSize={40} minSize={20}>
                <div className="h-full flex flex-col overflow-hidden">
                  <Tabs value={testTab} onValueChange={(v) => setTestTab(v as 'testcases' | 'results')} className="flex-1 flex flex-col overflow-hidden">
                    <div className="border-b border-border px-4 py-2">
                      <TabsList className="grid w-full max-w-[400px] grid-cols-2">
                        <TabsTrigger value="testcases">Test Cases</TabsTrigger>
                        <TabsTrigger value="results">Results</TabsTrigger>
                      </TabsList>
                    </div>

                    <TabsContent value="testcases" className="flex-1 overflow-hidden mt-0 p-4 h-full">
                      <TestCaseManager 
                        defaultTestCases={problem.testCases}
                        customTestCases={customTestCases || []}
                        onCustomTestCasesChange={setCustomTestCases}
                      />
                    </TabsContent>

                    <TabsContent value="results" className="flex-1 overflow-hidden mt-0 p-4 h-full">
                      {result ? (
                        result.success && result.results ? (
                          <TestResults results={result.results} executionTime={result.executionTime} />
                        ) : (
                          <Alert variant="destructive">
                            <AlertDescription className="space-y-2">
                              <div className="font-semibold">Execution Error</div>
                              <pre className="console-output text-xs overflow-x-auto">{result.error}</pre>
                              {result.stack && (
                                <pre className="console-output text-xs overflow-x-auto opacity-70">{result.stack}</pre>
                              )}
                            </AlertDescription>
                          </Alert>
                        )
                      ) : (
                        <div className="flex-1 flex items-center justify-center text-muted-foreground">
                          <div className="text-center space-y-2">
                            <Play size={48} className="mx-auto opacity-30" />
                            <p className="text-sm">Run your code to see test results</p>
                          </div>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
