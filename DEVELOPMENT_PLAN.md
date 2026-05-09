# Mita / 幂塔 Development Plan

Last updated: 2026-05-08

## Product Direction

Mita（幂塔）is a desktop AI chat client for online model workflows. It is based on a lean Jan fork and keeps the upstream Tauri + Rust + React/TypeScript architecture, local thread storage, provider management, and streaming chat path.

The product goal is: "幂塔会安安静静地完成主人交代的工作". The agent identity is always `Mita`; Chinese UI may show `幂塔`.

## Baseline

- Upstream repository: `janhq/jan`
- Upstream branch: `main`
- Upstream commit: `17771a60b8dc89e8fdfcb486d7292e6c4b22cb9a`
- Local workspace: `/Volumes/Data/CodexProjects/silence`
- Current branch: `silence-main`
- Desktop stack: Tauri, Rust, React, TypeScript, Vite, Yarn 4
- Storage model: Jan-compatible `thread.json` plus `messages.jsonl`
- Primary API shape: OpenAI-compatible `/v1/models` and `/v1/chat/completions`

## Implementation Plan And Current Progress

### 1. App Identity And Packaging

Scope:

- Product name: `Mita`
- Chinese visible brand: `幂塔`
- Bundle identifier: `uk.jingxing.mita`
- URL scheme: `mita://`
- Legacy URL scheme: `silence://`
- CLI command: `mita`
- CLI package/bin: `mita-cli`
- Updater and release artifact naming: Mita-oriented

Current progress:

- Tauri product name, bundle identifiers, app titles, platform configs, Cargo metadata, Info.plist, URL schemes, resources, and CLI binary names have been moved to Mita.
- `silence://` is retained as a compatibility scheme for one migration cycle.
- Shell marker now writes `# Mita Local API Server`; cleanup still recognizes legacy Silence and Jan markers.
- Linux AppImage helper and build scripts now use Mita naming.

Remaining work:

- Rename remote GitHub repository/release channels from `Silence` to `Mita` when the repository migration is scheduled.
- Re-check final packaged artifact names after the next `build:tauri`.

### 2. Data And Configuration Migration

Scope:

- Canonical app data folder: `Mita`
- Canonical bundle data id: `uk.jingxing.mita`
- First launch should restore from Silence or Jan config if Mita config does not exist.
- Never delete old Silence data automatically.

Current progress:

- Rust app constants now expose Mita as canonical and keep legacy Silence/Jan constants.
- App config migration checks Mita first, then Silence human-readable data dir, then `uk.jingxing.silence`, then legacy Jan locations.
- Core browser API exposes `getMitaDataFolderPath`, while `getSilenceDataFolderPath` and `getJanDataFolderPath` remain compatibility wrappers.

Remaining work:

- Manual startup test using a real old Silence data folder to confirm provider keys, threads, assistants, and MCP settings migrate cleanly.

### 3. Agent Identity And Prompt

Scope:

- Default assistant id: `mita`
- Default assistant name: `Mita`
- Identity guard: "You are Mita"
- Never answer as Jan, Silence, Jan.ai, or Menlo Research.
- Migrate old `jan` / `silence` default assistants to Mita.

Current progress:

- Web default assistant and prompt guard are now Mita.
- Assistant extension default id/name/instructions are now Mita.
- Legacy assistant branding markers detect Jan and Silence prompts.
- Existing default assistant ids `jan` and `silence` are migrated into `mita`; if Mita already exists, old default assistant files are removed from the active list.

Remaining work:

- Run a live chat smoke test asking "你是谁" after rebuilding extensions and launching the desktop app.

### 4. Web UI And Locale Sweep

Scope:

- Chinese locale should display `幂塔`.
- English and non-Chinese locales should display `Mita`.
- Setup, chat, settings, analytics, provider, MCP, errors, toasts, empty states, tests, and visible assets should not show Silence except as legacy compatibility text.

Current progress:

- Setup and chat surfaces have been moved to Mita/幂塔.
- `jan-logo.png` has been renamed to `mita-logo.png`; the image content is temporarily reused.
- Chinese locale visible brand strings now use `幂塔`.
- Non-Chinese locale visible brand strings now use `Mita`.

Remaining work:

- Run full web tests and a fresh-user desktop walkthrough.
- Replace the placeholder logo artwork when final Mita visual identity is ready.

### 5. Jingxing Provider

Scope:

- Keep provider name `Jingxing`.
- Base URL: `https://api.jingxing.uk/v1`
- Help link: `https://jingxing.uk/`
- Use Bearer token authentication through the existing provider settings UI.
- Load models through `GET /models`.
- Send standard chat through OpenAI-compatible chat completions.

Current progress:

- Provider preset and setup screen are implemented.
- Jingxing model capability overrides hide non-chat image models from the chat selector.
- Provider setup includes a Jingxing website link for registration/recharge guidance.

Remaining work:

- Re-run provider smoke tests after the Mita rename build.

### 6. Auto-Run V1

