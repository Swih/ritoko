# Local software privacy

Updated 9 October 2026. This notice describes the local Ritoko CLI, plugins and MCP server. The [website privacy notice](https://ritoko.com/privacy) separately describes optional website statistics.

Ritoko does not add application telemetry or send your runs to a Ritoko service. It runs on your computer. By default it stores workflows, frozen run inputs, non-secret parameters and variables, item outcomes and execution events in `~/.ritoko`. Set `RITOKO_HOME` to choose another location. Workflows can also save downloaded files, extracts and other evidence to configured paths. These files may contain personal or business data; control access to them and their backups.

A workflow sends the fields it needs to the websites, HTTP endpoints or MCP tools you configure. Those services and your AI client have their own data handling rules. A browser workflow can access the authorized Chrome session. An explicitly selected dedicated Chrome profile stores its own browser data. The local journal is not a substitute for the destination's privacy policy or access controls.

Declare credentials as environment-backed secret parameters rather than ordinary values. Ritoko keeps declared secret values in memory and redacts known secrets from its journal and reported errors. Ordinary workflow fields, filenames, inputs, results and evidence are not inherently secret. Do not embed passwords or tokens in them, and do not assume redaction detects every confidential value returned by a service.

Installing or bootstrapping the launcher downloads runtime packages from npm. Updating through GitHub, npm or a client-managed catalog contacts that distributor. These downloads are separate from workflow execution and remain governed by that service's policies.

You control retention of your local run data. Stop the server before removing its home, keep any evidence you need, and remember that backups and exported files are separate copies. Removing the local journal also removes its history for detecting prior confirmed or uncertain submissions; verify destination records before running a replacement installation against them.

For software support or a privacy question, use the [GitHub repository](https://github.com/Swih/ritoko) to request a private contact channel. Do not include personal data, credentials, private workflows or journals in public issues. See the [usage guide](usage.md#cli-and-browser-selection) for browser permissions and trust boundaries.
