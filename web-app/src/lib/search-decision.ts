import type { UIMessage } from 'ai'

export type SearchMode = 'off' | 'auto' | 'on'
export type SearchDepth = 'low' | 'medium' | 'high'
export type SearchIntent =
  | 'explicit_search'
  | 'fresh_fact'
  | 'technical_docs'
  | 'market_finance'
  | 'news'
  | 'citation_required'
  | 'fact_check'
  | 'none'

export type SearchDecision = {
  enabled: boolean
  mode: SearchMode
  depth: SearchDepth
  intent: SearchIntent
  reason: string
  blockedReason?: string
}

const SEARCH_OFF_REASON = 'Web search is off for this turn.'
const SEARCH_NOT_NEEDED_REASON =
  'The request does not need fresh or externally verifiable information.'

const EXPLICIT_SEARCH_RE =
  /(联网|上网|搜索|搜尋|检索|檢索|查一下|查下|查找|查证|查證|web\s*search|search\s+the\s+web|look\s+up|browse|google|来源|信源|引用|cite|citation|source)/i
const FRESH_FACT_RE =
  /(最新|今天|今日|当前|當前|现在|現在|最近|实时|實時|目前|刚刚|剛剛|this\s+(?:week|month|year)|today|current|latest|recent|now|real[-\s]?time|schedule|日程|天气|天氣|价格|價格)/i
const TECHNICAL_DOCS_RE =
  /(sdk|api|版本|release\s*notes?|breaking\s+changes?|github\s+(?:issue|repo|release)|cve|漏洞|官方文档|官方文件|docs?|documentation|changelog|npm|pypi|crates\.io)/i
const MARKET_FINANCE_RE =
  /(股票|股价|股價|财报|財報|估值|汇率|匯率|行情|投资价值|投資價值|市值|营收|營收|earnings|stock|share\s+price|valuation|exchange\s+rate|market|finance|financial|invest(?:ment)?|sec\s+filing|10-k|10-q)/i
const NEWS_POLICY_RE =
  /(新闻|新聞|政策|法规|法規|监管|監管|公告|press\s+release|news|policy|regulation|law|government|election)/i
const FACT_CHECK_RE =
  /(核验|核驗|验证|驗證|查证|查證|事实核查|真假|辟谣|闢謠|是否属实|是否屬實|fact[-\s]?check|verify|validate|debunk|true\s+or\s+false|is\s+it\s+true)/i
const WRITING_ONLY_RE =
  /^(?:请|幫我|帮我|please\s+)?(?:翻译|翻譯|润色|潤色|改写|改寫|总结|總結|摘要|rewrite|polish|translate|summari[sz]e|copyedit)\b/i
const CODE_OR_STATIC_EXPLANATION_RE =
  /(解释|解釋|讲解|說明|说明|explain).*(quicksort|quick\s*sort|时间复杂度|時間複雜度|time\s+complexity|二叉树|binary\s+tree|算法|algorithm)|\b(?:prove|calculate|solve)\b.*\b(?:math|equation|integral|derivative)\b/i
const DEEP_RESEARCH_RE =
  /(深度|深入|完整调研|完整調研|投资研究|投資研究|研究报告|研究報告|事实核验|事實核驗|技术调研|技術調研|deep\s+research|in-depth|investment\s+research|research\s+report|thorough)/i

function baseDecision(
  mode: SearchMode,
  overrides: Partial<SearchDecision>
): SearchDecision {
  return {
    enabled: false,
    mode,
    depth: 'medium',
    intent: 'none',
    reason: SEARCH_NOT_NEEDED_REASON,
    ...overrides,
  }
}

export function webSearchModeFromEnabled(
  enabled: boolean,
  mode?: SearchMode
): SearchMode {
  if (mode) return mode
  return enabled ? 'auto' : 'off'
}

export function extractLatestUserTextForSearch(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'user') continue
    const chunks = (message.parts ?? [])
      .flatMap((part) => {
        if (!part || typeof part !== 'object') return []
        const typed = part as { type?: string; text?: string }
        return typed.type === 'text' && typed.text ? [typed.text.trim()] : []
      })
      .filter(Boolean)
    if (chunks.length > 0) return chunks.join('\n')
  }
  return ''
}

