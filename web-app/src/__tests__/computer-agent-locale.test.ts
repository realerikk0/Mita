import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
    expect(zhCNSettings.computerAgent.allowedRootsShellNote).toContain('支持的平台')
    expect(zhTWSettings.computerAgent.allowedRootsShellNote).toContain('支援的平台')
    expect(zhCNSettings.computerAgent.shellStatusAvailable).toContain(
      '本地命令执行可用'
    )
    expect(zhTWSettings.computerAgent.shellStatusAvailable).toContain(
      '本機命令執行可用'
    )
    expect(zhCNSettings.computerAgent.shellStatusAvailable).not.toMatch(
      /phase|runner|seatbelt/i
    )
    expect(zhTWSettings.computerAgent.shellStatusAvailable).not.toMatch(
      /phase|runner|seatbelt/i
    )
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

  it('keeps active tool approval descriptions free of interpolation markup', () => {
    const localesDir = join(process.cwd(), 'src/locales')

    for (const locale of readdirSync(localesDir)) {
      const toolsPath = join(localesDir, locale, 'tools.json')
      const tools = JSON.parse(readFileSync(toolsPath, 'utf8')) as {
        toolApproval?: { description?: string }
      }
      const description = tools.toolApproval?.description ?? ''

      expect(description, `${locale}/tools.json`).not.toMatch(
        /<[^>]+>|{{\s*toolName\s*}}/
      )
    }
  })
})
