import { describe, expect, it } from 'vitest'

import {
  blockSearchDecision,
  decideChatSearch,
  decideMitaTeamsRoleSearch,
} from '../search-decision'

describe('search decision', () => {
  it('enables chat Auto search for current technology news', () => {
    const decision = decideChatSearch({
      mode: 'auto',
      latestUserText: '查一下今天的科技新闻',
    })

    expect(decision).toMatchObject({
      enabled: true,
      mode: 'auto',
      intent: 'news',
      depth: 'medium',
    })
    expect(decision.reason).toContain('current news')
  })

  it('does not enable chat Auto search for static quicksort explanation', () => {
    const decision = decideChatSearch({
      mode: 'auto',
      latestUserText: '解释 quicksort 时间复杂度',
    })

    expect(decision).toMatchObject({
      enabled: false,
      intent: 'none',
      depth: 'medium',
    })
  })

  it('classifies explicit, technical, finance, and fact-check intents', () => {
    expect(
      decideChatSearch({
        mode: 'auto',
        latestUserText: '联网查一下 Next.js latest release notes',
      })
    ).toMatchObject({
      enabled: true,
      intent: 'technical_docs',
      depth: 'medium',
    })

    expect(
      decideChatSearch({
        mode: 'auto',
        latestUserText: '研究 $MRVL 投资价值',
      })
    ).toMatchObject({
      enabled: true,
      intent: 'market_finance',
      depth: 'medium',
    })

    expect(
      decideChatSearch({
        mode: 'auto',
        latestUserText: '核验这条新闻是否属实',
      })
    ).toMatchObject({
      enabled: true,
      intent: 'fact_check',
      depth: 'medium',
    })
  })

  it('uses high depth for Mita Teams market research role calls', () => {
    const decision = decideMitaTeamsRoleSearch({
      scenarioId: 'market_research',
      roleText: 'Market Analyst investment research',
      instruction: '研究 $MRVL 投资价值',
      userText: '帮我研究 $MRVL 投资价值',
    })

    expect(decision).toMatchObject({
      enabled: true,
      intent: 'market_finance',
      depth: 'high',
    })
  })

  it('records blocked native search without changing original intent', () => {
    const decision = blockSearchDecision(
      decideChatSearch({
        mode: 'auto',
        latestUserText: '查一下今天的科技新闻',
      }),
      'Assigned model does not support native web search.'
    )

    expect(decision).toMatchObject({
      enabled: false,
      intent: 'news',
      depth: 'medium',
      blockedReason: 'Assigned model does not support native web search.',
    })
  })
})
