import { strFromU8, unzipSync } from 'fflate'

/** Extract readable paragraphs from the main document part of a DOCX file. */
export function extractDocxText(bytes: Uint8Array): string {
  let archive: ReturnType<typeof unzipSync>
  try {
    archive = unzipSync(bytes)
  } catch {
    throw new Error('这个 DOCX 文件无法解压，可能已经损坏')
  }
  const document = archive['word/document.xml']
  if (!document) throw new Error('DOCX 中没有找到正文内容')

  const xml = new DOMParser().parseFromString(
    strFromU8(document),
    'application/xml'
  )
  if (xml.querySelector('parsererror')) {
    throw new Error('DOCX 正文格式无法识别')
  }

  const paragraphs = Array.from(xml.getElementsByTagName('*'))
    .filter((element) => element.localName === 'p')
    .map((paragraph) =>
      Array.from(paragraph.getElementsByTagName('*'))
        .filter((node) => ['t', 'tab', 'br', 'cr'].includes(node.localName))
        .map((node) =>
          node.localName === 't'
            ? (node.textContent ?? '')
            : node.localName === 'tab'
              ? '\t'
              : '\n'
        )
        .join('')
        .trimEnd()
    )
    .filter((paragraph) => paragraph.trim())

  if (!paragraphs.length) throw new Error('DOCX 中没有可导入的正文')
  return paragraphs.join('\n\n')
}
