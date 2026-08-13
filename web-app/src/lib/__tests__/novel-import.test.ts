import { describe, expect, it } from 'vitest'

import { extractDocxText } from '@/lib/novel-import'

describe('extractDocxText', () => {
  const bytes = (base64: string) =>
    Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))

  it('extracts paragraphs, tabs and line breaks from document.xml', () => {
    const archive = bytes(
      'UEsDBBQAAAAIACyhDF27IRNKpQAAAPMAAAARAAAAd29yZC9kb2N1bWVudC54bWyzKbdKyU8uzU3NK1GoyM3JK7Yqt1XKKCkpsNLXL07OSM1NLNbLL0jNA8ql5RflJpYAuUXp+uX5RSkFRfnJqcXFmXnpuTn6RgYGZvq5iZl5SnZAI5PyUypBdAGIKAIRJXbP16x5sqPh+eoFNvogLogEygBJsCJklS9nr3gxYS9UGZBITNKHSDztn/h8wyq4RFIRTLx16dONDVjMBZIQpwAZMG/aAQBQSwECFAAUAAAACAAsoQxduyETSqUAAADzAAAAEQAAAAAAAAAAAAAAAAAAAAAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAEAAQA/AAAA1AAAAAAA'
    )
    expect(extractDocxText(archive)).toBe('第一章\n\n雨落\t发簪\n入局')
  })

  it('rejects a malformed or empty archive', () => {
    expect(() => extractDocxText(new Uint8Array([1, 2, 3]))).toThrow('无法解压')
    expect(() =>
      extractDocxText(
        bytes(
          'UEsDBBQAAAAIACyhDF0AAAAAAgAAAAAAAAAJAAAAZW1wdHkudHh0AwBQSwECFAAUAAAACAAsoQxdAAAAAAIAAAAAAAAACQAAAAAAAAAAAAAAAAAAAAAAZW1wdHkudHh0UEsFBgAAAAABAAEANwAAACkAAAAAAA=='
        )
      )
    ).toThrow('没有找到正文')
  })
})
