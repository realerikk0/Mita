#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RETIRED_PRODUCT_COMPONENT =
  /(?:^|[^A-Za-z0-9])(?:jan(?:hq)?|mita|silence)(?=$|[^A-Za-z0-9])/i
export const RETIRED_RUNTIME_COMPONENT =
  /(?:^|[^A-Za-z0-9])(?:llama(?:[^A-Za-z0-9]*cpp)?|mlx|foundation[^A-Za-z0-9]*models?|rag|vector[^A-Za-z0-9]*db|local[^A-Za-z0-9]*models?)(?=$|[^A-Za-z0-9])/i

function normalizedOptions(options = {}) {
  return {
    checkProduct: options.checkProduct !== false,
    checkRuntime: options.checkRuntime !== false,
  }
}

export function candidatePathComponentViolation(component, options = {}) {
  const policy = normalizedOptions(options)
  if (policy.checkProduct && RETIRED_PRODUCT_COMPONENT.test(component)) {
    return { component, kind: 'product' }
  }
  if (policy.checkRuntime && RETIRED_RUNTIME_COMPONENT.test(component)) {
    return { component, kind: 'runtime' }
  }
  return null
}

export function findCandidatePathViolation(candidatePath, options = {}) {
  const renderedPath = String(candidatePath)
  const components = renderedPath.split(/[\\/]+/).filter(Boolean)
  for (const component of components) {
    const violation = candidatePathComponentViolation(component, options)
    if (violation) return { ...violation, path: renderedPath }
  }
  const compoundPath = components.join('/')
  const compoundViolation = candidatePathComponentViolation(
    compoundPath,
    options
  )
  if (compoundViolation) {
    return { ...compoundViolation, component: compoundPath, path: renderedPath }
  }
  return null
}

function violationMessage(violation) {
  const label =
    violation.kind === 'product'
      ? 'Retired product name'
      : 'Retired local runtime'
  return `${label} found in candidate path: ${violation.path} (component: ${violation.component})`
}

export function assertSafeCandidatePath(candidatePath, options = {}) {
  const violation = findCandidatePathViolation(candidatePath, options)
  if (violation) throw new Error(violationMessage(violation))
}

export function assertSafeCandidatePaths(root, options = {}) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('Candidate path root is required')
  }

  const resolvedRoot = path.resolve(root)
  let rootStats
  try {
    rootStats = fs.lstatSync(resolvedRoot)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Candidate path root does not exist: ${resolvedRoot}`)
    }
    throw error
  }
  if (rootStats.isSymbolicLink()) {
    throw new Error(
      `Candidate path root must not be a symbolic link: ${resolvedRoot}`
    )
  }
  if (!rootStats.isDirectory()) {
    throw new Error(`Candidate path root is not a directory: ${resolvedRoot}`)
  }

  let entryCount = 0
  const visit = (directory) => {
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(resolvedRoot, absolute)
      assertSafeCandidatePath(relative, options)
      entryCount += 1

      if (entry.isSymbolicLink()) {
        // Bundle symlinks can intentionally be absolute or become dangling
        // after an accepted workspace is relocated. Do not follow them; only
        // enforce the same token policy on the recorded link target.
        assertSafeCandidatePath(fs.readlinkSync(absolute), options)
        continue
      }

      if (entry.isDirectory()) visit(absolute)
    }
  }

  visit(resolvedRoot)
  return { entryCount, root: resolvedRoot }
}

export function parseCandidatePathPolicyArgs(argv) {
  let root
  let runtimeOnly = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--runtime-only') {
      if (runtimeOnly) throw new Error('Duplicate argument: --runtime-only')
      runtimeOnly = true
      continue
    }
    if (argument === '--root') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --root')
      }
      if (root) throw new Error('Duplicate argument: --root')
      root = value
      index += 1
      continue
    }
    throw new Error(`Unexpected argument: ${argument ?? 'missing'}`)
  }
  if (!root) throw new Error('Missing required argument: --root')
  return {
    options: { checkProduct: !runtimeOnly, checkRuntime: true },
    root,
  }
}

function usage() {
  return 'Usage: node scripts/ci/candidate-path-policy.mjs --root <candidate-directory> [--runtime-only]'
}

function main() {
  const { options, root } = parseCandidatePathPolicyArgs(
    process.argv.slice(2)
  )
  const result = assertSafeCandidatePaths(root, options)
  console.log(
    `Candidate path policy verified: ${result.root} (${result.entryCount} entries)`
  )
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    console.error(usage())
    process.exitCode = 1
  }
}
