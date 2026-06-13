/**
 * Providers Service Types
 */

import type { ProviderModelDescriptor } from '@/lib/provider-models'

export type ProviderBalanceTotals = {
  available: number
  used?: number
  total?: number
}

export type ProviderTokenLimit = ProviderBalanceTotals & {
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

export type SupportedProviderBalance = {
  state: 'supported'
  provider: string
  unit: 'quota' | 'usd' | 'currency' | 'credits'
  currency?: string
  fetchedAt: number
  accountBalance?: ProviderBalanceTotals
  tokenLimit?: ProviderTokenLimit
  converted?: {
    usdAvailable?: number
  }
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
