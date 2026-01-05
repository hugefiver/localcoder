use std::io::{self, Read};

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Mode {
    Executor,
    Test,
}

#[derive(Debug, Deserialize)]
struct Request {
    mode: Mode,
    code: String,
    input: Option<serde_json::Value>,
}

fn wrap_executor(code: &str) -> String {
    // NOTE: capture stdout/stderr in Python-level (best effort).
    format!(
        r#"import json
import sys

_logs = []

def _lc_write(*args):
    try:
        _logs.append(' '.join(str(a) for a in args))
    except Exception:
        _logs.append('[log error]')

class _LCStdout:
    def write(self, s):
        if s is None:
            return 0
        # splitlines keeps output readable
        for line in str(s).splitlines():
            if line != '':
                _logs.append(line)
        return len(str(s))
    def flush(self):
        return None

_old_out, _old_err = sys.stdout, sys.stderr
sys.stdout, sys.stderr = _LCStdout(), _LCStdout()

try:
{code}
    _result = None
    _err = None
except Exception as e:
    _result = None
    _err = repr(e)

sys.stdout, sys.stderr = _old_out, _old_err

print(json.dumps({{"logs": "\\n".join(_logs), "result": _result, "error": _err}}))
"#,
        code = indent(code, 4)
    )
}

fn wrap_test(code: &str, input_json: &str) -> String {
    // Test contract: user defines solution(input) and we call it.
    format!(
        r#"import json
import sys

_logs = []

class _LCStdout:
    def write(self, s):
        if s is None:
            return 0
        for line in str(s).splitlines():
            if line != '':
                _logs.append(line)
        return len(str(s))
    def flush(self):
        return None

_old_out, _old_err = sys.stdout, sys.stderr
sys.stdout, sys.stderr = _LCStdout(), _LCStdout()

try:
{code}
    _input_data = json.loads(r'''{input_json}''')
    _result = solution(_input_data)
    _err = None
except Exception as e:
    _result = None
    _err = repr(e)

sys.stdout, sys.stderr = _old_out, _old_err

print(json.dumps({{"logs": "\\n".join(_logs), "result": _result, "error": _err}}))
"#,
        code = indent(code, 4),
        input_json = input_json
    )
}

fn indent(s: &str, spaces: usize) -> String {
    let pad = " ".repeat(spaces);
    s.lines()
        .map(|l| {
            if l.trim().is_empty() {
                String::new()
            } else {
                format!("{}{}", pad, l)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn main() {
    let mut stdin = String::new();
    io::stdin().read_to_string(&mut stdin).unwrap_or(0);

    let req: Request = match serde_json::from_str(&stdin) {
        Ok(v) => v,
        Err(e) => {
            let out = serde_json::json!({
                "logs": "",
                "result": serde_json::Value::Null,
                "error": format!("Invalid input JSON: {e}")
            });
            println!("{}", out);
            return;
        }
    };

    let input_json = req
        .input
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "null".to_string()))
        .unwrap_or_else(|| "null".to_string());

    let program = match req.mode {
        Mode::Executor => wrap_executor(&req.code),
        Mode::Test => wrap_test(&req.code, &input_json),
    };

    // Run with RustPython
    // NOTE: The exact API surface may vary across RustPython versions.
    // We keep it minimal and rely on stdlib modules where possible.
    let interpreter = rustpython_vm::Interpreter::default();
    interpreter.enter(|vm| {
        let scope = vm.new_scope_with_builtins();
        let res = vm.run_code_string(scope, program, "<localcoder>".to_owned());
        if let Err(err) = res {
            let msg = err.to_string();
            let out = serde_json::json!({
                "logs": "",
                "result": serde_json::Value::Null,
                "error": msg,
            });
            println!("{}", out);
        }
    });
}
