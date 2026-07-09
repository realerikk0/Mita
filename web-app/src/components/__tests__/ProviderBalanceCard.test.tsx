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
        'common:providerBalance.walletBalance': '钱包余额',
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
        'common:providerBalance.billingPreference.subscriptionFirst': '优先套餐',
        'common:providerBalance.billingPreference.walletFirst': '优先钱包',
        'common:providerBalance.billingPreference.subscriptionOnly': '仅套餐',
        'common:providerBalance.billingPreference.walletOnly': '仅钱包',
        'common:providerBalance.subscription.currentPlan': '当前套餐',
        'common:providerBalance.subscription.availableSuffix': '可用',
        'common:providerBalance.subscription.weeklyCompact': '7天',
        'common:providerBalance.subscription.weeklyRemaining': '7 天窗口剩余',
        'common:providerBalance.subscription.weeklyReset': '7 天窗口重置',
        'common:providerBalance.subscription.fiveHourRemaining': '5 小时窗口剩余',
        'common:providerBalance.subscription.fiveHourReset': '5 小时窗口重置',
        'common:providerBalance.subscription.period': '套餐有效期',
        'common:providerBalance.subscription.status': '套餐 {{status}}',
        'common:providerBalance.subscription.statusActive': '生效中',
        'common:providerBalance.subscription.statusCanceled': '已取消',
        'common:providerBalance.subscription.statusDisabled': '已禁用',
        'common:providerBalance.subscription.statusExpired': '已过期',
        'common:providerBalance.subscription.startsAt': '{{value}} 开始',
        'common:providerBalance.subscription.endsAt': '{{value}} 结束',
        'common:providerBalance.subscription.unavailable': '旧版服务未提供套餐信息',
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

