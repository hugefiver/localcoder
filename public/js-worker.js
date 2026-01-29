let isReady = false;

self.onmessage = async (e) => {
  const { type, requestId, code, language, testCases, executorMode } = e.data;
  
  if (type === 'preload') {
    if (!isReady) {
      isReady = true;
    }
    self.postMessage({ type: 'ready', requestId });
    return;
  }

  if (!isReady) {
    isReady = true;
    self.postMessage({ type: 'ready' });
  }
  
  const startTime = performance.now();

  try {
    let results = [];
    let logs = '';
    let result = undefined;

    if (executorMode) {
      if (language === 'javascript') {
        const output = await runJavaScriptExecutor(code);
        logs = output.logs;
        result = output.result;
      } else if (language === 'typescript') {
        const output = await runTypeScriptExecutor(code);
        logs = output.logs;
        result = output.result;
      }

      const endTime = performance.now();
      const executionTime = Math.round(endTime - startTime);

      self.postMessage({
        success: true,
        logs,
        result,
        executionTime,
        requestId,
      });
    } else {
      if (language === 'javascript') {
        results = await runJavaScript(code, testCases);
      } else if (language === 'typescript') {
        results = await runTypeScript(code, testCases);
      }

      const endTime = performance.now();
      const executionTime = Math.round(endTime - startTime);

      self.postMessage({
        success: true,
        results,
        executionTime,
        output: '',
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

async function runJavaScript(code, testCases) {
  const results = [];
  
  for (const testCase of testCases) {
    try {
      const logs = [];
      const originalLog = console.log;
      console.log = (...args) => {
        logs.push(args.map(arg => String(arg)).join(' '));
      };

      const func = new Function('input', `
        ${code}
        const result = solution(input);
        return result;
      `);

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Execution timeout (5s)')), 5000);
      });

      const execPromise = Promise.resolve(func(testCase.input));
      const output = await Promise.race([execPromise, timeoutPromise]);

      console.log = originalLog;

      const passed = JSON.stringify(output) === JSON.stringify(testCase.expected);

      results.push({
        input: testCase.input,
        expected: testCase.expected,
        actual: output,
        passed,
        logs: logs.join('\n'),
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

  return results;
}

async function runTypeScript(code, testCases) {
  const jsCode = stripTypeScript(code);

  return runJavaScript(jsCode, testCases);
}

async function runJavaScriptExecutor(code) {
  const logs = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  
  console.log = (...args) => {
    logs.push(args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' '));
  };
  
  console.error = (...args) => {
    logs.push('ERROR: ' + args.map(arg => String(arg)).join(' '));
  };
  
  console.warn = (...args) => {
    logs.push('WARN: ' + args.map(arg => String(arg)).join(' '));
  };

  try {
    const func = new Function(`
      ${code}
      return typeof solution !== 'undefined' ? solution : undefined;
    `);

    const result = func();
    
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;

    return {
      logs: logs.join('\n'),
      result: result,
    };
  } catch (error) {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    throw error;
  }
}

async function runTypeScriptExecutor(code) {
  const jsCode = stripTypeScript(code);

  return runJavaScriptExecutor(jsCode);
}

function stripTypeScript(code) {
  return code
    .replace(/interface\s+\w+\s*{[^}]*}/gs, '')
    .replace(/type\s+\w+\s*=\s*[^;]+;/gs, '')
    .replace(/enum\s+\w+\s*{[^}]*}/gs, '')
    .replace(/(\b(?:let|const|var)\s+\w+)\s*:\s*\w+(\[\])?\s*;/g, '$1 = [];')
    .replace(/:\s*\w+(\[\])?/g, '');
}
