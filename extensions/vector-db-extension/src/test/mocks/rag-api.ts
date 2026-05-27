const mocks = () => (globalThis as any).__VECTOR_DB_EXTENSION_TEST_MOCKS__

export const parseDocument = (...args: unknown[]) =>
  mocks().parseDocument(...args)
