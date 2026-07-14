import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const manifest = fs.readFileSync('flatpak/uk.jingxing.Mita.yml', 'utf8')
const metainfo = fs.readFileSync('flatpak/uk.jingxing.Mita.metainfo.xml', 'utf8')

test('Flatpak manifest launches the Biyan binary from Biyan deb contents', () => {
  assert.match(manifest, /^command: Biyan$/m)
  assert.match(manifest, /install -Dm755 usr\/bin\/Biyan \/app\/bin\/Biyan/)
  assert.match(manifest, /install -Dm644 usr\/share\/applications\/Biyan\.desktop/)
  assert.match(manifest, /desktop-file-edit --set-key=Exec --set-value=\/app\/bin\/Biyan/)
  assert.match(manifest, /usr\/share\/icons\/hicolor\/128x128\/apps\/Biyan\.png/)
  assert.doesNotMatch(manifest, /usr\/bin\/Mita/)
  assert.doesNotMatch(manifest, /Exec --set-value=\/app\/bin\/Mita/)
})

test('Flatpak keeps only the published app ID as a documented compatibility boundary', () => {
  assert.match(manifest, /Compatibility boundary: this published Flatpak app ID must stay stable/)
  assert.match(manifest, /^id: uk\.jingxing\.Mita$/m)
  assert.match(manifest, /flatpak\/Biyan_0\.0\.0_amd64\.deb/)
  assert.doesNotMatch(manifest, /flatpak\/Mita_[^/\s]*\.deb/)

  assert.match(metainfo, /Compatibility boundary: the published Flatpak app ID/)
  assert.match(metainfo, /<id>uk\.jingxing\.Mita<\/id>/)
  assert.match(metainfo, /<launchable type="desktop-id">uk\.jingxing\.Mita\.desktop<\/launchable>/)

  const productMetadata = metainfo
    .replaceAll('https://github.com/realerikk0/Mita/issues', '')
    .replaceAll('https://github.com/realerikk0/Mita', '')
    .replaceAll('uk.jingxing.Mita', '')
  assert.doesNotMatch(productMetadata, /\bMita\b/)
})

test('Flatpak metadata describes the remote-only Biyan product', () => {
  assert.match(metainfo, /<name>Biyan<\/name>/)
  assert.match(metainfo, /<summary>Desktop AI client for cloud and OpenAI-compatible providers<\/summary>/)
  assert.match(metainfo, /does\s+not bundle or run local AI models/)
  assert.doesNotMatch(
    metainfo,
    /Private offline|100% offline|Local AI models:|offline by default|localhost:1337|Llama\.cpp|Mita Hub|Native MLX/i,
  )
})

test('Flatpak no longer requests or bundles local model GPU compute support', () => {
  assert.match(manifest, /--device=dri/)
  assert.doesNotMatch(
    manifest,
    /--device=all|extensions\/cuda|OpenCL\/vendors|name: (?:volk|vulkan-headers|vulkan-tools|shaderc)/,
  )
  assert.doesNotMatch(manifest, /patches\/fix-cstdint\.patch/)
})
