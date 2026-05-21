import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../code-block', () => ({
  CodeBlock: ({ code, language }: { code: string; language: string }) => (
    <pre data-testid={`code-${language}`}>{code}</pre>
  ),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const values: Record<string, string> = {
        'chat:toolCall.running': 'Running {{toolName}}...',
        'chat:toolCall.used': 'Used {{toolName}}',
        'chat:toolCall.failed': '{{toolName}} failed',
        'chat:toolCall.commandLabel': 'Command',
        'chat:toolCall.cwdLabel': 'Working directory',
        'chat:toolCall.parametersLabel': 'Parameters',
        'chat:toolCall.resultLabel': 'Result',
        'chat:toolCall.errorLabel': 'Error',
      }

      return (values[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name) =>
        options?.[name] === undefined ? _match : String(options[name])
      )
    },
  }),
}))

import { Tool, ToolHeader, ToolInput } from '../tool'

describe('Tool components', () => {
  it('renders a shell command separately from the raw parameters', () => {
    render(
      <ToolInput
        input={{
          command: 'df -h',
          cwd: '/tmp/workspace',
          timeoutSeconds: 10,
        }}
      />
    )

    expect(screen.getByText('Command')).toBeInTheDocument()
    expect(screen.getByText('df -h')).toBeInTheDocument()
    expect(
      screen.getByText('Working directory: /tmp/workspace')
    ).toBeInTheDocument()
    expect(screen.getByText('Parameters')).toBeInTheDocument()
    expect(screen.getByTestId('code-json')).toHaveTextContent(
      '"command": "df -h"'
    )
    expect(screen.getByTestId('code-json')).toHaveTextContent(
      '"timeoutSeconds": 10'
    )
  })

  it('parses stringified JSON input before rendering command details', () => {
    render(
      <ToolInput
        input={JSON.stringify({
          command: 'pwd',
          cwd: '/tmp/workspace',
        })}
      />
    )

    expect(screen.getByText('pwd')).toBeInTheDocument()
    expect(
      screen.getByText('Working directory: /tmp/workspace')
    ).toBeInTheDocument()
  })

  it('keeps the tool header as a call record instead of a result summary', () => {
    render(
      <Tool state={'output-available' as any}>
        <ToolHeader
          state={'output-available' as any}
          type={'tool-computer_agent_run_shell' as any}
        />
      </Tool>
    )

    expect(
      screen.getByText('Used computer agent run shell')
    ).toBeInTheDocument()
    expect(screen.queryByText(/Result:/)).not.toBeInTheDocument()
  })
})
