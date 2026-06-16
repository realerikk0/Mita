import type { ProviderBalanceStatus } from '@/services/providers/types'
import {
  BIYUAN_PROVIDER_NAMES,
  BIYUAN_QUOTA_POINTS_PER_USD,
} from '@/constants/biyuan'

type ProviderBalanceLabelOptions = {
  balancePrefix?: string
  quotaUnitLabel?: string
}

export function formatProviderMoney(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatDecimalAmount(value: number) {
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

export function isBiyuanQuotaBalance(balance: ProviderBalanceStatus) {
  return (
    balance.state === 'supported' &&
    balance.unit === 'quota' &&
    (BIYUAN_PROVIDER_NAMES as readonly string[]).includes(balance.provider)
  )
}

export function formatBiyuanQuotaAsUsd(value: number) {
  return formatProviderMoney(value / BIYUAN_QUOTA_POINTS_PER_USD, 'USD')
}

export function providerBalancePrimaryLabel(
  balance: ProviderBalanceStatus,
  options: ProviderBalanceLabelOptions = {}
) {
  if (balance.state !== 'supported') return null
  if (balance.moneyBalance) {
    const currency = balance.moneyBalance.currency ?? balance.currency
    return currency
      ? formatProviderMoney(balance.moneyBalance.available, currency)
      : formatDecimalAmount(balance.moneyBalance.available)
  }
  if (!balance.accountBalance) return null
  if (isBiyuanQuotaBalance(balance)) {
    return formatBiyuanQuotaAsUsd(balance.accountBalance.available)
  }
  if (balance.unit === 'usd') {
    return formatProviderMoney(balance.accountBalance.available, 'USD')
  }
  if (balance.unit === 'currency') {
    return formatProviderMoney(
      balance.accountBalance.available,
      balance.currency ?? 'USD'
    )
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
