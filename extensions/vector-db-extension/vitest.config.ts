import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  resolve: {
    alias: {
      '@janhq/core': new URL('./src/test/mocks/core.ts', import.meta.url)
        .pathname,
      '@janhq/tauri-plugin-rag-api': new URL(
        './src/test/mocks/rag-api.ts',
        import.meta.url
      ).pathname,
      '@janhq/tauri-plugin-vector-db-api': new URL(
        './src/test/mocks/vector-db-api.ts',
        import.meta.url
      ).pathname,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
})
