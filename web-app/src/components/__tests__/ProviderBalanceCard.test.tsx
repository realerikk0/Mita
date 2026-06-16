import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProviderBalanceContent } from '../ProviderBalanceCard'
import { getProviderBalanceBadgeLabel } from '@/lib/provider-balance-display'
import type { ProviderBalanceStatus } from '@/services/providers/types'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'common:providerBalance.availableBalance': '可用余额',
        'common:providerBalance.quotaPoints': '额度点',
        'common:providerBalance.unlimitedKey': '不限额 Key',
        'common:providerBalance.accountUnavailableTitle': '无法获取账户余额',
        'common:providerBalance.keyLimitOnly': '仅获取到 Key 限额信息',
        'common:providerBalance.needsManagementTitle': '需要管理权限',
        'common:providerBalance.notices.openrouterOverdrawn': '已透支 {{amount}}',
        'common:providerBalance.notices.deepseekUnavailable': '账户不可用',
        'common:providerBalance.keyLimitRemaining': '此 Key 限额剩余 {{value}}',
        'common:providerBalance.accountUsed': '账户已用',
        'common:providerBalance.keyUsed': 'Key 已用',
        'common:providerBalance.updatedAt': '更新时间',
        'common:providerBalance.refresh': '刷新',
        'common:providerBalance.topup': '去充值',
        'common:providerBalance.sourceNote':
          '{{provider}} 的主余额来自账户钱包；Key 限额只用于解释当前密钥状态。',
        'common:providerBalance.tokenStatus.normal': '正常',
        'common:providerBalance.tokenStatus.disabled': '已禁用',
        'common:providerBalance.tokenStatus.expired': '已过期',
        'common:providerBalance.tokenStatus.exhausted': '已耗尽',
        'common:providerBalance.keyStatus': 'Key {{status}}',
      }
      return (translations[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name) =>
        String(options?.[name] ?? `{{${name}}}`)
      )
    },
  }),
}))

const biyuanWithAccount: ProviderBalanceStatus = {
  state: 'supported',
  provider: 'jingxing',
  unit: 'quota',
  fetchedAt: 1781260326,
  accountBalance: {
    available: 38563951,
    used: 68391621,
    total: 106955572,
  },
  moneyBalance: {
    available: 77.127902,
    used: 136.783242,
    total: 213.911144,
    currency: 'USD',
  },
  tokenLimit: {
    available: 0,
    used: 0,
    total: 0,
    unlimited: true,
    status: 1,
  },
  links: {
    topup: 'https://api.biyuan.ai/console/topup',
  },
}

