# Biyan Assistant Extension

Provides the default `biyan` assistant and cumulative migration of legacy
assistant records. Stock legacy identities are normalized; customized records
are preserved under deterministic import IDs.

```ts
import { AssistantExtension } from '@biyan/core'
```

The extension does not register retrieval, embedding, or local-runtime tools.
