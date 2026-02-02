use std::io::{self, Read};

use serde::Deserialize;
use rustpython_vm::{AsObject, Interpreter, Settings};
use rustpython_vm::common::rc::PyRc;

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
    // NOTE: Embed stdlib (frozen) so imports like json/collections work under WASI.
    let mut builder = Interpreter::builder(Settings::default());
    let stdlib_defs = rustpython_stdlib::stdlib_module_defs(&builder.ctx);
    builder = builder
        .add_native_modules(&stdlib_defs)
        .add_frozen_modules(rustpython_pylib::FROZEN_STDLIB)
        .init_hook(|vm| {
            let state = PyRc::get_mut(&mut vm.state).unwrap();
            state.config.paths.stdlib_dir = Some(rustpython_pylib::LIB_PATH.to_owned());
        });
    let interpreter = builder.build();
    interpreter.enter(|vm| {
        let scope = vm.new_scope_with_builtins();
        let res = vm.run_string(scope, &program, "<localcoder>".to_owned());
        if let Err(err) = res {
            let msg = err
                .as_object()
                .str(vm)
                .map(|s| s.as_str().to_owned())
                .unwrap_or_else(|_| "Python error".to_owned());
            let out = serde_json::json!({
                "logs": "",
                "result": serde_json::Value::Null,
                "error": msg,
            });
            println!("{}", out);
        }
    });
}
