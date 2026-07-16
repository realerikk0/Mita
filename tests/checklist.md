# Biyan Release QA

The former Jan/local-runtime checklist was retired with Biyan migration phase C.
Biyan is a remote-only desktop client and must not download, install, or start
llama.cpp, MLX, Foundation Models, RAG, embedding, or vector-database runtimes.

Use the maintained release checklist in [`autoqa/checklist.md`](../autoqa/checklist.md).
It covers:

- Biyan installation and package branding;
- current -> A -> B -> C and cumulative upgrade paths;
- remote providers, chat, files, media, MCP, and privacy;
- retired-runtime behavior and explicit legacy-data cleanup;
- signed artifacts, updater contracts, and release safety.

The platform migration runner is documented in
[`autoqa/README.md`](../autoqa/README.md). Do not restore the old local-model QA
requirements to this file; historical upstream material belongs under
`docs/unpublished-upstream-history/`.
