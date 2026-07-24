#!/usr/bin/env node

const CANONICAL_PROJECT = 'biyan-docs'

export function assertCleanupConfiguration({
  accountId,
  apiToken,
  project,
  expirationDays,
}) {
  if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is required')
  if (!apiToken) throw new Error('CLOUDFLARE_API_TOKEN is required')
  if (project !== CANONICAL_PROJECT) {
    throw new Error(
      `CLOUDFLARE_PAGES_PROJECT must be exactly ${CANONICAL_PROJECT}`
    )
  }
  if (
    !Number.isInteger(expirationDays) ||
    expirationDays < 1 ||
    expirationDays > 30
  ) {
    throw new Error('EXPIRATION_DAYS must be an integer from 1 through 30')
  }
}

export function expiredPreviewIds(deployments, cutoff) {
  if (!Array.isArray(deployments)) {
    throw new Error('Cloudflare deployments result must be an array')
  }
  return deployments
    .map((deployment) => {
      if (
        !deployment ||
        typeof deployment.id !== 'string' ||
        !deployment.id ||
        deployment.environment !== 'preview'
      ) {
        if (deployment?.environment === 'production') return null
        throw new Error('Cloudflare returned a malformed preview deployment')
      }
      const createdAt = Date.parse(deployment.created_on)
      if (!Number.isFinite(createdAt)) {
        throw new Error(
          `Cloudflare preview ${deployment.id} has an invalid created_on`
        )
      }
      return createdAt < cutoff.getTime() ? deployment.id : null
    })
    .filter(Boolean)
}

async function cloudflareRequest(url, options) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20_000),
  })
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error(`Cloudflare returned non-JSON HTTP ${response.status}`)
  }
  if (!response.ok || payload?.success !== true) {
    const details = Array.isArray(payload?.errors)
      ? payload.errors
          .map((error) => error?.message)
          .filter(Boolean)
          .join('; ')
      : ''
    throw new Error(
      `Cloudflare request failed with HTTP ${response.status}${
        details ? `: ${details}` : ''
      }`
    )
  }
  return payload
}

export async function cleanExpiredPreviews({
  accountId,
  apiToken,
  project,
  expirationDays,
  dryRun,
  now = new Date(),
}) {
  assertCleanupConfiguration({
    accountId,
    apiToken,
    project,
    expirationDays,
  })
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    accountId
  )}/pages/projects/${encodeURIComponent(project)}/deployments`
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
  }
  const cutoff = new Date(
    now.getTime() - expirationDays * 24 * 60 * 60 * 1000
  )
  const eligible = []

  for (let page = 1; ; page += 1) {
    const payload = await cloudflareRequest(
      `${endpoint}?env=preview&page=${page}&per_page=100`,
      { headers }
    )
    const deployments = payload.result
    eligible.push(...expiredPreviewIds(deployments, cutoff))
    const totalPages = Number(payload.result_info?.total_pages)
    if (
      (Number.isFinite(totalPages) && page >= totalPages) ||
      (!Number.isFinite(totalPages) && deployments.length < 100)
    ) {
      break
    }
    if (page >= 100) {
      throw new Error('Cloudflare pagination exceeded the 100-page safety cap')
    }
  }

  for (const deploymentId of eligible) {
    if (dryRun) {
      console.log(`Would delete preview deployment ${deploymentId}`)
      continue
    }
    await cloudflareRequest(
      `${endpoint}/${encodeURIComponent(deploymentId)}`,
      { headers, method: 'DELETE' }
    )
    console.log(`Deleted preview deployment ${deploymentId}`)
  }
  console.log(
    `${dryRun ? 'Dry run found' : 'Deleted'} ${eligible.length} expired preview deployment(s)`
  )
  return eligible
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const expirationDays = Number(process.env.EXPIRATION_DAYS)
  const dryRun = process.env.DRY_RUN === 'true'
  cleanExpiredPreviews({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    project: process.env.CLOUDFLARE_PAGES_PROJECT,
    expirationDays,
    dryRun,
  }).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
