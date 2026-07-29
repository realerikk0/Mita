export const DIRECT_C_CURRENT = Object.freeze({
  version: '0.6.633',
  tag: 'v0.6.633',
  sourceCommit: '97d5f734b472f0b65e141614f047e405f1ba1c0b',
  manifestSha256:
    '142abddf03744562195404d0dd9ae92f53d8f74d20b2cef19b2db60aeb8ec350',
})

export const DIRECT_C_ROUTER_SOURCES = Object.freeze({
  '0.6.643': Object.freeze({
    tag: 'v0.6.643',
    sourceCommit: '38e6d9290a8b9b0f152ff2a7eefb550e6ead7df5',
    migrationPhase: 'A',
    dataSchema: 1,
    manifestKey: 'biyan/updater/releases/v0.6.643/latest.json',
    manifestSha256:
      'a0ad7721c74aa6ec7817bb1b9626dbad05226e7871f21cebb4976921d100c9fa',
  }),
  '0.6.644': Object.freeze({
    tag: 'v0.6.644',
    sourceCommit: 'd58f4e9141ee9dfc985171d13c993103dd763b01',
    migrationPhase: 'B',
    dataSchema: 2,
    manifestKey: 'biyan/updater/releases/v0.6.644/latest.json',
    manifestSha256:
      'a12610090f3cf49d767a00ac4a0f2125c2f64f66baeb03096c862ac25c744cdb',
  }),
  '0.6.645': Object.freeze({
    tag: 'v0.6.645',
    sourceCommit: 'a79c715a61057d7b78b440d90e3419dfc7e55d12',
    migrationPhase: 'C',
    dataSchema: 3,
    manifestKey: 'biyan/updater/releases/v0.6.645/latest.json',
    manifestSha256:
      '83c65a2d55615ceb98617ae0025c45f55273c27450fd79cc60da3ff9e66ceeab',
  }),
})

export const DIRECT_C_REQUIRED_PLATFORMS = Object.freeze([
  'windows',
  'macos',
  'linux',
])

export const DIRECT_C_REQUIRED_SCENARIOS = Object.freeze([
  'legacy-manual-to-c',
  'legacy-auto-to-c',
  'current-to-c',
  'a-to-c',
  'b-to-c',
  'c-to-c',
  'fresh-c',
])

export const DIRECT_C_CANONICAL_UPDATER_PLATFORMS = Object.freeze([
  'darwin-aarch64',
  'darwin-x86_64',
  'windows-x86_64',
  'linux-x86_64',
])

export const DIRECT_C_TARGET_SOURCE_COMMIT =
  '581ebf6b19ef407a9645d0b318792f1012f8f75b'
