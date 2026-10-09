# Ritoko 0.2.0

Ritoko 0.2.0 adds destination checks before creating an item, read-only reconciliation of an uncertain write, installation diagnostics and a runnable first try.

- `ensure` confirms an existing scoped record without submitting and permits creation only after a positive absence check.
- `run_reconcile` / `reconcile` use the original frozen lookup, parameters and input to check an uncertain item without replaying the submission. An inconclusive check leaves it for review.
- Lookups support direct HTTP GET and trusted MCP tools explicitly marked read-only. Browser, host and agent-managed lookups are outside this release's support.
- `doctor` checks runtime, installation, journal and browser configuration. Dedicated browser shutdown is bounded and never launches a new browser to close it.
- The [local first try](../first-run.md) creates ten fake CSV customers, verifies each with a separate readback and checks that rerunning creates nothing further. No account or Chrome is required for this example.
- Claude Code and Codex Git plugin manifests, npm and MCP Registry metadata are aligned at 0.2.0. The local MCP server exposes 20 tools. MCPB generation and extracted-bundle checks are now reproducible from committed scripts.

**Upgrade:** manual resolution now requires an evidence note and `--confirm-checked`, and is recorded as an unverified human decision. Adoption requires fresh verification. Update automation clients using these calls before upgrading. Reconciliation needs a lookup already present in the original run snapshot; adding a lookup to a saved workflow does not retrofit an older run.

Requires Node.js 24+. Browser workflows additionally need Chrome and an authorized debugging connection or explicitly selected dedicated profile. API-only workflows do not need Chrome. Host browser replay needs a client permitting page-script execution; current Codex computer-use read-only evaluation does not provide it.

Local validation: 206 unit tests, 37 E2E tests and 36-page site preflight pass on Windows, Node 24.19.0. Publication also requires green CI on the exact commit across Windows, macOS and Linux. The MCPB extracted test verifies 20 tools and two API rows followed by two skips; desktop-client runtime compatibility remains to be tested.

Install the executable release with `npm install ritoko@0.2.0`, or configure `npx -y ritoko@0.2.0 mcp` in a local stdio MCP client. Follow the [update policies](../release.md#maintaining-distributed-versions), test a small batch, and restart an existing MCP process after upgrading.
