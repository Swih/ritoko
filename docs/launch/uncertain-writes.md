# Why an interrupted batch should not blindly retry a write

A timeout can mean two different things: the request never reached the destination, or the destination accepted it and the response was lost. Retrying both situations the same way can create a duplicate customer, payment or submission.

Ritoko makes that ambiguity visible. A workflow defines a business key, scope, commit step and checks for the intended result. The local SQLite journal records the commit before dispatch. Once the write might have happened, interruption leaves the item for review. Verified rows are kept, and unstarted rows can continue from the frozen workflow and input.

Version 0.2.0 adds two optional ways to use business evidence. An `ensure` lookup checks the scoped destination before creating an item. Presence confirms the item without submitting; only a positive absence predicate permits creation. `reconcile` reads the lookup saved in the original run to settle an uncertain item. It does not replay the write, reload the spreadsheet or run setup. Inconclusive results leave the item unchanged.

These lookups need an authoritative direct HTTP GET or a trusted MCP tool explicitly marked read-only. They need checks for the specific record and its relevant business fields. A generic success message, an unavailable service or an unrelated record is not proof. Another client can still submit the same record between a check and a write: use destination-side idempotency or uniqueness controls where available.

The runnable [first-try example](../first-run.md) creates ten fake customers and then demonstrates journal skips on a second run. The [34-second recording](https://ritoko.com/watch) separately shows an interrupted browser batch with one uncertain row held for review. Both use controlled local applications; they do not prove behavior on every business system.

The resulting tradeoff is deliberate: a row may need review instead of appearing complete. The journal cannot atomically commit a remote request, a downloaded file and a local database transaction. Good verification and clear evidence are part of authoring a reliable workflow. See the [lookup rules](../usage.md#destination-lookup-ensure-and-reconcile) and [release gates](../release.md).