export function decideChatSearch(options: {
  mode: SearchMode
  latestUserText: string
}): SearchDecision {
  const text = options.latestUserText.trim()
  const mode = options.mode

  if (mode === 'off') {
    return baseDecision(mode, {
      reason: SEARCH_OFF_REASON,
    })
  }

  if (!text) {
    return baseDecision(mode, {
      reason: 'No user text is available for a search decision.',
    })
  }

  if (mode === 'on') {
    return baseDecision(mode, {
      enabled: true,
      depth: DEEP_RESEARCH_RE.test(text) ? 'high' : 'medium',
      intent: 'explicit_search',
      reason: 'Web search is forced on by the user setting.',
    })
  }

  if (WRITING_ONLY_RE.test(text) || CODE_OR_STATIC_EXPLANATION_RE.test(text)) {
    return baseDecision(mode, {
      reason: SEARCH_NOT_NEEDED_REASON,
    })
  }

  if (FACT_CHECK_RE.test(text)) {
    return baseDecision(mode, {
      enabled: true,
      depth: DEEP_RESEARCH_RE.test(text) ? 'high' : 'medium',
      intent: 'fact_check',
      reason: 'The user asked to verify whether a claim is true.',
    })
  }

  if (MARKET_FINANCE_RE.test(text)) {
    return baseDecision(mode, {
      enabled: true,
      depth: DEEP_RESEARCH_RE.test(text) ? 'high' : 'medium',
      intent: 'market_finance',
      reason: 'The request depends on current market or financial data.',
    })
  }

  if (TECHNICAL_DOCS_RE.test(text)) {
    return baseDecision(mode, {
      enabled: true,
      depth: DEEP_RESEARCH_RE.test(text) ? 'high' : 'medium',
      intent: 'technical_docs',
      reason: 'The request may depend on current technical documentation or releases.',
    })
  }

  if (NEWS_POLICY_RE.test(text)) {
    return baseDecision(mode, {
      enabled: true,
      depth: FRESH_FACT_RE.test(text) ? 'medium' : 'low',
      intent: 'news',
      reason: 'The request depends on current news, policy, or announcements.',
    })
  }

  if (FRESH_FACT_RE.test(text)) {
    return baseDecision(mode, {
      enabled: true,
      depth: 'medium',
      intent: 'fresh_fact',
      reason: 'The request depends on fresh or current information.',
    })
  }

  if (EXPLICIT_SEARCH_RE.test(text)) {
    return baseDecision(mode, {
      enabled: true,
      depth: DEEP_RESEARCH_RE.test(text) ? 'high' : 'low',
      intent: text.match(/来源|信源|引用|cite|citation|source/i)
        ? 'citation_required'
        : 'explicit_search',
      reason: 'The user explicitly asked Mita to search or cite sources.',
    })
  }

  return baseDecision(mode, {
    reason: SEARCH_NOT_NEEDED_REASON,
  })
}

export function decideMitaTeamsRoleSearch(options: {
  mode?: SearchMode
  scenarioId?: string
  roleText: string
  instruction: string
  userText: string
}): SearchDecision {
  const mode = options.mode ?? 'auto'
  if (mode === 'off') {
    return baseDecision(mode, { reason: SEARCH_OFF_REASON })
  }

  const combined = [options.userText, options.instruction, options.roleText]
    .join('\n')
    .trim()
  const lower = combined.toLowerCase()
  const isMarketScenario =
    options.scenarioId === 'market_research' || MARKET_FINANCE_RE.test(combined)
  const isSkepticOrFactCheck =
    /(skeptic|fact|verify|truth|source|risk|review|核验|核驗|查证|查證|事实|事實|来源|信源)/i.test(
      lower
    )
  const isResearcher =
    /(research|scout|analyst|investigate|调研|調研|研究|分析|检索|檢索)/i.test(
      lower
    )

  if (mode === 'on') {
    return baseDecision(mode, {
      enabled: true,
      depth: isMarketScenario || isResearcher ? 'high' : 'medium',
      intent: isMarketScenario ? 'market_finance' : 'explicit_search',
      reason: 'Web search is forced on for this role call.',
    })
  }

  if (isMarketScenario) {
    return baseDecision(mode, {
      enabled: true,
      depth: 'high',
      intent: 'market_finance',
      reason: 'This role call needs current market or investment data before analysis.',
    })
  }

  if (FACT_CHECK_RE.test(combined) || isSkepticOrFactCheck) {
    return baseDecision(mode, {
      enabled: true,
      depth: DEEP_RESEARCH_RE.test(combined) ? 'high' : 'medium',
      intent: 'fact_check',
      reason: 'This role call needs source verification or skeptical fact checking.',
    })
  }

  if (isResearcher && (FRESH_FACT_RE.test(combined) || EXPLICIT_SEARCH_RE.test(combined))) {
    return baseDecision(mode, {
      enabled: true,
      depth: DEEP_RESEARCH_RE.test(combined) ? 'high' : 'medium',
      intent: EXPLICIT_SEARCH_RE.test(combined) ? 'explicit_search' : 'fresh_fact',
      reason: 'This research role call needs current or source-grounded inputs.',
    })
  }

  return baseDecision(mode, {
    reason: SEARCH_NOT_NEEDED_REASON,
  })
}

export function blockSearchDecision(
  decision: SearchDecision,
  blockedReason: string
): SearchDecision {
  if (!decision.enabled) return { ...decision, blockedReason }
  return {
    ...decision,
    enabled: false,
    blockedReason,
  }
}

export function searchDecisionMetadata(
  decision: SearchDecision,
  options: {
    transport?: string
    sourceCount?: number
  } = {}
): Record<string, unknown> {
  return {
    web_search_enabled: decision.enabled,
    web_search_mode: decision.mode,
    web_search_intent: decision.intent,
    web_search_reason: decision.reason,
    web_search_depth: decision.depth,
    web_search_transport: options.transport ?? (decision.enabled ? 'native' : 'none'),
    source_count: options.sourceCount ?? 0,
    blocked_reason: decision.blockedReason,
  }
}
