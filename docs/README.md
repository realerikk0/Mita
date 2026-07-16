# Biyan Documentation

The documentation site is built with [Nextra](https://nextra.site/) and exported as static files for Cloudflare Pages at [docs.biyan.ai](https://docs.biyan.ai/).

## Published information architecture

- `/docs/desktop/`: Biyan Desktop guides.
- `/docs/desktop/remote-models/`: cloud Provider setup.
- `/docs/desktop/file-upload`: image and document behavior.
- `/docs/desktop/data-folder`: cumulative current → A → B → C migration.
- `/docs/desktop/mcp`: MCP setup and safety.
- `/docs/desktop/api-server`: remote-only local API gateway.

Upstream Jan changelog, posts, handbook pages, retired local-runtime documentation, and unapproved legal pages remain in source control for history but are excluded from navigation, static export, robots, and sitemap generation. Do not link to them from published pages.

The `postbuild` sitemap step also runs `scripts/prune-unpublished-output.cjs`. It removes generated HTML/data/chunks and archived images that Next compiles while discovering source pages, then filters the client build manifest. This step is mandatory before publishing `out`.

## Local development

Requirements: Node.js 20 or later and Yarn 1.22 for this documentation workspace.

```bash
cd docs
yarn install --frozen-lockfile
yarn dev
```

Production check:

```bash
cd docs
yarn build
```

The static site is written to `docs/out`.

## Cloudflare Pages

The repository includes `wrangler.toml` with `pages_build_output_dir = "./out"`.

- Project root: `docs`
- Build command: `yarn install --frozen-lockfile && yarn build`
- Build output: `out`
- Custom domain: `docs.biyan.ai`

Preview locally or deploy after authenticating Wrangler:

```bash
cd docs
npx wrangler pages dev out
npx wrangler pages deploy out --project-name biyan-docs
```

Do not publish Privacy or Terms pages until the legal entity and final policy text are approved.

For documentation support, email [help@biyan.ai](mailto:help@biyan.ai).
