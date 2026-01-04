let isReady = false;

self.onmessage = async (e) => {
  const { type, requestId, code, testCases, executorMode } = e.data;
  
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
    if (executorMode) {
      const output = await executeRacket(code);
      
      const endTime = performance.now();
      const executionTime = Math.round(endTime - startTime);

      self.postMessage({
        success: true,
        logs: output,
        result: null,
        executionTime,
        requestId,
      });
    } else {
      const results = [];

      for (const testCase of testCases) {
        try {
          const wrappedCode = `
${code}

(solution ${JSON.stringify(testCase.input)})
`;

          const output = await executeRacket(wrappedCode);
          const actualResult = parseRacketOutput(output);
          
          const passed = JSON.stringify(actualResult) === JSON.stringify(testCase.expected);

          results.push({
            input: testCase.input,
            expected: testCase.expected,
            actual: actualResult,
            passed,
            logs: output,
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

class RacketInterpreter {
  constructor() {
    this.env = this.createGlobalEnv();
    this.output = [];
  }

  createGlobalEnv() {
    return {
      '+': (...args) => args.reduce((a, b) => a + b, 0),
      '-': (...args) => args.length === 1 ? -args[0] : args.reduce((a, b) => a - b),
      '*': (...args) => args.reduce((a, b) => a * b, 1),
      '/': (...args) => args.reduce((a, b) => a / b),
      '=': (a, b) => a === b,
      '<': (a, b) => a < b,
      '>': (a, b) => a > b,
      '<=': (a, b) => a <= b,
      '>=': (a, b) => a >= b,
      'eq?': (a, b) => a === b,
      'equal?': (a, b) => JSON.stringify(a) === JSON.stringify(b),
      'not': (a) => !a,
      'and': (...args) => args.every(x => x),
      'or': (...args) => args.some(x => x),
      'null?': (a) => a === null || (Array.isArray(a) && a.length === 0),
      'list': (...args) => args,
      'cons': (a, b) => [a, ...(Array.isArray(b) ? b : [b])],
      'car': (lst) => Array.isArray(lst) ? lst[0] : null,
      'cdr': (lst) => Array.isArray(lst) ? lst.slice(1) : null,
      'first': (lst) => Array.isArray(lst) ? lst[0] : null,
      'rest': (lst) => Array.isArray(lst) ? lst.slice(1) : [],
      'length': (lst) => Array.isArray(lst) ? lst.length : 0,
      'append': (...lsts) => lsts.flat(),
      'reverse': (lst) => Array.isArray(lst) ? [...lst].reverse() : lst,
      'map': (fn, lst) => lst.map(x => this.apply(fn, [x])),
      'filter': (fn, lst) => lst.filter(x => this.apply(fn, [x])),
      'apply': (fn, args) => this.apply(fn, args),
      'foldl': (fn, init, lst) => lst.reduce((acc, x) => this.apply(fn, [x, acc]), init),
      'foldr': (fn, init, lst) => [...lst].reverse().reduce((acc, x) => this.apply(fn, [x, acc]), init),
      'displayln': (...args) => {
        this.output.push(args.map(this.formatValue.bind(this)).join(' '));
        return null;
      },
      'display': (...args) => {
        this.output.push(args.map(this.formatValue.bind(this)).join(''));
        return null;
      },
      'newline': () => {
        this.output.push('');
        return null;
      },
      'number->string': (n) => String(n),
      'string->number': (s) => Number(s),
      'string-append': (...args) => args.join(''),
      'substring': (s, start, end) => s.substring(start, end),
      'string-length': (s) => s.length,
      'modulo': (a, b) => a % b,
      'remainder': (a, b) => a % b,
      'quotient': (a, b) => Math.floor(a / b),
      'abs': Math.abs,
      'max': Math.max,
      'min': Math.min,
      'expt': Math.pow,
      'sqrt': Math.sqrt,
      'floor': Math.floor,
      'ceiling': Math.ceil,
      'round': Math.round,
    };
  }

  formatValue(val) {
    if (val === true) return '#t';
    if (val === false) return '#f';
    if (val === null) return '\'()';
    if (Array.isArray(val)) return `'(${val.map(v => this.formatValue(v)).join(' ')})`;
    if (typeof val === 'string') return val;
    return String(val);
  }

  tokenize(code) {
    code = code.replace(/;[^\n]*/g, '');
    code = code.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ');
    return code.split(/\s+/).filter(t => t.length > 0);
  }

  parse(tokens) {
    if (tokens.length === 0) throw new Error('Unexpected EOF');
    
    const token = tokens.shift();
    
    if (token === '(') {
      const list = [];
      while (tokens[0] !== ')') {
        if (tokens.length === 0) throw new Error('Unexpected EOF - missing )');
        list.push(this.parse(tokens));
      }
      tokens.shift();
      return list;
    } else if (token === ')') {
      throw new Error('Unexpected )');
    } else {
      return this.atom(token);
    }
  }

  atom(token) {
    if (token === '#t') return true;
    if (token === '#f') return false;
    if (token === 'null' || token === '\'()') return null;
    if (token.startsWith('"') && token.endsWith('"')) {
      return token.slice(1, -1);
    }
    if (token.startsWith("'")) {
      return token.slice(1);
    }
    if (!isNaN(parseFloat(token))) return parseFloat(token);
    return token;
  }

  eval(expr, env = this.env) {
    if (typeof expr === 'string') {
      if (expr in env) return env[expr];
      throw new Error(`Undefined variable: ${expr}`);
    }
    
    if (!Array.isArray(expr)) {
      return expr;
    }

    if (expr.length === 0) {
      return null;
    }

    const [first, ...rest] = expr;

    if (first === 'define') {
      const [name, value] = rest;
      if (Array.isArray(name)) {
        const [fnName, ...params] = name;
        env[fnName] = { params, body: value, env };
        return null;
      }
      env[name] = this.eval(value, env);
      return null;
    }

    if (first === 'lambda') {
      const [params, body] = rest;
      return { params, body, env };
    }

    if (first === 'if') {
      const [test, conseq, alt] = rest;
      const testResult = this.eval(test, env);
      return this.eval(testResult ? conseq : alt, env);
    }

    if (first === 'cond') {
      for (const clause of rest) {
        const [test, result] = clause;
        if (test === 'else' || this.eval(test, env)) {
          return this.eval(result, env);
        }
      }
      return null;
    }

    if (first === 'let') {
      const [bindings, body] = rest;
      const newEnv = { ...env };
      for (const [name, value] of bindings) {
        newEnv[name] = this.eval(value, env);
      }
      return this.eval(body, newEnv);
    }

    if (first === 'quote') {
      return rest[0];
    }

    if (first === 'begin') {
      let result = null;
      for (const expr of rest) {
        result = this.eval(expr, env);
      }
      return result;
    }

    const fn = this.eval(first, env);
    const args = rest.map(arg => this.eval(arg, env));
    return this.apply(fn, args);
  }

  apply(fn, args) {
    if (typeof fn === 'function') {
      return fn(...args);
    }
    
    if (fn && typeof fn === 'object' && fn.params && fn.body) {
      const newEnv = { ...fn.env };
      fn.params.forEach((param, i) => {
        newEnv[param] = args[i];
      });
      return this.eval(fn.body, newEnv);
    }
    
    throw new Error(`Not a function: ${JSON.stringify(fn)}`);
  }

  run(code) {
    this.output = [];
    try {
      const tokens = this.tokenize(code);
      let result = null;
      
      while (tokens.length > 0) {
        const expr = this.parse(tokens);
        result = this.eval(expr);
      }
      
      return {
        result,
        output: this.output.join('\n')
      };
    } catch (error) {
      throw error;
    }
  }
}

async function executeRacket(code) {
  const interpreter = new RacketInterpreter();
  const result = interpreter.run(code);
  return result.output || (result.result !== null ? interpreter.formatValue(result.result) : '');
}

function parseRacketOutput(output) {
  try {
    const lines = output.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    
    if (lastLine === '#t') return true;
    if (lastLine === '#f') return false;
    if (lastLine === '\'()') return [];
    
    const numMatch = lastLine.match(/^-?\d+\.?\d*$/);
    if (numMatch) return parseFloat(numMatch[0]);
    
    const listMatch = lastLine.match(/^'\((.+)\)$/);
    if (listMatch) {
      return listMatch[1].split(/\s+/).map(x => {
        if (x === '#t') return true;
        if (x === '#f') return false;
        const num = parseFloat(x);
        return isNaN(num) ? x : num;
      });
    }
    
    return lastLine;
  } catch (e) {
    return output;
  }
}
