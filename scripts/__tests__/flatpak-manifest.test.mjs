import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const manifest = fs.readFileSync('flatpak/uk.jingxing.Mita.yml', 'utf8')

test('Flatpak manifest launches the Biyan binary from Biyan deb contents', () => {
  assert.match(manifest, /^command: Biyan$/m)
  assert.match(manifest, /install -Dm755 usr\/bin\/Biyan \/app\/bin\/Biyan/)
  assert.match(manifest, /install -Dm644 usr\/share\/applications\/Biyan\.desktop/)
  assert.match(manifest, /desktop-file-edit --set-key=Exec --set-value=\/app\/bin\/Biyan/)
  assert.match(manifest, /usr\/share\/icons\/hicolor\/128x128\/apps\/Biyan\.png/)
  assert.doesNotMatch(manifest, /usr\/bin\/Mita/)
  assert.doesNotMatch(manifest, /Exec --set-value=\/app\/bin\/Mita/)
})
