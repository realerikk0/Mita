const mocks = () => (globalThis as any).__VECTOR_DB_EXTENSION_TEST_MOCKS__

export const createCollection = (...args: unknown[]) =>
  mocks().createCollection(...args)

export const createFile = (...args: unknown[]) => mocks().createFile(...args)

export const deleteCollection = (...args: unknown[]) =>
  mocks().deleteCollection(...args)

export const insertChunks = (...args: unknown[]) => mocks().insertChunks(...args)

export const listAttachments = (...args: unknown[]) =>
  mocks().listAttachments(...args)

export const chunkText = (...args: unknown[]) => mocks().chunkText(...args)
