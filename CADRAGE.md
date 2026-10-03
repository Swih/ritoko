# Ritoko — cadrage (3 oct. 2026)

## Promesse
Transformer une tâche web réussie par un agent en **procédure réutilisable** : nouveaux inputs, résultat vérifié, reprise et rapport par item. Toute soumission incertaine reste bloquée jusqu'à vérification, y compris dans les runs suivants. Si un sélecteur casse, le LLM répare la cible du run figé.

## Cible
Utilisateurs réguliers de Claude Code (terminal) et Codex CLI ayant une tâche web récurrente : builders, indés, petites équipes.

## Principes
- Chrome avec profil dédié, sessions conservées et connexion CDP locale partagée. Un verrou sérialise les opérations CLI/MCP et récupère les processus morts.
- Le LLM explore, choisit les sélecteurs et répare. Le moteur rejoue sans LLM.
- Sélecteurs robustes : rôle/nom accessible > label > texte visible ancré > testid > CSS/XPath relatif. Jamais d'id généré, de XPath absolu ou de position. Chaque élément a un sélecteur principal + des secours, vérifiés uniques à l'enregistrement.
- Vérification explicite (`expect`) ; étape `commit` = point de non-retour. Interruption après un commit → item « à vérifier », jamais relancé à l'aveugle.
- Chaque run conserve son workflow et ses lignes d'entrée. Avant commit, reprise depuis le début du formulaire ; après commit, vérification seule sur le même document, sinon review. La première ligne soumise pendant l'enregistrement est adoptée avant replay.
- Le moins de complexité possible : on réutilise l'existant (Playwright, MCP SDK, node:sqlite).

## Stack
Node 24 LTS · TypeScript 7 · Playwright 1.63 (playwright-core + Chrome installé) · MCP TypeScript SDK · Zod 4 · node:sqlite · read-excel-file · pnpm · Biome · Vitest · tsdown.

## Distribution
1. Claude Code : marketplace GitHub perso (`Swih/ritoko`), sans revue.
2. Codex CLI : même repo, même moteur, manifeste `.codex-plugin`.
3. Plus tard (après 5 utilisateurs qui reviennent) : directories officiels, façade HTTPS.

## Tests de référence
1. **RPA Challenge** (rpachallenge.com) : télécharger l'Excel, Start, remplir 10 formulaires aux champs mélangés et aux id aléatoires. Objectif : 100 % à l'enregistrement par le LLM, puis 100 % en replay sans LLM, chronométré.
2. Export de rapport avec période variable (onboarding).
3. Formulaire depuis CSV avec crash au milieu → reprise sans doublon (démo star).

## Hors périmètre
Apps desktop, contournement d'anti-bots/CAPTCHA, sites dont les CGU interdisent l'automatisation. Positionné comme actif de distribution, pas comme revenu.

## Métrique
5 utilisateurs extérieurs qui réutilisent leur workflow une semaine après l'avoir créé.
