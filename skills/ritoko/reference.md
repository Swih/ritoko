# Ritoko reference

## Input files

Columns are header names, trimmed. A CSV is read as UTF-8, or as Windows-1252 (Excel's classic CSV export) when it is not valid UTF-8, separated by `,` or `;`. Excel dates become `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM:SS` when they have a time. The whole input is validated before anything runs; rows are frozen in the journal.

## Extract a table to CSV

To pull data from a back office, write by hand `{"id": "export", "do": "extract", "target": <the table>, "saveAs": "customers.csv"}`, with the table's role/name from the snapshot. It reads an HTML `<table>` or a `role=table/grid/treegrid` element (not other list layouts) and writes UTF-8 CSV: header from `<thead>`/header cells or the first row (stacked headers joined, blank ones named `Column N`), hidden rows and `<tfoot>` skipped, cell text trimmed. Only rendered rows of the current page are read: wait or expect for the data first; pagination is not followed. The file appears in the run's `files` and as `{{files.customers.csv}}`, e.g. in `items.from` when extracting in setup and processing each row. It is read-only, so it may follow a commit.

## Optional document reading

Most workflows need no OCR. When images must be read, call `document_image` with a file from a run (its `runId` and the path relative to the run `dir`) or a `browser_act` download, and read it with your own model. Do not install local OCR tools or add a site-specific invoice parser to Ritoko. If the user prefers an external OCR API, ask which provider and use credentials already configured for it, or have the user configure them securely; do not ask for an API key when your own vision suffices. Each new image needs this extraction, so do not describe it as model-free replay. Verify extracted dates, identifiers and amounts before submitting their CSV.
