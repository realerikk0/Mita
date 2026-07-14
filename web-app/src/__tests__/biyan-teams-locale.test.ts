import { describe, expect, it } from 'vitest'

import en from '../locales/en/biyan-teams.json'
import zhCN from '../locales/zh-CN/biyan-teams.json'
import zhTW from '../locales/zh-TW/biyan-teams.json'

describe('Biyan Teams locale strings', () => {
  it('adds readable Chinese labels for the team workspace', () => {
    expect(zhCN.channels).toBe('频道')
    expect(zhCN.roles).toBe('角色')
    expect(zhCN.host).toBe('主持人')
    expect(zhCN.you).toBe('你')
    expect(zhCN.runtimeThinking).toBe('思考中...')
    expect(zhCN.rolesById.orchestrator.name).toBe('主持人')
    expect(zhCN.channelsById.task.label).toBe('当前任务')
    expect(zhCN.modesById.relay.label).toBe('接力')

    expect(zhTW.channels).toBe('頻道')
    expect(zhTW.host).toBe('主持人')
    expect(zhTW.rolesById.orchestrator.name).toBe('主持人')
    expect(zhTW.channelsById.task.label).toBe('目前任務')
    expect(zhTW.modesById.relay.label).toBe('接力')
  })

  it('does not localize role prompts in locale files', () => {
    for (const locale of [en, zhCN, zhTW]) {
      for (const role of Object.values(locale.rolesById)) {
        expect(role).not.toHaveProperty('prompt')
      }
    }
  })

  it('keeps every locale at full key parity with English', () => {
    const collectKeys = (value: unknown, prefix = ''): string[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      return Object.entries(value as Record<string, unknown>).flatMap(
        ([key, child]) => {
          const path = prefix ? `${prefix}.${key}` : key
          return [path, ...collectKeys(child, path)]
        }
      )
    }

    const enKeys = collectKeys(en).sort()
    // A missing key here means a locale silently falls back to English in the
    // UI — most damaging on the trust-critical plan-approval gate (zh-TW
    // regressed exactly this way before). Keep all locales in lockstep.
    expect(collectKeys(zhCN).sort()).toEqual(enKeys)
    expect(collectKeys(zhTW).sort()).toEqual(enKeys)
  })
})
