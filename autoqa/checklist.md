# Biyan Remote-only AutoQA Checklist

## Install and branding

- [ ] Windows installs to `%LOCALAPPDATA%\Programs\Biyan\Biyan.exe`.
- [ ] macOS installs `/Applications/Biyan.app`; Linux installs the `Biyan` executable.
- [ ] Process, shortcut, installer and updater artifact names use Biyan only.
- [ ] A legacy managed `mita` shim cannot start a local server or download a model.

## Upgrade matrix

- [ ] current → A → B → C.
- [ ] current → B, current → C, A → C, B → C and fresh C.
- [ ] Default, custom and conflicting legacy data directories are covered.
- [ ] `jan.db` and `mita.db` are copied, checked and switched to `biyan.db`.
- [ ] Disk-full, permissions, lock and crash injection resume idempotently.
- [ ] Legacy sources and downloaded model/RAG assets remain untouched.
- [ ] Factory reset preserves retired local-runtime/model/RAG data for every
  keep-option combination.
- [ ] Legacy-data cleanup deletes only the inspected paths after the matching
  confirmation token is supplied.

## Remote providers and chat

- [ ] Configure a test-only OpenAI-compatible remote provider through CI secrets.
- [ ] Send and receive text without any automatic paid request during startup or migration.
- [ ] Old local-provider threads remain readable and require an explicit remote model choice.
- [ ] Legacy remote provider settings migrate to Biyuan or OpenAI-compatible as specified.
- [ ] Local provider addresses are disabled with a clear retired-runtime message.

## Files and media

- [ ] Images remain supported.
- [ ] Provider-native file input is used when advertised by the selected model.
- [ ] Otherwise PDF, Office, text and code files up to 20 MB are parsed locally and injected in full.
- [ ] Files exceeding provider/context limits are blocked with an explanation; no truncation or summary occurs.
- [ ] Project folders organize chats without knowledge-base, retrieval, embedding or vector-index behavior.

## API, MCP and privacy

- [ ] Swagger title is `Biyan API Server Endpoints`.
- [ ] Local API proxies configured remote providers only; retired local routes return `410 LOCAL_RUNTIME_REMOVED`.
- [ ] `Biyan Web Research`/`biyan-web-research` and `BIYAN_WEB_RESEARCH_*` work after migration.
- [ ] Errors link to `help@biyan.ai` and do not attach tokens, full paths or raw content.

## Release safety

- [ ] No Jan domains, local-runtime extensions or model artifacts are loaded or requested.
- [ ] Every workspace package is private and no workflow can run public npm publish.
- [ ] Formal builds fail without `BIYAN_SIGNING_KEY`.
- [ ] Windows/macOS/Linux artifacts pass release policy and updater signature checks.
