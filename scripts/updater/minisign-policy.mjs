import {
  createHash,
  createPublicKey,
  verify as verifyCryptoSignature,
} from 'node:crypto'
import fs from 'node:fs'

function decodeBase64(value, label) {
  const encoded = String(value ?? '').trim()
  if (
    !encoded ||
    encoded.length % 4 === 1 ||
    !/^[0-9A-Za-z+/]*={0,2}$/.test(encoded)
  ) {
    throw new Error(`${label} is not canonical base64`)
  }
  const decoded = Buffer.from(encoded, 'base64')
  if (
    decoded
      .toString('base64')
      .replace(/=+$/, '') !== encoded.replace(/=+$/, '')
  ) {
    throw new Error(`${label} is not canonical base64`)
  }
  return decoded
}

function decodeUtf8(value, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value)
  } catch {
    throw new Error(`${label} is not valid UTF-8`)
  }
}

export function decodeUpdaterPublicKey(encoded) {
  const text = decodeUtf8(
    decodeBase64(encoded, 'Updater public key'),
    'Updater public key',
  )
  const lines = text.replace(/\r\n?/g, '\n').trimEnd().split('\n')
  if (
    lines.length !== 2 ||
    !lines[0].startsWith('untrusted comment: minisign public key')
  ) {
    throw new Error('Updater public key is not a Minisign public key')
  }
  const payload = decodeBase64(lines[1], 'Minisign public key payload')
  if (
    payload.length !== 42 ||
    payload[0] !== 0x45 ||
    ![0x44, 0x64].includes(payload[1])
  ) {
    throw new Error('Updater public key has an unsupported Minisign algorithm')
  }
  const keyId = payload.subarray(2, 10)
  const rawKey = payload.subarray(10)
  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex')
  return {
    keyId,
    key: createPublicKey({
      key: Buffer.concat([spkiPrefix, rawKey]),
      format: 'der',
      type: 'spki',
    }),
  }
}

function decodeUpdaterSignature(encoded, label) {
  const text = decodeUtf8(
    decodeBase64(encoded, `${label} updater signature`),
    `${label} updater signature`,
  )
  const lines = text.replace(/\r\n?/g, '\n').trimEnd().split('\n')
  if (
    lines.length !== 4 ||
    !lines[0].startsWith('untrusted comment:') ||
    !lines[2].startsWith('trusted comment: ')
  ) {
    throw new Error(`${label} is not a complete Minisign signature`)
  }
  const signaturePayload = decodeBase64(
    lines[1],
    `${label} Minisign signature payload`,
  )
  const globalSignature = decodeBase64(
    lines[3],
    `${label} Minisign global signature`,
  )
  if (
    signaturePayload.length !== 74 ||
    signaturePayload[0] !== 0x45 ||
    signaturePayload[1] !== 0x44 ||
    globalSignature.length !== 64
  ) {
    throw new Error(`${label} must use a prehashed Minisign signature`)
  }
  return {
    keyId: signaturePayload.subarray(2, 10),
    signature: signaturePayload.subarray(10),
    trustedComment: lines[2].slice('trusted comment: '.length),
    globalSignature,
  }
}

export function verifyUpdaterSignature(
  file,
  encodedSignature,
  publicKey,
  label,
) {
  const signature = decodeUpdaterSignature(encodedSignature, label)
  if (!signature.keyId.equals(publicKey.keyId)) {
    throw new Error(`${label} updater signature uses the wrong key`)
  }
  const prehash = createHash('blake2b512').update(fs.readFileSync(file)).digest()
  if (
    !verifyCryptoSignature(
      null,
      prehash,
      publicKey.key,
      signature.signature,
    )
  ) {
    throw new Error(`${label} updater signature does not verify`)
  }
  const globalPayload = Buffer.concat([
    signature.signature,
    Buffer.from(signature.trustedComment, 'utf8'),
  ])
  if (
    !verifyCryptoSignature(
      null,
      globalPayload,
      publicKey.key,
      signature.globalSignature,
    )
  ) {
    throw new Error(`${label} updater global signature does not verify`)
  }
}
