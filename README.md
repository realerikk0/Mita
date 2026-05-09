# Mita / 幂塔

Mita（幂塔）is a quiet desktop AI client built from a lean Jan fork. It keeps the upstream Tauri + Rust + React/TypeScript foundation, then focuses the product around Jingxing-compatible online chat, controlled auto-run conversations, and a future multi-agent workflow.

> 幂塔会安安静静地完成主人交代的工作。

## Status

Mita is under active development. The current local workspace is `/Volumes/Data/CodexProjects/silence`, and the active branch is `silence-main`, based on upstream Jan commit `17771a60b8dc89e8fdfcb486d7292e6c4b22cb9a`.

See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for the implementation plan, progress, migration notes, and verification history.

## What Is Included

- Desktop app shell based on Tauri, Rust, React, and TypeScript.
- Product identity: `Mita`, Chinese display name `幂塔`, bundle identifier `uk.jingxing.mita`, URL scheme `mita://`.
- Compatibility for legacy `silence://`, legacy Silence data/config, and upstream Jan data/config.
- Built-in Jingxing provider preset using `https://api.jingxing.uk/v1`.
- OpenAI-compatible model listing and chat completion path, plus a Responses API branch for tested native web search models.
- Auto-run v1 scaffold for single-thread round-based continuation.
- Reserved Mita multi-agent metadata and type surface for planner, worker, coordinator, and verifier roles.
- Mita Web Research MCP sidecar with legacy Silence Browser MCP and Jan Browser MCP migration compatibility.

## Development

### Prerequisites

- Node.js >= 20
- Corepack / Yarn 4.5.3
- Rust and Cargo
- Make
- Xcode on macOS for desktop packaging

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
corepack yarn test:core
corepack yarn test:web
corepack yarn workspace @janhq/web-app build
corepack yarn build:core
corepack yarn build:extensions
cargo test --manifest-path src-tauri/Cargo.toml
corepack yarn build:tauri
```

## Upstream

Mita is derived from [Jan](https://github.com/janhq/jan). Upstream package namespaces such as `@janhq/core`, `@janhq/web-app`, and attribution files are intentionally retained unless the fork fully replaces those packages. The upstream baseline is recorded in [UPSTREAM_JAN_COMMIT.md](UPSTREAM_JAN_COMMIT.md).

## License

This fork keeps the upstream project license terms. See [LICENSE](LICENSE).
