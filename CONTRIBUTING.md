# Contributing to Biyan

Thanks for helping improve Biyan (彼岩), a remote-provider desktop AI client.

## Development setup

Requirements:

- Node.js 20
- Yarn 4.5.3 through Corepack
- Rust stable
- The platform dependencies required by Tauri 2

```bash
corepack enable
yarn install
yarn build:core
yarn build:extensions
yarn dev:tauri
```

## Before opening a pull request

```bash
yarn lint
yarn test
yarn build:web
node scripts/ci/verify-release-policy.mjs
```

Changes to migration, updater, extension installation, or release packaging must
also include failure-path tests. Never publish a workspace package publicly,
embed credentials, add a local-model runtime, or bypass the signed updater
promotion process.

Please keep pull requests focused, explain user-visible behavior, and preserve
all existing license and attribution files.
