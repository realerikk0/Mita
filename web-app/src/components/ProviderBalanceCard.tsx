import { IconExternalLink, IconLoader, IconRefresh } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/containers/Card'
import { cn, getProviderTitle } from '@/lib/utils'
import { useProviderBalance } from '@/hooks/useProviderBalance'
import type { ProviderBalanceStatus } from '@/services/providers/types'
import { providerBalancePrimaryLabel } from '@/lib/provider-balance-display'

type ProviderBalanceContentProps = {
  provider: ModelProvider
  balance: ProviderBalanceStatus | null
  loading: boolean
  error?: string | null
  onRefresh: () => void
}

const tokenStatusLabels: Record<number, string> = {
  1: '正常',
  2: '已禁用',
  3: '已过期',
  4: '已耗尽',
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

function tokenStatusLabel(status?: number) {
  if (!status) return undefined
  return tokenStatusLabels[status] ?? `状态 ${status}`
}

function providerDisplayUnit(balance: ProviderBalanceStatus) {
  if (balance.state !== 'supported') return ''
  if (balance.unit === 'quota') return '额度点'
  if (balance.currency) return balance.currency
  if (balance.unit === 'usd') return 'USD'
  return balance.unit
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
  const providerTitle = getProviderTitle(provider.provider)

  if (!balance && loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <IconLoader size={16} className="animate-spin" />
        <span>正在查询余额</span>
      </div>
    )
  }

  if (!balance) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">尚未查询余额。</p>
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
          {loading ? <IconLoader size={14} className="animate-spin" /> : <IconRefresh size={14} />}
          刷新
        </Button>
      </div>
    )
  }

  if (balance.state === 'needs_extra_auth') {
    return (
      <div className="space-y-3">
        <div>
          <h3 className="font-medium">需要管理权限</h3>
          <p className="mt-1 text-sm text-muted-foreground">{balance.reason}</p>
          <p className="mt-1 text-sm font-medium">{balance.required.join(', ')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
            {loading ? <IconLoader size={14} className="animate-spin" /> : <IconRefresh size={14} />}
            刷新
          </Button>
          {balance.link && (
            <Button size="sm" variant="outline" asChild>
              <a href={balance.link} target="_blank" rel="noreferrer">
                打开控制台
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
          <h3 className="font-medium">不支持自动余额查询</h3>
          <p className="mt-1 text-sm text-muted-foreground">{balance.reason}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
            {loading ? <IconLoader size={14} className="animate-spin" /> : <IconRefresh size={14} />}
            刷新
          </Button>
          {balance.link && (
            <Button size="sm" variant="outline" asChild>
              <a href={balance.link} target="_blank" rel="noreferrer">
                打开账单控制台
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
          <h3 className="font-medium">余额查询失败</h3>
          <p className="mt-1 text-sm text-muted-foreground">{balance.message}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
          {loading ? <IconLoader size={14} className="animate-spin" /> : <IconRefresh size={14} />}
          重试
        </Button>
      </div>
    )
  }

  const hasAccountBalance = Boolean(balance.accountBalance)
  const displayUnit = providerDisplayUnit(balance)
  const primary = providerBalancePrimaryLabel(balance)
  const topupLink = balance.links?.topup
  const tokenLimit = balance.tokenLimit
  const tokenStatus = tokenStatusLabel(tokenLimit?.status)

  return (
    <div className="space-y-4">
      {hasAccountBalance ? (
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">可用余额</div>
          <div className="text-2xl font-semibold tracking-normal">{primary}</div>
        </div>
      ) : (
        <div className="space-y-1">
          <h3 className="font-medium">无法获取账户余额</h3>
          <p className="text-sm text-muted-foreground">
            仅获取到 Key 限额信息
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {tokenLimit?.unlimited && <StatusPill tone="success">不限额 Key</StatusPill>}
        {!tokenLimit?.unlimited && tokenLimit?.available !== undefined && (
          <StatusPill>此 Key 限额剩余 {formatInteger(tokenLimit.available)}</StatusPill>
        )}
        {tokenStatus && (
          <StatusPill tone={tokenLimit?.status === 1 ? 'success' : 'warning'}>
            Key {tokenStatus}
          </StatusPill>
        )}
      </div>

      <div className="space-y-1.5">
        {balance.accountBalance?.used !== undefined && (
          <DetailRow
            label="账户已用"
            value={`${formatInteger(balance.accountBalance.used)} ${displayUnit}`}
          />
        )}
        {!tokenLimit?.unlimited && tokenLimit?.used !== undefined && (
          <DetailRow
            label="Key 已用"
            value={`${formatInteger(tokenLimit.used)} ${displayUnit}`}
          />
        )}
        <DetailRow label="更新时间" value={formatTimeFromUnixSeconds(balance.fetchedAt)} />
        {error && <p className="text-xs text-yellow-600">{error}</p>}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
          {loading ? <IconLoader size={14} className="animate-spin" /> : <IconRefresh size={14} />}
          刷新
        </Button>
        {topupLink && (
          <Button size="sm" variant="outline" asChild>
            <a href={topupLink} target="_blank" rel="noreferrer">
              去充值
              <IconExternalLink size={14} />
            </a>
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {providerTitle} 的主余额来自账户钱包；Key 限额只用于解释当前密钥状态。
      </p>
    </div>
  )
}

export function ProviderBalanceCard({ provider }: { provider: ModelProvider }) {
  const { balance, loading, error, refetch } = useProviderBalance(provider)

  return (
    <Card>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-medium text-foreground text-base">余额</h2>
            <p className="text-sm text-muted-foreground leading-normal">
              查询当前供应商的账户余额和 Key 状态。
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
