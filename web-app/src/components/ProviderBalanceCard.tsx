import { IconExternalLink, IconLoader, IconRefresh } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/containers/Card'
import { cn, getProviderTitle } from '@/lib/utils'
import { useProviderBalance } from '@/hooks/useProviderBalance'
import type { ProviderBalanceStatus } from '@/services/providers/types'
import {
  formatProviderPercent,
  formatProviderMoney,
  primaryProviderSubscriptionPlan,
  providerBalancePrimaryLabel,
  shouldPrioritizeProviderWallet,
} from '@/lib/provider-balance-display'
import { useTranslation } from '@/i18n/react-i18next-compat'

type TranslationFn = (key: string, options?: Record<string, unknown>) => string

type ProviderBalanceContentProps = {
  provider: ModelProvider
  balance: ProviderBalanceStatus | null
  loading: boolean
  error?: string | null
  onRefresh: () => void
}

const tokenStatusLabelKeys: Record<number, string> = {
  1: 'common:providerBalance.tokenStatus.normal',
  2: 'common:providerBalance.tokenStatus.disabled',
  3: 'common:providerBalance.tokenStatus.expired',
  4: 'common:providerBalance.tokenStatus.exhausted',
}

const billingPreferenceLabelKeys = {
  subscription_first: 'common:providerBalance.billingPreference.subscriptionFirst',
  wallet_first: 'common:providerBalance.billingPreference.walletFirst',
  subscription_only: 'common:providerBalance.billingPreference.subscriptionOnly',
  wallet_only: 'common:providerBalance.billingPreference.walletOnly',
} as const

const subscriptionStatusLabelKeys: Record<string, string> = {
  active: 'common:providerBalance.subscription.statusActive',
  canceled: 'common:providerBalance.subscription.statusCanceled',
  cancelled: 'common:providerBalance.subscription.statusCanceled',
  disabled: 'common:providerBalance.subscription.statusDisabled',
  expired: 'common:providerBalance.subscription.statusExpired',
}

function formatInteger(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

function formatTimeFromUnixSeconds(value?: number) {
  if (!value) return '-'
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value * 1000))
}

function formatDateTimeFromUnixSeconds(value?: number) {
  if (!value) return '-'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value * 1000))
}

function tokenStatusLabel(status: number | undefined, t: TranslationFn) {
  if (!status) return undefined
  return tokenStatusLabelKeys[status]
    ? t(tokenStatusLabelKeys[status])
    : t('common:providerBalance.tokenStatus.unknown', { status })
}

function providerDisplayUnit(balance: ProviderBalanceStatus, t: TranslationFn) {
  if (balance.state !== 'supported') return ''
  if (balance.unit === 'quota') return t('common:providerBalance.quotaPoints')
  if (balance.currency) return balance.currency
  if (balance.unit === 'usd') return 'USD'
  return balance.unit
}

function billingPreferenceLabel(
  preference: keyof typeof billingPreferenceLabelKeys | undefined,
  t: TranslationFn
) {
  return preference ? t(billingPreferenceLabelKeys[preference]) : undefined
}

function subscriptionStatusLabel(status: string | undefined, t: TranslationFn) {
  const normalized = status?.trim().toLowerCase()
  if (!normalized) return undefined
  const labelKey = subscriptionStatusLabelKeys[normalized]
  return labelKey ? t(labelKey) : status
}

function formatProviderBalanceValue(
  value: number,
  displayUnit: string
) {
  return `${formatInteger(value)} ${displayUnit}`
}

function formatAccountBalanceAvailable(
  balance: ProviderBalanceStatus,
  displayUnit: string
) {
  if (balance.state !== 'supported' || !balance.accountBalance) return undefined
  if (balance.moneyBalance) {
    return formatProviderMoney(
      balance.moneyBalance.available,
      balance.moneyBalance.currency ?? balance.currency ?? 'USD'
    )
  }
  return formatProviderBalanceValue(balance.accountBalance.available, displayUnit)
}

function providerNoticeLabel(balance: ProviderBalanceStatus, t: TranslationFn) {
  if (balance.state !== 'supported' || !balance.notice) return undefined
  if (balance.notice.code === 'openrouter_overdrawn') {
    return t('common:providerBalance.notices.openrouterOverdrawn', {
      amount: formatProviderMoney(
        balance.notice.amount ?? 0,
        balance.notice.currency ?? balance.currency ?? 'USD'
      ),
    })
  }
  if (balance.notice.code === 'deepseek_unavailable') {
    return t('common:providerBalance.notices.deepseekUnavailable')
  }
  return undefined
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  )
}

function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'warning' | 'success'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'success' && 'bg-green-500/10 text-green-700 dark:text-green-400',
        tone === 'warning' && 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
        tone === 'neutral' && 'bg-secondary text-muted-foreground'
      )}
    >
      {children}
    </span>
  )
}

