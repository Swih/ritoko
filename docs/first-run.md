# Try Ritoko locally

Requires **Node.js 24 or newer**. No account, API key or browser is needed.

In an empty directory, install and run the bundled example:

```sh
npm install ritoko@0.2.0
node node_modules/ritoko/examples/first-run/demo.mjs
```

From a repository checkout:

```sh
npm ci
npm run build
node examples/first-run/demo.mjs
```

The command starts an HTTP service bound to `127.0.0.1`, imports the prepared
workflow and runs the **compiled Ritoko CLI** with ten fake CSV customers. Each
POST is followed by a GET checking the customer's email, name and company. The
second run uses the same journal and destination.

Expected output:

```text
PASS: 10 verified customers; rerun skipped 10; 0 extra writes.
```

The service deliberately accepts duplicates. The example checks actual writes
as well as Ritoko's reports, and fails if either differs from the expected result.
It stops the service automatically on completion or a caught error.

Each invocation creates an isolated temporary `RITOKO_HOME`, leaving your normal
journal untouched. The printed directory retains the SQLite journal and run
reports for inspection; remove that directory when finished. The smoke check
removes its own temporary journal:

```sh
node examples/first-run/smoke.mjs
```

This is a **localhost simulation**, not evidence from a customer deployment.
It tests HTTP write verification and skipping previously verified rows. It does
not test authentication, browser automation, interrupted writes or reconciliation.
The service keeps records only in memory. Restarting the example starts a fresh
service and journal. Before using a real service, define its own verification and
recovery rules.

## Essai en français

Avec **Node.js 24 ou plus**, installez puis lancez :

```sh
npm install ritoko@0.2.0
node node_modules/ritoko/examples/first-run/demo.mjs
```

Le premier passage crée dix clients fictifs et relit chaque fiche pour vérifier
son contenu. Le second ignore les dix lignes déjà vérifiées : le service reçoit
toujours exactement dix écritures, sans doublon supplémentaire.

Le message `PASS` confirme ces vérifications. Aucun compte, secret ou navigateur
n'est nécessaire. Le service écoute uniquement sur `127.0.0.1` et s'arrête à la
fin. Le journal est isolé dans le dossier temporaire affiché, que vous pouvez
supprimer après inspection. Chaque lancement repart avec un service et un journal
neufs. Cet essai local ne constitue pas une preuve d'utilisation chez un client ;
il ne teste ni l'authentification, ni Chrome, ni la reprise après interruption.
