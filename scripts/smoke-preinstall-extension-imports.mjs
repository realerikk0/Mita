import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const tar = require('tar')

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const preInstallDir = path.join(rootDir, 'pre-install')
const bareTauriPluginImport =
  /\b(?:import|export)\b[^;\n]*['"]@biyan\/tauri-plugin-[^'"]+['"]|import\(\s*['"]@biyan\/tauri-plugin-/g
const retiredJanImport = /['"]@janhq\//g

async function getExtensionPackages() {
  const entries = await readdir(preInstallDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tgz'))
    .map((entry) => path.join(preInstallDir, entry.name))
    .sort()
}

async function extractExtensionEntry(packagePath) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'biyan-extension-smoke-'))
  try {
    await tar.x({
      file: packagePath,
      cwd: tempDir,
      filter: (entryPath) => entryPath === 'package/dist/index.js',
      strict: true,
    })

    return await readFile(path.join(tempDir, 'package', 'dist', 'index.js'), 'utf8')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

const packages = await getExtensionPackages()
if (!packages.length) {
  throw new Error(`No extension packages found in ${preInstallDir}`)
}

const failures = []
for (const packagePath of packages) {
  const code = await extractExtensionEntry(packagePath)
  const matches = [
    ...[...code.matchAll(bareTauriPluginImport)].map((match) => match[0]),
    ...[...code.matchAll(retiredJanImport)].map((match) => match[0]),
  ]
  if (matches.length) {
    failures.push({ packagePath, matches })
  }
}

if (failures.length) {
  console.error('[preinstall-smoke] Found unresolved Tauri plugin API imports:')
  for (const failure of failures) {
    console.error(`- ${path.relative(rootDir, failure.packagePath)}`)
    for (const match of failure.matches) {
      console.error(`  ${match}`)
    }
  }
  process.exit(1)
}

console.log(
  `[preinstall-smoke] ${packages.length} extension packages contain no retired @janhq/* or bare @biyan/tauri-plugin-* imports`
)
