import type { ProviderBalanceStatus } from '@/services/providers/types'
import { BIYUAN_PROVIDER_NAMES } from '@/constants/biyuan'

type ProviderBalanceLabelOptions = {
  balancePrefix?: string
  quotaUnitLabel?: string
  weeklyWindowLabel?: string
  subscriptionAvailableSuffix?: string
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

export function formatProviderPercent(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return null
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 0,
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

function primarySubscriptionPlan(balance: ProviderBalanceStatus) {
  if (balance.state !== 'supported') return undefined
  const subscription = balance.subscription
  if (!subscription?.active || subscription.unavailable) return undefined
  return subscription.subscriptions[0]
}

export function providerSubscriptionPrimaryLabel(
  balance: ProviderBalanceStatus,
  options: ProviderBalanceLabelOptions = {}
) {
  const plan = primarySubscriptionPlan(balance)
  if (!plan) return null
  const percent = formatProviderPercent(plan.weeklyWindow.availablePercent)
  if (!percent) return plan.title
  const windowLabel = options.weeklyWindowLabel ?? '7d'
  const suffix = options.subscriptionAvailableSuffix
    ? ` ${options.subscriptionAvailableSuffix}`
    : ''
  return `${plan.title} · ${windowLabel} ${percent}${suffix}`
}

export function providerSubscriptionBadgeLabel(
  balance: ProviderBalanceStatus,
  options: ProviderBalanceLabelOptions = {}
) {
  const plan = primarySubscriptionPlan(balance)
  if (!plan) return null
  const percent = formatProviderPercent(plan.weeklyWindow.availablePercent)
  if (!percent) return plan.title
  return `${options.weeklyWindowLabel ?? '7d'} ${percent}`
}

export function providerBalancePrimaryLabel(
  balance: ProviderBalanceStatus,
  options: ProviderBalanceLabelOptions = {}
) {
  if (balance.state !== 'supported') return null
  const subscriptionLabel = providerSubscriptionPrimaryLabel(balance, options)
  if (subscriptionLabel) return subscriptionLabel
  if (balance.moneyBalance) {
    const currency = balance.moneyBalance.currency ?? balance.currency
    return currency
      ? formatProviderMoney(balance.moneyBalance.available, currency)
      : formatDecimalAmount(balance.moneyBalance.available)
  }
  if (!balance.accountBalance) return null
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
  const primary =
    providerSubscriptionBadgeLabel(balance, options) ??
    providerBalancePrimaryLabel(balance, options)
  if (!primary) return null
  return `${options.balancePrefix ?? 'Balance'} ${primary}`
}
