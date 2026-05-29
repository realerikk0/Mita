import { describe, expect, it } from 'vitest'

import {
  extractPseudoToolTranscripts,
  isPseudoToolTranscriptExecutable,
  splitTextByPseudoToolTranscripts,
} from '../pseudo-tool-transcript'

describe('pseudo-tool-transcript', () => {
  it('extracts XML tool calls with JSON arguments', () => {
    const [transcript] = extractPseudoToolTranscripts(
      'before <tool_call>{"name":"web_search","arguments":{"query":"杭州 市长"}}</tool_call> after'
    )

    expect(transcript).toMatchObject({
      kind: 'xml-tool-call',
      toolName: 'web_search',
      input: { query: '杭州 市长' },
    })
    expect(transcript?.parseError).toBeUndefined()
    expect(isPseudoToolTranscriptExecutable(transcript!)).toBe(true)
  })

  it('keeps a paired hallucinated tool response inside the raw transcript', () => {
    const [transcript] = extractPseudoToolTranscripts(
      '<tool_call>{"name":"web_search","arguments":{"query":"x"}}</tool_call>\n<tool_response>fake result</tool_response>'
    )

    expect(transcript?.raw).toContain('<tool_response>fake result</tool_response>')
    expect(transcript?.toolName).toBe('web_search')
  })

  it('extracts web_search pseudo function calls', () => {
    const [transcript] = extractPseudoToolTranscripts(
      'web_search({"query":"杭州市市长 2026","limit":5})'
    )

    expect(transcript).toMatchObject({
      kind: 'function-call',
      toolName: 'web_search',
      input: { query: '杭州市市长 2026', limit: 5 },
    })
  })

  it('marks malformed pseudo calls without making them executable', () => {
    const [transcript] = extractPseudoToolTranscripts(
      '<tool_call>{"name":"web_search","arguments":</tool_call>'
    )

    expect(transcript?.parseError).toBeTruthy()
    expect(isPseudoToolTranscriptExecutable(transcript!)).toBe(false)
  })

  it('splits text so renderers can replace pseudo tools with cards', () => {
    const segments = splitTextByPseudoToolTranscripts(
      'hello <tool_call>{"name":"web_search","arguments":{"query":"x"}}</tool_call> done'
    )

    expect(segments.map((segment) => segment.type)).toEqual([
      'text',
      'pseudo-tool-transcript',
      'text',
    ])
  })
})
