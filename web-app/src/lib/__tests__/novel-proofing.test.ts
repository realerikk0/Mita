import { describe, expect, it } from 'vitest'
import {
  applyNovelProofingSuggestion,
  proofNovelText,
} from '@/lib/novel-proofing'

describe('proofNovelText', () => {
  it('finds deterministic Chinese punctuation issues without changing input', () => {
    const text = '他愣住了，，低声说:“等等...”'
    const original = text
    const issues = proofNovelText(text)

    expect(text).toBe(original)
    expect(issues.map((value) => value.code)).toEqual([
      'repeated-punctuation',
      'ascii-cjk-punctuation',
      'ellipsis-format',
    ])
    expect(issues[0]?.suggestion).toBe('，')
    expect(issues[1]?.suggestion).toBe('：')
    expect(issues[2]?.suggestion).toBe('……')
  })

  it('accepts standard ellipses, dashes, and paired Chinese marks', () => {
    expect(
      proofNovelText('“等等……”他看向《照骨天书》——一切才刚开始。')
    ).toEqual([])
  })

  it('reports unmatched opening and closing marks', () => {
    const issues = proofNovelText('他说：“今夜不走。】')
    expect(issues.map((value) => value.code)).toEqual([
      'unmatched-opening-mark',
      'unmatched-closing-mark',
    ])
  })

  it('filters issues to an incremental scan range', () => {
    const text = '甲，，乙。丙！！丁。'
    const secondIssue = text.indexOf('！！')
    const issues = proofNovelText(text, {
      from: secondIssue,
      to: secondIssue + 2,
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      code: 'repeated-punctuation',
      source: '！！',
    })
  })

  it('supports disabling a noisy local rule', () => {
    const issues = proofNovelText('等等...', {
      disabledRules: ['ellipsis-format'],
    })
    expect(issues).toEqual([])
  })
})

describe('applyNovelProofingSuggestion', () => {
  it('applies only when the source text still matches', () => {
    const text = '他愣住了，，却没说话。'
    const value = proofNovelText(text)[0]!

    expect(applyNovelProofingSuggestion(text, value)).toBe(
      '他愣住了，却没说话。'
    )
    expect(applyNovelProofingSuggestion(`已改 ${text}`, value)).toBe(`已改 ${text}`)
  })
})
