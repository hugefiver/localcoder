let isReady = false;

/**
 * NOTE
 * ----
 * This worker intentionally implements a small, Racket-9-compatible *subset*
 * that is sufficient for the built-in problems and executor experience.
 * It supports:
 * - #lang racket (ignored)
 * - quote shorthand (')
 * - lists, numbers, booleans, strings
 * - define / lambda / if / cond / let / begin
 * - hash / hash-ref (backed by JS Map)
 */

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
      const { output, result } = await executeRacket(code);
      
      const endTime = performance.now();
      const executionTime = Math.round(endTime - startTime);

      self.postMessage({
        success: true,
        logs: output,
        result: result !== undefined ? formatValue(result) : null,
        executionTime,
        requestId,
      });
    } else {
      const results = [];

      for (const testCase of testCases) {
        try {
          const inputExpr = jsToRacketExpr(testCase.input);
          const wrappedCode = `${code}\n\n(solution ${inputExpr})\n`;

          const { output, result } = await executeRacket(wrappedCode);
          const actualResult = normalizeForJson(result);
          const expectedResult = normalizeForJson(testCase.expected);

          const passed = stableStringify(actualResult) === stableStringify(expectedResult);

          results.push({
            input: testCase.input,
            expected: testCase.expected,
            actual: actualResult,
            passed,
            logs: output || (result !== undefined ? formatValue(result) : ''),
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

function stableStringify(value) {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      // Ensure stable key ordering for objects.
      return Object.keys(v)
        .sort()
        .reduce((acc, key) => {
          acc[key] = v[key];
          return acc;
        }, {});
    }
    return v;
  });
}

function jsToRacketExpr(value) {
  if (value === null || value === undefined) return "'()";
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite number is not supported');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '#t' : '#f';
  if (typeof value === 'string') return `"${escapeRacketString(value)}"`;
  if (Array.isArray(value)) {
    return `(list ${value.map(jsToRacketExpr).join(' ')})`;
  }
  if (typeof value === 'object') {
    // Serialize plain objects as (hash 'k v 'k2 v2 ...)
    const entries = Object.entries(value);
    const parts = [];
    for (const [k, v] of entries) {
      // Use symbol keys for typical LeetCode-like inputs
      if (!isValidSymbolName(k)) {
        // Fallback to string keys
        parts.push(`"${escapeRacketString(k)}"`, jsToRacketExpr(v));
      } else {
        parts.push(`'${k}`, jsToRacketExpr(v));
      }
    }
    return `(hash ${parts.join(' ')})`;
  }
  throw new Error(`Unsupported input type: ${typeof value}`);
}

function isValidSymbolName(name) {
  // Conservative: letters/digits/_-? and can't start with a digit.
  return /^[A-Za-z_+\-*/?<>=!$%&^~][A-Za-z0-9_+\-*/?<>=!$%&^~]*$/.test(name);
}

function escapeRacketString(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function normalizeForJson(value) {
  if (value instanceof Sym) return value.name;
  if (value instanceof Str) return value.value;
  if (value instanceof Map) {
    const obj = {};
    for (const [k, v] of value.entries()) {
      obj[String(k)] = normalizeForJson(v);
    }
    return obj;
  }
  if (Array.isArray(value)) return value.map(normalizeForJson);
  if (value && typeof value === 'object') {
    const obj = {};
    for (const [k, v] of Object.entries(value)) obj[k] = normalizeForJson(v);
    return obj;
  }
  return value;
}

class Sym {
  constructor(name) {
    this.name = name;
  }
}

class Str {
  constructor(value) {
    this.value = value;
  }
}

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

      // Hashes (a subset of Racket hash API)
      'hash': (...args) => {
        if (args.length % 2 !== 0) throw new Error('hash: expected even number of arguments');
        const m = new Map();
        for (let i = 0; i < args.length; i += 2) {
          const key = this.normalizeHashKey(args[i]);
          m.set(key, args[i + 1]);
        }
        return m;
      },
      'hash-ref': (h, key, defaultValue) => {
        const k = this.normalizeHashKey(key);
        if (h instanceof Map) {
          if (h.has(k)) return h.get(k);
        } else if (h && typeof h === 'object') {
          if (Object.prototype.hasOwnProperty.call(h, k)) return h[k];
        } else {
          throw new Error('hash-ref: expected a hash');
        }
        if (defaultValue !== undefined) return defaultValue;
        throw new Error(`hash-ref: no value found for key ${this.formatValue(key)}`);
      },

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

  normalizeHashKey(key) {
    if (key instanceof Sym) return key.name;
    if (typeof key === 'string') return key;
    if (typeof key === 'number' || typeof key === 'boolean') return String(key);
    return stableStringify(normalizeForJson(key));
  }

  formatValue(val) {
    if (val === true) return '#t';
    if (val === false) return '#f';
    if (val instanceof Str) return val.value;
    if (val instanceof Sym) return val.name;
    if (Array.isArray(val)) {
      if (val.length === 0) return "'()";
      return `'(${val.map(v => this.formatValue(v)).join(' ')})`;
    }
    if (val instanceof Map) {
      const parts = [];
      for (const [k, v] of val.entries()) {
        parts.push(`${String(k)}: ${this.formatValue(v)}`);
      }
      return `#hash(${parts.join(', ')})`;
    }
    if (typeof val === 'string') return val;
    return String(val);
  }

  tokenize(code) {
    // Drop #lang line(s)
    code = code
      .split('\n')
      .filter(line => !line.trim().startsWith('#lang'))
      .join('\n');

    // Racket treats [] like (), so normalize them for our reader.
    code = code.replace(/\[/g, '(').replace(/\]/g, ')');

    const tokens = [];
    let i = 0;
    while (i < code.length) {
      const ch = code[i];

      // whitespace
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i++;
        continue;
      }

      // comment
      if (ch === ';') {
        while (i < code.length && code[i] !== '\n') i++;
        continue;
      }

      if (ch === '(' || ch === ')' || ch === "'") {
        tokens.push(ch);
        i++;
        continue;
      }

      // string
      if (ch === '"') {
        let j = i + 1;
        let out = '';
        while (j < code.length) {
          const cj = code[j];
          if (cj === '"') break;
          if (cj === '\\') {
            const next = code[j + 1];
            if (next === 'n') out += '\n';
            else if (next === 'r') out += '\r';
            else if (next === 't') out += '\t';
            else if (next === '"') out += '"';
            else if (next === '\\') out += '\\';
            else out += next;
            j += 2;
            continue;
          }
          out += cj;
          j++;
        }
        if (j >= code.length || code[j] !== '"') {
          throw new Error('Unterminated string literal');
        }
        tokens.push(`"${out}"`);
        i = j + 1;
        continue;
      }

      // atom
      let j = i;
      while (j < code.length) {
        const cj = code[j];
        if (cj === ' ' || cj === '\t' || cj === '\n' || cj === '\r' || cj === '(' || cj === ')' || cj === ';' || cj === "'") break;
        j++;
      }
      tokens.push(code.slice(i, j));
      i = j;
    }
    return tokens.filter(t => t.length > 0);
  }

  parse(tokens) {
    if (tokens.length === 0) throw new Error('Unexpected EOF');
    
    const token = tokens.shift();

    if (token === "'") {
      return ['quote', this.parse(tokens)];
    }
    
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
    if (token.startsWith('"') && token.endsWith('"')) {
      return new Str(token.slice(1, -1));
    }
    if (!isNaN(parseFloat(token))) return parseFloat(token);
    return token;
  }

  eval(expr, env = this.env) {
    if (expr instanceof Sym) {
      return expr;
    }
    if (expr instanceof Str) {
      return expr.value;
    }
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
      return this.quoteToDatum(rest[0]);
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

  quoteToDatum(expr) {
    if (expr instanceof Sym) return expr;
    if (expr instanceof Str) return expr.value;
    if (typeof expr === 'string') return new Sym(expr);
    if (Array.isArray(expr)) return expr.map(e => this.quoteToDatum(e));
    return expr;
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
  return {
    result: result.result === null ? undefined : result.result,
    output: result.output,
  };
}

function formatValue(val) {
  // Convenience wrapper for places outside the interpreter instance
  const i = new RacketInterpreter();
  return i.formatValue(val);
}
