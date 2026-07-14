# Contributing to Biyan Extensions

Bundled Biyan extensions are private workspace packages installed from signed
application resources. An extension must have an allowlisted `@biyan/*` ID,
declare a valid entry point, and pass the staging installer checks.

```bash
cd extensions
yarn install
yarn workspaces foreach -Apt run build
```

Do not add local model runtimes, model catalogs, embeddings, retrieval, vector
storage, or public package publishing. Keep each extension narrowly scoped and
add tests for migration and install failures.
