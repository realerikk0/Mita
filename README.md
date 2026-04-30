# Silence

Silence is a quiet desktop AI client built from a lean Jan fork. It keeps Jan's solid Tauri + Rust + React/TypeScript foundation, then focuses the product around Jingxing-compatible online chat, controlled auto-run conversations, and a future multi-agent workflow.

> 安安静静地完成主人交代的工作。

## Status

Silence is under active development. The current branch is `silence-main`, based on upstream Jan commit `17771a60b8dc89e8fdfcb486d7292e6c4b22cb9a`.

See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for the full implementation plan, progress, and verification history.

## What Is Included

- Desktop app shell based on Tauri, Rust, React, and TypeScript.
- Built-in Jingxing provider preset using `https://api.jingxing.uk/v1`.
- OpenAI-compatible model listing and chat completion path.
- Auto-run v1 scaffold for single-thread round-based continuation.
- Reserved multi-agent metadata and type surface for planner, worker, coordinator, and verifier roles.
- Silence branding across app identifiers, desktop metadata, CLI naming, and major runtime strings.
- Silence Browser MCP naming with legacy Jan Browser MCP migration compatibility.

## Development

### Prerequisites

- Node.js >= 20
- Corepack / Yarn 4.5.3
- Rust and Cargo
- Make

### Install

```bash
corepack enable
yarn install
```

### Run

```bash
yarn dev
```

or:

```bash
make dev
```

### Useful Checks

```bash
cargo test --manifest-path src-tauri/Cargo.toml core::app --no-default-features --features test-tauri
cargo test --manifest-path src-tauri/Cargo.toml core::system --no-default-features --features test-tauri
cargo test --manifest-path src-tauri/Cargo.toml mcp --no-default-features --features test-tauri
corepack yarn workspace @janhq/web-app lint
corepack yarn workspace @janhq/web-app build
```

## Upstream

Silence is derived from [Jan](https://github.com/janhq/jan). Upstream attribution and baseline information are recorded in [UPSTREAM_JAN_COMMIT.md](UPSTREAM_JAN_COMMIT.md).

## License

This fork keeps the upstream project license terms. See [LICENSE](LICENSE).
