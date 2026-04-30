# Silence Development Plan

Last updated: 2026-04-30

## Product Direction

Silence is a desktop AI chat client for online model workflows. It is based on a lean Jan fork and keeps the upstream Tauri + Rust + React/TypeScript architecture, local thread storage, provider management, and streaming chat path.

The product goal is simple: "安安静静地完成主人交代的工作". The first version should feel focused, quiet, and task-oriented rather than like a full local-model hub.

## Baseline

- Upstream repository: `janhq/jan`
- Upstream branch: `main`
- Upstream commit: `17771a60b8dc89e8fdfcb486d7292e6c4b22cb9a`
- Silence branch: `silence-main`
- Desktop stack: Tauri, Rust, React, TypeScript, Vite, Yarn 4
- Storage model: Jan-compatible `thread.json` plus `messages.jsonl`
- Primary API shape: OpenAI-compatible `/v1/models` and `/v1/chat/completions`

## Architecture Plan

### 1. Project Initialization

- Keep the current Jan fork in `/Volumes/Data/CodexProjects/silence`.
- Use `silence-main` as the main development branch.
- Preserve the upstream baseline in `UPSTREAM_JAN_COMMIT.md`.
- Keep the upstream directory structure:
  - `src-tauri/` for desktop shell, Rust commands, app identifiers, MCP runtime, CLI bridge.
  - `web-app/` for React UI, provider setup, chat UX, auto-run controls.
  - `core/` for shared Jan core packages.

Current progress: done.

### 2. Branding And App Identity

Implementation scope:

- Rename desktop product to `Silence`.
- Change Tauri bundle identifier to `uk.jingxing.silence`.
- Change platform-specific identifiers:
  - macOS/iOS plist and Tauri config
  - Android config
  - Windows/Linux bundle metadata
- Rename CLI entrypoint from Jan-oriented naming to Silence-oriented naming.
- Update visible UI copy from Jan to Silence where it appears in the primary app surface.
- Keep legacy Jan constants only when needed for migration or cleanup.

Current progress:

- `src-tauri/tauri.conf.json` product name and identifier updated.
- `src-tauri/Info.plist` uses `uk.jingxing.silence` and `silence://`.
- iOS and Android identifiers updated.
- Rust app constants now expose `APP_NAME = "Silence"` and `SILENCE_DATA_*`.
- Legacy `Jan` and `jan.ai.app` constants remain only for migration.
- Claude Code shell environment marker now writes `Silence Local API Server`, while cleanup still recognizes old `Jan Local API Server` blocks.
- Root `README.md` now describes Silence instead of upstream Jan.

Remaining work:

- Sweep lower-priority docs, localized READMEs, historical changelog text, and package metadata that still intentionally or incidentally reference Jan.
- Decide whether internal Rust helper names like `get_jan_data_folder_path` should be renamed now or kept temporarily to reduce churn.

### 3. Jingxing Provider

Implementation scope:

- Add a built-in `jingxing` provider preset.
- Default base URL: `https://api.jingxing.uk/v1`.
- Use Bearer token authentication through the existing provider settings UI.
- Load models through `GET /models`.
- Send chat through the OpenAI-compatible chat completions path.
- Avoid adding a custom SDK until the API surface needs non-compatible features.

Current progress:

- Provider preset added in `web-app/src/constants/providers.ts`.
- Existing Tauri provider service is reused for model fetching and authentication.
- Existing model factory path handles Jingxing through the OpenAI-compatible branch.

Remaining work:

- Manual validation with a real Jingxing token.
- Improve first-run guidance so users are nudged to configure Jingxing before chatting.
- Add provider-specific error copy for missing token, permission errors, and invalid base URL.

### 4. Auto-Run V1

Implementation scope:

- Add a front-end auto-run store.
- Add a compact auto-run panel near the chat input.
- Let the user configure maximum rounds.
- Support start, pause, resume, and stop.
- Reuse the current chat transport and message pipeline.
- Append a control message for each generated round.
- Persist run state in thread metadata:
  - `metadata.silenceAutoRun.status`
  - `metadata.silenceAutoRun.maxRounds`
  - `metadata.silenceAutoRun.currentRound`
  - `metadata.silenceAutoRun.startedAt`
  - `metadata.silenceAutoRun.updatedAt`
- Tag generated messages with `metadata.silence`.

Current progress:

- `web-app/src/stores/auto-run-store.ts` added.
- `web-app/src/containers/AutoRunPanel.tsx` added.
- Chat input integration is in place.
- Thread metadata plumbing has been started through the existing thread hooks.

Remaining work:

- Full desktop manual test with a real model.
- Confirm paused runs do not enqueue extra hidden requests.
- Confirm stopped runs do not pollute ordinary chat.
- Confirm metadata survives app restart and thread reload.
- Add targeted UI tests around pause/resume/stop once behavior is stable.

### 5. Multi-Agent Preparation

Implementation scope:

- Reserve a stable type surface for future agent execution.
- Support the roles:
  - `planner`
  - `worker`
  - `coordinator`
  - `verifier`
