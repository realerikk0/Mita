use clap::Parser;
use std::ffi::OsString;

const RETIRED_CODE: &str = "LOCAL_RUNTIME_REMOVED";

/// Compatibility CLI shipped during the Biyan migration.
///
/// Local model download, loading, serving, and chat commands were retired.
/// Remote providers are configured in the Biyan desktop application.
#[derive(Debug, Parser)]
#[command(name = "biyan", version, disable_help_subcommand = true)]
struct Cli {
    /// Legacy command and arguments. They are accepted only to return a stable
    /// retirement error instead of downloading a model or starting a service.
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    command: Vec<OsString>,
}

fn main() {
    let cli = Cli::parse();
    if cli.command.is_empty() {
        println!(
            "Biyan is remote-provider only. Configure a provider and model in the desktop app."
        );
        return;
    }

    eprintln!(
        "{RETIRED_CODE}: local model CLI commands have been retired; no model was downloaded and no local service was started."
    );
    std::process::exit(78);
}