const biyuanWithSubscription: ProviderBalanceStatus = {
  ...biyuanWithAccount,
  tokenLimit: {
    available: 75000,
    used: 25000,
    total: 100000,
    unlimited: false,
    status: 1,
  },
  subscription: {
    active: true,
    billingPreference: 'subscription_first',
    subscriptions: [
      {
        title: 'Biyuan Pro',
        planCode: 'biyuan_pro',
        startTime: 1783209600,
        endTime: 1785801600,
        status: 'active',
        weeklyWindow: {
          limit: 700000,
          used: 140000,
          available: 560000,
          resetAt: 1783814400,
          availablePercent: 0.8,
        },
        fiveHourWindow: {
          limit: 100000,
          used: 75000,
          available: 25000,
          resetAt: 1783227600,
          availablePercent: 0.25,
        },
        features: ['text', 'image', 'audio_transcription'],
      },
      {
        title: 'Biyuan Team',
        planCode: 'biyuan_team',
        weeklyWindow: { limit: 100, available: 50, availablePercent: 0.5 },
        fiveHourWindow: { limit: 100, available: 10, availablePercent: 0.1 },
        features: ['all'],
      },
    ],
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

  it('renders the first active Biyuan subscription as the main balance view', () => {
    const formatReset = (value: number) =>
      new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value * 1000))

    render(
      <ProviderBalanceContent
        provider={{ provider: 'jingxing' } as ModelProvider}
        balance={biyuanWithSubscription}
        loading={false}
        onRefresh={() => undefined}
      />
    )

    expect(screen.getByText('当前套餐')).toBeInTheDocument()
    expect(screen.getByText('Biyuan Pro · 7天 80% 可用')).toBeInTheDocument()
    expect(screen.getByText('7 天窗口剩余')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getByText('5 小时窗口剩余')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByText('7 天窗口重置')).toBeInTheDocument()
    expect(screen.getByText(formatReset(1783814400))).toBeInTheDocument()
    expect(screen.getByText('5 小时窗口重置')).toBeInTheDocument()
    expect(screen.getByText(formatReset(1783227600))).toBeInTheDocument()
    expect(screen.getByText('钱包余额')).toBeInTheDocument()
    expect(screen.getByText('$77.13')).toBeInTheDocument()
    expect(screen.getByText('套餐 生效中')).toBeInTheDocument()
    expect(screen.getByText('优先套餐')).toBeInTheDocument()
    expect(screen.getByText('Key 正常')).toBeInTheDocument()
    expect(screen.queryByText('1,000,000 额度点')).not.toBeInTheDocument()
    expect(screen.queryByText('100,000 额度点')).not.toBeInTheDocument()
  })

  it('falls back to quota points when Biyuan money balance is missing', () => {
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

    expect(screen.getByText('38,563,951 额度点')).toBeInTheDocument()
    expect(screen.queryByText('$77.13')).not.toBeInTheDocument()
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
    expect(screen.getByText('此 Key 限额剩余 500,000 额度点')).toBeInTheDocument()
    expect(screen.getByText('Key 已耗尽')).toBeInTheDocument()
    expect(screen.getByText('250,000 额度点')).toBeInTheDocument()
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

  it('marks legacy Biyuan fallback responses as subscription unavailable', () => {
    render(
      <ProviderBalanceContent
        provider={{ provider: 'jingxing' } as ModelProvider}
        balance={{
          state: 'supported',
          provider: 'jingxing',
          unit: 'quota',
          fetchedAt: 1781258144,
          tokenLimit: {
            available: 678.5,
            used: 321.5,
            total: 1000,
            unlimited: false,
          },
          subscription: {
            active: false,
            subscriptions: [],
            unavailable: true,
          },
        }}
        loading={false}
        onRefresh={() => undefined}
      />
    )

    expect(screen.getByText('旧版服务未提供套餐信息')).toBeInTheDocument()
    expect(screen.getByText('此 Key 限额剩余 679 额度点')).toBeInTheDocument()
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

  it('creates compact chat badge labels from Biyuan subscription weekly window', () => {
    expect(
      getProviderBalanceBadgeLabel(biyuanWithSubscription, {
        balancePrefix: '余额',
        quotaUnitLabel: '额度点',
        weeklyWindowLabel: '7天',
      })
    ).toBe('余额 7天 80%')
  })

  it('uses wallet balance first when Biyuan billing preference is wallet_first', () => {
    const walletFirst = {
      ...biyuanWithSubscription,
      subscription: {
        ...biyuanWithSubscription.subscription!,
        billingPreference: 'wallet_first' as const,
      },
    }

    render(
      <ProviderBalanceContent
        provider={{ provider: 'jingxing' } as ModelProvider}
        balance={walletFirst}
        loading={false}
        onRefresh={() => undefined}
      />
    )

    expect(screen.getByText('可用余额')).toBeInTheDocument()
    expect(screen.getByText('$77.13')).toBeInTheDocument()
    expect(screen.queryByText('Biyuan Pro · 7天 80% 可用')).not.toBeInTheDocument()
    expect(
      getProviderBalanceBadgeLabel(walletFirst, {
        balancePrefix: '余额',
        quotaUnitLabel: '额度点',
        weeklyWindowLabel: '7天',
      })
    ).toBe('余额 $77.13')
  })

  it('chooses the first active subscription plan for Biyuan subscription display', () => {
    const mixedPlans = {
      ...biyuanWithSubscription,
      subscription: {
        ...biyuanWithSubscription.subscription!,
        subscriptions: [
          {
            ...biyuanWithSubscription.subscription!.subscriptions[0],
            title: 'Expired Pro',
            status: 'expired',
            weeklyWindow: {
              limit: 700000,
              available: 0,
              availablePercent: 0,
            },
          },
          {
            ...biyuanWithSubscription.subscription!.subscriptions[0],
            title: 'Active Pro',
            status: 'active',
            weeklyWindow: {
              limit: 700000,
              available: 350000,
              availablePercent: 0.5,
            },
          },
        ],
      },
    }

    render(
      <ProviderBalanceContent
        provider={{ provider: 'jingxing' } as ModelProvider}
        balance={mixedPlans}
        loading={false}
        onRefresh={() => undefined}
      />
    )

    expect(screen.getByText('Active Pro · 7天 50% 可用')).toBeInTheDocument()
    expect(screen.queryByText('Expired Pro · 7天 0% 可用')).not.toBeInTheDocument()
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

  it('creates compact Biyuan chat badge labels from quota points when money is missing', () => {
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
    ).toBe('余额 38,563,951 额度点')
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
