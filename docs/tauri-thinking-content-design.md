# Tauri Thinking Content Design

## Goal

Upgrade AI thinking content in the Tauri desktop chat UI from raw markdown text into a polished, reusable, low-noise presentation system for macOS and Windows.

This work continues on `feature/tauri-loading-ribbon-animation` and extends the existing black/silver loading ribbon language. The implementation stays in the web UI layer: no chat transport, vault, MCP routing, model routing, or Tauri backend data-flow changes unless explicitly approved.

## Research Log

### 2026-06-23

- Reused the existing `feature/tauri-loading-ribbon-animation` branch and its worktree.
- Reviewed the current loading ribbon component and integrations:
  - `web-app/src/components/ai-elements/loading-ribbon.tsx`
  - `web-app/src/components/ai-elements/loading-ribbon.css`
  - `web-app/src/components/ai-elements/reasoning.tsx`
  - `web-app/src/components/ai-elements/chain-of-thought.tsx`
  - `web-app/src/components/ai-elements/tool.tsx`
  - `web-app/src/components/PromptProgress.tsx`
- Started from the existing chat surface rather than changing message schemas.
- Collected current public references for Claude, Cursor, Codex, and Perplexity.
- Added a code-analysis preview state so file paths, commands, and implementation notes are verified alongside reasoning, tool, search, and plan content.

## Product References

### Claude

Sources:

