import { describe, expect, it } from 'vitest'

import en from '../locales/en/mita-teams.json'
import zhCN from '../locales/zh-CN/mita-teams.json'
import zhTW from '../locales/zh-TW/mita-teams.json'

describe('Mita Teams locale strings', () => {
  it('adds readable Chinese labels for the team workspace', () => {
    expect(zhCN.channels).toBe('频道')
    expect(zhCN.roles).toBe('角色')
    expect(zhCN.rolesById.orchestrator.name).toBe('主持人')
    expect(zhCN.channelsById.task.label).toBe('当前任务')
    expect(zhCN.modesById.relay.label).toBe('接力')

    expect(zhTW.channels).toBe('頻道')
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
})
