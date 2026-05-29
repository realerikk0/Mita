export type PseudoToolTranscriptKind =
  | 'xml-tool-call'
  | 'xml-tool-response'
  | 'function-call'

export type PseudoToolTranscript = {
  kind: PseudoToolTranscriptKind
  raw: string
  start: number
  end: number
  toolName?: string
  input?: Record<string, unknown>
  parseError?: string
}

export type PseudoToolTranscriptSegment =
  | { type: 'text'; text: string }
  | { type: 'pseudo-tool-transcript'; transcript: PseudoToolTranscript }

const XML_TOOL_CALL_RE =
  /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>(?:\s*<tool_response>\s*([\s\S]*?)\s*<\/tool_response>)?/gi
const XML_TOOL_RESPONSE_RE =
  /<tool_response>\s*([\s\S]*?)\s*<\/tool_response>/gi
const WEB_SEARCH_CALL_RE = /\bweb_search\s*\(/gi

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function normalizeInput(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value
  if (typeof value === 'string') return parseJsonRecord(value)
  return undefined
}

function parseXmlToolCall(rawPayload: string): Pick<
  PseudoToolTranscript,
  'toolName' | 'input' | 'parseError'
> {
  const parsed = parseJsonRecord(rawPayload.trim())
  if (!parsed) {
    return { parseError: 'Tool call JSON could not be parsed.' }
  }

  const toolName =
    typeof parsed.name === 'string'
      ? parsed.name
      : typeof parsed.tool_name === 'string'
        ? parsed.tool_name
        : typeof parsed.tool === 'string'
          ? parsed.tool
          : undefined
  const input = normalizeInput(parsed.arguments ?? parsed.args ?? parsed.input)

  if (!toolName) {
    return { parseError: 'Tool name is missing.' }
  }
  if (!input) {
    return { toolName, parseError: 'Tool arguments could not be parsed.' }
  }

  return { toolName, input }
}

function findBalancedJsonObject(
  text: string,
  searchStart: number
): { start: number; end: number } | undefined {
  const start = text.indexOf('{', searchStart)
  if (start === -1) return undefined

  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index++) {
    const char = text[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0) {
        return { start, end: index + 1 }
      }
    }
  }

  return undefined
}

function findFunctionCallEnd(text: string, searchStart: number): number {
  const closingParen = text.indexOf(')', searchStart)
  return closingParen === -1 ? searchStart : closingParen + 1
}

function overlaps(
  candidate: Pick<PseudoToolTranscript, 'start' | 'end'>,
  existing: PseudoToolTranscript[]
) {
  return existing.some(
    (item) => candidate.start < item.end && candidate.end > item.start
  )
}

export function extractPseudoToolTranscripts(
  text: string
): PseudoToolTranscript[] {
  const transcripts: PseudoToolTranscript[] = []

  for (const match of text.matchAll(XML_TOOL_CALL_RE)) {
    const raw = match[0]
    const start = match.index ?? 0
    const end = start + raw.length
    const parsed = parseXmlToolCall(match[1] ?? '')

    transcripts.push({
      kind: 'xml-tool-call',
      raw,
      start,
      end,
      ...parsed,
    })
  }

  for (const match of text.matchAll(XML_TOOL_RESPONSE_RE)) {
    const raw = match[0]
    const start = match.index ?? 0
    const end = start + raw.length
    if (overlaps({ start, end }, transcripts)) continue

    transcripts.push({
      kind: 'xml-tool-response',
      raw,
      start,
      end,
      parseError: 'Tool response appeared without a parseable tool call.',
    })
  }

  for (const match of text.matchAll(WEB_SEARCH_CALL_RE)) {
    const start = match.index ?? 0
    const jsonRange = findBalancedJsonObject(text, start)
    const fallbackEnd = findFunctionCallEnd(text, start)
    const end = jsonRange ? findFunctionCallEnd(text, jsonRange.end) : fallbackEnd
    if (overlaps({ start, end }, transcripts)) continue

    const raw = text.slice(start, end)
    const input = jsonRange
      ? parseJsonRecord(text.slice(jsonRange.start, jsonRange.end))
      : undefined

    transcripts.push({
      kind: 'function-call',
      raw,
      start,
      end,
      toolName: 'web_search',
      input,
      parseError: input ? undefined : 'Tool arguments could not be parsed.',
    })
  }

  return transcripts.sort((a, b) => a.start - b.start)
}

export function splitTextByPseudoToolTranscripts(
  text: string
): PseudoToolTranscriptSegment[] {
  const transcripts = extractPseudoToolTranscripts(text)
  if (transcripts.length === 0) return [{ type: 'text', text }]

  const segments: PseudoToolTranscriptSegment[] = []
  let cursor = 0

  for (const transcript of transcripts) {
    if (transcript.start > cursor) {
      segments.push({ type: 'text', text: text.slice(cursor, transcript.start) })
    }
    segments.push({ type: 'pseudo-tool-transcript', transcript })
    cursor = transcript.end
  }

  if (cursor < text.length) {
    segments.push({ type: 'text', text: text.slice(cursor) })
  }

  return segments.filter(
    (segment) => segment.type !== 'text' || segment.text.length > 0
  )
}

export function isPseudoToolTranscriptExecutable(
  transcript: PseudoToolTranscript
): transcript is PseudoToolTranscript & {
  toolName: string
  input: Record<string, unknown>
} {
  return Boolean(transcript.toolName && transcript.input && !transcript.parseError)
}
