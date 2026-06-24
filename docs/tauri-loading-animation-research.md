# Tauri Loading Ribbon Animation Research

## Goal

Build a reusable, very low-resource loading text animation for the Tauri desktop app on macOS and Windows. The visual direction is black surfaces with silver liquid-metal ribbon gradients for states such as thinking, web search, generating, code analysis, and tool calls.

This work stays in the web UI layer. It does not change chat vaults, MCP tool integration, transport, model routing, or the Tauri backend.

## Research Log

### 2026-06-22

- Created feature branch `feature/tauri-loading-ribbon-animation`.
- Created this research document before production code changes.
- Reviewed current route/component structure under `web-app/src/components` and `web-app/src/routes`.
- Collected public references for Cursor, Claude Code, Codex, OpenAI desktop apps, and browser animation/accessibility guidance.
- Implemented first reusable React/CSS component and integrated it into existing thinking/tool/progress surfaces.

## Public Product References

Public sources rarely document the exact proprietary pixels of loading animations, so this analysis focuses on behavior patterns: when status is shown, how much information is revealed, and how the UI avoids blocking the user.

### Cursor

Sources:

- [Cursor Agent best practices](https://cursor.com/blog/agent-best-practices)

Observed pattern:

- Cursor emphasizes explicit agent phases: planning, asking clarifying questions, editing, and follow-up verification.
- The status is useful because it names the current activity instead of showing a decorative spinner only.
- The best-practice guidance frames agent work as a loop of goal, context, approval, implementation, and verification.

Design takeaway:

- Loading text should say what kind of work is happening: `思考中`, `网络搜索中`, `分析代码中`, `正在调用工具...`.
- A single animation style is not enough; the component needs variants that can communicate different phases without adding noisy UI.

### Claude Code

Sources:

- [Claude Code status line documentation](https://code.claude.com/docs/en/statusline)
- [Claude Code changelog](https://docs.claude.com/en/release-notes/claude-code)

Observed pattern:

- Claude Code exposes a status line that can show contextual state near the prompt.
- Changelog entries mention spinner/status improvements, stream-stall hints, and progress indicator fixes. This points to a practical requirement: loading indicators must be informative and recoverable, not only pretty.
- Terminal UI is constrained, so the strongest signal is short text plus subtle movement.

Design takeaway:

- Keep messages short and readable at all times. Animation must never hide the text.
- Prefer stable text with a gentle moving highlight over large spinners.
- Long-running states should remain calm to avoid a sense of a stuck app.

### Codex App / Codex CLI

Sources:

- [Codex CLI slash commands](https://developers.openai.com/codex/cli/slash-commands)
- [Codex app troubleshooting](https://developers.openai.com/codex/app/troubleshooting)
- [Codex changelog](https://developers.openai.com/codex/changelog)

Observed pattern:

- Codex exposes explicit status commands and status-line concepts.
- Troubleshooting docs discuss stuck tasks, queued prompts, running threads, and subagent state. That makes status feedback a core part of trust and recoverability.
- The desktop app treats status as lightweight ambient feedback rather than a modal interruption.

Design takeaway:

- The loading component should be inline and composable inside chat rows, tool rows, reasoning headers, and queue/progress surfaces.
- It should be safe to render multiple times, but still tiny enough to avoid raising idle CPU/GPU use.

### OpenAI Desktop / ChatGPT

Sources:

- [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes)
- [ChatGPT macOS app release notes](https://help.openai.com/en/articles/9703738-macos-app-release-notes)
- [ChatGPT Windows app release notes](https://help.openai.com/en/articles/9982051-using-the-chatgpt-windows-app)

Observed pattern:

- Public notes confirm separate macOS and Windows desktop app surfaces and ongoing UX polish, but do not specify exact loading animation internals.
- The visible design direction in modern AI apps is restrained: compact feedback, calm motion, and no heavy decorative loaders in the main conversation.

Design takeaway:

- Match the app's black/silver premium language with a compact inline text treatment.
- Avoid a full-card or full-screen loader for ordinary thinking/search states.

## Browser, Performance, And Accessibility References

Sources:

- [web.dev high-performance CSS animations](https://web.dev/articles/animations-guide)
- [MDN `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/%40media/prefers-reduced-motion)
- [MDN ARIA `status` role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/status_role)
- [MDN `background-clip`](https://developer.mozilla.org/en-US/docs/Web/CSS/background-clip)

Takeaways:

- Transform and opacity animation are the cheapest general-purpose choices.
- Animating paint-heavy properties can be acceptable only when the animated region is very small. Here the repaint area is limited to inline text glyphs, not cards, containers, or the viewport.
- `background-clip: text` plus `-webkit-background-clip: text` is the right primitive for metallic text gradients across Chromium/WebView2 and WebKit/WKWebView.
- `prefers-reduced-motion: reduce` must disable motion while preserving readable text.
- `role="status"`, `aria-live="polite"`, and `aria-atomic="true"` fit loading text because the user should receive state changes without focus being moved.

## Final Design Direction

### Visual Language

- Base surface: near-black (`#020204`) with existing app dark UI surfaces.
- Text: silver/cold-metal gradient with darker steel bands and bright specular highlights.
- Motion: slow lateral flow, occasional glint, or wave-like gradient drift.
- Shape: text itself becomes the ribbon. This avoids additional canvas/SVG layers and keeps the animated area tiny.

### Variants

- `ribbon`: continuous metallic flow for general thinking and generating.
- `glint`: mostly stable text with a subtle highlight sweep for web search or pending generation.
- `wave`: slower liquid-metal drift for code analysis and tool calls.

### States

Supported default labels:

- `思考中`
- `网络搜索中`
- `正在生成回复`
- `分析代码中`
- `正在调用工具...`

## Implementation

Primary files:

- `web-app/src/components/ai-elements/loading-ribbon.tsx`
- `web-app/src/components/ai-elements/loading-ribbon.css`
- `web-app/src/routes/loading-ribbon-demo.tsx`
- `scripts/loading-ribbon-tauri-demo.config.json`
- `scripts/run-loading-ribbon-tauri-demo.mjs`
- `scripts/verify-loading-ribbon-demo.mjs`
- `scripts/verify-loading-ribbon-windows.ps1`

Integrated surfaces:

- `web-app/src/components/ai-elements/chain-of-thought.tsx`
- `web-app/src/components/ai-elements/reasoning.tsx`
- `web-app/src/components/ai-elements/tool.tsx`
- `web-app/src/components/PromptProgress.tsx`
- `web-app/src/routes/threads/$threadId.tsx`

Component API:

```tsx
<LoadingRibbonText
  icon="thinking"
  label="思考中"
  live
  showIcon
  size="sm"
  variant="ribbon"
/>
```

Props:

- `label`: visible text. Defaults to `思考中`.
- `variant`: `ribbon | glint | wave`.
- `size`: `xs | sm | md`.
- `icon`: `sparkles | thinking | search | tool`.
- `showIcon`: hides the icon when false.
- `live`: enables `role="status"`, `aria-live="polite"`, and `aria-atomic="true"`.
- `as`: renders a different element, for example `span`, `div`, or `p`.

## Framework Integration Notes

React/Tauri:

```tsx
import { LoadingRibbonText } from '@/components/ai-elements/loading-ribbon'

export function AssistantThinking() {
  return (
    <LoadingRibbonText
      icon="thinking"
      label="正在生成回复"
      variant="glint"
    />
  )
}
```

Plain HTML/CSS:

```html
<span
  class="loading-ribbon"
  data-loading-ribbon
  data-loading-ribbon-size="sm"
  data-loading-ribbon-variant="ribbon"
  role="status"
  aria-live="polite"
  aria-atomic="true"
>
  <span class="loading-ribbon__text" data-loading-ribbon-label="思考中">
    思考中
  </span>
</span>
```

Vue/Svelte:

- Reuse the CSS classes and data attributes directly.
- Bind the label to both text content and `data-loading-ribbon-label` so the glint pseudo-element can mirror the text.
- Keep the animation state declarative; do not add per-frame JavaScript timers.

## Performance Decisions

- No new runtime dependency.
- No canvas, Lottie, SVG filters, blur filters, or heavy animation library.
- No React state updates during animation.
- CSS keyframes run on a small inline text area only.
- The `glint` variant uses transform/opacity on a pseudo-element for the highlight sweep.
- Icon motion uses only transform/opacity and no drop-shadow filter.
- `contain: paint` limits repaint work around the gradient text.
- `prefers-reduced-motion: reduce` disables all keyframe animation and keeps static metallic text.

Recommended usage limits:

- Use one primary live status per active assistant message.
- Avoid rendering dozens of animated ribbons in history. Completed messages should render static final text.
- Prefer `glint` for very long pending states because its base text remains mostly static.

## Cross-Platform Notes

Tauri uses platform webviews: WKWebView on macOS and WebView2 on Windows. The component sticks to common CSS primitives supported by both:

- `linear-gradient`
- `background-clip: text`
- `-webkit-background-clip: text`
- CSS keyframes
- `transform`
- `opacity`
- `prefers-reduced-motion`

High DPI notes:

- The text gradient is vector/CSS based, so it scales cleanly on Retina and Windows high-DPI screens.
- No raster sprite or bitmap asset is used.

Liquid Glass / translucent macOS surfaces:

- The component does not create a backdrop layer. It can sit on top of glass or blurred containers without adding another expensive blur.
- On very translucent surfaces, prefer `variant="glint"` or `variant="wave"` to avoid overly bright continuous movement.

## Preview

Development route:

- `/loading-ribbon-demo`
- The route is a full-window black preview surface mounted through the root `PreviewLayout`, so screenshots are not affected by the normal app shell, providers, dialogs, or sidebar.
- The preview route is development-only. `beforeLoad` throws `notFound()` in production builds, matching the `thinking-content-demo` guard.

Run with the existing web/Tauri dev flow:

```bash
yarn dev:web
```

Then open:

```text
http://localhost:1420/loading-ribbon-demo
```

For full Tauri shells:

```bash
yarn dev
```

For a focused demo-shell check without bundling optional external binaries:

```bash
yarn dev:web
yarn dev:loading-ribbon:tauri
```

This focused config is for local visual validation only. It bypasses optional external bundle binaries and points the Tauri shell directly at `/loading-ribbon-demo`; it does not change the normal checked-in Tauri app config.

The `dev:loading-ribbon:tauri` wrapper adds `--target aarch64-apple-darwin` automatically on Apple Silicon macOS to avoid the local x86_64 linker crash seen during verification. Windows runs the same config without a custom target.

Windows verification command from a Windows machine:

```powershell
yarn install
yarn verify:loading-ribbon:windows
```

For an additional Tauri/WebView2 shell screenshot on Windows:

```powershell
yarn verify:loading-ribbon:windows -IncludeTauri
```

The Windows script starts the demo server, runs the Edge-backed browser verifier, clears stale repo-owned port listeners, and, when `-IncludeTauri` is provided, launches a focused Tauri shell against `/loading-ribbon-demo`, foregrounds the app window, checks that the capture is nonblank, and saves a desktop screenshot.

Automated verification command:

```bash
yarn verify:loading-ribbon
```

The script reuses the existing Playwright dependency and launches an installed desktop browser. On Windows it tries Microsoft Edge first, then Chrome; on macOS it tries Chrome first. It validates desktop and mobile viewports, expected labels, all variants, black background, gradient motion, text overflow, reduced-motion behavior, and a short long-run performance sample with low script/layout duration. It writes screenshots to `output/playwright/`.

## Verification Plan

- Focused component tests for props, variants, accessibility attributes, and supported statuses.
- Focused integration tests for reasoning, chain-of-thought, tool status, and prompt progress.
- Web-app build/typecheck.
- Browser preview screenshot on macOS via local Vite dev server.
- Windows visual verification on a Windows/WebView2 machine.
- `yarn verify:loading-ribbon` on both macOS and Windows where those hosts are available.
- `yarn verify:loading-ribbon:windows -IncludeTauri` on a Windows host for a Tauri shell screenshot.
- `git diff --check`.

## Verification Evidence

Current focused tests:

```bash
yarn exec vitest run --project @janhq/web-app \
  web-app/src/components/ai-elements/__tests__/loading-ribbon.test.tsx \
  web-app/src/components/ai-elements/__tests__/chain-of-thought.test.tsx \
  web-app/src/components/ai-elements/__tests__/tool.test.tsx \
  web-app/src/components/ai-elements/__tests__/reasoning.test.tsx \
  web-app/src/components/__tests__/PromptProgress.test.tsx
```

Result on 2026-06-22:

- 5 test files passed.
- 47 tests passed.

Build/typecheck:

```bash
yarn workspace @janhq/core build && yarn workspace @janhq/web-app build
```

Result on 2026-06-22:

- Passed.
- Vite emitted existing large-chunk/dynamic-import warnings unrelated to this component.
- Generated CSS artifact for the ribbon component was about 3.80 kB before gzip and about 1.07 kB gzip in the production build output.
- Current rerun also passed `yarn workspace @janhq/core build` and `yarn workspace @janhq/web-app build`.

Browser preview on macOS Chrome:

```text
http://localhost:1420/loading-ribbon-demo
```

Automated command on 2026-06-22:

```bash
yarn verify:loading-ribbon
```

Automated checks on macOS Chrome, 2026-06-22:

- 11 ribbon nodes rendered in the demo route.
- Variants detected: `ribbon`, `glint`, and `wave`.
- Labels detected: `思考中`, `网络搜索中`, `正在生成回复`, `分析代码中`, `正在调用工具...`.
- Demo background resolved to `rgb(2, 2, 4)`.
- Ribbon gradient background position changed over 900 ms, confirming live motion.
- Long-run browser sample checks continuous animation without sustained JS/layout pressure.
- Latest 6 second sample: `scriptDuration` 0.000745 s, `layoutDuration` 0 s, `recalcStyleDuration` 0.210372 s.
- Desktop and mobile viewport checks reported no ribbon text overflow.
- `prefers-reduced-motion: reduce` resolved text and pseudo-element animation names to `none`.

Screenshot artifacts:

- `output/playwright/loading-ribbon-demo-desktop.png`
- `output/playwright/loading-ribbon-demo-mobile.png`
- Windows Tauri shell screenshot target: `output/playwright/loading-ribbon-tauri-windows.png`

macOS Tauri shell check on 2026-06-22:

```bash
yarn tauri dev --no-watch --target aarch64-apple-darwin --config '{"build":{"devUrl":"http://localhost:1420/loading-ribbon-demo"},"bundle":{"externalBin":[],"resources":{"resources/LICENSE":"resources/LICENSE","resources/bin/mita-web-research-mcp.mjs":"resources/bin/mita-web-research-mcp.mjs","resources/embedding-models":"resources/embedding-models","resources/ms-playwright":"resources/ms-playwright"}}}'
```

Result:

- Passed through Rust compile and launched `target/aarch64-apple-darwin/debug/Mita`.
- Runtime logs showed the app setup completed and the bundled Biyan Web Research MCP server initialized successfully.
- `http://localhost:1420/loading-ribbon-demo` returned HTTP 200 while the Tauri process was running.
- Initial default `x86_64-apple-darwin` dev attempt failed before app launch because Apple `cc` crashed with `Segmentation fault: 11` while linking a build script.
- The arm64 attempt without config override failed on missing optional local bundle resource `resources/bin/bun-aarch64-apple-darwin`; overriding `externalBin` avoided that resource-only blocker for the focused visual demo.
- macOS screen capture command did not return in this Codex desktop session, so the Tauri-shell evidence is launch/process/HTTP-log based rather than a window screenshot.

Windows verifier added on 2026-06-22:

- `scripts/verify-loading-ribbon-windows.ps1`
- `scripts/loading-ribbon-tauri-demo.config.json`
- `scripts/run-loading-ribbon-tauri-demo.mjs`
- Root script: `yarn verify:loading-ribbon:windows`
- Optional Tauri/WebView2 shell screenshot: `yarn verify:loading-ribbon:windows -IncludeTauri`
- This macOS host does not have `pwsh` or `powershell`, so the PowerShell script still needs to be executed on Windows for final evidence.

Focused Tauri wrapper check on macOS, 2026-06-22:

```bash
LOADING_RIBBON_TAURI_DRY_RUN=1 node scripts/run-loading-ribbon-tauri-demo.mjs
yarn dev:loading-ribbon:tauri
```

Result:

- Dry run selected `--target aarch64-apple-darwin` and `--config scripts/loading-ribbon-tauri-demo.config.json`.
- `yarn dev:loading-ribbon:tauri` compiled and launched `target/aarch64-apple-darwin/debug/Mita`.
- The Tauri app process was visible as `target/aarch64-apple-darwin/debug/Mita`.
- `http://localhost:1420/loading-ribbon-demo` returned HTTP 200 while the Tauri shell was running.

Remaining before full cross-platform sign-off:

- Run `yarn verify:loading-ribbon` on a Windows host with Microsoft Edge/WebView2 available.
- Run `yarn verify:loading-ribbon:windows -IncludeTauri` on a Windows host with a desktop session.
- Capture a Tauri-shell screenshot on a host where OS screen capture permission is available.
