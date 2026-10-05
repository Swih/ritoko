# Outreach messages

First-contact messages to ask people for 20 minutes about a problem they already had, in English and French, plus the rules for sending them. Written 2026-10-05. The interview itself is in [`interview-guide.md`](interview-guide.md).

Each message says who you are, admits that you have a stake, asks for one thing, offers nothing, and makes it easy to say no. Replace every `[bracket]` before sending. If you cannot fill the reason line with a fact you can point to, do not send the message.

## Rules

1. **One message per person.** At most one reminder, seven days later. A "no" ends it: thank them, delete your notes about them, and keep only a one-line "do not contact" entry (channel and date) so that you never write to them again. If they ask you to delete that line too, delete it.
2. **Use a channel the person chose to publish**, or reply publicly in the thread where they wrote (except in GitHub issue trackers, see rule 5). Do not look for another way in.
3. **Private communities** (Discord, Slack, Telegram, WhatsApp, Facebook or LinkedIn groups and similar): never send direct messages to members unless the community's written rules allow it for this purpose, a moderator agreed in writing, or the person invited you. Otherwise ask a moderator whether you may post one request in the right channel, and wait for a yes.
4. **Never scrape email addresses.** Not from GitHub profiles or commits, npm or PyPI metadata, LinkedIn exports, or with a script from websites. Use an address only when the person published it for contact, and write to one person at a time.
5. **Do not post requests in other maintainers' issue trackers.** Your own issue forms are the place for people who come to you.
6. **First paragraph:** who you are, with the link, and that you build in this area.
7. **One reason for writing to this person**, as a fact about their public work or post: "Your site lists n8n and Make automations for small businesses." Never "I love what you're doing", "I've been following your work", "quick question", a made-up mutual connection or a deadline.
8. **Ask for 20 minutes about one past problem.** Offer nothing: no payment, no gift, no early access, no promise.
9. **Opt-out in the message itself.**
10. **Keep a private contact sheet** (date, channel, message used, reply, outcome, date deleted) outside this repository. Delete a person's row when they ask.

For messages to people in France, check the CNIL's guidance on prospecting by email (cnil.fr). A research request is not a sales offer, but take the same care: identify yourself, say why you chose them, give an opt-out, and write once.

## Platform notes

Checked on 2026-10-05, in GitHub's Acceptable Use Policies (<https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies>, read from the source in the `github/docs` repository):

- Section 7: "You may not use information from the Service (whether scraped, collected through our API, or obtained otherwise) for spamming purposes, including for the purposes of sending unsolicited emails to users or selling personal information, such as to recruiters, headhunters, and job boards."
- Section 10: "You may not advertise in other Users' Accounts, such as by posting monetized or excessive bulk content in issues."

So: do not email people at addresses you found through GitHub, and do not post requests in other people's issues.

Not checked against the current rules, because Reddit and Hacker News could not be opened when this was written. Read their rules before you post, and treat the points below as etiquette, not as quotes:

- **Reddit.** Read the subreddit's rules (sidebar or "About") first; many forbid self-promotion or surveys, and if a rule is unclear, ask the moderators and wait for a yes. Prefer a public, useful comment to a direct message, and do not open with a direct message to someone who did not ask for contact. Say in the first sentence that you write the project you mention. No second accounts, and do not ask anyone to upvote or comment. One request per thread; do not paste the same text in many threads. If someone is asking for help, answer their question before anything else.
- **Hacker News.** Read the site guidelines and the Show HN rules first. Take part in discussions before you ask for anything, and answer the question that was asked before you mention your project. Do not ask for upvotes or comments, and do not use second accounts. Do not email people at the address in their profile unless the profile invites that kind of contact.
- **LinkedIn, X and similar.** Write by hand, one person at a time, with no automation tools, and follow the platform's rules.

## 1. An n8n or Make freelancer (persona C)

**English**

> Subject: 20 minutes about one automation that broke
>
> Hello [First name],
>
> I'm [Your name]. I write open-source software. One project, Ritoko (github.com/Swih/ritoko), saves a browser task so it can be replayed on spreadsheet rows, so I have a stake in this topic.
>
> I'm writing to you because [reason line, for example: your site lists n8n and Make automations for small businesses].
>
> Could we talk for 20 minutes about one batch automation that went wrong for a client in the past? I would ask what happened, what you did and what it cost. I won't pitch anything, and I have nothing to offer in return.
>
> If this isn't for you, ignore this message, or reply "no" and I won't write again. I'll send one reminder at most. If we talk, my notes won't contain your name or your clients' names, and I'll delete what I hold about you if you ask.
>
> [Your name]

**Français**