export function ProviderBalanceContent({
  provider,
  balance,
  loading,
  error,
  onRefresh,
}: ProviderBalanceContentProps) {
  const { t } = useTranslation()
  const providerTitle = getProviderTitle(provider.provider)

  if (!balance && loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <IconLoader size={16} className="animate-spin" />
        <span>{t('common:providerBalance.loading')}</span>
      </div>
    )
  }

  if (!balance) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t('common:providerBalance.notFetched')}
        </p>
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
          {loading ? <IconLoader size={14} className="animate-spin" /> : <IconRefresh size={14} />}
          {t('common:providerBalance.refresh')}
        </Button>
      </div>
    )
  }

  if (balance.state === 'needs_extra_auth') {
    return (
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">
            {t('common:providerBalance.needsManagementTitle')}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{balance.reason}</p>
          <p className="mt-1 text-sm font-medium">{balance.required.join(', ')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
            {loading ? <IconLoader size={14} className="animate-spin" /> : <IconRefresh size={14} />}
            {t('common:providerBalance.refresh')}
          </Button>
          {balance.link && (
            <Button size="sm" variant="outline" asChild>
              <a href={balance.link} target="_blank" rel="noreferrer">
                {t('common:providerBalance.openConsole')}
                <IconExternalLink size={14} />
              </a>
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (balance.state === 'unsupported') {
    return (
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">
            {t('common:providerBalance.unsupportedTitle')}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{balance.reason}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
            {loading ? <IconLoader size={14} className="animate-spin" /> : <IconRefresh size={14} />}
            {t('common:providerBalance.refresh')}
          </Button>
          {balance.link && (
            <Button size="sm" variant="outline" asChild>
              <a href={balance.link} target="_blank" rel="noreferrer">
                {t('common:providerBalance.openBillingConsole')}
                <IconExternalLink size={14} />
              </a>
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (balance.state === 'error') {
    return (
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">
            {t('common:providerBalance.errorTitle')}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{balance.message}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
          {loading ? <IconLoader size={14} className="animate-spin" /> : <IconRefresh size={14} />}
          {t('common:providerBalance.retry')}
        </Button>
      </div>
    )
  }

  const quotaUnitLabel = t('common:providerBalance.quotaPoints')
  const displayUnit = providerDisplayUnit(balance, t)
  const primary = providerBalancePrimaryLabel(balance, {
    quotaUnitLabel,
    weeklyWindowLabel: t('common:providerBalance.subscription.weeklyCompact'),
    subscriptionAvailableSuffix: t('common:providerBalance.subscription.availableSuffix'),
  })
  const hasAvailableBalance = Boolean(primary)
  const topupLink = balance.links?.topup
  const tokenLimit = balance.tokenLimit
  const tokenStatus = tokenStatusLabel(tokenLimit?.status, t)
  const notice = providerNoticeLabel(balance, t)
  const primaryPlan = primaryProviderSubscriptionPlan(balance)
  const walletPrimary = shouldPrioritizeProviderWallet(balance)
  const billing = billingPreferenceLabel(
    balance.subscription?.billingPreference,
    t
  )
  const subscriptionUnavailable = balance.subscription?.unavailable === true
  const primaryPlanStatus = subscriptionStatusLabel(primaryPlan?.status, t)
  const accountAvailable = formatAccountBalanceAvailable(balance, displayUnit)

  return (
    <div className="space-y-4">
      {hasAvailableBalance ? (
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">
            {primaryPlan && !walletPrimary
              ? t('common:providerBalance.subscription.currentPlan')
              : t('common:providerBalance.availableBalance')}
          </div>
          <div className="text-2xl font-semibold tracking-normal">{primary}</div>
        </div>
      ) : (
        <div className="space-y-1">
          <h3 className="font-medium">
            {t('common:providerBalance.accountUnavailableTitle')}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t('common:providerBalance.keyLimitOnly')}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {notice && (
          <StatusPill tone={balance.notice?.tone === 'warning' ? 'warning' : 'neutral'}>
            {notice}
          </StatusPill>
        )}
        {tokenLimit?.unlimited && (
          <StatusPill tone="success">
            {t('common:providerBalance.unlimitedKey')}
          </StatusPill>
        )}
        {!tokenLimit?.unlimited && tokenLimit?.available !== undefined && (
          <StatusPill>
            {t('common:providerBalance.keyLimitRemaining', {
              value: formatProviderBalanceValue(tokenLimit.available, displayUnit),
            })}
          </StatusPill>
        )}
        {tokenStatus && (
          <StatusPill tone={tokenLimit?.status === 1 ? 'success' : 'warning'}>
            {t('common:providerBalance.keyStatus', { status: tokenStatus })}
          </StatusPill>
        )}
        {primaryPlanStatus && (
          <StatusPill
            tone={
              primaryPlan?.status?.toLowerCase() === 'active'
                ? 'success'
                : 'neutral'
            }
          >
            {t('common:providerBalance.subscription.status', {
              status: primaryPlanStatus,
            })}
          </StatusPill>
        )}
        {billing && <StatusPill>{billing}</StatusPill>}
        {subscriptionUnavailable && (
          <StatusPill tone="neutral">
            {t('common:providerBalance.subscription.unavailable')}
          </StatusPill>
        )}
      </div>

      <div className="space-y-1.5">
        {primaryPlan ? (
          <>
            {accountAvailable && !walletPrimary && (
              <DetailRow
                label={t('common:providerBalance.walletBalance')}
                value={accountAvailable}
              />
            )}
            <DetailRow
              label={t('common:providerBalance.subscription.weeklyRemaining')}
              value={
                formatProviderPercent(
                  primaryPlan.weeklyWindow.availablePercent
                ) ?? '-'
              }
            />
            <DetailRow
              label={t('common:providerBalance.subscription.weeklyReset')}
              value={formatDateTimeFromUnixSeconds(
                primaryPlan.weeklyWindow.resetAt
              )}
            />
            <DetailRow
              label={t('common:providerBalance.subscription.fiveHourRemaining')}
              value={
                formatProviderPercent(
                  primaryPlan.fiveHourWindow.availablePercent
                ) ?? '-'
              }
            />
            <DetailRow
              label={t('common:providerBalance.subscription.fiveHourReset')}
              value={formatDateTimeFromUnixSeconds(
                primaryPlan.fiveHourWindow.resetAt
              )}
            />
            {(primaryPlan.startTime || primaryPlan.endTime) && (
              <DetailRow
                label={t('common:providerBalance.subscription.period')}
                value={
                  primaryPlan.startTime && primaryPlan.endTime
                    ? `${formatDateTimeFromUnixSeconds(primaryPlan.startTime)} - ${formatDateTimeFromUnixSeconds(primaryPlan.endTime)}`
                    : primaryPlan.startTime
                      ? t('common:providerBalance.subscription.startsAt', {
                          value: formatDateTimeFromUnixSeconds(
                            primaryPlan.startTime
                          ),
                        })
                      : t('common:providerBalance.subscription.endsAt', {
                          value: formatDateTimeFromUnixSeconds(
                            primaryPlan.endTime
                          ),
                        })
                }
              />
            )}
          </>
        ) : (
          <>
            {balance.accountBalance?.used !== undefined && (
              <DetailRow
                label={t('common:providerBalance.accountUsed')}
                value={
                  balance.moneyBalance?.used !== undefined
                    ? formatProviderMoney(
                        balance.moneyBalance.used,
                        balance.moneyBalance.currency ?? balance.currency ?? 'USD'
                      )
                    : formatProviderBalanceValue(
                        balance.accountBalance.used,
                        displayUnit
                      )
                }
              />
            )}
            {!tokenLimit?.unlimited && tokenLimit?.used !== undefined && (
              <DetailRow
                label={t('common:providerBalance.keyUsed')}
                value={formatProviderBalanceValue(tokenLimit.used, displayUnit)}
              />
            )}
          </>
        )}
        <DetailRow
          label={t('common:providerBalance.updatedAt')}
          value={formatTimeFromUnixSeconds(balance.fetchedAt)}
        />
        {error && <p className="text-xs text-yellow-600">{error}</p>}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
          {loading ? <IconLoader size={14} className="animate-spin" /> : <IconRefresh size={14} />}
          {t('common:providerBalance.refresh')}
        </Button>
        {topupLink && (
          <Button size="sm" variant="outline" asChild>
            <a href={topupLink} target="_blank" rel="noreferrer">
              {t('common:providerBalance.topup')}
              <IconExternalLink size={14} />
            </a>
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {t('common:providerBalance.sourceNote', { provider: providerTitle })}
      </p>
    </div>
  )
}

export function ProviderBalanceCard({ provider }: { provider: ModelProvider }) {
  const { balance, loading, error, refetch } = useProviderBalance(provider)
  const { t } = useTranslation()

  return (
    <Card>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-medium text-foreground text-base">
              {t('common:providerBalance.title')}
            </h2>
            <p className="text-sm text-muted-foreground leading-normal">
              {t('common:providerBalance.description')}
            </p>
          </div>
          {loading && <IconLoader size={16} className="animate-spin text-muted-foreground" />}
        </div>
        <ProviderBalanceContent
          provider={provider}
          balance={balance}
          loading={loading}
          error={error}
          onRefresh={refetch}
        />
      </div>
    </Card>
  )
}
