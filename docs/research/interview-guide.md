# Interview guide: how people run batches with browser agents

For the maintainer, to run 10 to 15 conversations of about 25 minutes. English first; section 10 is the French version for back offices (persona D). Written 2026-10-05.

The method is "past behaviour only", as described in Rob Fitzpatrick's book *The Mom Test*: ask about what already happened, never about what someone would do. Read the book for the reasoning; this guide only fixes the questions, the coding and the decision rules for this project.

1. [Purpose and ground rules](#1-purpose-and-ground-rules)
2. [Who to talk to](#2-who-to-talk-to)
3. [Screener questions](#3-screener-questions)
4. [Consent, recording and privacy](#4-consent-recording-and-privacy)
5. [The 25-minute script](#5-the-25-minute-script)
6. [One-page note template](#6-one-page-note-template)
7. [Coding answers into the pain log](#7-coding-answers-into-the-pain-log)
8. [Decision rules](#8-decision-rules)
9. [Synthesis template](#9-synthesis-template)
10. [Version française pour les back-offices (persona D)](#10-version-française-pour-les-back-offices-persona-d)

## 1. Purpose and ground rules

What the conversations are for:

1. The last time a batch of repeated browser or portal work went wrong: what happened, what it cost, what the person did.
2. What they use today, and what it costs them in money, hours or model usage.
3. Who else has to say yes, and what proof that person asks for.
4. Which pains they bring up without being prompted.

What they are not: a sales call, a demo or an opinion poll. Nobody is asked whether they would use or pay for anything.

Five rules:

1. **Talk about their life, not about Ritoko.** Do not describe the product unless asked (see 5.8).
2. **Past behaviour only.** "The last time", "what did you do next". Never "would you", "do you think", "how much would you pay".
3. **Specifics.** When, how many rows, which tool, how long, what it cost.
4. **Listen.** You speak less than a third of the time. Silence is fine; people fill it with the useful part.
5. **Compliments are not data.** "Sounds useful" and "I'd try it" go under *noise* in the note and never into the pain log.

Instead of / ask:

| Instead of | Ask |
| --- | --- |
| Would you use a tool that resumes after a crash? | Tell me about the last time a run stopped halfway. What did you do next? |
| Do duplicates bother you? | Has the same row ever been entered twice? When was the last time? (Only in the probes, marked as prompted.) |
| Is the cost a problem? | What did that run cost you? (Let them pick the unit.) |
| How much would you pay for this? | What do you pay today for this work, in money or hours? Who approves it? |
| Would your clients want a report? | The last time a client asked what happened to their rows, what did you send? |
| Do you like automation? | Walk me through the last batch you ran, from the moment you started. |

Do not offer payment or gifts in the first round. The invitation says nothing is offered, and incentives change what people tell you.

## 2. Who to talk to

| Code | Who | Why | Target |
| --- | --- | --- | --- |
| A | Developers who use Claude Code, Codex or a similar agent for browser or portal tasks beyond testing their own app | Traction audience | 5 |
| C | Consultants and agencies who deliver automations to clients and answer for the results | Revenue audience, later | 4 |
| D | Small back offices (accounting, e-commerce, insurance), French-speaking | The people who do the repeated entry, and the people who pay | 4 |
| B | Anyone else (for example no-code builders on their own account, RPA teams, tool builders) | Not in the quotas; talk to them if they come to you, and keep them separate in the counts | 0 |

Aim for 13, between 10 and 15. With fewer than 3 conversations in a group, draw no conclusion about that group.

- Run two practice calls first, with people you know, and do not count them. Use them to time the script.
- Do not count friends or family. They are kind, which is the problem.
- Sources: pain-report issues where the person ticked the call box; public replies under the rules in [`outreach-messages.md`](outreach-messages.md); referrals from earlier calls (ask at the end).
- The pain-report form promises that contact stays in the issue. Reply there, and move to email or video only when the person gives you a way to reach them.
- Stop at 15, or earlier if three calls in a row add no new pain category and no new tool. This stopping rule is a heuristic, not a statistical one.

## 3. Screener questions

Ask by message or in a two-minute pre-call. The person passes if question 1 gets a specific, recent answer. A person who ran a batch without trouble passes too: they show where the pain is not.

For everyone:

1. In the last 90 days, did you run the same web task over a list of 10 or more items? What was it?
2. How did you do it: an AI agent, a script, a tool, by hand?
3. Did you run it yourself, or decide how it is run?
4. Can we talk for 20 minutes without showing real customer data or passwords?

Add for each group:

- **A.** Which agent and which browser tool? Was the target a site you do not control (a portal, a back office, a marketplace)? Pass only if yes.
- **C.** In the last 6 months, did you deliver or maintain a recurring automation for a client that touches a web portal? Who answers for it when it fails: you or the client? Pass if the person or their agency is accountable.
- **D.** In a typical week, roughly how many entries (invoices, orders, declarations, policies) does your team enter into web portals? Who does it? Do you use a tool for it today? Pass if someone on the team does it weekly and the person is not only in IT.

If someone does not pass, thank them, do not pitch, and delete their contact details if they ask.

## 4. Consent, recording and privacy

This is a practical starting point, not legal advice.

### 4.1 Defaults

- Take notes. Record audio only if you will use it to check exact quotes, and the person agrees on the recording.
- Collect nothing you do not need: no client names, no screens with real data, no passwords. If they start, stop them: "Please leave out names and real data."
- Keep two documents outside this repository: a **contact sheet** (name, channel, date, consent given yes/no) and the **notes** (call ID only, for example `A03`).
- Quotes in public documents carry no name, handle or company.
- Do not ask about health, beliefs or anything else that is not about their work. If they volunteer it, do not write it down.

### 4.2 Decide before call 1

Write these down. The values are suggestions, not legal requirements:

- Audio: deleted once the note is written, and within 30 days at the latest.
- Contact sheet: deleted 90 days after your last conversation, or on request, whichever is first. Someone who declines keeps a one-line "do not contact" entry so that you never write to them again, unless they ask you to delete that line too.
- Notes with call IDs only: kept as long as the project needs them.
- Storage: an encrypted disk or a private drive that only you can open.
- The address people use to withdraw or ask for deletion: `[address]`.

### 4.3 Read aloud at the start

> I'm [name]. I write open-source software, including Ritoko. This call is research: I'm not selling anything and I won't pitch it. I'll ask about things that already happened to you. I take notes, and I don't write down your name or your clients' names. I'd like to record the audio only so I can quote you exactly. The recording is for me alone, and I delete it within 30 days. You can say no to the recording, skip any question, stop at any time, and ask me afterwards to delete what I have about you: write to [address]. Is it OK if I record?

If you record, keep the spoken yes on the recording. If the answer is no: "No problem, I'll only take notes", and carry on.

### 4.4 Privacy note to send with the invitation or after the call

- **Who:** [name], individual maintainer of Ritoko.
- **Why:** research on how people run repeated browser tasks. Not marketing, and no mailing list.
- **What:** your answers (notes without your name) and, only with your yes, audio. To schedule the call: your name and a way to reach you.
- **How long:** the durations you chose in 4.2.
- **Your rights:** ask what I hold, have it corrected or deleted, withdraw your consent at any time, and complain to your data protection authority (in France, the CNIL).
- **Contact:** [address].

### 4.5 References to check yourself

Regulation (EU) 2016/679 (GDPR): Article 5 (minimisation, storage limitation), Article 6 (lawful basis: consent or legitimate interests), Article 7 (conditions for consent; withdrawing must be as easy as giving it), Article 13 (information to give when you collect data from the person), Article 17 (erasure). Official text: <https://eur-lex.europa.eu/eli/reg/2016/679/oj>. For people in France, the CNIL's website (cnil.fr) has guidance in French for professionals. If a participant starts to describe their clients' personal data, stop them.

## 5. The 25-minute script

The call is 25 minutes in your calendar. You promised 20: at minute 20, say so and ask before you continue.

| Minutes | Block | Goal |
| --- | --- | --- |
| 0:00-2:00 | Opening and consent | They know who you are, why you ask, and what happens to the notes |
| 2:00-4:00 | Context | Their role and their repeated work |
| 4:00-12:00 | The last time | One specific, recent batch from start to end. This is the core |
| 12:00-17:00 | Today's way | Tools, workarounds, money, people |
| 17:00-20:00 | Probes | Only the pains they have not mentioned, as past events |
| 20:00 | Checkpoint | "That's 20 minutes, as promised. May I take five more?" |
| 20:00-23:00 | Decision and proof | Who decides, who asks for proof, what "done" means |
| 23:00-25:00 | Close | Anything missed, one referral, one concrete next step, thanks |

Follow each answer with "What happened next?", "How did you know?" or "How long did that take?" Wait before you speak.

### 5.1 Context (2:00-4:00)

- What is your role, in a sentence?
- What do you do in a browser or a web portal that repeats?
- Roughly how often, and how many items at a time?

### 5.2 The last time (4:00-12:00)

Ask in this order.

1. When was the last time you ran it?
2. Walk me through it from the moment you started.
3. Which tools, agents or people were involved?
4. How did it end? (Do not suggest that something went wrong.)
5. How did you find out? (If something did.)
6. What did you do next?
7. From the start until you were sure it was right, how long did it take?
8. What did it cost you? Time, money, a customer, a deadline. Use the unit you track.
9. What did you change afterwards?
10. Before that one, when did it last go wrong? What was different?

Keep this block neutral: a question that names a pain (stopped, duplicated, cost, proof) belongs in the probes, because the answer is then prompted. Add for each group, as needed:

- **A.** What exactly did you ask the agent to do? Did you reuse that prompt, skill or script the next time? What happened the second time? Did you ever turn the task into a script? What happened to it?
- **C.** What kind of client was it, without names? Who noticed first, you or the client? Who paid for the time it took?
- **D.** Which portal, what do you type, from which file? Who does it, and what happens when that person is away? How did you find the error, who corrected it, and did it cost money, a penalty or a complaint?

### 5.3 Today's way (12:00-17:00)

- What do you use for this now?
- What did you try and stop using? Why?
- What does it cost you today, in money, subscriptions or hours? Who pays?
- The last time you changed a tool for this kind of work, who had to agree? How did it go?
- **C only:** How do you charge for running or fixing automations? What do your contracts say about monitoring or fixes, in general terms?
- **D only:** Has IT, a client or a software vendor ever stopped you from using a tool? What happened?

### 5.4 Probes (17:00-20:00)

Ask only about pains they have not raised. Each one is a past event. Mark every answer *prompted* in the note, and `raised_unprompted = N` in the log. "Never" is an answer: write it down.

Three minutes hold three or four probes. Pick those that fit the person, and rotate the order between calls so that the last ones are not always the ones you skip. Write down the probes you did not ask: "not asked" is not "never".

- **Repeat.** The last time you ran the same task again, did you start from scratch or reuse something?
- **Cost (A).** Do you see what a run costs you anywhere? Where, and when did you last look?
- **Interruption.** Has a run ever stopped halfway? The last time, how did you know which items were done?
- **Long runs (A).** Have you left a long run alone? What happened?
- **Duplicates.** Has the same item ever been entered or sent twice? When was the last time? What happened?
- **Site change.** When did a site you automate last change under you? How did you notice?
- **Session.** Has a login or a session expired during a run? What happened?
- **Proof.** Has anyone asked you to show what happened to one specific item? What did you show?
- **False success.** Has a tool or an agent ever told you it was done when it was not? How did you find out?
- **Trust.** Has anyone refused to let an automation use their logged-in session? What was the reason?

### 5.5 Checkpoint (20:00)

> That's 20 minutes, as I promised. I have about five more minutes of questions. Is it OK to continue?

If not, go straight to the close (5.7).

### 5.6 Decision and proof (20:00-23:00)

- Who decides how this work is done? Who would have to agree to a new tool?
- Who asks you for proof that it was done, and how often? What do you show them?
- What does "done" mean for one item? How do you check?
- **C only:** After the last failure, what did you send the client? How do you show a client what happened to each record today?

### 5.7 Close (23:00-25:00)

- Is there something I should have asked?
- Who else runs batches like this? A name or a public post is enough; you do not need to introduce me.
- One concrete step that costs them something and does not involve Ritoko. Pick one:
  - "Could you send me the column headers of one batch you run, with made-up values?"
  - "Could we talk for 15 more minutes with the workflow on screen and no real data?"
  - "May I ask you one question in a month, to hear what changed?" (the weakest)
- Thank them, repeat how to withdraw, promise nothing.

Whatever they answer goes under *Commitments* in the note. It is the only evidence for `would_try`.

### 5.8 If they ask what you are building

> I maintain an open-source tool called Ritoko. An agent does a browser task once, the task is saved, and it can be replayed on the rows of a spreadsheet with a record of what happened to each row. I'd rather keep this call about your experience. Can I come back to it at the end?

Then go back to their story. Do not demo, do not share your screen, do not send the link during the call. If they still ask at the end, give the GitHub link, and mark everything after that point *post-pitch* in the note: it is excluded from the counts.

### 5.9 After the call

Within 24 hours: write the note, add the pain-log rows, update the counts, delete the audio according to your choice in 4.2. Do not change the questions in the middle of a round of five calls; change them between rounds and write the change in the synthesis.

### 5.10 Mistakes to catch in your own calls

- You described Ritoko before they told their story.
- You asked "would you".
- You suggested a pain ("does it annoy you when...").
- You asked about "usually" and accepted a general answer. Ask about the last time.
- You let a compliment stand.
- You talked for more than a third of the time.
- You wrote down a feature wish as if it were a pain. Ask what they were trying to get done, how they cope today, and when it last came up.

## 6. One-page note template

Copy it for each call. Keep it outside this repository.

```text
Call ID: A03      Date: ____-__-__      Length: __ min      Language: EN / FR
Recorded: yes / no (spoken consent on the recording: yes / no)
Persona: A / B / C / D      Source: issue #__ / public reply / referral
Knew Ritoko before the call: yes / no
Role in one line, no names: ______________________________

1. The last time (story)
   When: ____    What for: ____    Items: ____    Tools: ____
   Timeline, in order:
   -
   How they found out: ____          What they did: ____
   Time until they were sure it was right: ____
   Cost, in their unit: ____
   Exact words: "____"

2. Pains raised WITHOUT prompting (tick, with the minute)
   [ ] cost-per-row  [ ] slow  [ ] duplicates  [ ] lost-progress  [ ] site-changed
   [ ] session-expired  [ ] agent-stopped  [ ] no-proof  [ ] false-success
   [ ] non-deterministic  [ ] other: ____

3. Pains confirmed only after a probe (tick; each needs a past event, otherwise write "never" or put it under noise)
   Probes not asked: ____

4. Today
   Tools: ____    Tried and dropped (why): ____
   Pays: ____ (amount, unit, what it buys, who pays)

5. Who decides, and who asks for proof: ____

6. Proof they produce today (ask them to describe it, not to show it): ____

7. Commitments
   Asked for: ____    Answer: ____

8. Noise (compliments, hypotheticals, feature wishes)

9. Surprises, and anything that contradicts what we assumed

10. Follow-up (what, by when): ____

Post-pitch from minute: ____ (everything after is excluded from the counts)
```

## 7. Coding answers into the pain log

Code each call within 24 hours into `pain-log-template.csv` (copy it; keep your copy outside this repository). One row per pain per person. If one incident shows two pains, write two rows with the same prefix (`A03.1`, `A03.2`). Delete the two `EXAMPLE` rows first.

### 7.1 Columns

| Column | What to write | Rule |
| --- | --- | --- |
| `id` | `<call or post>.<n>` | Interview: persona letter and two digits, for example `A03.1`. Issue: `I<number>.<n>`. Other public post: `W<nn>.<n>`. |
| `date` | Date of the call or of the post | `YYYY-MM-DD` |
| `source` | Where it came from | `interview`, or the public URL of the issue or post. Never a private-community link or an email address. |
| `persona` | Who they are | `A`, `B`, `C` or `D` (section 2) |
| `tool_used` | What they used in that incident | Lowercase slugs joined with `+`: `claude-in-chrome`, `claude-code`, `playwright-mcp`, `codex`, `browser-use`, `stagehand`, `skyvern`, `scripts`, `rpa`, `n8n`, `make`, `zapier`, `by-hand`, `spreadsheet-macros`, `software-import`, `outsourced`, `other:<name>` |
| `rows_per_run` | Batch size as they said it | A number, a range such as `200-500`, or `unknown` |
| `frequency` | How often they run it | `several-per-day`, `daily`, `weekly`, `monthly`, `occasionally`, `one-off`, `unknown` |
| `pain_category` | One category per row | A slug from 7.2 |
| `verbatim_quote` | Their exact words, up to about 300 characters | No names. Keep the original language; add a translation after it as `[EN: ...]` |
| `what_they_did` | What they actually did, past tense | Start with how they found out when that matters (rule R4). Name the proof artifact if there was one (rule R3) and whether they checked items by hand (rule R2). |
| `cost_or_impact` | The cost in their own unit | Hours, money, a penalty, a complaint, a missed deadline, or `unknown`. Do not convert units. |
| `pays_today` | What they pay for this problem area | Amount, unit, what it buys, who pays (for example `25 USD/month subscription, paid by me`). Hours count. `nothing` or `unknown` are valid. |
| `would_try` | Did they take a step that costs them something? | `Y` only if they sent a redacted sample, booked a second call, introduced someone, or asked to try the tool on their own batch. `N` if they declined a concrete step or have no current pain. Otherwise `unknown`. "Sounds good" is `unknown`. |
| `follow_up` | The next step with a date | For example `send slots by 2026-10-20`, or `none` |
| `raised_unprompted` | Did they raise it before the probes? | `Y` or `N`. On an issue form, a ticked box counts as `N` and text the person wrote counts as `Y`. |

The 15th column, `raised_unprompted`, is there because the decision rules in section 8 count unprompted mentions.

### 7.2 Pain categories

| Slug | Use it when | Do not use it when |
| --- | --- | --- |
| `cost-per-row` | They paid or used up model usage (money, plan limit, tokens) again and again for the same task or for many rows, and it hurt | "AI is expensive" in general |
| `slow` | A run took long enough that they changed what they did: waited, ran it overnight, split it | It was only slower than they hoped |
| `duplicates` | The same item was entered, sent or created twice | An item was missing instead |
| `lost-progress` | A run was interrupted (crash, timeout, closed laptop) and they could not continue without redoing or checking work | The run finished and the result was wrong |
| `site-changed` | A site changed and the automation broke or gave wrong results | A login or session expired |
| `session-expired` | A login, a one-time code or a session expired during a run | The site changed |
| `agent-stopped` | The agent or tool stopped before the end, looped, or asked for help on a long list | They stopped it on purpose |
| `no-proof` | They could not show, to themselves, a client or a boss, what happened to each item | They could show it but did not like the format |
| `false-success` | The tool or agent reported success when the work was incomplete or wrong | They found the failure at once, from an error message |
| `non-deterministic` | The same task took a different path or gave different results on each run | The inputs were different |
| `other` | Anything else; explain it in `what_they_did` | |

### 7.3 From an issue form to log rows

| Form field | Pain-log column |
| --- | --- |
| Issue URL and creation date | `source`, `date` |
| Which agent or tool do you use today? | `tool_used` |
| Rows per run | `rows_per_run` |
| How often do you run it? | `frequency` |
| Who is this automation for? and What do you automate? | `persona` (your reading: A, C or D) |
| What breaks or costs too much? (ticked boxes) | One row per tick that the story supports, with `raised_unprompted = N` |
| The worst incident, in your own words | `verbatim_quote`, `what_they_did`, `cost_or_impact`. Categories named in this text get `raised_unprompted = Y` |
| What would 'done right' look like? | Your private notes; there is no column |
| A 20-minute call (optional), ticked | `follow_up`: "propose a time in the issue" |

To export the reports: `gh issue list --repo Swih/ritoko --label pain-report --state all --limit 200 --json number,url,createdAt,body`.

## 8. Decision rules

### 8.1 Fix them before call 1

Copy the table to your private notes with today's date. Change any threshold now. Do not change it again until the synthesis. The 4-of-10 rule R1 is the maintainer's; the others are proposals of about a third to 40 percent of people (60 percent for R6 and R9, which test the headline message).

### 8.2 What counts

A person counts for a pain when all three hold:

1. They raised it before the probes (`raised_unprompted = Y`).
2. It was a specific past incident: when, and what happened.
3. `what_they_did` and `cost_or_impact` are filled in (`unknown` with a reason is allowed for the cost).

Count people, not rows. Prompted answers and general complaints are noted, not counted. Exceptions: R3, R7 and R8 count facts the script asks for directly (a client asked for proof, money is paid, an incident in the last 90 days). They still need a specific past event, but not `raised_unprompted = Y`.

Thresholds count interview participants in personas A, C and D (R5 also looks at bug reports). Pain-report issues and public posts are leads: they decide whom to invite and which probes to add. Report them next to the interview counts, never inside them.

Two independent mentions of something new make a lead: add it to the probes of the next round. Three or more make a candidate for a rule.

### 8.3 Rules

The candidates named below (`ensure`, `reconcile`, `check` preflight, the HTML/CSV report, the heal journal and diff, `ritoko doctor`, the scheduled canary) are not implemented. This table decides whether to work on them, not what they do.

| # | Signal (people counted) | Threshold | If met | If not met |
| --- | --- | --- | --- | --- |
| R1 | `duplicates` or `lost-progress` | 4 of the first 10 (6 of 15) | `ensure` stays on the roadmap; design it from these incidents | Deprioritise `ensure`; look again after 10 more pain reports |
| R2 | `lost-progress` or `no-proof` where people checked items by hand | 3 people | `reconcile` is worth designing; start from how they checked | Leave `reconcile` out of the next plan |
| R3 | `no-proof` in personas C and D, where a client or boss asked for proof and they produce a manual artifact today | 3 of the C and D calls together | The HTML/CSV report moves up; build it from the artifact they described | The report stays nice to have |
| R4 | `site-changed`, personas A and C | 4 of 10, and in 2 of them they found out late (from a user, a client, or after the run ended) | The heal journal and diff and the scheduled canary move up | If people noticed at once and fixed it in minutes, deprioritise the canary |
| R5 | `session-expired` in the calls, or setup problems among the first 10 reports labelled `bug` | 3 people, or 3 of those 10 reports | `check` preflight and `ritoko doctor` move up | No change |
| R6 | `cost-per-row`, persona A, with a figure in their own unit | 3 of 5 A calls | Keep "Pay the model once, not per row" as the lead message | Test another lead message before relying on cost |
| R7 | `pays_today` is money or paid hours, personas C and D, with a named person who controls the budget | 3 of the C and D calls together | A paid offer (support, reports, setup) is worth testing | No revenue work this round; keep building for traction |
| R8 | Stop rule: people who describe a specific incident from the last 90 days | Fewer than 3 of 10 | The pain is not frequent enough for this audience: stop adding features, revisit audience and channel | |
| R9 | Counter-signal, persona A: "I ask the agent again and it works in minutes" | 6 of 10 | Determinism is not their pain: rethink the hook before more engineering | |

### 8.4 What no interview can change

- An uncertain write is never resubmitted automatically; it is held for review.
- Nothing heals itself without confirmation.
- Public claims stay within what the code does and what was measured.

If someone asks for "just retry it automatically", file it as a feature wish, ask what they were trying to get done, and record the incident behind it.

### 8.5 Small samples

Thresholds on 10 or 15 conversations are rules to stop you from following a loud story. They are not estimates. With 10 conversations, 4 mentions fits anywhere from about 17% to 69% of people like these (95% Wilson interval); 3 of 10 fits about 11% to 60%; 6 of 15 about 20% to 64%; 0 of 10 still fits up to about 28%. The people you reach are not a random sample, so the real uncertainty is larger. Report counts and what people did, not percentages.

<details>
<summary>The interval, as code</summary>

```python
from math import sqrt

def wilson(k, n, z=1.96):
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0, c - h), c + h
```

</details>

### 8.6 Decision record

Write one per decision, in your private notes:

```text
Date: ____    Rule: R_    Threshold: ____    Observed: __ of __ (ids: A03.1, C02.2, ...)
Decision: ____
What would change my mind: ____
Next check: ____
```

## 9. Synthesis template

Fill it after every five calls and at the end. Keep it outside this repository; publish only counts and unnamed quotes.

```markdown
# Synthesis, round _ (calls A01 to __)

Date: ____    Thresholds fixed on: ____    Changed since: no / yes (what, why)

## Coverage
| Persona | Calls | Counted | Language, sources |
| --- | --- | --- | --- |
| A | | | |
| C | | | |
| D | | | |
| B (not in the quotas) | | | |

## Pain counts (people: unprompted and specific / prompted only)
| Pain | A | C | D | B | Counted | Prompted only |
| --- | --- | --- | --- | --- | --- | --- |
| cost-per-row | | | | | | |
| slow | | | | | | |
| duplicates | | | | | | |
| lost-progress | | | | | | |
| site-changed | | | | | | |
| session-expired | | | | | | |
| agent-stopped | | | | | | |
| no-proof | | | | | | |
| false-success | | | | | | |
| non-deterministic | | | | | | |
| other | | | | | | |

## Rules
| Rule | Threshold | Observed (ids) | Decision |
| --- | --- | --- | --- |

## What people do today
Tools, workarounds, what they pay and who pays.

## Who decides, and who asks for proof

## Quotes worth keeping (ids only, no names)

## Surprises and things that contradict what we assumed

## What we did not learn

## Next round: changes to the script or the probes
```

## 10. Version française pour les back-offices (persona D)

Pour les petites équipes de comptabilité, d'e-commerce ou d'assurance. Mêmes principes que les sections 1 à 9 : le modèle de notes (section 6), le codage (section 7) et les règles de décision (section 8) s'appliquent sans changement. Les libellés des notes et du journal restent en anglais.

### 10.1 Objectif et règles

Ce que l'on veut apprendre :

1. La dernière fois qu'un lot de saisies répétitives sur un portail ou un site web a mal tourné : ce qui s'est passé, ce que cela a coûté, ce que la personne a fait.
2. Ce qu'elle utilise aujourd'hui et ce que cela lui coûte : argent, abonnements, heures.
3. Qui d'autre doit donner son accord, et quelle preuve cette personne demande.
4. Les difficultés qu'elle évoque sans qu'on les lui suggère.

Ce n'est pas un appel commercial, ni une démonstration, ni un sondage d'opinion. On ne demande à personne s'il utiliserait ou paierait quoi que ce soit.

Cinq règles :

1. **Parlez de leur travail, pas de Ritoko.** Ne présentez pas l'outil sauf si on vous le demande (voir 10.4).
2. **Seulement le passé.** « La dernière fois », « qu'avez-vous fait ensuite ». Jamais « utiliseriez-vous », « pensez-vous que », « combien paieriez-vous ».
3. **Des faits précis.** Quand, combien de lignes, quel outil, combien de temps, quel coût.
4. **Écoutez.** Vous parlez moins d'un tiers du temps. Le silence est utile.
5. **Les compliments ne sont pas des données.** « Ça a l'air utile » et « je testerais » vont dans la rubrique *bruit* des notes, jamais dans le journal.

Au lieu de / demandez :

| Au lieu de | Demandez |
| --- | --- |
| Utiliseriez-vous un outil qui reprend après un plantage ? | Racontez-moi la dernière fois qu'un lot s'est arrêté en cours de route. Qu'avez-vous fait ensuite ? |
| Les doublons vous posent-ils problème ? | Une même ligne a-t-elle déjà été saisie deux fois ? La dernière fois, c'était quand ? (Seulement dans les sondes, marqué « suggéré ».) |
| Combien paieriez-vous ? | Que payez-vous aujourd'hui pour ce travail, en argent ou en heures ? Qui valide cette dépense ? |
| Vos clients voudraient-ils un rapport ? | La dernière fois qu'un client vous a demandé ce qu'il était advenu de ses lignes, que lui avez-vous envoyé ? |
| Aimez-vous l'automatisation ? | Racontez-moi le dernier lot que vous avez traité, depuis le moment où vous avez commencé. |

N'offrez ni paiement ni cadeau lors de la première série d'entretiens : l'invitation ne promet rien, et une contrepartie change ce que les gens racontent.

### 10.2 Présélection

À poser par message ou lors d'un échange de deux minutes. La personne est retenue si la première réponse est concrète et récente. Une personne dont les lots se sont bien passés est retenue aussi : elle montre où la difficulté n'est pas.

1. Ces 90 derniers jours, avez-vous saisi ou envoyé le même type d'opération sur un portail ou un site web, pour une liste de 10 éléments ou plus ? De quoi s'agissait-il (factures, commandes, déclarations, contrats, avenants, relevés) ?
2. Comment l'avez-vous fait : à la main, avec un tableur ou une macro, avec un outil, avec un prestataire ?
3. Est-ce vous qui le faites, ou qui décidez comment cela se fait ?
4. Une semaine type représente combien de saisies pour votre équipe ? Qui s'en occupe ?
5. Pouvons-nous échanger 20 minutes sans que vous montriez de données clients ni de mots de passe ?

Retenue : quelqu'un de l'équipe fait ce travail chaque semaine et la personne n'est pas uniquement dans l'informatique. Une grande structure avec une équipe d'automatisation dédiée se note comme persona B.

Si la personne n'est pas retenue : remerciez, ne présentez rien, et supprimez ses coordonnées si elle le demande.

### 10.3 Consentement, enregistrement et vie privée (RGPD)

Ce texte est un point de départ pratique, pas un avis juridique.

Par défaut :

- Prenez des notes. N'enregistrez l'audio que si vous en avez besoin pour vérifier des citations exactes, et que la personne est d'accord, de vive voix, sur l'enregistrement.
- Ne collectez rien d'inutile : ni noms de clients, ni écrans avec des données réelles, ni mots de passe. Si la personne commence, arrêtez-la : « Merci de ne pas citer de noms ni de données réelles. »
- Deux documents, hors du dépôt Ritoko : une **fiche de contacts** (nom, canal, date, consentement oui/non) et les **notes** (identifiant d'appel seulement, par exemple `D02`).
- Les citations dans un document public ne portent ni nom, ni pseudo, ni entreprise.
- Ne posez aucune question sur la santé, les opinions ou tout ce qui n'est pas le travail. Si la personne en parle, ne le notez pas.

À décider avant le premier appel (suggestions, pas des obligations légales) : audio supprimé dès que la note est écrite et sous 30 jours au plus ; fiche de contacts supprimée 90 jours après votre dernier entretien ou sur demande (une personne qui refuse garde une ligne « ne pas contacter » pour que vous ne lui écriviez plus, sauf si elle demande aussi la suppression de cette ligne) ; notes sans nom conservées tant que le projet en a besoin ; stockage sur un disque chiffré ou un espace privé ; adresse pour retirer son accord ou demander la suppression : `[adresse]`.

À lire au début de l'appel :

> Je m'appelle [prénom nom]. J'écris des logiciels open source, dont Ritoko. Cet appel est une démarche de recherche : je ne vends rien et je ne vais rien vous présenter. Je vais vous poser des questions sur des choses qui vous sont déjà arrivées. Je prends des notes sans écrire votre nom ni celui de vos clients. J'aimerais enregistrer l'audio uniquement pour pouvoir vous citer exactement ; l'enregistrement reste entre mes mains et je le supprime sous 30 jours. Vous pouvez refuser l'enregistrement, ne pas répondre à une question, arrêter à tout moment, et me demander ensuite de supprimer ce que j'ai sur vous en écrivant à [adresse]. Êtes-vous d'accord pour que j'enregistre ?

Si la réponse est non : « Pas de souci, je prends seulement des notes », et poursuivez. Si vous enregistrez, gardez le « oui » sur l'enregistrement.

Note d'information à envoyer avec l'invitation ou après l'appel :

- **Qui :** [nom], mainteneur individuel de Ritoko.
- **Pourquoi :** recherche sur la façon dont on traite des tâches répétitives dans un navigateur. Pas de prospection, pas de liste de diffusion.
- **Quoi :** vos réponses (notes sans votre nom) et, seulement avec votre accord, l'audio. Pour fixer l'appel : votre nom et un moyen de vous joindre.
- **Combien de temps :** les durées que vous avez choisies ci-dessus.
- **Vos droits :** demander ce que je conserve, le faire corriger ou supprimer, retirer votre consentement à tout moment, et saisir la CNIL (cnil.fr) en cas de difficulté.
- **Contact :** [adresse].

Références à vérifier vous-même : règlement (UE) 2016/679 (RGPD), articles 5, 6, 7, 13 et 17, texte officiel : <https://eur-lex.europa.eu/eli/reg/2016/679/oj>. Si la personne se met à décrire des données personnelles de ses clients, arrêtez-la.

### 10.4 Déroulé de 25 minutes

L'appel dure 25 minutes dans votre agenda. Vous en avez promis 20 : à la minute 20, dites-le et demandez avant de continuer.

| Minutes | Bloc | But |
| --- | --- | --- |
| 0:00-2:00 | Ouverture et consentement | Elle sait qui vous êtes, pourquoi vous demandez, et ce que deviennent les notes |
| 2:00-4:00 | Contexte | Son rôle et son travail répétitif |
| 4:00-12:00 | La dernière fois | Un lot précis et récent, du début à la fin. C'est le cœur de l'entretien |
| 12:00-17:00 | Comment on fait aujourd'hui | Outils, contournements, argent, personnes |
| 17:00-20:00 | Sondes | Seulement les difficultés non évoquées, sous forme d'événements passés |
| 20:00 | Point de contrôle | « Nous voici à 20 minutes, comme promis. Puis-je prendre cinq minutes de plus ? » |
| 20:00-23:00 | Décision et preuve | Qui décide, qui demande une preuve, ce que veut dire « terminé » |
| 23:00-25:00 | Clôture | Ce qui manque, une recommandation, une suite concrète, remerciements |

Après chaque réponse : « Et ensuite ? », « Comment l'avez-vous su ? » ou « Combien de temps cela a-t-il pris ? » Attendez avant de parler.

**Contexte (2:00-4:00)**

- Quel est votre rôle, en une phrase ?
- Qu'est-ce que vous faites de répétitif sur un portail ou un site web ?
- À quelle fréquence, et combien d'éléments à la fois ?

**La dernière fois (4:00-12:00)** — dans cet ordre :

1. Quand avez-vous traité ce genre de lot pour la dernière fois ?
2. Racontez-moi cela depuis le moment où vous avez commencé.
3. Quels outils ou quelles personnes étaient impliqués ?
4. Comment cela s'est-il terminé ? (Ne suggérez pas qu'un problème est survenu.)
5. Comment l'avez-vous découvert ? (Si quelque chose s'est mal passé.)
6. Qu'avez-vous fait ensuite ?
7. Du début jusqu'au moment où vous étiez sûr(e) que c'était bon, combien de temps cela a-t-il pris ?
8. Qu'est-ce que cela vous a coûté ? Du temps, de l'argent, une pénalité, une réclamation, un délai manqué. Dans l'unité que vous suivez.
9. Qu'avez-vous changé après ?
10. Avant celui-là, quand cela s'était-il mal passé pour la dernière fois ? Qu'est-ce qui était différent ?

Variantes pour les back-offices : Quel portail, que saisissez-vous, à partir de quel fichier ? Qui le fait, et que se passe-t-il quand cette personne est absente ? Comment avez-vous trouvé l'erreur, qui l'a corrigée, et cela a-t-il coûté de l'argent, une pénalité ou une réclamation ?

**Comment on fait aujourd'hui (12:00-17:00)**

- Qu'utilisez-vous pour ce travail aujourd'hui ?
- Qu'avez-vous essayé puis abandonné ? Pourquoi ?
- Que cela vous coûte-t-il aujourd'hui, en argent, en abonnements ou en heures ? Qui paie ?
- La dernière fois que vous avez changé d'outil pour ce type de travail, qui devait donner son accord ? Comment cela s'est-il passé ?
- Le service informatique, un client ou un éditeur de logiciel vous a-t-il déjà empêché d'utiliser un outil ? Que s'est-il passé ?

**Sondes (17:00-20:00)** — seulement ce qui n'a pas été évoqué. Chaque question porte sur un événement passé. Marquez chaque réponse « suggéré » dans la note, et `raised_unprompted = N` dans le journal. « Jamais » est une réponse : notez-la. Trois minutes permettent trois ou quatre sondes : choisissez celles qui conviennent à la personne et changez l'ordre d'un appel à l'autre, pour que les dernières ne soient pas toujours celles que vous sautez. Notez les sondes non posées : « non posée » ne veut pas dire « jamais ».

- **Reprise.** La dernière fois que vous avez refait la même tâche, avez-vous tout repris de zéro ou réutilisé quelque chose ?
- **Interruption.** Un lot s'est-il déjà arrêté en cours de route ? La dernière fois, comment saviez-vous quelles lignes étaient passées ?
- **Doublons.** Une même ligne a-t-elle déjà été saisie ou envoyée deux fois ? La dernière fois, c'était quand ? Que s'est-il passé ?
- **Changement du site.** Quand un site que vous utilisez a-t-il changé pour la dernière fois au point de perturber votre travail ? Comment l'avez-vous remarqué ?
- **Session.** Une connexion ou une session a-t-elle déjà expiré en plein traitement ? Que s'est-il passé ?
- **Preuve.** Quelqu'un vous a-t-il déjà demandé de montrer ce qu'il était advenu d'une ligne précise ? Qu'avez-vous montré ?
- **Faux succès.** Un outil vous a-t-il déjà dit que c'était terminé alors que ce ne l'était pas ? Comment l'avez-vous su ?
- **Confiance.** Quelqu'un a-t-il déjà refusé qu'un outil utilise sa session connectée ? Pour quelle raison ?

**Point de contrôle (20:00)**

> Nous voici à 20 minutes, comme promis. Il me reste environ cinq minutes de questions. Êtes-vous d'accord pour continuer ?

Sinon, passez directement à la clôture.

**Décision et preuve (20:00-23:00)**

- Qui décide de la façon dont ce travail est fait ? Qui devrait donner son accord pour un nouvel outil ?
- Qui vous demande une preuve que le travail a été fait ? Que lui montrez-vous ?
- Que veut dire « terminé » pour une ligne ? Comment le vérifiez-vous ?

**Clôture (23:00-25:00)**

- Y a-t-il quelque chose que j'aurais dû vous demander ?
- Qui d'autre traite des lots de ce genre ? Un nom ou un message public suffit ; vous n'avez pas besoin de me présenter.
- Une suite concrète qui coûte quelque chose à la personne et ne passe pas par Ritoko :
  - « Pourriez-vous m'envoyer les en-têtes de colonnes d'un lot que vous traitez, avec des valeurs inventées ? »
  - « Pourrions-nous échanger 15 minutes de plus, avec le déroulé à l'écran et sans données réelles ? »
  - « Puis-je vous poser une question dans un mois, pour savoir ce qui a changé ? » (la plus faible)
- Remerciez, rappelez comment retirer son accord, ne promettez rien.

Ce que la personne répond va dans la rubrique *Commitments* de la note. C'est la seule preuve pour `would_try`.

**Si on vous demande ce que vous construisez**

> Je maintiens un outil open source, Ritoko. Un agent fait une tâche une fois dans un navigateur, la tâche est enregistrée, puis elle peut être rejouée sur les lignes d'un tableur, avec une trace de ce qu'il est advenu de chaque ligne. Je préfère garder cet échange sur votre expérience. Puis-je y revenir à la fin ?

Revenez ensuite à son récit. Pas de démonstration, pas de partage d'écran, pas de lien pendant l'appel. Si la personne insiste à la fin, donnez le lien GitHub et marquez tout ce qui suit *post-pitch* dans la note : cela sort des comptages.

**Après l'appel.** Dans les 24 heures : rédigez la note, ajoutez les lignes du journal, mettez à jour les comptages, supprimez l'audio selon vos choix. Ne changez pas les questions au milieu d'une série de cinq appels.

### 10.5 Notes et journal

- Citez les mots exacts en français dans `verbatim_quote`, suivis de `[EN: traduction]`.
- Correspondance des catégories : coût par ligne = `cost-per-row` ; lenteur = `slow` ; doublon = `duplicates` ; travail perdu après un arrêt = `lost-progress` ; site modifié = `site-changed` ; session expirée = `session-expired` ; arrêt en cours de lot = `agent-stopped` ; impossible de prouver = `no-proof` ; faux succès = `false-success` ; résultat différent à chaque fois = `non-deterministic` ; autre = `other`.
- Pour `tool_used`, les réponses fréquentes en back-office sont `by-hand`, `spreadsheet-macros` (tableur et macros), `software-import` (l'import du logiciel lui-même) et `outsourced` (un prestataire).
- Seuls comptent les incidents précis et passés, évoqués avant les sondes, et on compte des personnes, pas des lignes (section 8.2).
