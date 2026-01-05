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
    #[allow(dead_code)]
    code: Option<String>,
    #[allow(dead_code)]
    input: Option<serde_json::Value>,
}

fn main() {
    // Read stdin (ignore parse errors; still output a valid JSON payload)
    let mut stdin = String::new();
    let _ = io::stdin().read_to_string(&mut stdin);

    let _req: Option<Request> = serde_json::from_str(&stdin).ok();

    let out = serde_json::json!({
        "logs": "Haskell runtime stub (replace public/haskell/runner.wasm with a real runner)",
        "result": serde_json::Value::Null
    });

    println!("{}", out);
}
