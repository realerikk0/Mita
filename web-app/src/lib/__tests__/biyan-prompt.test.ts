import { describe, expect, it } from 'vitest'

import {
  ensureBiyanIdentityGuard,
  hasBiyanIdentityGuard,
  getToolAwareSystemMessage,
  BIYAN_ASSISTANT_INSTRUCTIONS,
  BIYAN_IDENTITY_GUARD,
} from '../biyan-prompt'

describe('Biyan assistant identity', () => {
  it('uses Biyan and 彼岩 as the current assistant brand', () => {
    expect(BIYAN_IDENTITY_GUARD).toContain('You are Biyan')
    expect(BIYAN_IDENTITY_GUARD).toContain('say that you are Biyan')
    expect(BIYAN_IDENTITY_GUARD).toContain('Chinese app name is "彼岩"')
    expect(BIYAN_IDENTITY_GUARD).not.toContain('You are Mita')
    expect(BIYAN_IDENTITY_GUARD).not.toContain('Chinese app name is "幂塔"')
  })

  it('recognizes and inserts the canonical Biyan identity guard', () => {
    expect(hasBiyanIdentityGuard(BIYAN_ASSISTANT_INSTRUCTIONS)).toBe(true)

    const guarded = ensureBiyanIdentityGuard('Answer briefly.')

    expect(guarded).toContain('You are Biyan')
    expect(guarded).toContain(
      'Never adopt an upstream model or retired product identity'
    )
    expect(guarded).toContain('Answer briefly.')
  })
})

describe('getToolAwareSystemMessage', () => {
  it('removes legacy plain-text search hints when no real tool channel is enabled', () => {
    const legacyInstructions = `${BIYAN_ASSISTANT_INSTRUCTIONS}

2. Use tools when they are needed:
   - Analyze what information is missing.
   - Choose the tool that directly closes that gap.
   - Use precise parameters, then summarize the result clearly.

You have tools to search for and access real-time, up-to-date data. Use them when current or verifiable information matters.`

    const systemMessage = getToolAwareSystemMessage(legacyInstructions, {
      structuredToolsEnabled: false,
      nativeWebSearchEnabled: false,
    })

    expect(systemMessage).not.toContain(
      'You have tools to search for and access real-time'
    )
    expect(systemMessage).not.toContain('Use tools when they are needed')
    expect(systemMessage).toContain(
      'Use structured tools only when they are available'
    )
  })

  it('keeps tool guidance when structured tools or native search are enabled', () => {
    const instructions =
      'You have tools to search for and access real-time, up-to-date data.'

    expect(
      getToolAwareSystemMessage(instructions, {
        structuredToolsEnabled: true,
        nativeWebSearchEnabled: false,
      })
    ).toBe(instructions)
    expect(
      getToolAwareSystemMessage(instructions, {
        structuredToolsEnabled: false,
        nativeWebSearchEnabled: true,
      })
    ).toBe(instructions)
  })

  it('appends the search contract only when native search is enabled for this turn', () => {
    const instructions = 'You are helpful.'
    const searchDecision = {
      enabled: true,
      mode: 'auto' as const,
      depth: 'medium' as const,
      intent: 'news' as const,
      reason: 'The request depends on current news, policy, or announcements.',
    }

    expect(
      getToolAwareSystemMessage(instructions, {
        structuredToolsEnabled: false,
        nativeWebSearchEnabled: true,
        searchDecision,
      })
    ).toContain('Search contract:')

    expect(
      getToolAwareSystemMessage(instructions, {
        structuredToolsEnabled: false,
        nativeWebSearchEnabled: false,
        searchDecision,
      })
    ).not.toContain('Search contract:')
  })

  it('is byte-stable across tool toggles so the prefix stays cacheable', () => {
    const withTools = getToolAwareSystemMessage(BIYAN_ASSISTANT_INSTRUCTIONS, {
      structuredToolsEnabled: true,
      nativeWebSearchEnabled: false,
    })
    const withoutTools = getToolAwareSystemMessage(BIYAN_ASSISTANT_INSTRUCTIONS, {
      structuredToolsEnabled: false,
      nativeWebSearchEnabled: false,
    })
    expect(withTools).toBe(withoutTools)
  })
})
