import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const resourceNodeModules = resolve(root, 'src-tauri/resources/node_modules')
const packages = ['playwright', 'playwright-core']

mkdirSync(resourceNodeModules, { recursive: true })

for (const packageName of packages) {
  const source = resolve(root, 'node_modules', packageName)
  const destination = resolve(resourceNodeModules, packageName)

  if (!existsSync(source)) {
    throw new Error(`Missing ${packageName}. Run yarn install before preparing Web Research runtime.`)
  }

  rmSync(destination, { recursive: true, force: true })
  cpSync(source, destination, {
    recursive: true,
    dereference: false,
  })
  console.log(`Copied ${packageName} to ${destination}`)
}

writeFileSync(resolve(resourceNodeModules, '.gitkeep'), '')
