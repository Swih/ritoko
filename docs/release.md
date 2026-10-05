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

## 0.2.0 release candidate

The recovery branch prepares 0.2.0; it is not a published npm release. The production distribution remains 0.1.1 until the candidate passes CI on all three operating systems and the versioned package is published through the release process below.

- `ensure` checks an explicitly scoped destination before an item writes. A matching record is confirmed without submitting; only a positive absence predicate permits the workflow to continue.
- `reconcile` and MCP `run_reconcile` settle an original uncertain row using its frozen workflow, parameters and item data. They read once without setup or resubmission; inconclusive results leave the row unchanged.
- Lookups support direct HTTP GET without redirects or browser sessions, and trusted MCP tools explicitly declaring `readOnlyHint: true`. Browser, host and agent-managed lookup paths are unsupported. The lookup must already exist in the run snapshot.
- Manual `resolve` now requires an evidence note and `--confirm-checked`; it records an unverified human decision. API/MCP adoption must perform fresh verification rather than trusting the skipped commit response. These changes can require updates to existing automation clients.
- `doctor` inspects the runtime and local installation. Selector fallbacks and unscoped workflows are visible in diagnostics and evidence. A failed dedicated Chrome startup now stops only the process launched by that browser instance; shutdown never starts a new browser.
- The site adds six guides in each language, six English tool comparisons and English/French FAQs, with canonical links, reciprocal language links, dated sources, sitemaps and text discovery files. The generated routes stay inside the analytics consent and path allowlist.

Local candidate validation on 2026-10-05, Windows with Node 24.19.0: lint and TypeScript pass, 193 unit tests and 37 E2E tests pass, including the isolated npm tarball and killed-CLI HTTP acceptance/reconciliation test. Site preflight passes for 35 indexable pages; production builds are idempotent, sample output is refused in production mode and removed on rebuild. Browser checks cover 24 pages at 390 and 1,440 px, and analytics consent, private-parameter removal and unknown-path exclusion.

The CI also rebuilds the site, checks publication metadata and rejects committed generated output that differs from the source data. Source-revision CI results remain the release gate; local tests alone do not establish support across all systems.

Search and answer visibility remains **not measured**. The [measurement kit](research/geo-measurement.md) reports real, saved observations; the research forms and interview templates contain no collected customer evidence. Technical SEO checks do not demonstrate rankings, citations or customer demand.

## Evidence before expanding compatibility claims

Controlled fixtures cannot establish every site's behavior. Keep the following work separate from an initial package release:

1. Repeat a representative authorized task on two real sites. Run at least ten small batches on each; report verified business outcomes, review/repair rate, duplicate writes, wall time, tool calls and tokens. Include a changed selector, session expiry, slow generation and interrupted download. Agree on any paid-generation budget first.
2. Exercise installation, tools/list, save, run, interrupt, resume and report in each client claimed as supported. Record client/Node/Chrome/OS versions. Host browser mode requires a client that permits page-script execution; read-only evaluation cannot satisfy that requirement.
3. Run realistic disk-backed batch sizes of 100, 1,000 and 10,000 on the same machine, repeating measurements. Separate SQLite time, transport time and browser/agent time. Do not weaken journal durability to improve a benchmark.
4. Add power-loss, disk-full and clipboard-restoration fault injection around file and journal boundaries before claiming atomic receipt recovery. Filesystem writes and SQLite transactions are separate; interrupted transfers can leave orphaned files.
5. Adopt newer MCP protocol versions, OAuth and extra host actions only alongside interoperability and recovery tests for those paths.

## Publishing

First publish the validated tarball to npm with a logged-in maintainer account. Confirm `npm view ritoko@<version> version mcpName dist.integrity` and install that registry version in a clean consumer directory. Keep package, lockfiles, plugin manifests and `server.json` versions aligned; npm versions are immutable.

Then manually dispatch **Publish MCP Registry** on `main`. It requires successful CI on the exact commit and the published matching npm version, validates the manifest with a pinned official publisher, and authenticates via GitHub OIDC. The namespace is case-sensitive: this repository owns `io.github.Swih/ritoko`. `release:check` checks it against the GitHub repository owner before publication. No persistent registry token is needed. See the [official publishing guide](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/github-actions.mdx).

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

## Maintaining distributed versions

GitHub is the source; npm is the executable distribution. Pushing a fix to GitHub alone does not update a published npm package, an already running MCP process or a separately published directory release.

