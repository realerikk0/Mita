import type { ProviderBalanceStatus } from '@/services/providers/types'

type ProviderBalanceLabelOptions = {
  balancePrefix?: string
  quotaUnitLabel?: string
}

const BIYUAN_QUOTA_POINTS_PER_USD = 500_000

function formatMoney(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatDecimalAmount(value: number) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatWholeNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value)
}

function isBiyuanQuotaBalance(balance: ProviderBalanceStatus) {
  return (
    balance.state === 'supported' &&
    balance.unit === 'quota' &&
    ['biyuan', 'jingxing'].includes(balance.provider)
  )
}

export function providerBalancePrimaryLabel(
  balance: ProviderBalanceStatus,
  options: ProviderBalanceLabelOptions = {}
) {
  if (balance.state !== 'supported') return null
  if (balance.moneyBalance) {
    const currency = balance.moneyBalance.currency ?? balance.currency
    return currency
      ? formatMoney(balance.moneyBalance.available, currency)
      : formatDecimalAmount(balance.moneyBalance.available)
  }
  if (!balance.accountBalance) return null
  if (isBiyuanQuotaBalance(balance)) {
    return formatMoney(
      balance.accountBalance.available / BIYUAN_QUOTA_POINTS_PER_USD,
      'USD'
    )
  }
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
    balance.notice?.hideBadge
  ) {
    return null
  }
  const primary = providerBalancePrimaryLabel(balance, options)
  if (!primary) return null
  return `${options.balancePrefix ?? 'Balance'} ${primary}`
}
