import type { ProviderBalanceStatus } from '@/services/providers/types'

function formatMoney(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value)
}

export function providerBalancePrimaryLabel(
  balance: ProviderBalanceStatus
) {
  if (balance.state !== 'supported' || !balance.accountBalance) return null
  if (balance.converted?.usdAvailable !== undefined) {
    return formatMoney(balance.converted.usdAvailable, 'USD')
  }
  if (balance.unit === 'usd') {
    return formatMoney(balance.accountBalance.available, 'USD')
  }
  if (balance.unit === 'currency') {
    return formatMoney(balance.accountBalance.available, balance.currency ?? 'USD')
  }
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(balance.accountBalance.available)
}

export function getProviderBalanceBadgeLabel(
  balance?: ProviderBalanceStatus | null
) {
  if (!balance || balance.state !== 'supported' || !balance.accountBalance) {
    return null
  }
  const primary = providerBalancePrimaryLabel(balance)
  if (!primary) return null
  return `余额 ${primary}`
}
