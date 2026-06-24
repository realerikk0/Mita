import { createFileRoute } from '@tanstack/react-router'
import {
  ReasoningStep,
  SearchSourceItem,
  SearchSourceList,
  ThinkingBlock,
  ThinkingMarkdown,
  ToolCallCard,
} from '@/components/ai-elements/thinking-block'
import { LoadingRibbonText } from '@/components/ai-elements/loading-ribbon'
import { blockPreviewRouteInProduction } from './-preview-route-guard'

export const Route = createFileRoute('/thinking-content-demo')({
  beforeLoad: blockPreviewRouteInProduction,
  component: ThinkingContentDemo,
})

const longReasoning = `## Context pass

- Scanned the existing chat reasoning components.
- Kept the transport and message data flow unchanged.
- Reused the silver loading ribbon for active thinking states.

> Thinking content should be inspectable without competing with the final answer.

\`\`\`ts
type ThinkingKind = 'reasoning' | 'tool' | 'search' | 'plan' | 'code'
\`\`\`

| Surface | Behavior |
| --- | --- |
| Reasoning | Polished markdown and compact collapse |
| Tool | Input/output card with bounded payloads |
| Search | Source chips with external links |
| Plan | Status steps for implementation progress |
| Code | Compact code analysis with file paths and findings |`

const codeAnalysis = `## Chat integration pass

- Reviewed \`reasoning.tsx\`, \`chain-of-thought.tsx\`, and \`tool.tsx\`.
- Confirmed the message transport stays unchanged.
- Kept code-oriented notes compact so they do not compete with the answer.

\`\`\`tsx
<ThinkingBlock kind="code" status="complete" title="Code analysis">
  <ThinkingMarkdown>{analysis}</ThinkingMarkdown>
</ThinkingBlock>
\`\`\`

| Check | Result |
| --- | --- |
| Markdown | Scoped thinking typography |
| Payloads | Scroll-contained |
| Motion | Reduced-motion aware |`

function ThinkingContentDemo() {
  return (
    <main
      className="fixed inset-0 z-[60] min-h-screen overflow-y-auto bg-[#020204] text-zinc-100"
      data-thinking-content-demo=""
    >
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-6 py-8 md:px-10">
        <header className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-zinc-500">
            Tauri Desktop Preview
          </p>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-normal text-zinc-50 md:text-5xl">
                Thinking content system
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-zinc-400">
                黑银视觉语言下的 reasoning、tool call、search source、plan step 与 code analysis 预览。
              </p>
            </div>
            <LoadingRibbonText
              icon="thinking"
              label="思考中"
              live={false}
              showIcon={false}
              size="md"
              variant="ribbon"
            />
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="grid gap-4">
            <ThinkingBlock
              kind="reasoning"
              status="running"
              title="Reasoning"
              subtitle="Streaming summary with polished markdown"
            >
              <ThinkingMarkdown>{longReasoning}</ThinkingMarkdown>
            </ThinkingBlock>

            <ThinkingBlock
              defaultOpen={false}
              kind="reasoning"
              status="complete"
              title="Collapsed long reasoning"
              subtitle="Completed content stays available without pushing the answer away"
            >
              <ThinkingMarkdown>
                {
                  'Completed reasoning can default collapsed when the final answer is already visible.\n\n- Keeps chat history compact\n- Still supports inspection\n- Uses the same markdown treatment'
                }
              </ThinkingMarkdown>
            </ThinkingBlock>

            <ThinkingBlock
              kind="code"
              status="complete"
              title="Code analysis"
              subtitle="Compact file, command, and implementation notes"
            >
              <ThinkingMarkdown>{codeAnalysis}</ThinkingMarkdown>
            </ThinkingBlock>
          </div>

          <div className="grid gap-4">
            <ThinkingBlock
              kind="tool"
              status="complete"
              title="Tool call"
              subtitle="Structured input and output payloads"
            >
              <ToolCallCard
                name="web_search"
                status="complete"
                input={{
                  query: 'Claude Cursor Codex thinking UI display patterns',
                  recency: 'current',
                }}
                output={{
                  sources: 4,
                  summary:
                    'Expandable thinking, editable plans, formatted tool logs, and compact citations.',
                }}
              />
            </ThinkingBlock>

            <ThinkingBlock
              kind="search"
              status="complete"
              title="Sources"
              subtitle="Compact references inspired by answer engines"
            >
              <SearchSourceList title="References">
                <SearchSourceItem
                  domain="support.claude.com"
                  href="https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings"
                >
                  Claude Thinking section
                </SearchSourceItem>
                <SearchSourceItem
                  domain="cursor.com"
                  href="https://cursor.com/blog/plan-mode"
                >
                  Cursor Plan Mode
                </SearchSourceItem>
                <SearchSourceItem
                  domain="openai.com"
                  href="https://openai.com/index/introducing-upgrades-to-codex/"
                >
                  Codex progress and tools
                </SearchSourceItem>
              </SearchSourceList>
            </ThinkingBlock>

            <ThinkingBlock
              kind="plan"
              status="running"
              title="Implementation plan"
              subtitle="Readable step states for longer agent work"
            >
              <ReasoningStep status="complete" label="Create design document" />
              <ReasoningStep
                status="complete"
                label="Implement reusable thinking primitives"
              />
              <ReasoningStep
                status="active"
                label="Integrate into real chat reasoning and tool surfaces"
              />
              <ReasoningStep
                status="pending"
                label="Verify macOS and Windows desktop previews"
              />
            </ThinkingBlock>
          </div>
        </section>
      </section>
    </main>
  )
}
