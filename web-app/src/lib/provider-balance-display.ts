import type { ProviderBalanceStatus } from '@/services/providers/types'

type ProviderBalanceLabelOptions = {
  balancePrefix?: string
  quotaUnitLabel?: string
}

function formatMoney(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatWholeNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value)
}

export function providerBalancePrimaryLabel(
  balance: ProviderBalanceStatus,
  options: ProviderBalanceLabelOptions = {}
) {
  if (balance.state !== 'supported' || !balance.accountBalance) return null
  if (balance.unit === 'usd') {
    return formatMoney(balance.accountBalance.available, 'USD')
  }
  if (balance.unit === 'currency') {
    return formatMoney(balance.accountBalance.available, balance.currency ?? 'USD')
  }
  const formatted = formatWholeNumber(balance.accountBalance.available)
  if (balance.unit === 'quota') {
    return `${formatted} ${options.quotaUnitLabel ?? 'quota'}`
  }
  return formatted
}

export function getProviderBalanceBadgeLabel(
  balance?: ProviderBalanceStatus | null,
  options: ProviderBalanceLabelOptions = {}
) {
  if (
    !balance ||
    balance.state !== 'supported' ||
    !balance.accountBalance ||
    balance.notice?.hideBadge
  ) {
    return null
  }
  const primary = providerBalancePrimaryLabel(balance, options)
  if (!primary) return null
  return `${options.balancePrefix ?? 'Balance'} ${primary}`
}