Scope:

- Single-thread round-based continuation.
- Start, pause, resume, and stop.
- New metadata keys:
  - `metadata.mitaAutoRun`
  - `metadata.mita`
- Legacy reads:
  - `metadata.silenceAutoRun`
  - `metadata.silence`

Current progress:

- Auto-run store and chat integration are in place.
- Thread metadata now writes `mitaAutoRun`.
- Generated auto-run messages now write Mita metadata.
- Legacy Silence metadata is still read for migration compatibility.

Remaining work:

- Manual test 3-round and 10-round runs after the next desktop launch.
- Add regression tests for pause/resume/stop if behavior changes.

### 7. Multi-Agent Preparation

Scope:

- Type prefix: `MitaAgent*`
- Roles:
  - `planner`
  - `worker`
  - `coordinator`
  - `verifier`
- New metadata key: `metadata.mitaAgents`
- Legacy read key: `metadata.silenceAgents`

Current progress:

- `web-app/src/types/mita-agent.ts` defines the reserved type surface.
- New threads write `mitaAgents`.
- Existing threads can still read `silenceAgents`.

Remaining work:

- Build the actual multi-agent executor.
- Decide whether orchestration runs in frontend, Rust backend, or a hybrid.

### 8. Web Research And MCP

Scope:

- New visible server name: `Mita Web Research`
- New runtime command/profile/env:
  - `mita-web-research`
  - `~/.mita-web-research`
  - `MITA_WEB_RESEARCH_*`
- Legacy compatibility:
  - `Silence Web Research`
  - `Silence Browser MCP`
  - `Jan Browser MCP`
- Do not copy old browser profiles automatically.

Current progress:

- Tauri resources and scripts have been renamed to `mita-web-research-mcp.mjs`.
- Browser profile is now independent at `~/.mita-web-research`.
- MCP config migration normalizes legacy Silence/Jan keys into Mita.
- Tauri commands now include Mita commands plus Silence/Jan compatibility wrappers.
- Frontend hook/test names have been moved to Mita.

Remaining work:

- Manual test the Web Search toggle with Mita Web Research after desktop launch.

### 9. Product Simplification

Scope:

- Keep chat, provider setup, settings, threads, MCP, auto-run, and web search as primary surfaces.
- Continue hiding or de-emphasizing heavy Jan-first local model/Hub experiences in v1.

Current progress:

- Primary onboarding now focuses on provider setup.
- Non-text-generation models are hidden from chat selection.
- Chrome extension based Jan search path has been replaced by Mita Web Research planning/runtime work.

Remaining work:

- Full fresh-user walkthrough after build.

## Verification Plan

Target checks:

```bash
corepack yarn install
corepack yarn test:core
corepack yarn test:web
corepack yarn workspace @janhq/web-app build
corepack yarn build:core
corepack yarn build:extensions
cargo test --manifest-path src-tauri/Cargo.toml
corepack yarn build:tauri
```

Current local verification on 2026-05-08:

- `corepack yarn install` passed with existing peer dependency warnings.
- `corepack yarn test:web` passed.
- `corepack yarn workspace @janhq/web-app build` passed with existing Vite chunk/dynamic import warnings.
- `corepack yarn build:core` passed and refreshed `core/package.tgz` for extension consumers.
- `corepack yarn build:extensions` passed; Tauri plugin imports remain external by design.
- `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features test-tauri --lib` passed with 256 tests.
- Full `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features test-tauri` ran all unit tests successfully, then failed only at rustdoc doctest setup because this toolchain requires `-Z unstable-options` for `check-cfg`.
- Bare `corepack yarn tauri build` compiled the app but failed at bundling because it skips the project script that builds `mita-cli`; use `corepack yarn build:tauri` instead.
- `corepack yarn build:tauri` passed and produced:
  - `src-tauri/target/universal-apple-darwin/release/bundle/macos/Mita.app`
  - `src-tauri/target/universal-apple-darwin/release/bundle/dmg/Mita_0.6.599_universal.dmg`

Manual checks:

- Fresh user launch shows `幂塔` in Chinese UI and `Mita` in system surfaces.
- Existing Silence data starts without losing threads, provider config, API key, MCP config, and assistants.
- Asking "你是谁" returns Mita/幂塔, never Jan/Silence/Menlo.
- `mita://` works and `silence://` still routes.
- Mita Web Research starts with an isolated profile and does not read system Chrome cookies.

## Static Scan Policy

Allowed remaining `Jan` references:

- Upstream package scopes such as `@janhq/core` and `@janhq/web-app`.
- Upstream attribution and license/history files.
- Legacy migration constants, tests, and compatibility wrappers.
- Model ids or provider ids that are genuinely named `jan`.

Allowed remaining `Silence` references:

- Legacy migration constants and compatibility wrappers.
- Historical development notes or upstream attribution.
- `silence://` compatibility.
- Legacy metadata read paths such as `silenceAutoRun` and `silenceAgents`.
