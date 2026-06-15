import { IconExternalLink, IconLoader, IconRefresh } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/containers/Card'
import { cn, getProviderTitle } from '@/lib/utils'
import { useProviderBalance } from '@/hooks/useProviderBalance'
import type { ProviderBalanceStatus } from '@/services/providers/types'
import { providerBalancePrimaryLabel } from '@/lib/provider-balance-display'
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

function formatMoney(value: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value)
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

function providerNoticeLabel(balance: ProviderBalanceStatus, t: TranslationFn) {
  if (balance.state !== 'supported' || !balance.notice) return undefined
  if (balance.notice.code === 'openrouter_overdrawn') {
    return t('common:providerBalance.notices.openrouterOverdrawn', {
      amount: formatMoney(
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

  const hasAccountBalance = Boolean(balance.accountBalance)
  const quotaUnitLabel = t('common:providerBalance.quotaPoints')
  const displayUnit = providerDisplayUnit(balance, t)
  const primary = providerBalancePrimaryLabel(balance, { quotaUnitLabel })
  const topupLink = balance.links?.topup
  const tokenLimit = balance.tokenLimit
  const tokenStatus = tokenStatusLabel(tokenLimit?.status, t)
  const notice = providerNoticeLabel(balance, t)

  return (
    <div className="space-y-4">
      {hasAccountBalance ? (
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">
            {t('common:providerBalance.availableBalance')}
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
              value: formatInteger(tokenLimit.available),
            })}
          </StatusPill>
        )}
        {tokenStatus && (
          <StatusPill tone={tokenLimit?.status === 1 ? 'success' : 'warning'}>
            {t('common:providerBalance.keyStatus', { status: tokenStatus })}
          </StatusPill>
        )}
      </div>

      <div className="space-y-1.5">
        {balance.accountBalance?.used !== undefined && (
          <DetailRow
            label={t('common:providerBalance.accountUsed')}
            value={`${formatInteger(balance.accountBalance.used)} ${displayUnit}`}
          />
        )}
        {!tokenLimit?.unlimited && tokenLimit?.used !== undefined && (
          <DetailRow
            label={t('common:providerBalance.keyUsed')}
            value={`${formatInteger(tokenLimit.used)} ${displayUnit}`}
          />
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
