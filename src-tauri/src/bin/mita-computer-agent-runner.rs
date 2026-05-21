//! Computer Agent shell runner.
//!
//! The native execution path still requires an internal broker marker
//! (`MITA_COMPUTER_AGENT_RUNNER_EXECUTE=1`); the desktop app sets that marker only
//! when it invokes the runner for an approved shell command.

use std::io::{self, Read};

use app_lib::core::computer_agent::windows_runner::{
    error_response, execute_runner_request, preflight_response, RunnerRequest,
};

fn main() {
    let response = match std::env::args().nth(1).as_deref() {
        Some("--self-test") | Some("self-test") | Some("preflight") => preflight_response(),
        Some("--run") | Some("run") | None => run_from_stdin(),
        Some(other) => error_response(format!("Unknown runner argument '{other}'")),
    };

    match serde_json::to_string_pretty(&response) {
        Ok(json) => println!("{json}"),
        Err(error) => {
            eprintln!("Failed to serialize runner response: {error}");
            std::process::exit(1);
        }
    }
}

fn run_from_stdin() -> app_lib::core::computer_agent::windows_runner::RunnerResponse {
    let mut input = String::new();
    if let Err(error) = io::stdin().read_to_string(&mut input) {
        return error_response(format!("Failed to read runner request: {error}"));
    }

    let request: RunnerRequest = match serde_json::from_str(&input) {
        Ok(request) => request,
        Err(error) => return error_response(format!("Invalid runner request JSON: {error}")),
    };

    execute_runner_request(request)
}
