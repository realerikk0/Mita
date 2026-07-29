const DEFAULT_POLICY_KEY = 'biyan/updater/stable/policy.json'
const MAX_CLOCK_SKEW_SECONDS = 300

function json(body, status = 200) {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function empty(state) {
  return new Response(null, {
    status: 204,
    headers: {
      'cache-control': 'no-store',
      'x-biyan-updater-state': state,
    },
  })
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
}

async function verifySignedRequest(request, secret, currentVersion) {
  if (!secret) return false
  const session = request.headers.get('x-client-session') ?? ''
  const token = request.headers.get('x-request-token') ?? ''
  const timestamp = request.headers.get('x-request-time') ?? ''
  const nonce = request.headers.get('x-request-id') ?? ''
  const headerVersion = request.headers.get('x-client-version') ?? ''
  if (!/^[0-9A-Za-z._:-]{8,200}$/.test(session)) return false
  if (!/^[0-9a-f]{64}$/i.test(token) || !/^[0-9a-f]{64}$/i.test(nonce)) return false
  if (headerVersion !== currentVersion) return false
  const seconds = Number(timestamp)
  if (!Number.isInteger(seconds) || Math.abs(Date.now() / 1000 - seconds) > MAX_CLOCK_SKEW_SECONDS) return false
  const expected = await hmac(secret, `${session}:${timestamp}:${nonce}`)
  return expected.length === token.length && expected === token.toLowerCase()
}

async function readR2Json(bucket, key) {
  const object = await bucket.get(key)
  if (!object) return undefined
  if (typeof object.json === 'function') return object.json()
  return JSON.parse(await object.text())
}

function platformKey(target, arch) {
  const normalizedTarget = target.toLowerCase()
  const normalizedArch = arch === 'x86_64' || arch === 'aarch64' ? arch : null
  if (!normalizedArch) return null
  if (normalizedTarget.includes('darwin') || normalizedTarget.includes('apple')) {
    return `darwin-${normalizedArch}`
  }
  if (normalizedTarget.includes('windows')) return `windows-${normalizedArch}`
  if (normalizedTarget.includes('linux')) return `linux-${normalizedArch}`
  return null
}

function isAllowedTransition(policy, currentVersion, transition) {
  const source = policy.releases?.[currentVersion]
  const target = policy.releases?.[transition.to]
  const sourcePhase = source?.effectivePhase ?? source?.phase
  const targetPhase = target?.effectivePhase ?? target?.phase
  if (transition.phase !== target?.phase) return false
  if (target?.phase === 'RECOVERY') return Boolean(sourcePhase) && sourcePhase === targetPhase
  if (transition.phase === 'A') return sourcePhase === 'A'
  if (transition.phase === 'B') return sourcePhase === 'A'
  return transition.phase === 'C' && sourcePhase === 'B'
}

async function rolloutBucket(salt, session, targetVersion) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${salt}:${session}:${targetVersion}`),
  )
  return new DataView(digest).getUint32(0) % 10000
}

export async function handleRequest(request, env) {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)
  const url = new URL(request.url)
  const match = /^\/biyan\/v1\/stable\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(url.pathname)
  if (!match) return json({ error: 'not_found' }, 404)

  const [, target, arch, encodedCurrentVersion] = match
  const currentVersion = decodeURIComponent(encodedCurrentVersion)
  if (!(await verifySignedRequest(request, env.BIYAN_SIGNING_KEY, currentVersion))) {
    return json({ error: 'unauthorized' }, 401)
  }

  const policy = await readR2Json(env.UPDATER_BUCKET, env.POLICY_KEY ?? DEFAULT_POLICY_KEY)
  if (policy === undefined) {
    return empty('policy-unavailable')
  }
  if (
    policy === null
    || typeof policy !== 'object'
    || Array.isArray(policy)
    || policy.schema !== 1
    || policy.channel !== 'stable'
  ) return empty('policy-invalid')
  if (policy.paused) return empty('paused')
  const transition = policy.transitions?.[currentVersion]
  if (!transition) return empty('no-transition')
  if (!Number.isInteger(transition.rollout) || transition.rollout <= 0) {
    return empty('phase-closed')
  }
  if (!isAllowedTransition(policy, currentVersion, transition)) {
    return empty('invalid-transition')
  }

  const session = request.headers.get('x-client-session')
  const salt = env.ROLLOUT_SALT
  if (!salt) return json({ error: 'router_not_configured' }, 503)
  if (transition.rollout < 100) {
    const bucket = await rolloutBucket(salt, session, transition.to)
    if (bucket >= transition.rollout * 100) return empty('outside-cohort')
  }

  const manifest = await readR2Json(env.UPDATER_BUCKET, transition.manifestKey)
  const platform = platformKey(target, arch)
  const artifact = platform ? manifest?.platforms?.[platform] : null
  if (!artifact?.url || !artifact?.signature || manifest.version !== transition.to) {
    return json({ error: 'invalid_release_manifest' }, 503)
  }

  return json({
    version: manifest.version,
    notes: manifest.notes ?? '',
    pub_date: manifest.pub_date,
    url: artifact.url,
    signature: artifact.signature,
  })
}

export default { fetch: handleRequest }