- Store future configuration in `metadata.silenceAgents`.
- Do not ship a complex orchestration UI in v1.

Current progress:

- `web-app/src/types/silence-agent.ts` added.
- Role and config types are reserved.

Remaining work:

- Build the actual multi-agent executor.
- Decide how role prompts, provider/model overrides, and verification results are stored.
- Add migration strategy if the metadata format changes after v1.

### 6. Silence Browser MCP

Implementation scope:

- Rename product-visible `Jan Browser MCP` to `Silence Browser MCP`.
- Keep old config compatibility.
- Prevent duplicate startup when both old and new MCP keys exist.
- Keep Chrome Store extension link unchanged until the browser extension itself is forked.

Current progress:

- Backend constants now include `SILENCE_BROWSER_MCP_NAME` and `LEGACY_JAN_BROWSER_MCP_NAME`.
- MCP config read/write normalizes legacy key to the Silence key.
- Tauri command `check_silence_browser_extension_connected` added.
- Old `check_jan_browser_extension_connected` remains as a compatibility wrapper.
- Frontend hook and dialog renamed to Silence.
- Tool filtering recognizes both old and new server names.
- Tests updated for hook, MCP service, Rust MCP config, migration, and connection checks.

Remaining work:

- Fork or replace the browser extension when product distribution requires it.
- Update extension-store references only after the extension is actually owned by Silence.

### 7. Product Simplification

Implementation scope:

- Hide or de-emphasize heavy Jan-first experiences for v1:
  - Hub
  - local model download flows
  - hardware monitor
  - upstream Jan update/source links
- Keep settings, provider management, threads, and MCP controls available.
- Make first-run focus on provider setup and immediate chat.

Current progress:

- Primary app copy and settings/navigation surfaces have been partially renamed.
- Local heavy surfaces have been reduced in the main experience.

Remaining work:

- Run a fresh first-launch UI walkthrough.
- Decide which upstream local-model surfaces should remain hidden, removed, or reintroduced later.
- Sweep all visible settings routes for old Jan naming.

## Verification History

Completed checks:

- `cargo test --manifest-path src-tauri/Cargo.toml core::app --no-default-features --features test-tauri`
  - Result: 19 passed
- `cargo test --manifest-path src-tauri/Cargo.toml core::system --no-default-features --features test-tauri`
  - Result: 10 passed
- `cargo test --manifest-path src-tauri/Cargo.toml mcp --no-default-features --features test-tauri`
  - Result: 47 passed during Browser MCP rename verification
- `corepack yarn vitest run --project @janhq/web-app web-app/src/hooks/__tests__/useSilenceBrowserExtension.test.ts web-app/src/services/mcp/__tests__/default.test.ts web-app/src/services/mcp/__tests__/tauri.coverage.test.ts`
  - Result: 34 passed
- `corepack yarn vitest run --project @janhq/web-app web-app/src/services/deeplink/__tests__/tauri.test.ts web-app/src/providers/__tests__/DataProvider.test.tsx`
  - Result: 24 passed
- `corepack yarn workspace @janhq/web-app lint`
  - Result: passed with existing React Fast Refresh warnings
- `corepack yarn workspace @janhq/web-app build`
  - Result: passed with existing Vite dynamic import/chunk warnings
- `git diff --check`
  - Result: passed

## Publishing Plan

Repository target:

- Owner: `realerikk0`
- Repository name: `Silence`
- URL: `https://github.com/realerikk0/Silence`
- Visibility: public
- Default branch: `silence-main`

Publish steps:

1. Update this plan and root README.
2. Run focused verification.
3. Stage the current Silence fork changes.
4. Commit with a clear initial implementation message.
5. Create the public GitHub repository.
6. Point `origin` to the new Silence repository.
7. Push `silence-main` and set it as the tracked/default branch.

## Next Milestones

### Milestone 1: Public Fork Baseline

- Publish the repository.
- Ensure README and development plan are visible.
- Confirm GitHub default branch and public visibility.

### Milestone 2: Real Provider Smoke Test

- Configure a Jingxing token locally.
- Fetch models from `https://api.jingxing.uk/v1/models`.
- Send a short streaming chat request.
- Capture error behavior for invalid token and invalid base URL.

### Milestone 3: Auto-Run Hardening

- Test 3-round and 10-round runs.
- Verify pause/resume/stop semantics.
- Confirm metadata persistence after restart.
- Add regression tests for state transitions.

### Milestone 4: Branding Sweep

- Sweep remaining visible Jan copy in docs, localized strings, package metadata, and settings.
- Decide what remains as explicit upstream attribution.
- Keep migration constants and compatibility wrappers documented.

### Milestone 5: Multi-Agent Executor Design

- Define role execution contracts.
- Decide whether orchestration runs fully in frontend, Rust backend, or a hybrid.
- Add storage schema for agent traces and verification results.
- Ship a minimal planner -> worker -> verifier loop behind a feature flag.
