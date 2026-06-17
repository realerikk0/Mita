import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const MODEL = {
  id: 'sentence-transformer-mini',
  fileName: 'model.gguf',
  expectedBytes: 45_949_216,
  expectedSha256:
    '797b70c4edf85907fe0a49eb85811256f65fa0f7bf52166b147fd16be2be4662',
  urls: [
    'https://apps.jan.ai/huggingface.co/second-state/All-MiniLM-L6-v2-Embedding-GGUF/resolve/main/all-MiniLM-L6-v2-ggml-model-f16.gguf?download=true',
    'https://huggingface.co/second-state/All-MiniLM-L6-v2-Embedding-GGUF/resolve/main/all-MiniLM-L6-v2-ggml-model-f16.gguf?download=true',
  ],
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const modelDir = path.join(
  rootDir,
  'src-tauri',
  'resources',
  'embedding-models',
  MODEL.id
)
const modelPath = path.join(modelDir, MODEL.fileName)
const tempPath = `${modelPath}.tmp`

async function fileSha256(filePath) {
  const hash = createHash('sha256')
  const { createReadStream } = await import('node:fs')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}

async function validateExisting(filePath) {
  try {
    const info = await stat(filePath)
    if (info.size !== MODEL.expectedBytes) return false
    return (await fileSha256(filePath)) === MODEL.expectedSha256
  } catch {
    return false
  }
}

async function download(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'Biyan embedding model preparer' },
    redirect: 'follow',
  })

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }

  await rm(tempPath, { force: true })
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath))

  const info = await stat(tempPath)
  if (info.size !== MODEL.expectedBytes) {
    throw new Error(
      `Downloaded size mismatch: ${info.size} != ${MODEL.expectedBytes}`
    )
  }

  const sha256 = await fileSha256(tempPath)
  if (sha256 !== MODEL.expectedSha256) {
    throw new Error(`Downloaded SHA-256 mismatch: ${sha256}`)
  }

  await rename(tempPath, modelPath)
}

await mkdir(modelDir, { recursive: true })

if (await validateExisting(modelPath)) {
  console.log(`[embedding-model] ${MODEL.id} already prepared`)
  process.exit(0)
}

let lastError
for (const url of MODEL.urls) {
  try {
    console.log(`[embedding-model] downloading ${MODEL.id} from ${url}`)
    await download(url)
    console.log(`[embedding-model] prepared ${modelPath}`)
    process.exit(0)
  } catch (error) {
    lastError = error
    console.warn(`[embedding-model] download failed from ${url}: ${error}`)
  }
}

await rm(tempPath, { force: true })
throw lastError ?? new Error(`Failed to prepare ${MODEL.id}`)
