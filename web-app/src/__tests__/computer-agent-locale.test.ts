import { describe, expect, it } from 'vitest'

import zhCNCommon from '../locales/zh-CN/common.json'
import zhCNSettings from '../locales/zh-CN/settings.json'
import zhTWCommon from '../locales/zh-TW/common.json'
import zhTWSettings from '../locales/zh-TW/settings.json'

describe('Computer Agent locale strings', () => {
  it('keeps simplified and traditional Chinese labels readable', () => {
    expect(zhCNCommon.computerAgent).toBe('计算机代理')
    expect(zhTWCommon.computerAgent).toBe('計算機代理')
    expect(zhCNSettings.computerAgent.title).toBe('计算机代理')
    expect(zhTWSettings.computerAgent.title).toBe('計算機代理')
    expect(zhCNSettings.computerAgent.shellTitle).toBe('允许 AI 运行本地命令')
    expect(zhTWSettings.computerAgent.shellTitle).toBe('允許 AI 執行本機命令')
    expect(zhCNSettings.computerAgent.approvalNever).toBe('不询问')
    expect(zhTWSettings.computerAgent.approvalNever).toBe('不詢問')
    expect(zhCNSettings.computerAgent.sandboxReadOnly).toBe('只读')
    expect(zhTWSettings.computerAgent.sandboxReadOnly).toBe('唯讀')
  })

  it('does not contain replacement question-mark placeholders', () => {
    const values = [
      zhCNCommon.computerAgent,
      zhTWCommon.computerAgent,
      ...Object.values(zhCNSettings.computerAgent),
      ...Object.values(zhTWSettings.computerAgent),
    ]

    for (const value of values) {
      expect(String(value)).not.toMatch(/\?{2,}/)
    }
  })
})
