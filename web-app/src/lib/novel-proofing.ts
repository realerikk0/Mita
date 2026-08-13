export type NovelProofingRuleCode =
  | 'repeated-punctuation'
  | 'ascii-cjk-punctuation'
  | 'ellipsis-format'
  | 'dash-format'
  | 'space-before-punctuation'
  | 'unmatched-opening-mark'
  | 'unmatched-closing-mark'

export type NovelProofingIssue = {
  id: string
  code: NovelProofingRuleCode
  from: number
  to: number
  source: string
  message: string
  suggestion?: string
  severity: 'warning'
}

export type NovelProofingOptions = {
  /** Only return issues intersecting this half-open range. */
  from?: number
  to?: number
  disabledRules?: readonly NovelProofingRuleCode[]
}

const ASCII_TO_CJK_PUNCTUATION: Readonly<Record<string, string>> = {
  ',': '，',
  '.': '。',
  '!': '！',
  '?': '？',
  ';': '；',
  ':': '：',
}

const PAIR_MARKS: Readonly<Record<string, string>> = {
  '“': '”',
  '‘': '’',
  '（': '）',
  '《': '》',
  '【': '】',
}

const CLOSING_TO_OPENING = Object.fromEntries(
  Object.entries(PAIR_MARKS).map(([opening, closing]) => [closing, opening])
)

function issue(
  code: NovelProofingRuleCode,
  from: number,
  to: number,
  source: string,
  message: string,
  suggestion?: string
): NovelProofingIssue {
  return {
    id: `${code}:${from}:${to}`,
    code,
    from,
    to,
    source,
    message,
    suggestion,
    severity: 'warning',
  }
}

function collectRegexIssues(
  text: string,
  pattern: RegExp,
  create: (match: RegExpExecArray) => NovelProofingIssue | null
) {
  const issues: NovelProofingIssue[] = []
  pattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const next = create(match)
    if (next) issues.push(next)
    if (match[0].length === 0) pattern.lastIndex += 1
  }
  return issues
}

function pairedMarkIssues(text: string) {
  const issues: NovelProofingIssue[] = []
  const stacks = new Map<string, number[]>()

  for (const opening of Object.keys(PAIR_MARKS)) stacks.set(opening, [])

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (PAIR_MARKS[char]) {
      stacks.get(char)!.push(index)
      continue
    }

    const opening = CLOSING_TO_OPENING[char]
    if (!opening) continue
    const stack = stacks.get(opening)!
    if (stack.length > 0) {
      stack.pop()
    } else {
      issues.push(
        issue(
          'unmatched-closing-mark',
          index,
          index + 1,
          char,
          `“${char}”没有对应的左侧符号`
        )
      )
    }
  }

  for (const [opening, positions] of stacks) {
    for (const index of positions) {
      issues.push(
        issue(
          'unmatched-opening-mark',
          index,
          index + 1,
          opening,
          `“${opening}”没有对应的右侧符号`,
          PAIR_MARKS[opening]
        )
      )
    }
  }

  return issues
}

function intersectsRange(
  value: NovelProofingIssue,
  from: number,
  to: number
) {
  return value.from < to && value.to > from
}

/**
 * Runs fast, deterministic punctuation checks. The function never mutates text
 * and deliberately stays local-only; model-backed proofreading is a separate,
 * explicit action.
 */
export function proofNovelText(
  text: string,
  options: NovelProofingOptions = {}
): NovelProofingIssue[] {
  const disabled = new Set(options.disabledRules ?? [])
  const issues: NovelProofingIssue[] = []
  const add = (values: NovelProofingIssue[]) => {
    issues.push(...values.filter((value) => !disabled.has(value.code)))
  }

  add(
    collectRegexIssues(text, /([，。！？；：、])\1+/gu, (match) => {
      const source = match[0]
      const from = match.index
      return issue(
        'repeated-punctuation',
        from,
        from + source.length,
        source,
        '这里的标点重复了',
        source[0]
      )
    })
  )

  add(
    collectRegexIssues(
      text,
      /([\p{Script=Han}])([,.!?;:])(?=[\p{Script=Han}“”‘’（）《》【】]|$)/gu,
      (match) => {
        const punctuation = match[2]!
        const punctuationOffset = match[1]!.length
        const from = match.index + punctuationOffset
        return issue(
          'ascii-cjk-punctuation',
          from,
          from + punctuation.length,
          punctuation,
          '中文句子中使用了半角标点',
          ASCII_TO_CJK_PUNCTUATION[punctuation]
        )
      }
    )
  )

  add(
    collectRegexIssues(text, /\.{3,}|…+/gu, (match) => {
      const source = match[0]
      if (source === '……') return null
      const from = match.index
      return issue(
        'ellipsis-format',
        from,
        from + source.length,
        source,
        '中文省略号建议使用两个“…”',
        '……'
      )
    })
  )

  add(
    collectRegexIssues(text, /—+/gu, (match) => {
      const source = match[0]
      if (source === '——') return null
      const from = match.index
      return issue(
        'dash-format',
        from,
        from + source.length,
        source,
        '中文破折号建议使用两个“—”',
        '——'
      )
    })
  )

  add(
    collectRegexIssues(text, /[\t ]+([，。！？；：、）》】”’])/gu, (match) => {
      const source = match[0]
      const punctuation = match[1]!
      const from = match.index
      return issue(
        'space-before-punctuation',
        from,
        from + source.length,
        source,
        '中文标点前不需要空格',
        punctuation
      )
    })
  )

  add(pairedMarkIssues(text))

  const rangeFrom = Math.max(0, Math.min(options.from ?? 0, text.length))
  const rangeTo = Math.max(
    rangeFrom,
    Math.min(options.to ?? text.length, text.length)
  )

  return issues
    .filter((value) => intersectsRange(value, rangeFrom, rangeTo))
    .sort((left, right) => left.from - right.from || left.to - right.to)
}

export function applyNovelProofingSuggestion(
  text: string,
  value: NovelProofingIssue
) {
  if (value.suggestion === undefined) return text
  if (text.slice(value.from, value.to) !== value.source) return text
  return text.slice(0, value.from) + value.suggestion + text.slice(value.to)
}