- [Claude Help Center: model, effort, and thinking settings](https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings)
- [Anthropic API docs: extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Anthropic: Claude's extended thinking](https://www.anthropic.com/news/visible-extended-thinking)

Observed pattern:

- Claude shows a compact `Thinking` indicator with elapsed time while processing.
- Thinking appears above the final answer in an expandable section.
- The displayed content is a summary/problem-solving view, not necessarily raw internal chain-of-thought.
- Newer API behavior distinguishes summarized thinking from omitted thinking, which supports a UI that can show useful process content without implying every internal token is visible.

Design takeaways:

- Thinking content should be secondary to the final answer and default-collapsible when long.
- Header text should communicate duration/state and remain readable even while animated.
- The UI copy should frame the section as a reasoning summary or work log, not private hidden cognition.

### Cursor

Source:

- [Cursor: Introducing Plan Mode](https://cursor.com/blog/plan-mode)

Observed pattern:

- Cursor plan mode researches code, asks clarifying questions, creates editable plans, and can save the plan as Markdown in the repository.
- Plans can include file paths, code references, and editable to-dos.
- The value is not decoration; the plan creates a reviewable bridge between intent and execution.

Design takeaways:

- Plan content should render as structured steps with clear active/complete/pending states.
- Markdown remains important, but plan-like content deserves dedicated step chrome, not only paragraph text.
- File paths, commands, and code references need compact monospace treatment.

### Codex

Sources:

- [OpenAI: Introducing Codex](https://openai.com/index/introducing-codex/)
- [OpenAI: Introducing upgrades to Codex](https://openai.com/index/introducing-upgrades-to-codex/)
- [OpenAI Developers: Codex CLI features](https://developers.openai.com/codex/cli/features)

Observed pattern:

- Codex surfaces progress in real time and provides verifiable evidence such as terminal logs and test output citations.
- Recent Codex updates emphasize progress to-dos, better formatted tool calls, diffs, web search, and MCP tool use.
- The useful UI object is often a work record: plan item, command, tool call, diff, result, verification.

Design takeaways:

- Tool calls should be visually distinct cards with an icon, status, input, output, and error state.
- Long tool payloads must be scroll-contained and collapsed by default after completion.
- The same component family should cover reasoning text, tool calls, search sources, plan steps, and code-analysis notes.

### Perplexity

Sources:

- [Perplexity App Store listing](https://apps.apple.com/us/app/perplexity-ai-search-chat/id1668000334)
- [Perplexity](https://www.perplexity.ai/)

Observed pattern:

- Perplexity positions answers around trusted, up-to-date sources and citations.
- Source visibility is part of the answer experience, but sources are compact enough not to overwhelm the answer.

Design takeaways:

- Search results should render as compact source chips/cards with domain/title affordances.
- Source lists should be scannable and wrap gracefully inside narrow desktop side-by-side layouts.

## Current App Baseline

Existing loading-ribbon work already introduced the core black/silver motion language:

- `ribbon`: continuous silver gradient for thinking/generating.
- `glint`: subtle sweep for search/pending states.
- `wave`: slow metal drift for tool/code analysis states.

Existing thinking surfaces:

- `ReasoningContent` renders markdown via `Streamdown` inside a dotted left rail.
- `ChainOfThoughtContent` renders child steps inside the same dotted left rail.
- `ToolContent` renders command/input/output in plain bordered blocks.

Gap:

- The status headers are now polished, but the expanded content is still visually closer to raw debug markdown.
- Reasoning, tools, plans, and search results do not yet share one premium surface system.

## Final Design Direction

### Visual Language

- Base: near-black surfaces (`#020204`, `#070709`) with subtle transparent borders.
- Accent: silver/steel gradients reused from the loading ribbon.
- Shape: low-profile panels, 8px-or-less radius, no nested decorative cards.
- Motion: only the existing text ribbon and small icon/status motion. Expanded content stays stable.
- Density: compact enough for chat history; no landing-page or hero styling inside chat.

### Component Set

- `ThinkingBlock`: collapsible root shell with kind, title, subtitle, status, default-open behavior, and a compact metallic header.
- `ReasoningStep`: step row for plan/search/code-analysis sequences.
- `ToolCallCard`: tool-specific card wrapper for command/input/output/error states.
- `ThinkingMarkdown`: markdown renderer wrapper with thinking-specific typography for headings, lists, code, quotes, and tables.
- `SearchSourceList` / `SearchSourceItem`: compact source chips/cards.

The first implementation should reuse existing Radix `Collapsible`, `Streamdown`, `CodeBlock`, `LoadingRibbonText`, `lucide-react`, and Tailwind/CSS. No new heavy rendering dependency.

### Content Types

- `reasoning`: silver ribbon title, prose markdown, quote/code/table styling.
- `tool`: wrench/search icon, status badge, card content, scroll-contained payloads.
- `search`: source list with search icon and compact external-link affordance.
- `plan`: numbered/vertical steps with complete/active/pending states.
- `code`: monospace-focused analysis blocks, command/path chips, result summary.

### Collapse Rules

- Streaming thinking may start open because the user benefits from seeing live progress.
- Completed long thinking/tool content should default closed when the final assistant answer is present.
- Short reasoning can remain open when it is the main visible content.
- Tool calls should default closed after completion and open while running or errored.

### Markdown Styling

Thinking markdown should be scoped under a class such as `.thinking-markdown` and should improve:

- Heading scale: compact, not article-sized.
- Lists: inside-position quirks avoided; use readable indentation.
- Code: dark metal blocks with stable overflow.
- Quotes: slim silver rail, subdued text.
- Tables: small, bordered, horizontally scrollable.
- Links: silver-blue text with hover underline.

### Accessibility

- Headers remain real buttons through `CollapsibleTrigger`.
- Animated status text uses the existing `LoadingRibbonText` live-region behavior only for active states.
- Icons are decorative unless they are the only label, which should be avoided.
- Focus rings should remain visible on black backgrounds.
- `prefers-reduced-motion` continues to disable motion.

### Performance

- CSS-first styling.
- No per-frame React state.
- No blur-heavy animated backdrops, canvas, SVG filters, Lottie, or large motion libraries.
- Long payloads are scroll-contained with max heights.
- Existing `Streamdown` usage remains the markdown renderer; no additional markdown stack.

## Implementation Plan

1. Add tests for the reusable thinking display primitives before implementation.
2. Implement `thinking-block.tsx` and `thinking-block.css` under `web-app/src/components/ai-elements/`.
3. Replace the plain dotted-rail content in `reasoning.tsx`, `chain-of-thought.tsx`, and `tool.tsx` with the new primitives.
4. Add a `thinking-content-demo` route with reasoning, tool call, search, plan, code-analysis, short, long, open, and collapsed examples.
5. Add verification scripts or extend the existing loading-ribbon verifier so the demo can be checked in browser/Tauri shell.
6. Run focused component tests, web build, browser preview screenshots, and Tauri demo checks. Windows proof remains required before cross-platform completion is claimed.

## Implemented Files

Primary component files:

- `web-app/src/components/ai-elements/thinking-block.tsx`
- `web-app/src/components/ai-elements/thinking-block.css`

Existing chat integrations:

- `web-app/src/components/ai-elements/reasoning.tsx`
- `web-app/src/components/ai-elements/chain-of-thought.tsx`
- `web-app/src/components/ai-elements/tool.tsx`

Preview and verification:

- `web-app/src/routes/thinking-content-demo.tsx` covers reasoning, tool call, search sources, plan steps, code-analysis notes, long content, and collapsed content.
- `/thinking-content-demo` and `/loading-ribbon-demo` share the root `PreviewLayout` path and bypass the normal app shell only in development; both routes throw `notFound()` from `beforeLoad` in production builds.
- `scripts/verify-thinking-content-demo.mjs`
- `scripts/run-thinking-content-tauri-demo.mjs`
- `scripts/thinking-content-tauri-demo.config.json`
- `scripts/verify-thinking-content-windows.ps1`

Tests:

- `web-app/src/components/ai-elements/__tests__/thinking-block.test.tsx`
- `web-app/src/routes/__tests__/thinking-content-demo.test.tsx`
- Updated focused integration tests for reasoning, chain-of-thought, and tool surfaces.

## Verification Commands

Focused component and route tests:

```bash
cd web-app
../node_modules/.bin/vitest run --config vitest.config.ts \
  src/components/ai-elements/__tests__/thinking-block.test.tsx \
  src/components/ai-elements/__tests__/reasoning.test.tsx \
  src/components/ai-elements/__tests__/chain-of-thought.test.tsx \
  src/components/ai-elements/__tests__/tool.test.tsx \
  src/routes/__tests__/thinking-content-demo.test.tsx
```

Browser preview verification:

```bash
yarn dev:web
yarn verify:thinking-content
```

Focused macOS Tauri shell:

```bash
yarn dev:thinking-content:tauri
```

Windows browser/WebView2 proof:

```powershell
yarn verify:thinking-content:windows -IncludeTauri
```

Expected Windows evidence package:

- `output/playwright/thinking-content-windows-verification.log`
- `output/playwright/thinking-content-demo-desktop.png`
- `output/playwright/thinking-content-demo-mobile.png`
- `output/playwright/thinking-content-tauri-windows.png`

The Windows verifier starts the Vite demo server, runs the Edge/WebView2 browser check with `PLAYWRIGHT_CHANNEL=msedge`, launches the focused Tauri shell when `-IncludeTauri` is passed, foregrounds the `Biyan`/`Mita` window, then captures the desktop screenshot.

## Usage Examples

```tsx
<ThinkingBlock
  kind="reasoning"
  status="running"
  title="思考中"
  defaultOpen
>
  <ThinkingMarkdown>
    {"## 分析\n- 读取相关文件\n- 对齐现有 loading ribbon 风格"}
  </ThinkingMarkdown>
</ThinkingBlock>
```

```tsx
<ThinkingBlock kind="tool" status="complete" title="Used web search">
  <ToolCallCard
    name="web_search"
    input={{ query: "Claude extended thinking UI" }}
    output="Found Claude's expandable Thinking section pattern."
  />
</ThinkingBlock>
```

```tsx
<ThinkingBlock kind="plan" status="complete" title="Implementation plan">
  <ReasoningStep status="complete" label="Create design doc" />
  <ReasoningStep status="active" label="Implement reusable components" />
  <ReasoningStep status="pending" label="Run desktop visual checks" />
</ThinkingBlock>
```

```tsx
<ThinkingBlock kind="code" status="complete" title="Code analysis">
  <ThinkingMarkdown>
    {"## Files reviewed\n- `reasoning.tsx`\n- `tool.tsx`\n\n```ts\nconst kind = 'code'\n```"}
  </ThinkingMarkdown>
</ThinkingBlock>
```

## Non-Goals

- Do not expose hidden/private chain-of-thought beyond what providers already return.
- Do not redesign the full chat message schema.
- Do not create a separate rendering pipeline for every provider.
- Do not add a heavy markdown or animation dependency.
- Do not claim Windows parity without a Windows/WebView2 evidence artifact.
