import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProviderBalanceContent } from '../ProviderBalanceCard'
import { getProviderBalanceBadgeLabel } from '@/lib/provider-balance-display'
import type { ProviderBalanceStatus } from '@/services/providers/types'

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
  tokenLimit: {
    available: 0,
    used: 0,
    total: 0,
    unlimited: true,
    status: 1,
  },
  converted: {
    usdAvailable: 77.127902,
  },
  links: {
    topup: 'https://api.biyuan.ai/console/topup',
  },
}

describe('ProviderBalanceCard', () => {
  it('renders Biyuan account balance as the main value and marks unlimited keys', () => {
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

  it('creates a compact chat badge label from real account balance', () => {
    expect(getProviderBalanceBadgeLabel(biyuanWithAccount)).toBe('余额 $77.13')
  })
})
