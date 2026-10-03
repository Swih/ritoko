// Editorial content is rendered as static HTML so each use case has its own URL.
export const casePages = [
  {
    id: 'rpa',
    slug: 'rpa-challenge',
    metaTitle: 'RPA Challenge automation: 70 fields, 100% success — Ritoko',
    title: 'Fill changing browser forms from a spreadsheet.',
    description:
      'Inspect Ritoko’s RPA Challenge result: ten rows, seventy fields, 100% success. See how a saved workflow finds changing fields by their labels.',
    before:
      'A person copies each spreadsheet row into a browser form. The fields move, so their screen positions cannot be trusted.',
    after:
      'A saved procedure uses the field labels to fill the current row, submits it and checks the final challenge score.',
    detail:
      'The RPA Challenge is a useful test of form interaction: its fields shuffle after every submission. Ritoko completed ten rows and all seventy fields correctly in this measured run. The challenge’s own timer reported 1,735 ms. The journal duration was 3,190 ms and the CLI took 3,559 ms, including additional work outside that timer.',
    fit: 'Use this pattern for a repeatable form with stable field meanings and authorized access. In a business system, add an item-specific receipt or lookup so the workflow can prove which record was created. The challenge only provides a final batch score.',
  },
  {
    id: 'resume',
    slug: 'customer-onboarding',
    metaTitle: 'CSV customer onboarding with crash recovery — Ritoko',
    title: 'Create customer records from a CSV. Resume with care.',
    description:
      'Turn a customer spreadsheet into checked browser submissions. Watch a real interrupted Ritoko batch resume without resubmitting completed customers.',
    before:
      'Ten new customers need the same form. If the process stops halfway, someone must work out which submissions reached the back office.',
    after:
      'Each customer has a business key and a journal entry. Verified work is kept, uncertain submissions are held for review and unstarted rows can continue.',
    detail:
      'The recording uses a local test back office that accepts duplicate submissions. The process is killed after the fifth customer reaches the server. Four earlier customers are verified; the fifth has no confirmed result. On resume, Ritoko holds that item for review and finishes the other five. The server receives ten submissions with ten unique customer keys.',
    fit: 'Use this pattern for customer, supplier or account creation when the destination can confirm each new record. A submitted form is not enough: the workflow should check the customer’s email, record identifier or another business-specific result. The demonstration deliberately adds 700 ms per submission so the interruption can be observed.',
  },
  {
    id: 'exports',
    slug: 'reports-and-exports',
    metaTitle: 'Automate recurring browser reports and exports — Ritoko',
    title: 'Collect recurring reports without repeating the clicks.',
    description:
      'Save a monthly reporting procedure with Ritoko: choose the account and period, download each export and check the expected file.',
    before:
      'Every month, the same reporting page needs the same account selection, date filters and export clicks. Files then need consistent names.',
    after:
      'The account and period become workflow inputs. The saved routine produces named exports and records a checked outcome for each item.',
    detail:
      'Your agent works through one reporting task and defines the parts that change: account, date range and destination name. Browser steps can select the filters and request the export. The workflow then needs an appropriate check that the expected download exists. The next month reuses the procedure with new inputs.',
    fit: 'Use this pattern when the report format and access path are stable. Authentication remains in your authorized session. A changed selector pauses for repair. This is a supported workflow pattern; the site does not present it as a measured production integration or promise that every reporting portal behaves identically.',
  },
  {
    id: 'http',
    slug: 'browser-and-http',
    metaTitle: 'Combine browser automation and HTTP API steps — Ritoko',
    title: 'Combine browser work with a checked API update.',
    description:
      'Build a repeatable Ritoko workflow that mixes browser and HTTP steps, parameterizes record updates and checks the resulting business state.',
    before:
      'An operator finds a record in one interface, copies its identifier and performs a corresponding update in another system.',
    after:
      'The identifier and changes become inputs to a saved procedure. Browser and HTTP steps can share the work, with an explicit commit and result check.',
    detail:
      'A workflow can use the browser for the part that needs a page and an HTTP step for the part exposed by an authorized API. The agent defines the request and parameters directly. The business key identifies the item across runs. After a write, the expectation should verify the resulting record rather than treating an HTTP response alone as proof of the entire business task.',
    fit: 'Use this pattern where you have API access and a reliable way to check the update. A failure before the commit can be retried; an uncertain effect after the commit is held for review. Credentials, permissions and destination behavior still matter. This example describes a workflow pattern, not a named vendor integration.',
  },
  {
    id: 'mcp',
    slug: 'mcp-workflows',
    metaTitle: 'Repeat MCP tool workflows with a local journal — Ritoko',
    title: 'Repeat connected tool actions with an item journal.',
    description:
      'Save a sequence of MCP tool steps in Ritoko. Replay deterministic actions for new input rows and verify the expected result for each item.',
    before:
      'Your agent keeps making the same sequence of connected tool calls for different records. Every repeated task starts another reasoning loop.',
    after:
      'A trusted sequence can become a parameterized workflow. Deterministic steps replay without a model while the journal keeps each item’s outcome.',
    detail:
      'Your agent defines the MCP steps, their inputs and the expectations that prove success. The saved workflow can combine these tool calls with browser or HTTP work. A model is useful while learning or repairing the task; it is not required to decide every step of an unchanged deterministic replay.',
    fit: 'Use this pattern when the tools expose predictable actions and result checks. Direct mode and host mode have different execution capabilities, so follow the setup guide for the chosen path. Host permissions and the connected tools’ authorization still apply. This is a supported pattern, not a claim that every MCP tool can run in every mode.',
  },
  {
    id: 'documents',
    slug: 'document-processing',
    metaTitle: 'Automate workflows after document data extraction — Ritoko',
    title: 'Take extracted document data through a repeatable workflow.',
    description:
      'Combine agent-assisted document reading with Ritoko’s deterministic downstream workflow: submit structured rows, check results and resume from the journal.',
    before:
      'Someone reads incoming documents, extracts the important fields and then repeats the same data entry or update routine for each one.',
    after:
      'Reading produces structured rows. Ritoko handles the repeatable downstream steps and checks their results, keeping uncertain writes out of blind retries.',
    detail:
      'Document interpretation and repeatable execution are separate parts of this pattern. Your agent or an external document service reads each new document and returns structured data. A saved Ritoko workflow can then use those rows to fill a form, call an API or invoke a connected tool. The journal follows the downstream business item.',
    fit: 'Use this pattern when extracted data can be validated before submission and the destination can confirm the result. Ritoko does not provide built-in OCR. Reading a new document may require a model or external service on every item; only the deterministic saved steps replay without a model. This page describes a pattern, not a recorded document-processing benchmark.',
  },
]
