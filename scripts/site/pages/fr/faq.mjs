// FAQ française publiée sous /fr/faq ; les champs correspondent au contrat de ../types.mjs.
/** @type {import('../types.mjs').FaqGroup[]} */
export const faqGroupsFr = [
  {
    id: 'fit-and-setup',
    heading: 'Compatibilité et installation',
    items: [
      {
        q: 'Qu’est-ce que Ritoko ?',
        a: 'Ritoko enregistre une tâche résolue par un agent sous forme de workflow JSON réutilisable, puis l’exécute avec de nouveaux paramètres ou des lignes CSV/XLSX. Les étapes prises en charge incluent les actions navigateur, les requêtes HTTP et les outils MCP. Son journal local conserve le résultat de chaque ligne. Consultez le <a href="https://github.com/Swih/ritoko#quick-start">guide de démarrage</a>.',
      },
      {
        q: 'Quand utiliser un workflow enregistré plutôt qu’un agent ?',
        a: 'Utilisez un workflow si la tâche est récurrente, ses entrées structurées et son résultat vérifiable. Faites appel à un agent si chaque exécution demande exploration ou jugement. L’agent peut découvrir une procédure que Ritoko reprend ensuite.',
      },
      {
        q: 'Que faut-il pour exécuter Ritoko ?',
        a: 'L’environnement local nécessite Node.js 24 ou une version ultérieure. Les workflows navigateur directs ont aussi besoin de Google Chrome ; les workflows HTTP/MCP autonomes peuvent s’exécuter sans navigateur. Ritoko est disponible en CLI, serveur MCP local via stdio et plugin Claude Code ou Codex.',
      },
      {
        q: 'Tous les clients MCP peuvent-ils se connecter à Ritoko ?',
        a: 'Un client local capable de lancer un processus stdio peut se connecter, dans les limites de ses propres fonctions. Claude Code et Codex CLI sont les clients testés avec le plugin. Un client cloud isolé ne peut pas accéder au processus ou aux fichiers locaux sans mécanisme de connexion distinct.',
      },
      {
        q: 'Ritoko peut-il utiliser mon navigateur déjà connecté ?',
        a: 'L’exécuteur direct peut se connecter à Chrome personnel avec votre autorisation de débogage distant, ou utiliser un profil isolé explicitement choisi. Connectez-vous et faites l’authentification multifacteur dans ce navigateur. La reprise navigateur en mode hôte demande l’autorisation d’exécuter des scripts dans la page ; l’évaluation actuelle de Codex en mode computer-use est en lecture seule et ne peut pas l’exécuter. Voir les <a href="/fr/guides/browser-api-mcp-workflows">choix du pilote</a>.',
      },
    ],
  },
  {
    id: 'model-usage',
    heading: 'Modèles et services',
    items: [
      {
        q: 'Ritoko reprend-il une tâche sans appeler de LLM ?',
        a: 'Son moteur de reprise directe n’effectue aucun appel LLM. L’enregistrement, la réparation et l’orchestration hôte peuvent utiliser le modèle de l’agent client. Un outil MCP, fournisseur OCR ou service de génération externe peut aussi utiliser des modèles et facturer ses appels. Voir les <a href="/fr/guides/recurring-tasks-model-costs">coûts des tâches récurrentes</a>.',
      },
      {
        q: 'Faut-il une clé API LLM distincte ?',
        a: 'L’exécuteur direct n’en a pas besoin. Lors de l’enregistrement, de la réparation ou de l’orchestration hôte, l’agent client apporte le raisonnement via son abonnement ou sa configuration API. Les services externes nécessitent leurs propres accès configurés.',
      },
      {
        q: 'Ritoko fournit-il l’OCR ou un analyseur de factures ?',
        a: 'Non. L’outil facultatif <code>document_image</code> renvoie un JPEG/PNG téléchargé que le modèle de votre client peut lire. Un service OCR externe est une autre possibilité. Chaque nouveau document doit encore être interprété et vérifié avant que ses valeurs extraites soient soumises.',
      },
      {
        q: 'Puis-je planifier des exécutions récurrentes dans Ritoko ?',
        a: 'Ritoko n’intègre actuellement aucun planificateur. Un planificateur distinct peut lancer un workflow CLI existant. Prévoyez la connexion, les accès, les délais d’exécution et le suivi des éléments en revue avant un lancement sans surveillance ; consultez le rapport de chaque exécution.',
      },
    ],
  },
  {
    id: 'inputs-and-results',
    heading: 'Entrées et résultats',
    items: [
      {
        q: 'Quels formats de tableur Ritoko accepte-t-il ?',
        a: 'Il lit les fichiers <code>.xlsx</code> avec sélection d’une feuille, ainsi que les CSV séparés par des virgules ou points-virgules en UTF-8 ou Windows-1252. Les valeurs obligatoires et les clés métier vides ou dupliquées sont contrôlées avant le traitement. Voir la <a href="/fr/guides/resumable-csv-excel-batches">préparation des entrées</a>.',
      },
      {
        q: 'Les lignes Excel masquées et les identifiants formatés sont-ils importés ?',
        a: 'Les lignes XLSX masquées ou filtrées sont également lues. Le format numérique Excel n’est pas appliqué : conservez au format Texte les identifiants ayant des zéros initiaux. Les formules utilisent leurs résultats enregistrés ; les erreurs ou résultats manquants des formules référencées sont traités comme des valeurs vides.',
      },
      {
        q: 'Modifier le fichier d’entrée change-t-il un lot repris ?',
        a: 'Non. Le lot utilise le workflow et les lignes figés dans son journal. Après avoir examiné les résultats précédents, lancez volontairement un nouveau lot pour des données corrigées ou nouvelles.',
      },
      {
        q: 'Que contient le rapport d’exécution ?',
        a: 'Le rapport JSON présente le statut du lot, les décomptes et résultats par ligne, les causes, messages et preuves ou fichiers disponibles. Il ne génère actuellement aucun rapport d’audit HTML ou CSV. Un résultat partiel demande encore une intervention ; le lot n’est pas terminé.',
      },
    ],
  },
  {
    id: 'writes-and-recovery',
    heading: 'Écritures et reprise',
    items: [
      {
        q: 'Ritoko garantit-il l’absence de doublons dans les écritures ?',
        a: 'Non. En règle générale, il ignore les éléments confirmés et met en attente les écritures incertaines dans le journal de cette installation. Des clés métier, périmètres de destination, frontières commit et vérifications propres à chaque ligne corrects sont essentiels. Les soumissions indépendantes restent hors de ce journal. Voir la <a href="/fr/guides/avoid-duplicate-csv-imports">prévention des doublons à l’import</a>.',
      },
      {
        q: 'Que signifie « en revue » après un plantage ou un délai dépassé ?',
        a: 'L’écriture a peut-être réussi sans confirmation exploitable. Vérifiez cet enregistrement précis dans la destination avant de le résoudre. Si le résultat n’est pas concluant, laissez-le en revue, y compris lors d’exécutions ultérieures. Voir la <a href="/fr/guides/uncertain-writes-after-interruption">reprise d’une écriture incertaine</a>.',
      },
      {
        q: 'Comment résoudre un élément en revue ?',
        a: 'Après vérification de la destination par une personne, résolvez-le en <code>done</code> si l’effet existe, ou en <code>failed</code> s’il n’a pas eu lieu. Une résolution en échec permet une soumission ultérieure. Dans les deux cas, ajoutez une note de preuve et confirmez explicitement la vérification ; les résolutions manuelles sont enregistrées comme décisions non vérifiées. Un agent doit obtenir la confirmation de l’utilisateur que la destination a été vérifiée.',
      },
      {
        q: 'Comment reprendre un lot interrompu ?',
        a: 'Utilisez <code>run_resume</code> ou la commande CLI <code>ritoko resume</code> pour un lot direct, et <code>host_next</code> pour un lot hôte. Les lignes confirmées le restent ; les échecs admissibles peuvent être réessayés ; les écritures incertaines restent bloquées. Résolvez le lot initial contenant l’incertitude avant un lot ultérieur bloqué par le doublon.',
      },
      {
        q: 'Que faire si la démonstration a déjà créé le premier enregistrement ?',
        a: 'Après avoir enregistré le workflow, utilisez <code>run_adopt</code> avec la ligne complète et exacte et une note de preuve. L’outil exécute les vérifications et journalise l’enregistrement déjà soumis pour que les reprises puissent l’ignorer. Ne soumettez pas à nouveau cette ligne tant que son résultat n’est pas réglé.',
      },
      {
        q: 'Ritoko peut-il vérifier la destination avant une écriture ou résoudre automatiquement un élément en revue ?',
        a: 'Le candidat Git 0.2.0 ajoute une recherche facultative <code>ensure</code> avant l’écriture et une recherche <code>run_reconcile</code> pour résoudre un résultat incertain ; npm 0.1.1 ne les inclut pas. Elles exigent un GET HTTP direct ou un outil MCP de lecture de confiance déclarant <code>readOnlyHint: true</code>, un périmètre explicite et des prédicats prouvant la présence ou l’absence. Une réconciliation non concluante ne modifie pas l’élément ; elle ne le soumet jamais à nouveau. Les vérifications navigateur, les exécutions hôte et les outils gérés par l’agent ne sont pas pris en charge ; la recherche doit figurer dans le lot figé. Voir la <a href="https://github.com/Swih/ritoko/blob/main/docs/usage.md#destination-lookup-ensure-and-reconcile">configuration et les limites</a>.',
      },
      {
        q: 'Que se passe-t-il si un sélecteur enregistré change ?',
        a: 'Une exécution directe prise en charge peut se mettre en pause pour <code>step_repair</code>. Vérifiez qu’une nouvelle cible identifie le contrôle voulu ; le remplacement de la cible commit exige une confirmation explicite. Les échecs après soumission peuvent plutôt passer en revue. Le mode hôte ne propose actuellement aucune réparation de sélecteur. Voir <a href="/fr/guides/robust-browser-selectors">l’enregistrement et la réparation des sélecteurs</a>.',
      },
      {
        q: 'Puis-je répéter volontairement des lignes terminées ?',
        a: 'Oui, <code>repeat: true</code> ou l’option CLI <code>--repeat</code> relance les lignes terminées. Les éléments en revue restent bloqués. Utilisez cette option seulement si la répétition de l’effet métier est voulue.',
      },
    ],
  },
  {
    id: 'integrations-and-data',
    heading: 'Intégrations et données locales',
    items: [
      {
        q: 'Un enregistrement navigateur peut-il devenir automatiquement un workflow API ?',
        a: 'Non. La capture réseau facultative fournit des métadonnées fetch/XHR à des fins d’étude. Vérifiez le contrat API autorisé et l’authentification, testez une ligne et enregistrez explicitement les étapes HTTP prises en charge. Une écriture API incertaine ne doit pas entraîner automatiquement une autre soumission dans le navigateur.',
      },
      {
        q: 'Un workflow peut-il appeler un outil MCP existant ?',
        a: 'Oui, les serveurs configurés pris en charge peuvent fournir des étapes <code>mcp</code>, et les références hôte <code>{ref: "agent"}</code> réutilisent une connexion d’agent existante. Vérifiez les schémas, effets de bord, compatibilité du protocole et frais de service. Les appels d’outils ne sont pas réessayés automatiquement. Voir les <a href="/fr/guides/browser-api-mcp-workflows">choix d’intégration</a>.',
      },
      {
        q: 'Où sont enregistrés les workflows, le journal et les fichiers de sortie ?',
        a: 'Par défaut, ils se trouvent sous <code>~/.ritoko</code> ; <code>RITOKO_HOME</code> permet de modifier cet emplacement. Le journal contient les lignes métier et les valeurs enregistrées ordinaires. Les fichiers sauvegardés conservent leurs octets d’origine et peuvent contenir des données sensibles. Traitez les fichiers de l’installation comme des documents métier.',
      },
      {
        q: 'Comment stocker les identifiants d’accès ?',
        a: 'Déclarez des paramètres secrets alimentés par des variables d’environnement. Ne placez pas les identifiants dans le JSON du workflow ou les tableurs. Les identifiants d’exécution sont exclus du journal, mais les fichiers de réponses sauvegardés conservent leurs octets et demandent des précautions distinctes. Consultez la <a href="https://github.com/Swih/ritoko/blob/main/skills/ritoko/reference.md#api-and-mcp-steps">référence des intégrations</a>.',
      },
    ],
  },
]

/** @type {import('../types.mjs').FaqPage | null} */
export const faqPageFr = {
  metaTitle: 'FAQ Ritoko : reprise, lots CSV, modèles et récupération',
  description:
    'Réponses sur Ritoko, les modèles, les workflows navigateur/API, les imports CSV/XLSX, les écritures incertaines et leur reprise.',
  h1: 'FAQ Ritoko',
  shortAnswer:
    'Ritoko enregistre des procédures navigateur, HTTP et MCP vérifiables et les rejoue avec un journal local. Ces réponses présentent l’installation, l’usage des modèles, les entrées tableur et les contrôles nécessaires pour reprendre des écritures incertaines.',
  datePublished: '2026-10-05',
  dateModified: '2026-10-05',
}