describe('ProviderBalanceCard', () => {
  it('renders Biyuan available money as the main value and marks unlimited keys', () => {
    render(
      <ProviderBalanceContent
        provider={{ provider: 'jingxing' } as ModelProvider}
        balance={biyuanWithAccount}
        loading={false}
        onRefresh={() => undefined}
      />
    )

    expect(screen.getByText('可用余额')).toBeInTheDocument()
    expect(screen.getByText('$77.13')).toBeInTheDocument()
    expect(screen.queryByText('38,563,951 额度点')).not.toBeInTheDocument()
    expect(screen.getByText('不限额 Key')).toBeInTheDocument()
    expect(screen.queryByText('0 额度点')).not.toBeInTheDocument()
    expect(screen.getByText('$136.78')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /去充值/ })).toHaveAttribute(
      'href',
      'https://api.biyuan.ai/console/topup'
    )
  })

  it('derives Biyuan available money from quota points when money balance is missing', () => {
    render(
      <ProviderBalanceContent
        provider={{ provider: 'jingxing' } as ModelProvider}
        balance={{
          ...biyuanWithAccount,
          moneyBalance: undefined,
        }}
        loading={false}
        onRefresh={() => undefined}
      />
    )

    expect(screen.getByText('$77.13')).toBeInTheDocument()
    expect(screen.queryByText('38,563,951 额度点')).not.toBeInTheDocument()
  })

  it('falls back to quota points for unknown quota providers', () => {
    render(
      <ProviderBalanceContent
        provider={{ provider: 'custom-quota' } as ModelProvider}
        balance={{
          ...biyuanWithAccount,
          provider: 'custom-quota',
          moneyBalance: undefined,
        }}
        loading={false}
        onRefresh={() => undefined}
      />
    )

    expect(screen.getByText('38,563,951 额度点')).toBeInTheDocument()
  })

  it('keeps showing Biyuan balance for limited or exhausted keys', () => {
    render(
      <ProviderBalanceContent
        provider={{ provider: 'jingxing' } as ModelProvider}
        balance={{
          ...biyuanWithAccount,
          tokenLimit: {
            available: 500000,
            used: 250000,
            total: 750000,
            unlimited: false,
            status: 4,
          },
        }}
        loading={false}
        onRefresh={() => undefined}
      />
    )

    expect(screen.getByText('$77.13')).toBeInTheDocument()
    expect(screen.getByText('此 Key 限额剩余 $1.00')).toBeInTheDocument()
    expect(screen.getByText('Key 已耗尽')).toBeInTheDocument()
    expect(screen.getByText('$0.50')).toBeInTheDocument()
  })

  it('explains missing Biyuan account balance only in settings content', () => {
    render(
      <ProviderBalanceContent
        provider={{ provider: 'jingxing' } as ModelProvider}
        balance={{
          state: 'supported',
          provider: 'jingxing',
          unit: 'quota',
          fetchedAt: 1781258144,
          tokenLimit: {
            available: -15388303,
            used: 17293693,
            total: 1905390,
            unlimited: true,
            status: 1,
          },
        }}
        loading={false}
        onRefresh={() => undefined}
      />
    )

    expect(screen.getByText('无法获取账户余额')).toBeInTheDocument()
    expect(screen.getByText('仅获取到 Key 限额信息')).toBeInTheDocument()
    expect(screen.getByText('不限额 Key')).toBeInTheDocument()
    expect(screen.queryByText('-15,388,303 额度点')).not.toBeInTheDocument()
  })

  it('shows needs-extra-auth providers as management permission requirements', () => {
    render(
      <ProviderBalanceContent
        provider={{ provider: 'xai' } as ModelProvider}
        balance={{
          state: 'needs_extra_auth',
          provider: 'xai',
          reason: 'xAI billing lookup requires a management key and team id.',
          required: ['management key', 'team id'],
          link: 'https://console.x.ai/',
        }}
        loading={false}
        onRefresh={() => undefined}
      />
    )

    expect(screen.getByText('需要管理权限')).toBeInTheDocument()
    expect(screen.getByText('management key, team id')).toBeInTheDocument()
  })

  it('does not create a chat badge label without real account balance', () => {
    expect(
      getProviderBalanceBadgeLabel({
        state: 'supported',
        provider: 'jingxing',
        unit: 'quota',
        fetchedAt: 1781258144,
        tokenLimit: {
          available: -15388303,
          used: 17293693,
          total: 1905390,
          unlimited: true,
        },
      })
    ).toBeNull()
  })

  it('creates a compact chat badge label from available money first', () => {
    expect(
      getProviderBalanceBadgeLabel(biyuanWithAccount, {
        balancePrefix: '余额',
        quotaUnitLabel: '额度点',
      })
    ).toBe('余额 $77.13')
  })

  it('formats available money with two decimals when currency is omitted', () => {
    expect(
      getProviderBalanceBadgeLabel(
        {
          ...biyuanWithAccount,
          moneyBalance: {
            available: 77.127902,
          },
        },
        {
          balancePrefix: '余额',
          quotaUnitLabel: '额度点',
        }
      )
    ).toBe('余额 77.13')
  })

  it('derives compact Biyuan chat badge labels from quota points', () => {
    expect(
      getProviderBalanceBadgeLabel(
        {
          ...biyuanWithAccount,
          moneyBalance: undefined,
        },
        {
          balancePrefix: '余额',
          quotaUnitLabel: '额度点',
        }
      )
    ).toBe('余额 $77.13')
  })

  it('falls back to quota points for compact unknown quota badge labels', () => {
    expect(
      getProviderBalanceBadgeLabel(
        {
          ...biyuanWithAccount,
          provider: 'custom-quota',
          moneyBalance: undefined,
        },
        {
          balancePrefix: '余额',
          quotaUnitLabel: '额度点',
        }
      )
    ).toBe('余额 38,563,951 额度点')
  })

  it('shows OpenRouter overdrawn credits as zero available with warning', () => {
    render(
      <ProviderBalanceContent
        provider={{ provider: 'openrouter' } as ModelProvider}
        balance={{
          state: 'supported',
          provider: 'openrouter',
          unit: 'usd',
          currency: 'USD',
          fetchedAt: 1781260326,
          accountBalance: {
            available: 0,
            used: 13.2,
            total: 10,
          },
          notice: {
            code: 'openrouter_overdrawn',
            tone: 'warning',
            amount: 3.2,
            currency: 'USD',
          },
        }}
        loading={false}
        onRefresh={() => undefined}
      />
    )

    expect(screen.getByText('$0.00')).toBeInTheDocument()
    expect(screen.getByText('已透支 $3.20')).toBeInTheDocument()
  })

  it('hides compact badge labels for unavailable DeepSeek accounts', () => {
    const deepseekUnavailable: ProviderBalanceStatus = {
      state: 'supported',
      provider: 'deepseek',
      unit: 'currency',
      currency: 'CNY',
      fetchedAt: 1781260326,
      accountBalance: {
        available: 88.25,
        total: 88.25,
      },
      notice: {
        code: 'deepseek_unavailable',
        tone: 'warning',
        hideBadge: true,
      },
    }

    render(
      <ProviderBalanceContent
        provider={{ provider: 'deepseek' } as ModelProvider}
        balance={deepseekUnavailable}
        loading={false}
        onRefresh={() => undefined}
      />
    )

    expect(screen.getByText('账户不可用')).toBeInTheDocument()
    expect(getProviderBalanceBadgeLabel(deepseekUnavailable)).toBeNull()
  })
})