> Objet : 20 minutes sur une automatisation qui a mal tourné
>
> Bonjour [Prénom],
>
> Je m'appelle [Nom]. J'écris des logiciels open source. L'un d'eux, Ritoko (github.com/Swih/ritoko), enregistre une tâche faite dans un navigateur pour la rejouer sur les lignes d'un tableur : j'ai donc un intérêt dans ce sujet.
>
> Je vous écris parce que [raison, par exemple : votre site indique que vous créez des automatisations n8n et Make pour des petites entreprises].
>
> Accepteriez-vous de me consacrer 20 minutes pour parler d'une automatisation en lot qui a mal tourné chez un client ? Je demanderais ce qui s'est passé, ce que vous avez fait et ce que cela a coûté. Je ne présenterai rien et je n'ai rien à offrir en échange.
>
> Si cela ne vous convient pas, ignorez ce message ou répondez « non » : je ne vous écrirai plus. J'enverrai au plus un rappel. Si nous échangeons, mes notes ne contiendront ni votre nom ni ceux de vos clients, et je supprimerai ce que je conserve sur vous si vous me le demandez.
>
> Cordialement,
> [Nom]

## 2. A Claude Code user who posted about token cost (persona A)

Describe their post in one factual sentence, in your words, and link it. Add no praise.

### Public reply, in the thread where they wrote

**English**

> You wrote that [one factual sentence about their post]. I'm [Your name], the author of an open-source project in this area (github.com/Swih/ritoko), so I have a stake in it. I'm trying to understand how people handle repeated browser tasks with agents. If you're open to it, I'd like 20 minutes to hear about the last time it happened to you: what you ran, what it cost and what you did next. No pitch, and I can't offer anything in return. If you'd rather not, no problem, and I won't follow up.

**Français**

> Vous avez écrit que [une phrase factuelle sur son message]. Je m'appelle [Nom], je suis l'auteur d'un projet open source dans ce domaine (github.com/Swih/ritoko) : j'ai donc un intérêt dans le sujet. J'essaie de comprendre comment les gens traitent des tâches répétitives dans un navigateur avec des agents. Si vous êtes d'accord, j'aimerais 20 minutes pour entendre la dernière fois que cela vous est arrivé : ce que vous avez lancé, ce que cela a coûté et ce que vous avez fait ensuite. Pas de présentation, et je n'ai rien à offrir en échange. Si vous préférez ne pas répondre, aucun problème, et je ne relancerai pas.

### Direct message or email, only where the platform's rules and their profile allow it

**English**

> Subject: 20 minutes about a repeated browser task and its cost
>
> Hello [First name],
>
> I'm [Your name], an open-source author. My project, Ritoko (github.com/Swih/ritoko), saves a browser task so it can be replayed on spreadsheet rows, so I have a stake in this topic.
>
> I'm writing because of your post at [link], where you [one factual sentence].
>
> Could we talk for 20 minutes about the last time a repeated browser task cost you more than you wanted? I would ask what you ran, what it cost and what you did next. I won't pitch anything, and I have nothing to offer in return.
>
> If this isn't for you, ignore this message, or reply "no" and I won't write again. I'll send one reminder at most. If we talk, my notes won't contain your name, and I'll delete what I hold about you if you ask.
>
> [Your name]

**Français**

> Objet : 20 minutes sur une tâche répétitive dans un navigateur et son coût
>
> Bonjour [Prénom],
>
> Je m'appelle [Nom], j'écris des logiciels open source. Mon projet, Ritoko (github.com/Swih/ritoko), enregistre une tâche faite dans un navigateur pour la rejouer sur les lignes d'un tableur : j'ai donc un intérêt dans ce sujet.
>
> Je vous écris au sujet de votre message [lien], dans lequel vous [une phrase factuelle].
>
> Accepteriez-vous 20 minutes pour parler de la dernière fois qu'une tâche répétitive dans un navigateur vous a coûté plus que prévu ? Je demanderais ce que vous avez lancé, ce que cela a coûté et ce que vous avez fait ensuite. Je ne présenterai rien et je n'ai rien à offrir en échange.
>
> Si cela ne vous convient pas, ignorez ce message ou répondez « non » : je ne vous écrirai plus. J'enverrai au plus un rappel. Si nous échangeons, mes notes ne contiendront pas votre nom, et je supprimerai ce que je conserve sur vous si vous me le demandez.
>
> Cordialement,
> [Nom]

## 3. The owner or maintainer of an automation agency (persona C)

**English**

> Subject: 20 minutes about a client batch that went wrong
>
> Hello [First name],
>
> I'm [Your name]. I write open-source software. One project, Ritoko (github.com/Swih/ritoko), saves a browser task so it can be replayed on spreadsheet rows, so I have a stake in this topic.
>
> I'm writing to you because [reason line, for example: your agency's site lists browser-based automation among its services].
>
> Could we talk for 20 minutes about the last time a batch you run for a client went wrong? I would ask how you found out, what you showed the client and who paid for the fix. I won't pitch anything, and I have nothing to offer in return.
>
> If this isn't for you, ignore this message, or reply "no" and I won't write again. I'll send one reminder at most. If we talk, my notes won't contain your name, your agency's name or your clients' names, and I'll delete what I hold about you if you ask.
>
> [Your name]

**Français**

