/**
 * Providers Service Types
 */

import type { ProviderModelDescriptor } from '@/lib/provider-models'

export type ProviderBalanceTotals = {
  available: number
  used?: number
  total?: number
}

export type ProviderMoneyBalanceTotals = ProviderBalanceTotals & {
  currency?: string
}

export type ProviderTokenLimit = {
  available?: number
  used?: number
  total?: number
  unlimited?: boolean
  status?: number
  expiresAt?: number
  modelLimitsEnabled?: boolean
  modelLimits?: Record<string, boolean>
}

export type ProviderBalanceLinks = {
  billing?: string
  topup?: string
  tokens?: string
  dashboard?: string
}

export type ProviderBalanceNotice = {
  code: 'openrouter_overdrawn' | 'deepseek_unavailable'
  tone: 'warning' | 'neutral'
  amount?: number
  currency?: string
  hideBadge?: boolean
}

export type ProviderBalanceBillingPreference =
  | 'subscription_first'
  | 'wallet_first'
  | 'subscription_only'
  | 'wallet_only'

export type ProviderBalanceQuotaWindow = {
  limit?: number
  used?: number
  available?: number
  resetAt?: number
  availablePercent?: number
}

export type ProviderBalanceSubscriptionPlan = {
  title: string
  planCode?: string
  startTime?: number
  endTime?: number
  status?: string
  weeklyWindow: ProviderBalanceQuotaWindow
  fiveHourWindow: ProviderBalanceQuotaWindow
  features: string[]
}

export type ProviderBalanceSubscription = {
  active: boolean
  billingPreference?: ProviderBalanceBillingPreference
  subscriptions: ProviderBalanceSubscriptionPlan[]
  unavailable?: boolean
}

export type SupportedProviderBalance = {
  state: 'supported'
  provider: string
  unit: 'quota' | 'usd' | 'currency' | 'credits'
  currency?: string
  fetchedAt: number
  accountBalance?: ProviderBalanceTotals
  moneyBalance?: ProviderMoneyBalanceTotals
  tokenLimit?: ProviderTokenLimit
  subscription?: ProviderBalanceSubscription
  notice?: ProviderBalanceNotice
  links?: ProviderBalanceLinks
  raw?: unknown
}

export type NeedsExtraAuthProviderBalance = {
  state: 'needs_extra_auth'
  provider: string
  reason: string
  required: string[]
  link?: string
}

export type UnsupportedProviderBalance = {
  state: 'unsupported'
  provider: string
  reason: string
  link?: string
}

export type ErrorProviderBalance = {
  state: 'error'
  provider: string
  message: string
  status?: number
  retryable?: boolean
}

export type ProviderBalanceStatus =
  | SupportedProviderBalance
  | NeedsExtraAuthProviderBalance
  | UnsupportedProviderBalance
  | ErrorProviderBalance

export interface ProvidersService {
  getProviders(): Promise<ModelProvider[]>
  fetchModelsFromProvider(
    provider: ModelProvider
  ): Promise<ProviderModelDescriptor[]>
  fetchProviderBalance(provider: ModelProvider): Promise<ProviderBalanceStatus>
  updateSettings(providerName: string, settings: ProviderSetting[]): Promise<void>
  fetch(): typeof fetch
}
