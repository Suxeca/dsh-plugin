# @suxeca/dsh-literature-library

Authenticated local literature bookmarks for the radar briefing. The first-party `/literature-library` page shares one server-side catalog and bookmark file across browsers. Visualization cards cannot perform these writes because their sandbox blocks network requests.

## Configuration

The bundle patch declares **no paths**: an absolute path in a published patch pins the plugin to the machine that built it. The three paths are resolved at activation instead, in this order:

1. the `libraryRoot` / `catalogPath` / `pagePath` config keys, or the `DSH_LITERATURE_ROOT` environment variable for the whole root;
2. `~/Workspace/docs/literature`, when that directory already exists on disk;
3. `~/.dsh/literature` — the portable default for a fresh machine.

The three paths are derived from the resolved root: `<root>/library`, `<root>/library/catalog.json`, and `<root>/library-page.html`. Point it at an existing library by exporting `DSH_LITERATURE_ROOT=/srv/literature`, or by declaring the keys explicitly:

```yaml
- insert:
    - id: literature-library
      name: '@suxeca/dsh-literature-library'
      config:
        libraryRoot: /srv/literature/library
        catalogPath: /srv/literature/library/catalog.json
        pagePath: /srv/literature/library-page.html
```

When no catalog can be read at the resolved path, the plugin logs the resolved paths and stays **inactive** rather than throwing: a missing library must not take the host down with it. Catalog records must contain an exact arXiv id, source title, authors, source URL, and verification timestamp. Clients select existing ids; they cannot submit metadata or filesystem paths.

## Persistence

`bookmarks.json` is the authoritative selection list. Selecting a paper creates `papers/<id>/metadata.json` and a new `notes.md` only if no notes file exists. Unselecting never removes research files. Writes are serialized in one active plugin and committed through sibling-file rename before the UI reports success. A malformed bookmark file is refused, not replaced. This version stores metadata and note templates; it does not download PDFs or validate scientific claims.

## Authentication and lifecycle

Every page and API request uses the existing connection service's `requestRejection`. Cross-origin writes are rejected. Routes belong to `ctx.effect` and are disposed with the plugin. Install through the bundle patch. A config-less install is the normal case: the paths resolve at activation, so no raw injection or hand-written path is needed. Only one library writer should be active.

## Build and test

```sh
DSH_CHECKOUT=/path/to/deepseek-harness bash scripts/build.sh
node --test lib/library.test.js
node browser-test.mjs
```

The browser test uses the installed Google Chrome and local Playwright package. It exercises the actual route handlers through an HTTP server, with a test-only authentication provider and an isolated temporary library. It tests mobile selection-to-disk, reopening, independent browser contexts, filtering, discussion outlines, note retention, and denial of unauthenticated/cross-origin requests. It does not impersonate a production login; production unauthenticated access was separately observed as HTTP 401.

## Model Experience

No model tools, prompts, or session-log inputs are registered. Star selection is user-facing viewing state stored in the local library, not a scientific verification or an automatic change to the radar's interest profile. No model-token or KV-cache change is introduced.

## Known Limitations and Deferred Work

The page is a first-party route, not an inline visualization with a working network bridge. Scientific summaries, date-window membership, and journal metadata require further review. PDF archiving and in-page note editing are not implemented. The durable library assumes a single Host writer, not multiple DSH processes concurrently writing the same directory.
