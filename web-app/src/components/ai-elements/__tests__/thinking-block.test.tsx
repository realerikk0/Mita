import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  ReasoningStep,
  SearchSourceItem,
  SearchSourceList,
  ThinkingBlock,
  ThinkingMarkdown,
  ToolCallCard,
} from '../thinking-block'

vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children: string }) => (
    <div data-testid="thinking-streamdown">{children}</div>
  ),
}))

vi.mock('../loading-ribbon', () => ({
  LoadingRibbonText: ({ label }: { label: string }) => (
    <span data-testid="loading-ribbon">{label}</span>
  ),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const values: Record<string, string> = {
        'chat:generationStatus.thinking': 'Thinking',
        'chat:thinkingBlock.status.idle': 'Idle',
        'chat:thinkingBlock.status.running': 'Running',
        'chat:thinkingBlock.status.complete': 'Complete',
        'chat:thinkingBlock.status.error': 'Error',
        'chat:thinkingBlock.inputLabel': 'Input',
        'chat:thinkingBlock.outputLabel': 'Output',
      }

      return values[key] ?? key
    },
  }),
}))

describe('ThinkingBlock', () => {
  it('renders a black-silver reasoning surface with a collapsible header', () => {
    render(
      <ThinkingBlock
        kind="reasoning"
        status="running"
        title="思考中"
        subtitle="正在分析上下文"
      >
        <ThinkingMarkdown>{'## 分析\n- 读取消息\n- 整理计划'}</ThinkingMarkdown>
      </ThinkingBlock>
    )

    const block = screen.getByTestId('thinking-block')
    expect(block).toHaveAttribute('data-thinking-kind', 'reasoning')
    expect(block).toHaveAttribute('data-thinking-status', 'running')
    expect(screen.getByRole('button', { name: /思考中/ })).toBeInTheDocument()
    expect(screen.getByText('正在分析上下文')).toBeInTheDocument()
    expect(screen.getByTestId('loading-ribbon')).toHaveTextContent('思考中')
    expect(screen.getByTestId('thinking-streamdown')).toHaveTextContent(
      '读取消息'
    )
  })

  it('can start collapsed and expand without losing content semantics', async () => {
    const user = userEvent.setup()

    render(
      <ThinkingBlock
        kind="plan"
        status="complete"
        title="Implementation plan"
        defaultOpen={false}
      >
        <ReasoningStep status="complete" label="Create design doc" />
      </ThinkingBlock>
    )

    expect(screen.queryByText('Create design doc')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Implementation plan/ }))

    expect(screen.getByText('Create design doc')).toBeInTheDocument()
  })
})

describe('Thinking content primitives', () => {
  it('renders plan steps with explicit status markers', () => {
    render(
      <ThinkingBlock kind="plan" title="Plan">
        <ReasoningStep status="complete" label="Read current components" />
        <ReasoningStep status="active" label="Implement reusable surface" />
        <ReasoningStep status="pending" label="Verify desktop preview" />
      </ThinkingBlock>
    )

    expect(screen.getByText('Read current components')).toHaveAttribute(
      'data-thinking-step-status',
      'complete'
    )
    expect(screen.getByText('Implement reusable surface')).toHaveAttribute(
      'data-thinking-step-status',
      'active'
    )
    expect(screen.getByText('Verify desktop preview')).toHaveAttribute(
      'data-thinking-step-status',
      'pending'
    )
  })

  it('renders search sources as compact external links', () => {
    render(
      <ThinkingBlock kind="search" title="Sources">
        <SearchSourceList title="References">
          <SearchSourceItem href="https://example.com/article" domain="example.com">
            Claude thinking UI
          </SearchSourceItem>
        </SearchSourceList>
      </ThinkingBlock>
    )

    const link = screen.getByRole('link', { name: /Claude thinking UI/ })
    expect(link).toHaveAttribute('href', 'https://example.com/article')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByText('example.com')).toBeInTheDocument()
  })

  it('renders tool calls with separated input and output payloads', () => {
    render(
      <ThinkingBlock kind="tool" title="Tool call">
        <ToolCallCard
          name="web_search"
          status="complete"
          input={{ query: 'thinking UI' }}
          output={{ sources: 4 }}
        />
      </ThinkingBlock>
    )

    expect(screen.getByText('web search')).toBeInTheDocument()
    expect(screen.getByText('Input')).toBeInTheDocument()
    expect(screen.getByText('Output')).toBeInTheDocument()
    expect(screen.getByTestId('thinking-tool-input')).toHaveTextContent(
      '"query": "thinking UI"'
    )
    expect(screen.getByTestId('thinking-tool-output')).toHaveTextContent(
      '"sources": 4'
    )
  })
})
