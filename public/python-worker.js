importScripts('./pyodide/pyodide.js');

let pyodide = null;
let isInitializing = false;
let initError = null;

async function initPyodide(readyRequestId) {
  if (pyodide) {
    return pyodide;
  }
  
  if (initError) {
    throw initError;
  }
  
  if (!isInitializing) {
    isInitializing = true;
    self.postMessage({
      type: 'status',
      message: 'Initializing Python environment (first run may take 10-15 seconds)...'
    });
    
    try {
      const baseURL = self.location.origin + self.location.pathname.replace(/\/[^\/]*$/, '/');
      
      pyodide = await loadPyodide({
        indexURL: baseURL + 'pyodide/',
      });
      
      isInitializing = false;
      self.postMessage({
        type: 'ready',
        message: 'Python environment ready',
        requestId: readyRequestId,
      });
      
      return pyodide;
    } catch (error) {
      isInitializing = false;
      initError = error;
      self.postMessage({
        success: false,
        error: `Failed to initialize Pyodide: ${error.message}`,
      });
      throw error;
    }
  }
  
  while (isInitializing) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  if (initError) {
    throw initError;
  }
  
  return pyodide;
}

self.onmessage = async (e) => {
  const { type, requestId, code, testCases, executorMode } = e.data;

  if (type === 'preload') {
    try {
      await initPyodide(requestId);
    } catch (error) {
      self.postMessage({
        success: false,
        error: error.message,
        stack: error.stack,
        requestId,
      });
    }
    return;
  }

  const startTime = performance.now();

  try {
    const py = await initPyodide();
    
    if (executorMode) {
      const executorCode = `
import json
import sys
from io import StringIO

captured_output = StringIO()
sys.stdout = captured_output

${code}

sys.stdout = sys.__stdout__
output_logs = captured_output.getvalue()

json.dumps({"logs": output_logs})
`;

      const output = await py.runPythonAsync(executorCode);
      const parsed = JSON.parse(output);
      
      const endTime = performance.now();
      const executionTime = Math.round(endTime - startTime);

      self.postMessage({
        success: true,
        logs: parsed.logs,
        result: null,
        executionTime,
        requestId,
      });
    } else {
      const results = [];

      for (const testCase of testCases) {
        try {
          const testCode = `
import json
import sys
from io import StringIO

${code}

captured_output = StringIO()
sys.stdout = captured_output

input_data = json.loads('''${JSON.stringify(testCase.input)}''')
result = solution(input_data)

sys.stdout = sys.__stdout__
output_logs = captured_output.getvalue()

json.dumps({"result": result, "logs": output_logs})
`;

          const output = await py.runPythonAsync(testCode);
          const parsed = JSON.parse(output);
          const actualResult = parsed.result;
          const logs = parsed.logs;

          const passed = JSON.stringify(actualResult) === JSON.stringify(testCase.expected);

          results.push({
            input: testCase.input,
            expected: testCase.expected,
            actual: actualResult,
            passed,
            logs,
          });
        } catch (error) {
          results.push({
            input: testCase.input,
            expected: testCase.expected,
            actual: null,
            passed: false,
            error: error.message,
          });
        }
      }

      const endTime = performance.now();
      const executionTime = Math.round(endTime - startTime);

      self.postMessage({
        success: true,
        results,
        executionTime,
        requestId,
      });
    }
  } catch (error) {
    self.postMessage({
      success: false,
      error: error.message,
      stack: error.stack,
      requestId,
    });
  }
};
