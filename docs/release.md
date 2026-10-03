# Release and reliability gates

The release unit is the deterministic runner, journal, HTTP/MCP integrations and supported host actions. Host features without recovery coverage should land in later versions. The README's supported-driver and protocol limits remain part of the contract.

## Required checks

Run against the exact source revision that will be published:

```sh
npm ci
npm run check
npm test
npm run build
npm run test:e2e
npm run release:check
```

The E2E suite includes the actual npm tarball installed outside the checkout with production dependencies only. To run just that distribution check: `npm run test:package`. Cold installs use the pinned public npm dependency graph; `RITOKO_TEST_NPM_OFFLINE=1` opts into a previously populated npm cache.

Release acceptance requires green CI on Windows, Linux and macOS. Local uncommitted work in another area is not evidence about the committed revision; do not publish those files incidentally.

The suite must continue proving:

- Frozen workflow and input, durable commit before dispatch, no automatic replay of an uncertain write.
- A killed compiled CLI after HTTP acceptance becomes review on restart, blocks future runs, and resumes after independent business evidence without duplicate writes or launching Chrome.
- Real browser/API transitions and a 20-row, four-tab host batch: interrupt, reopen SQLite, resolve, finish with 20 unique business records, rerun and skip all 20.
- Invalid agent results, stale batches, lease contention, secrets, and driver mismatches fail safely.
- Parallel receipts remain separate; a corrupt receipt or unwritable output folder affects its row while other rows continue and prior clipboard text is restored.
- A thousand-row API-only host run completes, retains no finished cursors, and does not materialize the whole input repeatedly. This complexity check uses SQLite in memory; persistence is exercised separately by restart tests.
- The tarball ships compiled integration modules, installs without development dependencies, exposes its CLI and stdio MCP tools, preserves exit statuses, and completes API-only workflows without Chrome.

## Evidence before expanding compatibility claims

Controlled fixtures cannot establish every site's behavior. Keep the following work separate from an initial package release:

1. Repeat a representative authorized task on two real sites. Run at least ten small batches on each; report verified business outcomes, review/repair rate, duplicate writes, wall time, tool calls and tokens. Include a changed selector, session expiry, slow generation and interrupted download. Agree on any paid-generation budget first.
2. Exercise installation, tools/list, save, run, interrupt, resume and report in each client claimed as supported. Record client/Node/Chrome/OS versions. Host browser mode requires a client that permits page-script execution; read-only evaluation cannot satisfy that requirement.
3. Run realistic disk-backed batch sizes of 100, 1,000 and 10,000 on the same machine, repeating measurements. Separate SQLite time, transport time and browser/agent time. Do not weaken journal durability to improve a benchmark.
4. Add power-loss, disk-full and clipboard-restoration fault injection around file and journal boundaries before claiming atomic receipt recovery. Filesystem writes and SQLite transactions are separate; interrupted transfers can leave orphaned files.
5. Adopt newer MCP protocol versions, OAuth and extra host actions only alongside interoperability and recovery tests for those paths.

## Publishing

First publish the validated tarball to npm with a logged-in maintainer account. Confirm `npm view ritoko@<version> version mcpName dist.integrity` and install that registry version in a clean consumer directory. Keep package, lockfiles, plugin manifests and `server.json` versions aligned; npm versions are immutable.

Then manually dispatch **Publish MCP Registry** on `main`. It requires successful CI on the exact commit and the published matching npm version, validates the manifest with a pinned official publisher, and authenticates via GitHub OIDC. No persistent registry token is needed. See the [official publishing guide](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/github-actions.mdx).

For later npm releases, configure [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) on the package before adding a publishing workflow. Public GitHub Actions can then publish with OIDC and provenance, without storing an npm token in the repository.

Directory submission is separate from publishing a package:

| Destination | Next requirement |
|---|---|
| [Official MCP Registry](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx) | Published npm package, matching namespace, authenticated publication |
| [Glama](https://glama.ai/mcp/faq) | GitHub repository submission and directory checks |
| [Smithery](https://smithery.ai/docs/build/publish) | Account and tested MCPB bundle for local stdio distribution |
| [mcpservers.org](https://mcpservers.org/submit) | Free directory form and review; optional paid priority is separate |
| [OpenAI plugin directory](https://developers.openai.com/plugins/deploy/submission) | Verified developer identity, public metadata and review; the [remote MCP review](https://developers.openai.com/plugins/deploy/app-review) requires a public endpoint, which the local stdio server does not provide |

Do not claim a directory accepted or indexed a submission until its public listing or review response confirms it. A paid listing needs its own budget authorization.
