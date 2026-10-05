# Research kit

How Ritoko learns from the people who run batches. Four pieces, one loop. Written 2026-10-05.

1. **Collect.** Three issue forms in [`.github/ISSUE_TEMPLATE`](../../.github/ISSUE_TEMPLATE) take pain reports, workflow requests and bug reports in a fixed shape, in public.
2. **Log.** Every pain a person describes becomes one row of the pain log ([`pain-log-template.csv`](pain-log-template.csv)): who, which tool, how many rows, which pain, their exact words, what they did, what it cost.
3. **Invite.** [`outreach-messages.md`](outreach-messages.md) has the first-contact messages, in English and French, and the rules for sending them.
4. **Interview.** [`interview-guide.md`](interview-guide.md) is the 25-minute script for 10 to 15 conversations, with the consent note, the note template, the coding rules and a French version for back offices.
5. **Decide.** The thresholds in section 8 of the guide are fixed before the first call. When counts cross one, write a decision record (date, rule, counts, log ids), then change the roadmap, and not before.
6. **Stay honest.** Count only unprompted, specific, past incidents. Compliments and "I would use it" are noise. No result switches off review holds or adds automatic resubmission.

Before you start:

- Create the labels the forms apply; GitHub skips a label that does not exist. `gh label create pain-report --repo Swih/ritoko --color D93F0B --description "What hurts in a batch automation"`, then the same for `workflow-request`. `bug` usually exists already: check with `gh label list --repo Swih/ritoko`.
- Link people straight to a form: `https://github.com/Swih/ritoko/issues/new?template=pain-report.yml`. Forms and the chooser only work once the files are on the default branch. The chooser lists templates alphabetically by file name; prefix the names with numbers to change the order.
- Keep your filled pain log, notes and contact sheet outside this repository: interview data is personal data. To export the reports, see section 7.3 of the guide.
- Excel in a French locale expects semicolons. Import the CSV with a comma delimiter (Data, From Text/CSV), or open it in a spreadsheet that asks.
