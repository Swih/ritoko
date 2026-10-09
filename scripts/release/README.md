# Local MCPB release artifacts

Run from the repository root with Node.js 24 or newer and npm. The builder reads
`package.json` for the current version, and writes only `.ritoko/release-VERSION/`.
No publish or registry mutation occurs.

1. Install development dependencies once with `npm ci --ignore-scripts --no-audit --no-fund`.
   This also populates npm's cache. The bundle builder subsequently installs locked
   production dependencies **offline**, with lifecycle scripts disabled.
2. Install the independent official tools with
   `npm install --prefix .ritoko/mcpb-tools --ignore-scripts --save-exact @anthropic-ai/mcpb@2.1.2`.
   To reuse an existing installation, set `MCPB_TOOLS_DIR` to its directory.
3. Finish all source, example and documentation edits and run the project checks.
4. Run `npm pack --pack-destination .ritoko/release-VERSION --json` (create the directory first).
   npm's prepack builds the compiled JavaScript. Use the version from package.json.
5. Run `node scripts/release/build-mcpb.mjs [path/to/npm-pack.tgz]`.
6. Run `node scripts/release/validate-mcpb.mjs [path/to/bundle.mcpb]`.

The optional paths default to the current version's release directory. Run the
builder and validator sequentially; the builder replaces its own staging folder.
Repeat steps 4–6 after any source, package metadata, example or README change.

The validator uses official MCPB validation/unpacking and checks every extracted
file against a SHA-256 source inventory after the official packer's exclusions.
It launches the extracted bundle over stdio, checks the server version and 20
current tools, captures `server-card.json`, and runs a two-item local HTTP workflow
twice. It requires two verified items, two skipped items on rerun, and exactly two
HTTP requests, with an unavailable Chrome path. `mcpb-smoke.json` records the
runtime, platform, hashes and limitations; `SHA256SUMS` covers the npm tarball,
MCPB and actual server card. Production dependencies are included; source files,
dev dependencies, generated npm shims/locks, auth state, journals and caches are
excluded. No native .node modules or symlinks are accepted.

A successful stdio smoke is evidence for the recorded Node runtime and operating
system only. It does not establish compatibility with any desktop MCP client or
other operating systems; the manifest's platform list describes intended support.
