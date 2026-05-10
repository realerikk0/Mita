# Mita

Mita is a desktop AI chat client built on top of the Jan desktop stack. It keeps the Tauri, Rust, React, and TypeScript foundation while focusing on online model workflows, OpenAI-compatible providers, controlled auto-run conversations, web research, and future multi-agent capabilities.

> Chinese name: 幂塔

## Features

- Cross-platform desktop app powered by Tauri, Rust, React, TypeScript, and Vite.
- OpenAI-compatible provider support for model listing and chat completions.
- Built-in Jingxing-compatible provider preset.
- Native web-search path for supported online models.
- Local thread storage compatible with Jan-style conversations.
- Controlled auto-run conversations for iterative task continuation.
- Mita Web Research MCP sidecar for browser-assisted research workflows.
- Foundation for future multi-agent workflows.
- Data migration compatibility for selected upstream and legacy configurations.

## Tech Stack

- Desktop: Tauri 2, Rust
- Frontend: React, TypeScript, Vite
- Package manager: Yarn 4
- Testing: Vitest
- Local services and extensions: Rust, Node.js, MCP-compatible sidecars

## Getting Started

### Prerequisites

- Node.js 20 or later
- Yarn 4.5.3 via Corepack
- Rust and Cargo
- Make
- Platform build tools:
  - macOS: Xcode Command Line Tools
  - Windows: Microsoft C++ Build Tools
  - Linux: common desktop build dependencies for Tauri

### Install Dependencies

```bash
git clone https://github.com/realerikk0/Mita.git
cd Mita
corepack enable
yarn install
```

### Start The Desktop App

```bash
yarn dev
```

or:

```bash
make dev
```

## Common Commands

```bash
# Run all configured tests
yarn test

# Run web app tests
yarn test:web

# Build the web app
yarn build:web

# Build the desktop app
yarn build:tauri

# Build everything
yarn build
```

## Project Structure

```text
core/                 Shared core package
web-app/              React frontend
src-tauri/            Tauri desktop shell and Rust services
extensions/           Built-in extensions
mlx-server/           MLX runtime service
docs/                 Documentation site sources
autoqa/               Automation and QA scripts
```

## Upstream

Mita is derived from [Jan](https://github.com/janhq/jan). Some upstream package names, namespaces, and attribution files are intentionally retained while the fork evolves.

The upstream baseline is recorded in [UPSTREAM_JAN_COMMIT.md](UPSTREAM_JAN_COMMIT.md).

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening pull requests.

## License

This project keeps the upstream license terms. See [LICENSE](LICENSE).