For each executable change, choose a new version, align the package, root lock, plugin manifests, MCP manifest and protocol version, then run the release gates. Publish the validated npm tarball, verify a clean install of that registry version, and dispatch **Publish MCP Registry** on the same green commit. Create the corresponding GitHub release with its changelog and tarball. A failed directory update does not require republishing the same immutable npm version: retry that directory using the published version.

| Destination | Routine update |
|---|---|
| npm | Publish a new immutable version; stable publications use the `latest` tag by default. Git pushes do not publish packages. |
| Official MCP Registry | Dispatch the existing workflow for each npm release. It validates and publishes the versioned manifest after CI and npm checks. |
| GitHub | Push source changes; publish release notes and the matching archive for package releases. |
| Glama | Auto-Release is enabled for GitHub releases. Verify that the expected version and tools were published; manual repository sync, build and release remain the fallback. |
| Link-only directories such as the submitted mcpservers.org listing | Keep the GitHub link stable; update submitted metadata when the name, description, installation or supported features change. Their review/indexing is separate. |
| Smithery | Build and test a new MCPB bundle, then publish its release. The npm tarball does not replace a bundle. |

Consumers choose their update policy:

- `npx -y ritoko@0.1.1 mcp` keeps a reproducible version until the configuration changes.
- `npx --yes --prefer-online ritoko@latest mcp` checks the stable npm tag at launch. It still needs a process/client restart and does not replace a running server.
- A globally installed copy needs `npm install -g ritoko@latest`; a cloned source installation needs the new revision, dependencies and build.
- A client-managed plugin or MCPB bundle follows that client's update mechanism. A directory listing alone does not upgrade a local installation.

Use pinned versions for repeatable automation; test an upgrade on a small batch before moving production workflows to it. See [npm execution and cache behavior](https://docs.npmjs.com/cli/v11/commands/npm-exec/) and [npm publishing and dist tags](https://docs.npmjs.com/cli/v11/commands/npm-publish/).

The official MCP step is automated after a manual dispatch. Glama's enabled Auto-Release setting is intended to build and publish on each GitHub release; the initial version was also checked through its manual build/release path. npm publishing can later use trusted publishing, and a single release workflow can coordinate npm and the official registry. Smithery automation still needs bundle generation, validation and its account integration. Verify these integrations before relying on a fully automatic release.

## Initial distribution record

Version 0.1.1 was published on 2026-10-04 from commit `d6c3a67135fe478b248ae1b43600a49d32ff6f72`, with [successful CI on all three operating systems](https://github.com/Swih/ritoko/actions/runs/37156295697).

| Channel | Verified result |
|---|---|
| [npm](https://www.npmjs.com/package/ritoko/v/0.1.1) | Public 0.1.1, matching namespace and tarball integrity; isolated registry installation exposes 18 tools and skips already verified rows. |
| [Official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.Swih%2Fritoko/versions/0.1.1) | Active 0.1.1, npm package `ritoko`, local stdio transport. |
| [GitHub release](https://github.com/Swih/ritoko/releases/tag/v0.1.1) | npm archive and validated MCPB bundle attached to the tagged source revision. |
| [Glama](https://glama.ai/mcp/servers/Swih/ritoko) | Successful build of the tagged source, version 0.1.1 published, 18 detected tools. |
| [Smithery](https://smithery.ai/servers/akaswitsh/ritoko) | Successful local stdio bundle release, 18 public tools and accurate metadata. |

The free mcpservers.org form was submitted; submission is not approval. OpenAI directory submission still needs the applicable developer verification, metadata and review requirements.

The MCPB archive contains only the npm package and its locked production dependencies. Its extracted-bundle test verifies the 0.1.1 handshake, 18 tools and API replay without Chrome or development dependencies on Windows with Node 24.19.0. Clients must supply Node 24 or newer; bundle availability does not prove every client provides that runtime.

Smithery CLI 1.2.0 created the server but failed to publish this bundle with `No values to set`. The documented [multipart release API](https://smithery.ai/docs/api-reference/servers/publish-a-server) succeeded with the same archive, an explicit empty object configuration schema, and a server card containing the actual `tools/list` definitions collected from the extracted bundle. Its [metadata API](https://smithery.ai/docs/api-reference/servers/update-a-server) set the name, description, public repository, homepage and license. Reuse this supported API path if that CLI failure recurs; verify the release result and public tool listing before declaring completion.
