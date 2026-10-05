// Guides français, publiés sous /fr/guides/<slug>. Les clés twin reprennent les slugs anglais pour les hreflang.
/** @type {import('../types.mjs').Page[]} */
export const problemPagesFr = [
  {
    slug: 'uncertain-writes-after-interruption',
    twin: 'uncertain-writes-after-interruption',
    lang: 'fr',
    metaTitle: 'Reprendre une écriture incertaine après un arrêt — Ritoko',
    description:
      'Une soumission peut aboutir même si sa confirmation est perdue. Vérifiez le résultat, mettez les lignes incertaines en attente et reprenez le lot avec prudence.',
    h1: 'Ma soumission dans le navigateur a-t-elle abouti avant l’arrêt ?',
    shortAnswer:
      'Un délai dépassé ou un plantage ne prouve pas que la soumission a échoué. Vérifiez la destination pour cet enregistrement précis avant de réessayer. Ritoko met en revue les écritures interrompues après leur étape commit et reprend les autres lignes admissibles depuis son journal.',
    datePublished: '2026-10-05',
    dateModified: '2026-10-05',
    tags: ['Reprise', 'Écritures navigateur'],
    sections: [
      {
        id: 'two-outcomes',
        heading: 'Pourquoi un lot en échec peut-il quand même créer un enregistrement ?',
        html: '<p>La ligne <code>INV-1042</code> remplit un formulaire de facture et clique sur Envoyer. Le serveur accepte la facture, puis la connexion se ferme avant que le navigateur affiche le reçu. Le processus local voit une interruption, mais la facture peut déjà exister dans le système métier. Répéter le clic risque de créer un doublon.</p><p>Il faut donc vérifier si l’effet attendu existe, et pas seulement si l’automatisation s’est terminée correctement. La même incertitude concerne une écriture HTTP ou un outil MCP qui expire : l’action distante peut se terminer après que le client a cessé d’attendre.</p>',
      },
      {
        id: 'check-destination',
        heading: 'Que vérifier avant de réessayer ?',
        html: '<ol><li>Lisez le rapport du lot et relevez la ligne en revue, sa clé métier et le compte de destination.</li><li>Recherchez cette clé dans la destination. Comparez les champs qui définissent l’opération : pour une facture, sa référence, son client, son montant et sa période.</li><li>Si l’effet existe, notez son reçu ou son identifiant, puis résolvez la ligne en <code>done</code>.</li><li>Si vous avez établi que l’effet n’a pas eu lieu, résolvez-la en <code>failed</code>. Une reprise ultérieure pourra la soumettre.</li><li>Si les preuves ne suffisent pas, laissez la ligne en revue. Une recherche vide pendant un traitement différé ne prouve pas toujours l’absence de l’enregistrement.</li></ol><p>La résolution manuelle exige une note de preuve et la confirmation explicite qu’une personne a vérifié la destination. Elle est enregistrée comme une décision manuelle non vérifiée. Un agent doit demander à l’utilisateur de confirmer cette vérification avant de définir <code>confirmChecked</code>. Voir le <a href="https://github.com/Swih/ritoko/blob/main/docs/usage.md#resolving-a-review-item">guide de reprise</a> pour les commandes exactes.</p>',
      },
      {
        id: 'resume-other-rows',
        heading: 'Comment Ritoko reprend-il les autres lignes ?',
        html: '<p>Reprenez le lot existant : utilisez <code>run_resume</code> pour une exécution directe ou <code>host_next</code> pour une exécution pilotée par l’hôte. Les lignes confirmées le restent. Les échecs antérieurs à la soumission peuvent être réessayés ; les écritures incertaines restent bloquées. Le lot réutilise le workflow et l’instantané d’entrée enregistrés : modifier le tableur ne réécrit pas le lot interrompu.</p><p>Un lot ultérieur utilisant le même workflow, périmètre et clé respecte aussi la mise en revue. Si un autre lot est bloqué par l’élément incertain d’origine, résolvez d’abord le lot initial. Ne contournez pas l’incertitude en changeant le nom du workflow, le périmètre ou le journal.</p>',
      },
      {
        id: 'design-recovery',
        heading: 'Comment faciliter la résolution d’une prochaine interruption ?',
        html: '<p>Marquez l’unique opération irréversible avec <code>commit: true</code>, puis vérifiez un résultat propre à la ligne avec <code>expect</code>. Un bandeau « Succès » générique constitue une preuve faible ; une référence correspondante ou un reçu est plus utile. Considérez aussi un champ à sauvegarde automatique ou un téléversement qui crée un enregistrement comme une écriture.</p><p>Ritoko suit les actions de cette installation. Il ne voit pas les soumissions indépendantes, ne rend pas un site distant idempotent et ne déduit pas le résultat en l’absence de preuve. Séparez les tâches comportant plusieurs effets irréversibles en procédures dont chaque résultat peut être vérifié.</p>',
      },
    ],
    faq: [
      {
        q: 'Puis-je réessayer une soumission simplement parce que la requête a expiré ?',
        a: 'Non. Le délai peut expirer après l’acceptation. Vérifiez la destination et laissez la ligne en revue tant que le résultat reste incertain.',
      },
      {
        q: 'La résolution en échec soumet-elle immédiatement la ligne ?',
        a: 'Elle consigne que l’effet n’a pas eu lieu. Une reprise ultérieure ou un nouveau lot admissible pourra la soumettre ; c’est pourquoi la vérification de la destination est nécessaire.',
      },
    ],
    related: ['avoid-duplicate-csv-imports', 'resumable-csv-excel-batches'],
  },
  {
    slug: 'avoid-duplicate-csv-imports',
    twin: 'avoid-duplicate-csv-imports',
    lang: 'fr',
    metaTitle: 'Éviter les doublons lors d’imports CSV répétés — Ritoko',
    description:
      'Clé métier, périmètre et contrôles par ligne pour les imports CSV répétés, y compris la ligne créée pendant la démonstration.',
    h1: 'Comment éviter les doublons en important à nouveau le même CSV ?',
    shortAnswer:
      'Identifiez chaque opération par une clé métier et un périmètre de destination stables, adoptez toute ligne déjà soumise pendant l’enregistrement et vérifiez chaque résultat. Ritoko ignore normalement les clés confirmées et met en revue les écritures incertaines, mais son journal local ne garantit pas l’absence de doublons.',
    datePublished: '2026-10-05',
    dateModified: '2026-10-05',
    tags: ['Imports CSV', 'Clés métier'],
    sections: [
      {
        id: 'choose-key',
        heading: 'À quoi ressemble une bonne clé métier ?',
        html: '<p>Une clé représente l’opération métier plutôt que la position d’une ligne dans un fichier. Pour créer un client, une adresse e-mail peut convenir si la destination la considère unique. Pour une facture, préférez une référence de facture externe. Pour un rapport mensuel, incluez le compte et la période afin que les opérations d’octobre et de novembre soient distinctes.</p><p>Les numéros de ligne, horodatages générés à chaque exécution et noms de fichiers changent lorsque vous réorganisez ou réexportez les données. Ils ne permettent pas d’identifier fiablement la même opération. Choisissez et normalisez les identifiants avant le lot, en conservant les zéros initiaux lorsqu’ils ont un sens.</p>',
      },
      {
        id: 'choose-scope',
        heading: 'Comment distinguer les comptes et les destinations ?',
        html: `<p>La déduplication repose sur le nom du workflow, <code>items.scope</code> et la clé métier. Définissez le périmètre à partir de la destination, du compte et de l’opération. L’URL du back-office seule ne suffit pas si plusieurs comptes utilisent cette URL. Le nom du fichier d’entrée ne doit pas servir de périmètre.</p><pre><code>"items": {
  "from": "{{param.input}}",
  "key": "{{item.InvoiceReference}}",
  "scope": "{{param.base}}|{{param.account}}|create-invoice"
}</code></pre><p>Cet extrait illustre un workflow de facturation ; ses paramètres et ses contrôles de destination doivent aussi être définis. Un périmètre vide partage les clés entre plusieurs contextes et peut faire ignorer des lignes légitimes dans un autre compte. Corrigez l’avertissement de périmètre vide avant un vrai lot.</p>`,
      },
      {
        id: 'adopt-demo',
        heading: 'Que faire de la ligne créée pendant l’enregistrement de la tâche ?',
        html: '<p>Cette ligne existe déjà avant le début de la reprise. Après avoir enregistré le workflow, utilisez <code>run_adopt</code> avec la ligne d’entrée complète et exacte et une note de preuve. L’adoption exécute les vérifications et inscrit la ligne soumise dans le journal pour que le prochain lot puisse l’ignorer. Ne soumettez pas à nouveau la ligne de démonstration tant que l’adoption ou son résultat n’est pas réglé.</p><p>Testez la procédure sur un petit lot autorisé. Vérifiez la clé métier, le périmètre, l’étape irréversible <code>commit</code> et le contrôle <code>expect</code> propre à la ligne avant de traiter le reste.</p>',
      },
      {
        id: 'rerun-behavior',
        heading: 'Que se passe-t-il si je relance le lot ou modifie le fichier ?',
        html: '<ul><li>Une clé confirmée avec les mêmes données de ligne est normalement ignorée.</li><li>Des données différentes pour une clé terminée sont bloquées ; la procédure de création ne devient pas silencieusement une mise à jour.</li><li>Les clés répétées dans un même fichier d’entrée sont rejetées avant traitement.</li><li>Une clé incertaine reste bloquée, y compris lors d’une répétition explicite.</li></ul><p><code>repeat: true</code> ou l’option CLI <code>--repeat</code> relance volontairement les éléments terminés. Utilisez-la uniquement si répéter l’effet est voulu. Changer le nom du workflow ou supprimer le journal peut aussi effacer le contexte qui empêchait une répétition.</p><p>Pour une API HTTP distante qui documente la prise en charge des clés d’idempotence, Ritoko peut envoyer un en-tête <code>Idempotency-Key</code> stable. Cet en-tête n’aide que si le service destinataire respecte son contrat. Les imports indépendants, la saisie manuelle et une autre installation ne sont pas suivis par ce journal. Consultez le <a href="https://github.com/Swih/ritoko/blob/main/docs/usage.md#safe-workflow-contract">contrat du workflow</a>.</p>',
      },
    ],
    faq: [
      {
        q: 'Une clé fondée sur l’adresse e-mail garantit-elle l’absence de doublons ?',
        a: 'Non. La clé doit correspondre à l’identité métier de la destination, et le périmètre et les contrôles doivent être corrects. Le journal de Ritoko ne suit pas non plus les soumissions indépendantes.',
      },
      {
        q: 'Puis-je utiliser le nom du CSV comme périmètre ?',
        a: 'Non. Utilisez la destination, le compte et les paramètres de l’opération. Un nouveau nom de fichier ne doit pas faire passer une opération existante pour une nouvelle.',
      },
    ],
    related: ['uncertain-writes-after-interruption', 'resumable-csv-excel-batches'],
  },
  {
    slug: 'recurring-tasks-model-costs',
    twin: 'recurring-tasks-model-costs',
    lang: 'fr',
    metaTitle: 'Réduire l’usage des modèles pour les tâches répétitives — Ritoko',
    description:
      'Distinguez découverte, réparation et exécution répétée. Voyez quand la reprise directe évite un appel de modèle et ce qui reste payant.',
    h1: 'Faut-il un modèle d’IA pour résoudre la même tâche de navigateur à chaque fois ?',
    shortAnswer:
      'Une tâche stable, avec des actions et des contrôles explicites, peut être exécutée comme une procédure enregistrée. Le moteur de reprise directe de Ritoko n’appelle pas de LLM. L’enregistrement, la réparation, l’orchestration par l’hôte et les services externes utilisant des modèles peuvent encore consommer des ressources ou entraîner des frais.',
    datePublished: '2026-10-05',
    dateModified: '2026-10-05',
    tags: ['Tâches répétitives', 'Usage des modèles'],
    sections: [
      {
        id: 'separate-work',
        heading: 'Quelles décisions demandent du raisonnement et lesquelles peuvent être enregistrées ?',
        html: '<p>Pour un import hebdomadaire de fournisseurs, un agent découvre d’abord le formulaire, associe chaque colonne au bon champ et cherche une preuve de création. Une fois ces choix validés, le fichier suivant peut demander les mêmes actions avec de nouvelles valeurs.</p><p>Enregistrez les paramètres, sélecteurs, clé métier, frontière de commit et vérifications. La reprise directe exécute alors cette procédure sans redemander au modèle de retrouver chaque étape. Une tâche qui demande d’interpréter de nouveaux documents, de choisir entre des règles métier changeantes ou de parcourir des sites inconnus peut encore nécessiter un raisonnement pour chaque élément.</p>',
      },
      {
        id: 'cost-boundaries',
        heading: 'Quelles étapes d’une exécution Ritoko peuvent encore coûter ?',
        html: '<ul><li><strong>Création et enregistrement :</strong> l’agent du client utilise son abonnement ou sa configuration API pour résoudre et enregistrer la tâche.</li><li><strong>Reprise directe :</strong> le moteur exécute les étapes enregistrées du navigateur, HTTP et MCP sans appel LLM de sa part. L’agent qui lance ou commente l’exécution peut toujours utiliser un modèle.</li><li><strong>Services externes :</strong> un outil MCP, une API OCR ou un service de génération peut utiliser un modèle et facturer chaque appel.</li><li><strong>Réparation et mode hôte :</strong> l’agent intervient à nouveau. L’orchestration hôte ne promet pas un usage nul des modèles.</li><li><strong>Exploitation et maintenance :</strong> l’exécution du navigateur, l’accès au service, les limites de destination et le temps de vérification restent à prendre en compte.</li></ul><p>Ritoko n’intègre ni moteur OCR local ni analyseur de factures. L’outil facultatif <code>document_image</code> renvoie une image téléchargée que le modèle du client peut lire ; chaque nouvelle image doit encore être interprétée. Voir la <a href="https://github.com/Swih/ritoko/blob/main/README.md#faq">FAQ sur l’exécution et la lecture de documents</a>.</p>',
      },
      {
        id: 'measure-own-task',
        heading: 'Comment mesurer les économies pour ma tâche ?',
        html: '<p>Mesurez séparément le temps de création et l’usage du modèle, puis les exécutions répétées. Pour un petit lot représentatif, notez la durée, les éléments confirmés, ceux en revue, les frais des services externes et l’effort de réparation. Comparez les résultats métier complets, y compris le suivi manuel.</p><p>Un budget utile additionne le coût initial de création, le coût des exécutions répétées, puis la maintenance et la vérification attendues. L’architecture seule ne permet pas d’annoncer un pourcentage d’économie. Une page qui change ou une extraction assistée par modèle peut dominer le budget, même si le moteur de reprise ne fait aucun appel de modèle.</p>',
      },
      {
        id: 'choose-replay',
        heading: 'Quand vaut-il la peine d’enregistrer une procédure ?',
        html: '<p>La reprise convient aux tâches récurrentes qui acceptent des entrées structurées et exposent un résultat vérifiable. Gardez un agent dans la boucle si la tâche est exploratoire ou si l’étape suivante exige un jugement. Commencez par une opération vérifiée et un petit lot, puis réutilisez la procédure lorsque les règles métier sont claires.</p><p>Ritoko n’est pas le seul moyen d’éviter l’inférence pendant l’exécution : du code Playwright généré et les voies de reprise ou de cache documentées d’autres outils le permettent également. Le choix dépend du mode de vérification, de reprise et de journalisation souhaité.</p>',
      },
    ],
    faq: [
      {
        q: 'La reprise directe peut-elle garantir zéro appel de modèle sur l’ensemble de mon processus ?',
        a: 'Non. Elle n’appelle pas de LLM pour exécuter les étapes enregistrées, mais l’agent, les réparations et les services externes peuvent encore utiliser des modèles.',
      },
      {
        q: 'Dois-je compter l’OCR dans le coût de reprise ?',
        a: 'Oui, si chaque nouveau document est interprété par un modèle ou un service OCR externe. Ritoko ne fournit pas de moteur OCR local.',
      },
    ],
    related: ['resumable-csv-excel-batches', 'browser-api-mcp-workflows'],
  },
  {
    slug: 'robust-browser-selectors',
    twin: 'robust-browser-selectors',
    lang: 'fr',
    metaTitle: 'Enregistrer des sélecteurs stables et les réparer — Ritoko',
    description:
      'Choisissez des cibles uniques, vérifiez le résultat et réparez les sélecteurs sans relancer une écriture à l’aveugle.',
    h1: 'Comment garder un workflow navigateur utile quand la page change ?',
    shortAnswer:
      'Choisissez des cibles identifiant le contrôle visé par son sens et son unicité, puis vérifiez le résultat métier. Ritoko propose des sélecteurs de repli et met en pause certaines reprises directes pour permettre une réparation réfléchie. Le remplacement d’une cible d’envoi exige une confirmation explicite.',
    datePublished: '2026-10-05',
    dateModified: '2026-10-05',
    tags: ['Enregistrement', 'Réparation des sélecteurs'],
    sections: [
      {
        id: 'meaningful-target',
        heading: 'Que doit identifier un sélecteur ?',
        html: `<p>Privilégiez le libellé unique d’un champ, un rôle et son nom accessible, ou un identifiant de test stable. « Créer un client » décrit le bouton attendu plus clairement que le troisième bouton du deuxième panneau. Un texte seul peut aussi être ambigu si plusieurs panneaux répètent les mêmes mots.</p><p>L’enregistreur de Ritoko vérifie qu’une cible correspond uniquement à l’élément sélectionné et signale les cibles fragiles fondées sur la position. Vérifiez-les avant d’enregistrer. Un sélecteur de repli doit retrouver le même contrôle avec une autre propriété stable, et non n’importe quel bouton encore présent.</p><pre><code>"target": {
  "primary": { "by": "role", "role": "button", "name": "Create customer" },
  "fallbacks": [{ "by": "testid", "id": "create-customer" }]
}</code></pre><p>Cet exemple convient uniquement si les deux sélecteurs identifient de façon unique le vrai bouton de soumission de votre application. Ne reprenez pas cet identifiant de test pour un autre site.</p>`,
      },
      {
        id: 'check-result',
        heading: 'Pourquoi un sélecteur correspondant ne suffit-il pas ?',
        html: '<p>Un bouton peut conserver le même nom tout en changeant de comportement. Vérifiez l’enregistrement obtenu, pas seulement la réussite du clic. Utilisez <code>expect</code> avec l’e-mail, la référence ou une autre preuve métier de la ligne courante. Ciblez une iframe dans le bon cadre et laissez le temps à la confirmation d’apparaître.</p><p>Définissez un point de départ reproductible pour chaque élément, comme la navigation vers un formulaire de création. Considérez les contrôles à sauvegarde automatique ou à soumission automatique comme des écritures possibles. Le succès du remplissage d’un champ ne prouve pas qu’aucune action irréversible n’a eu lieu.</p>',
      },
      {
        id: 'repair-pause',
        heading: 'Que faire quand une cible ne correspond plus ?',
        html: '<ol><li>Inspectez l’étape en pause, la capture de page et l’action métier prévue.</li><li>Vérifiez si la page a changé ou si la connexion, l’authentification multifacteur, une erreur ou un mauvais compte explique le problème.</li><li>Choisissez une nouvelle cible unique pour la même action avec <code>step_repair</code>. Pour remplacer la cible d’un commit, il faut aussi fournir <code>confirmCommitTarget: true</code> après avoir vérifié qu’il s’agit du même contrôle de soumission.</li><li>Reprenez le lot. Avant la soumission, le formulaire de l’élément repart depuis le début ; après une soumission, seule une réparation admissible de confirmation peut continuer sur le même document.</li></ol><p>Les sélecteurs de repli automatiques doivent aussi correspondre à un seul élément. L’exécuteur direct signale leur utilisation ; un repli pour l’étape commit déclenche un avertissement sur le bouton d’envoi. Le mode hôte ne propose actuellement ni réparation de sélecteur ni rapport sur les replis. Voir <a href="https://github.com/Swih/ritoko/blob/main/docs/usage.md#execution-and-recovery">l’exécution et la reprise</a>.</p>',
      },
      {
        id: 'after-submit',
        heading: 'Et si le sélecteur a échoué après la soumission ?',
        html: '<p>Ne recréez pas l’enregistrement pour réparer son écran de reçu. Une cible de vérification manquante peut mettre en pause une fois le premier élément soumis ; d’autres échecs après commit peuvent passer en revue. L’absence du texte attendu est également un échec de vérification : changer de sélecteur ne suffit pas nécessairement.</p><p>Appliquez la procédure de reprise d’une écriture incertaine si le résultat n’est pas prouvé. La réparation restaure une cible ; elle n’établit pas si l’écriture métier précédente a réussi. Testez le workflow réparé sur un petit lot avant de l’utiliser dans un grand traitement récurrent.</p>',
      },
    ],
    faq: [
      {
        q: 'Ritoko répare-t-il automatiquement chaque sélecteur qui échoue ?',
        a: 'Non. Les exécutions directes admissibles peuvent s’arrêter pour une réparation explicite. Le remplacement de la cible commit demande une confirmation ; le mode hôte n’offre actuellement pas la réparation des sélecteurs.',
      },
      {
        q: 'Un sélecteur stable garantit-il que le résultat métier est correct ?',
        a: 'Non. Vérifiez l’enregistrement ou la preuve propre à la ligne. Un contrôle qui fonctionne peut avoir changé de comportement.',
      },
    ],
    related: ['uncertain-writes-after-interruption', 'resumable-csv-excel-batches'],
  },
  {
    slug: 'resumable-csv-excel-batches',
    twin: 'resumable-csv-excel-batches',
    lang: 'fr',
    metaTitle: 'Traiter et reprendre des lots CSV ou Excel — Ritoko',
    description:
      'Préparez les entrées CSV et XLSX, préservez les identifiants, validez les lignes et reprenez un lot interrompu depuis son workflow et son instantané journalisé.',
    h1: 'Comment traiter un CSV ou Excel et reprendre le lot à mi-parcours ?',
    shortAnswer:
      'Définissez une opération vérifiable par ligne, validez l’entrée et conservez une trace durable de chaque résultat. Ritoko lit les fichiers CSV et XLSX, fige les lignes et le workflow dans son journal SQLite et reprend le même lot en conservant les lignes confirmées et en mettant les écritures incertaines en revue.',
    datePublished: '2026-10-05',
    dateModified: '2026-10-05',
    tags: ['CSV', 'Excel', 'Reprise de lots'],
    sections: [
      {
        id: 'prepare-input',
        heading: 'Que faut-il corriger dans le tableur avant le traitement ?',
        html: '<ul><li>Utilisez des en-têtes clairs et uniques ainsi qu’une clé métier non vide et unique pour le lot.</li><li>Conservez les colonnes d’identifiants au format Texte. Le format Excel n’est pas appliqué : une cellule numérique affichée <code>07001</code> peut être lue <code>7001</code>, et <code>15 %</code> comme <code>0,15</code>.</li><li>Exportez uniquement les lignes à traiter. Les lignes masquées ou filtrées du XLSX sont tout de même lues.</li><li>Enregistrez les résultats calculés dans Excel. Les erreurs de formule ou les formules sans résultat enregistré sont traitées comme vides lorsqu’elles sont référencées.</li><li>Ne placez pas d’identifiants secrets dans les fichiers d’entrée. Déclarez plutôt des paramètres secrets issus de l’environnement.</li></ul><p>Ritoko accepte les CSV séparés par des virgules ou des points-virgules en UTF-8 ou Windows-1252, ainsi que les fichiers <code>.xlsx</code> avec choix de feuille. Ce n’est pas un lecteur universel de tous les tableurs. Voir la <a href="https://github.com/Swih/ritoko/blob/main/skills/ritoko/reference.md#input-files">référence des fichiers d’entrée</a>.</p>',
      },
      {
        id: 'define-row',
        heading: 'Comment définir l’opération de chaque ligne ?',
        html: '<p>Déclarez le chemin d’entrée, la clé, le périmètre de destination et les colonnes obligatoires. Marquez l’écriture irréversible comme <code>commit</code>, puis ajoutez un contrôle prouvant le résultat de cette ligne. Utilisez <code>readOnly: true</code> pour un lot qui ne fait que lire ou télécharger.</p><p>L’entrée entière est validée avant le traitement : en-têtes mal formés, clés en double ou vides, et valeurs référencées manquantes sont rejetés. Cela détecte des problèmes d’entrée, mais ne prouve pas que chaque valeur convient au système métier distant. Commencez par un petit lot représentatif et autorisé.</p>',
      },
      {
        id: 'resume-snapshot',
        heading: 'Dois-je modifier le tableur pour supprimer les lignes déjà traitées ?',
        html: '<p>Il n’est pas nécessaire de supprimer les lignes terminées pour reprendre un lot existant. Le journal enregistre ses lignes et la définition du workflow. Reprenez-le par son identifiant avec <code>run_resume</code> ou la commande <code>ritoko resume</code> en exécution directe ; utilisez <code>host_next</code> pour une exécution hôte.</p><p>Modifier le fichier d’origine ne change pas ce lot enregistré. Après avoir examiné les résultats précédents, placez les données corrigées ou nouvelles dans un nouveau lot volontairement lancé. Les éléments confirmés le restent ; les échecs sûrs peuvent être réessayés ; les éléments en revue nécessitent la vérification de la destination. Un nouveau fichier contenant les mêmes clés terminées ne signifie pas automatiquement une nouvelle opération métier.</p>',
      },
      {
        id: 'read-report',
        heading: 'Quel rapport indique que le lot est réellement terminé ?',
        html: '<p>Utilisez <code>run_report</code> ou la commande <code>ritoko report</code> pour examiner l’état de chaque élément, les causes, les messages et les preuves ou fichiers disponibles. <code>done</code> signifie que les contrôles du workflow ont réussi ; <code>skipped</code> signifie que l’élément était déjà confirmé selon les règles d’identité du journal. Un résultat partiel contient encore des échecs ou des éléments en revue.</p><p>Un lot est terminé uniquement lorsque ses éléments sont confirmés ou ignorés et que ses contrôles finaux réussissent. Un résultat partiel, un arrêt ou une pause de réparation renvoie le code de sortie CLI <code>2</code>. Gardez le journal avec l’installation : c’est la trace de reprise, pas un cache jetable. Les rapports actuels sont au format JSON ; ne supposez pas qu’un rapport d’audit HTML ou CSV existe.</p>',
      },
    ],
    faq: [
      {
        q: 'Modifier le fichier Excel modifiera-t-il un lot repris ?',
        a: 'Non. Le lot utilise l’instantané enregistré des entrées et du workflow. Après avoir examiné les résultats précédents, lancez volontairement un nouveau lot pour les données corrigées ou nouvelles.',
      },
    ],
    related: [
      'avoid-duplicate-csv-imports',
      'uncertain-writes-after-interruption',
      'browser-api-mcp-workflows',
    ],
  },
  {
    slug: 'browser-api-mcp-workflows',
    twin: 'browser-api-mcp-workflows',
    lang: 'fr',
    metaTitle: 'Choisir entre navigateur, API HTTP et workflow MCP — Ritoko',
    description:
      'Choisissez navigateur, API HTTP ou MCP pour un travail récurrent, avec vérifications, gestion des accès et reprise des écritures incertaines.',
    h1: 'Une tâche répétitive doit-elle utiliser le navigateur, une API HTTP ou un outil MCP ?',
    shortAnswer:
      'Utilisez l’interface prise en charge dont vous pouvez vérifier le contrat métier et les autorisations. Les étapes navigateur conviennent aux tâches dans une interface graphique ; HTTP aux points d’accès documentés ; MCP aux outils dont les entrées et sorties sont connues. Ritoko peut réunir ces voies dans un même workflow et journal.',
    datePublished: '2026-10-05',
    dateModified: '2026-10-05',
    tags: ['Navigateur', 'API HTTP', 'MCP'],
    table: {
      caption: 'Choisir une voie selon le contrat vérifiable',
      columns: ['Voie', 'Utile lorsque', 'À vérifier avant l’enregistrement'],
      rows: [
        [
          'Navigateur',
          'La tâche est proposée dans l’interface du compte auquel vous êtes autorisé',
          'Contrôles uniques, session, commit et preuve métier visible',
        ],
        [
          'API HTTP',
          'Un point d’accès pris en charge expose l’opération requise',
          'Authentification, schéma de requête, vérifications du résultat et contrat d’idempotence éventuel',
        ],
        [
          'Outil MCP',
          'Un outil connecté réalise l’opération souhaitée',
          'Schéma entrée/sortie, effets de bord, compatibilité et frais du fournisseur',
        ],
      ],
    },
    sections: [
      {
        id: 'browser-path',
        heading: 'Quand le navigateur est-il le choix pratique ?',
        html: '<p>Utilisez l’interface lorsqu’elle est la méthode prise en charge ou lorsqu’elle fournit une approbation ou un contrôle métier nécessaire. L’exécuteur direct se connecte à Chrome personnel avec l’autorisation de débogage distant, ou à un profil isolé explicitement choisi. Connectez-vous et effectuez l’authentification multifacteur dans le navigateur sélectionné.</p><p>La reprise navigateur en mode hôte exige un client qui autorise l’exécution de scripts dans la page. L’évaluation actuelle de Codex en mode computer-use est en lecture seule et ne peut pas effectuer cette reprise. Les lots hôte limités à l’API et aux outils MCP connectés restent possibles. Vérifiez les limites du pilote avant d’enregistrer une tâche dépendant des iframes, des frappes clavier ou des téléchargements.</p>',
      },
      {
        id: 'api-path',
        heading: 'Puis-je transformer un enregistrement navigateur en appels API ?',
        html: '<p>La capture réseau facultative fournit des métadonnées fetch/XHR utiles à l’étude d’une API. Ces indications ne constituent pas un contrat API et ne créent pas automatiquement des étapes HTTP exécutables. Vérifiez le point d’accès pris en charge, l’authentification, les champs requis et le résultat métier retourné, puis testez une ligne autorisée et enregistrez explicitement le remplacement.</p><p>Une étape HTTP peut vérifier le statut et les valeurs JSON, enregistrer les identifiants renvoyés et alimenter des contrôles ultérieurs en lecture seule. Les paramètres secrets issus de l’environnement évitent d’inscrire les accès dans les workflows. Une clé <code>Idempotency-Key</code> stable est disponible si l’API destinataire en documente la prise en charge. Seules les requêtes GET/HEAD admissibles avant commit sont réessayées automatiquement ; une écriture au résultat incertain reste en revue.</p>',
      },
      {
        id: 'mcp-path',
        heading: 'Que vérifier pour un outil MCP connecté ?',
        html: '<p>Vérifiez le schéma de l’outil et ses effets réels. Déclarer une étape en lecture seule est une affirmation de l’auteur, pas une garantie du protocole. Les erreurs d’outil, délais dépassés et demandes d’informations supplémentaires font échouer l’étape ; Ritoko ne réessaie pas automatiquement les appels MCP. Une écriture ayant expiré peut tout de même aboutir à distance.</p><p>Un workflow direct peut démarrer ou contacter des serveurs configurés. Les références hôte <code>{ref: "agent"}</code> réutilisent une connexion de l’agent existante. Les protocoles pris en charge par les clients directs sont limités ; un serveur compatible uniquement avec un protocole plus récent peut ne pas fonctionner. Un outil MCP externe peut invoquer un modèle ou un service payant, même si le moteur de reprise directe Ritoko ne contient aucun appel LLM.</p>',
      },
      {
        id: 'combine-paths',
        heading: 'Comment combiner les interfaces sans répéter une écriture ?',
        html: '<p>Par exemple, créez un enregistrement via une API documentée, enregistrez son identifiant, puis récupérez son reçu avec un outil en lecture seule. Gardez une seule opération irréversible commit par élément et vérifiez ensuite l’effet attendu. Un workflow sans étape navigateur n’a pas besoin de Chrome.</p><p>Après l’expiration d’une écriture API, ne basculez pas automatiquement vers une soumission dans le navigateur : le même enregistrement pourrait être créé deux fois. Vérifiez d’abord le résultat de la première voie. Séparez les tâches comportant plusieurs écritures indépendantes en procédures vérifiables distinctes. La <a href="https://github.com/Swih/ritoko/blob/main/skills/ritoko/reference.md#api-and-mcp-steps">référence des étapes HTTP/MCP</a> décrit les formats, l’authentification et les limites des pilotes.</p>',
      },
    ],
    related: [
      'uncertain-writes-after-interruption',
      'recurring-tasks-model-costs',
      'resumable-csv-excel-batches',
    ],
  },
]
