function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function jobBlock(source, jobName) {
  const header = new RegExp(`^  ${escapeRegExp(jobName)}:\\s*$`, 'm')
  const match = header.exec(source)
  if (!match) return null

  const start = match.index
  const remainder = source.slice(start + match[0].length)
  const nextJob = /^  [A-Za-z0-9_-]+:\s*$/m.exec(remainder)
  return source.slice(start, nextJob ? start + match[0].length + nextJob.index : source.length)
}

function jobNeeds(block, dependency) {
  if (!block) return false
  const needs = /^    needs:\s*(?:\[[^\n]*\]|[^\n]*)(?:\n(?:      - [^\n]+\n?)*)?/m.exec(block)?.[0]
  if (!needs) return false
  return new RegExp(`(?:^|[\\s,[{-])${escapeRegExp(dependency)}(?:$|[\\s,\\]}])`).test(needs)
}

export function validateCandidateWorkflow(source) {
  const failures = []
  const preflight = jobBlock(source, 'preflight')
  const qualityGate = jobBlock(source, 'quality-gate')

  if (!preflight) {
    failures.push('desktop release is missing the immutable preflight job')
  } else {
    if (!preflight.includes('node scripts/ci/verify-release-policy.mjs')) {
      failures.push('desktop release preflight does not run the release policy scan')
    }
    if (!preflight.includes('node --test scripts/ci/__tests__/release-policy.test.mjs')) {
      failures.push('desktop release preflight does not test release policy contracts')
    }
  }

  if (!qualityGate) {
    failures.push('desktop release is missing the candidate quality gate')
  } else {
    if (!jobNeeds(qualityGate, 'preflight')) {
      failures.push('candidate quality gate must depend on immutable preflight')
    }
    if (!/(?:^|\n)\s*(?:-\s*)?run:\s*make test\s*(?:\n|$)/.test(qualityGate)) {
      failures.push('candidate quality gate must run the full make test suite')
    }
    if (!qualityGate.includes('node --test scripts/updater/__tests__/updater.test.mjs')) {
      failures.push('candidate quality gate does not run updater contract tests')
    }
  }

  for (const buildJob of ['build-macos', 'build-windows', 'build-linux']) {
    const block = jobBlock(source, buildJob)
    if (!block) {
      failures.push(`desktop release is missing ${buildJob}`)
      continue
    }
    if (!jobNeeds(block, 'preflight') || !jobNeeds(block, 'quality-gate')) {
      failures.push(`${buildJob} must depend on preflight and quality-gate`)
    }
  }

  return failures
}

export function validateCiWorkflow(source) {
  const failures = []
  const releaseSafety = jobBlock(source, 'release-safety')
  const prGate = jobBlock(source, 'pr-ci-gate')

  if (!releaseSafety) {
    failures.push('Biyan CI is missing the release-safety job')
  } else {
    for (const command of [
      'node scripts/ci/verify-release-policy.mjs',
      'node --test scripts/ci/__tests__/release-policy.test.mjs',
      'node --test scripts/updater/__tests__/updater.test.mjs',
    ]) {
      if (!releaseSafety.includes(command)) {
        failures.push(`Biyan CI release-safety job does not run: ${command}`)
      }
    }
  }

  if (!prGate || !jobNeeds(prGate, 'release-safety')) {
    failures.push('PR CI Gate must require the release-safety result')
  }

  return failures
}

function productFacingMetainfo(metainfo) {
  return metainfo
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(?:id|icon|launchable|url|image)\b[^>]*>[\s\S]*?<\/(?:id|icon|launchable|url|image)>/gi, '')
    .replace(/<[^>]+>/g, ' ')
}

export function validateFlatpakMetadata(manifest, metainfo) {
  const failures = []

  if (!/^id: uk\.jingxing\.Mita$/m.test(manifest)) {
    failures.push('Flatpak must retain the published uk.jingxing.Mita app ID')
  }
  if (!/^command: Biyan$/m.test(manifest) || !/usr\/bin\/Biyan \/app\/bin\/Biyan/.test(manifest)) {
    failures.push('Flatpak runtime entry points must use Biyan')
  }
  if (!/flatpak\/Biyan_[^/\s]*\.deb/.test(manifest) || /flatpak\/Mita_[^/\s]*\.deb/i.test(manifest)) {
    failures.push('Flatpak source artifact must be Biyan-branded')
  }
  if (/--device=all|extensions\/cuda|OpenCL\/vendors|name:\s*(?:volk|vulkan-headers|vulkan-tools|shaderc)\b/i.test(manifest)) {
    failures.push('Flatpak still requests or bundles retired local model GPU compute support')
  }

  if (!/<name>Biyan<\/name>/i.test(metainfo)) {
    failures.push('Flatpak product name must be Biyan')
  }
  if (!/does\s+not bundle or run local AI models/i.test(metainfo)) {
    failures.push('Flatpak metadata must state the remote-only local-model boundary')
  }
  if (/\b(?:Mita|Jan|Silence)\b/i.test(productFacingMetainfo(metainfo))) {
    failures.push('Flatpak product-facing metadata exposes a retired product name')
  }
  if (/Private offline|100% offline|Local AI models:|offline by default|localhost:1337|Llama\.cpp|Mita Hub|Native MLX/i.test(metainfo)) {
    failures.push('Flatpak metadata advertises retired offline or local-model behavior')
  }

  return failures
}