> Objet : 20 minutes sur un lot client qui a mal tourné
>
> Bonjour [Prénom],
>
> Je m'appelle [Nom]. J'écris des logiciels open source. L'un d'eux, Ritoko (github.com/Swih/ritoko), enregistre une tâche faite dans un navigateur pour la rejouer sur les lignes d'un tableur : j'ai donc un intérêt dans ce sujet.
>
> Je vous écris parce que [raison, par exemple : le site de votre agence indique l'automatisation par navigateur parmi ses services].
>
> Accepteriez-vous 20 minutes pour parler de la dernière fois qu'un lot que vous traitez pour un client a mal tourné ? Je demanderais comment vous l'avez découvert, ce que vous avez montré au client et qui a payé la correction. Je ne présenterai rien et je n'ai rien à offrir en échange.
>
> Si cela ne vous convient pas, ignorez ce message ou répondez « non » : je ne vous écrirai plus. J'enverrai au plus un rappel. Si nous échangeons, mes notes ne contiendront ni votre nom, ni celui de votre agence, ni ceux de vos clients, et je supprimerai ce que je conserve sur vous si vous me le demandez.
>
> Cordialement,
> [Nom]

## 4. An accountant (persona D)

**English**

> Subject: 20 minutes about repeated data entry in web portals
>
> Hello [First name],
>
> I'm [Your name]. I write open-source software. One project, Ritoko (github.com/Swih/ritoko), replays a saved browser task on spreadsheet rows, so I have a stake in how small accounting offices handle repeated entry in web portals.
>
> I'm writing to you because [reason line, for example: your firm's website lists bookkeeping for small businesses].
>
> Could we talk for 20 minutes about the last time a batch of entries went wrong? I would ask what happened, how you found out and what it cost. I won't ask for client data or passwords, I won't pitch anything, and I have nothing to offer in return.
>
> If this isn't for you, ignore this message, or reply "no" and I won't write again. I'll send one reminder at most. If we talk, my notes won't contain your name or your clients' names, and I'll delete what I hold about you if you ask.
>
> [Your name]

**Français**

> Objet : 20 minutes sur la saisie répétitive sur des portails web
>
> Bonjour [Prénom Nom],
>
> Je m'appelle [Nom]. J'écris des logiciels open source. L'un d'eux, Ritoko (github.com/Swih/ritoko), rejoue une tâche enregistrée dans un navigateur sur les lignes d'un tableur : j'ai donc un intérêt dans la façon dont les petits cabinets comptables traitent la saisie répétitive sur des portails web.
>
> Je vous écris parce que [raison, par exemple : le site de votre cabinet indique la tenue de comptabilité pour de petites entreprises].
>
> Accepteriez-vous 20 minutes pour me raconter la dernière fois qu'un lot de saisies s'est mal passé ? Je demanderais ce qui s'est passé, comment vous l'avez découvert et ce que cela a coûté. Je ne demanderai ni données clients ni mots de passe, je ne présenterai rien et je n'ai rien à offrir en échange.
>
> Si cela ne vous convient pas, ignorez ce message ou répondez « non » : je ne vous écrirai plus. J'enverrai au plus un rappel. Si nous échangeons, mes notes ne contiendront ni votre nom ni ceux de vos clients, et je supprimerai ce que je conserve sur vous si vous me le demandez.
>
> Cordialement,
> [Nom]

## Replies

**One reminder, seven days later, no earlier**

> Hello [First name], a short reminder of my message of [date]: 20 minutes about [the topic], no pitch, nothing offered. If it isn't for you, reply "no" or ignore this, and I won't write again.

> Bonjour [Prénom], un court rappel de mon message du [date] : 20 minutes sur [le sujet], sans présentation et sans contrepartie. Si cela ne vous convient pas, répondez « non » ou ignorez ce message, et je ne vous écrirai plus.

**They say yes**

> Thank you. Here are three slots: [slots] (20 minutes, by video or phone, your choice). You don't need to prepare anything, and please don't share real client data or passwords. Before we talk, here is what I keep and why: [the privacy note, section 4.4 of the interview guide]. I'll ask before recording, and you can say no.

> Merci. Voici trois créneaux : [créneaux] (20 minutes, en visio ou par téléphone, comme vous préférez). Vous n'avez rien à préparer, et merci de ne pas partager de données clients ni de mots de passe. Avant l'appel, voici ce que je conserve et pourquoi : [la note d'information, section 10.3 du guide]. Je demanderai avant d'enregistrer, et vous pouvez refuser.

**They ask what Ritoko is**

> It's an open-source tool: an agent does a browser task once, the task is saved, and it can be replayed on spreadsheet rows with a record of what happened to each row. The code is at github.com/Swih/ritoko. I'm not asking you to try it. The call is about your experience.

> C'est un outil open source : un agent fait une tâche une fois dans un navigateur, la tâche est enregistrée, puis elle peut être rejouée sur les lignes d'un tableur, avec une trace de ce qu'il est advenu de chaque ligne. Le code est sur github.com/Swih/ritoko. Je ne vous demande pas de l'essayer : l'appel porte sur votre expérience.

**They say no, or do not want to be contacted**

> Understood, thank you for answering. I won't write again.

> Bien compris, merci de votre réponse. Je ne vous écrirai plus.

Then delete your notes about them and keep only the one-line "do not contact" entry (rule 1).
