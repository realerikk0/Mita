# Contributing to Biyan Core

`@biyan/core` contains shared extension APIs and persisted data types. It is an
internal, private workspace package.

```bash
yarn install
yarn build
yarn test
```

Keep public types backwards compatible when possible. New storage fields must
be additive, and release code must not add local-runtime, model-download, RAG,
or vector-database dependencies.
