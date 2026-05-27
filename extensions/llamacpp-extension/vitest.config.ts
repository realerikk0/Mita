import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  resolve: {
    alias: {
      '@janhq/tauri-plugin-hardware-api': new URL(
        './src/test/mocks/hardware-api.ts',
        import.meta.url
      ).pathname,
      '@janhq/tauri-plugin-llamacpp-api': new URL(
        './src/test/mocks/llamacpp-api.ts',
        import.meta.url
      ).pathname,
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
