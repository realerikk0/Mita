const fs = require('node:fs')
const path = require('node:path')

const docsRoot = path.resolve(__dirname, '..')

const forbiddenSourcePaths = [
  'src/pages/blog.mdx',
  'src/pages/changelog.mdx',
  'src/pages/changelog',
  'src/pages/handbook',
  'src/pages/post',
  'src/pages/privacy.mdx',
  'src/pages/docs/desktop/agents.mdx',
  'src/pages/docs/desktop/privacy.mdx',
  'src/pages/docs/desktop/privacy-policy.mdx',
  'src/pages/docs/desktop/jan-models',
  'src/pages/docs/desktop/local-engine',
  'src/pages/docs/desktop/integrations/claude-code.mdx',
  'src/pages/docs/desktop/integrations/openclaw.mdx',
  'src/components/DropdownDownload',
  'src/components/FavoriteModels.tsx',
  'src/components/NewsletterForm',
  'src/components/OAICoverage',
  'src/components/ui/dropdown-button.tsx',
  'src/helpers/authors.yml',
]

const requiredArchivePaths = [
  'unpublished-upstream-history/upstream-jan-site/pages/changelog.mdx',
  'unpublished-upstream-history/upstream-jan-site/pages/changelog',
  'unpublished-upstream-history/upstream-jan-site/pages/post',
  'unpublished-upstream-history/upstream-jan-site/pages/docs/desktop/jan-models',
]

const retiredRoute =
  /^\/(?:blog|changelog|handbook|post|privacy)(?:\/|$)|^\/docs\/desktop\/(?:agents|privacy(?:-policy)?|jan-models|local-engine)(?:\/|$)|^\/docs\/desktop\/integrations\/(?:claude-code|openclaw)(?:\/|$)/

const walkFiles = (directory) => {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? walkFiles(entryPath) : [entryPath]
  })
}

const failures = []

for (const relativePath of forbiddenSourcePaths) {
  if (fs.existsSync(path.join(docsRoot, relativePath))) {
    failures.push(`retired source is still a docs build input: ${relativePath}`)
  }
}

for (const relativePath of requiredArchivePaths) {
  if (!fs.existsSync(path.join(docsRoot, relativePath))) {
    failures.push(`required unpublished archive entry is missing: ${relativePath}`)
  }
}

const routesManifestPath = path.join(docsRoot, '.next/routes-manifest.json')
if (fs.existsSync(routesManifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(routesManifestPath, 'utf8'))
  const routes = [
    ...(manifest.staticRoutes ?? []),
    ...(manifest.dynamicRoutes ?? []),
    ...(manifest.dataRoutes ?? []),
  ]
    .map((entry) => entry.page ?? entry.route ?? '')
    .filter(Boolean)
  for (const route of routes.filter((candidate) => retiredRoute.test(candidate))) {
    failures.push(`retired route was compiled by Next: ${route}`)
  }
}

for (const root of ['.next/server/pages', 'out']) {
  const absoluteRoot = path.join(docsRoot, root)
  for (const file of walkFiles(absoluteRoot)) {
    const relative = path.relative(absoluteRoot, file).replaceAll(path.sep, '/')
    const route = `/${relative
      .replace(/\.(?:html|js|json)$/, '')
      .replace(/\/index$/, '')}`
    if (retiredRoute.test(route)) {
      failures.push(`retired route artifact exists: ${root}/${relative}`)
    }
  }
}

const retiredRouteLiteral =
  /["']\/(?:blog|changelog|handbook|post|privacy)(?:\/|["'])|["']\/docs\/desktop\/(?:agents|privacy(?:-policy)?|jan-models|local-engine)(?:\/|["'])|["']\/docs\/desktop\/integrations\/(?:claude-code|openclaw)(?:\/|["'])/
for (const file of walkFiles(path.join(docsRoot, 'out')).filter((candidate) =>
  /\.(?:html|js|json|xml)$/.test(candidate)
)) {
  if (retiredRouteLiteral.test(fs.readFileSync(file, 'utf8'))) {
    failures.push(
      `retired route literal leaked into release output: ${path.relative(docsRoot, file)}`
    )
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('Unpublished upstream archive boundary verified')
