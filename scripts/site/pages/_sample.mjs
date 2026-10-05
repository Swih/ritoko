// SAMPLE ENTRIES, NOT CONTENT. The build loads this file only when SITE_SAMPLES=1, to test the guide,
// comparison, FAQ and French templates (hreflang twin included). Every sample carries the marker
// "ritoko-sample": preflight fails when the marker appears in the output of a build made without
// SITE_SAMPLES=1, so nothing here can ship. Never copy these texts into a real page.

const problem = {
  slug: 'ritoko-sample-problem',
  lang: 'en',
  twin: 'ritoko-sample',
  metaTitle: 'Sample guide (ritoko-sample) — Ritoko',
  description:
    'Sample entry used only to test the guide template. It is never published. Marker: ritoko-sample. Replace it with real content.',
  h1: 'Sample question: does the template put a direct answer first?',
  shortAnswer:
    'This is a sample entry (ritoko-sample). It tests the layout, the structured data and the links, and it never ships.',
  sections: [
    {
      id: 'why',
      heading: 'Sample section: why does this happen?',
      html: '<p>This <strong>sample</strong> paragraph links to an <a href="/benchmarks">existing page</a> and shows <code>inline code</code>.</p><ul><li>First sample item.</li><li>Second sample item.</li></ul>',
    },
    {
      id: 'code',
      heading: 'Sample section: code and a long line',
      html: '<h3>Sample subheading</h3><p>A code block scrolls inside its box and never widens the page.</p><pre><code>{ "sample": "ritoko-sample", "long": "a very long line that must scroll sideways on a narrow screen without breaking the layout" }</code></pre>',
    },
    {
      id: 'steps',
      heading: 'Sample section: an ordered list',
      html: '<ol><li>Step one of a sample procedure.</li><li>Step two, with a <a href="#faq">link to an anchor on this page</a>.</li></ol>',
    },
  ],
  faq: [
    {
      q: 'Is this sample real content?',
      a: 'No. It is a <strong>sample</strong> that carries the marker <code>ritoko-sample</code>.',
    },
    {
      q: 'Where do sample pages go?',
      a: 'Nowhere: the build adds them only when <code>SITE_SAMPLES=1</code> is set.',
    },
  ],
  related: ['ritoko-sample-comparison'],
  sources: [
    {
      label: 'Sample source label',
      url: 'https://example.com/',
      retrieved: '2026-10-05',
    },
  ],
  datePublished: '2026-10-01',
  dateModified: '2026-10-05',
  tags: ['sample', 'template-test'],
}

const comparison = {
  slug: 'ritoko-sample-comparison',
  lang: 'en',
  metaTitle: 'Sample comparison (ritoko-sample) — Ritoko',
  description:
    'Sample comparison used only to test the table, sources and related-links blocks. It is never published. Marker: ritoko-sample.',
  h1: 'Sample comparison: which tool fits which job?',
  shortAnswer:
    'Sample answer: a comparison names who should pick each tool and when to use both. This text is a placeholder (ritoko-sample).',
  table: {
    caption: 'Sample table: what each tool documents (not real data)',
    columns: ['Question', 'Tool A (sample)', 'Tool B (sample)'],
    rows: [
      ['Runs where?', 'Locally', 'In a hosted browser'],
      ['Journal per item?', 'Documented', '<a href="/watch">Not found in its docs</a>'],
    ],
    note: 'Sample data, not a real comparison.',
  },
  sections: [
    {
      id: 'when-a',
      heading: 'Sample section: when is Tool A the better choice?',
      html: '<p>Sample text. A real page names what the other tool does better.</p>',
    },
  ],
  related: ['ritoko-sample-problem'],
  sources: [
    {
      label: 'Sample source label',
      url: 'https://example.com/docs',
      retrieved: '2026-10-04',
    },
  ],
  datePublished: '2026-10-02',
  dateModified: '2026-10-05',
  tags: ['sample'],
}

const faqGroup = {
  id: 'ritoko-sample-group',
  heading: 'Sample group of questions',
  intro: 'This group exists only when samples are enabled.',
  items: [
    {
      q: 'Is this FAQ sample real content?',
      a: 'No. It is a <strong>sample</strong> with the marker <code>ritoko-sample</code>.',
    },
    {
      q: 'Do these answers match the structured data?',
      a: 'Preflight compares each visible answer with the FAQPage JSON-LD of the same page.',
    },
  ],
}

const faqPage = {
  metaTitle: 'Sample FAQ (ritoko-sample) — Ritoko',
  description:
    'Sample FAQ used only to test the FAQ template and its structured data. It is never published. Marker: ritoko-sample.',
  h1: 'Sample FAQ (ritoko-sample)',
  shortAnswer: 'A sample FAQ page that exists only when SITE_SAMPLES=1 is set.',
  datePublished: '2026-10-01',
  dateModified: '2026-10-05',
}

const problemFr = {
  slug: 'ritoko-sample-probleme',
  lang: 'fr',
  twin: 'ritoko-sample',
  metaTitle: 'Guide d’exemple (ritoko-sample) — Ritoko',
  description:
    'Entrée d’exemple servant uniquement à tester le modèle de guide. Elle n’est jamais publiée. Repère\xa0: ritoko-sample. À remplacer.',
  h1: 'Exemple\xa0: ce modèle affiche-t-il d’abord une réponse directe\xa0?',
  shortAnswer:
    'Ceci est une entrée d’exemple (ritoko-sample). Elle sert à tester la mise en page, les données structurées et les liens, et elle n’est jamais publiée.',
  sections: [
    {
      id: 'pourquoi',
      heading: 'Section d’exemple\xa0: pourquoi cela arrive-t-il\xa0?',
      html: '<p>Ce paragraphe d’<strong>exemple</strong> renvoie vers une <a href="/benchmarks">page existante</a> et montre du <code>code en ligne</code>.</p><ul><li>Premier élément d’exemple.</li><li>Second élément d’exemple.</li></ul>',
    },
    {
      id: 'code',
      heading: 'Section d’exemple\xa0: un bloc de code',
      html: '<p>Un bloc de code défile dans sa boîte et n’élargit jamais la page.</p><pre><code>{ "exemple": "ritoko-sample", "long": "une ligne très longue qui doit défiler sur un écran étroit sans casser la mise en page" }</code></pre>',
    },
  ],
  faq: [
    {
      q: 'Cet exemple est-il un vrai contenu\xa0?',
      a: 'Non. C’est un <strong>exemple</strong> qui porte le repère <code>ritoko-sample</code>.',
    },
  ],
  related: [],
  datePublished: '2026-10-01',
  dateModified: '2026-10-05',
  tags: ['exemple'],
}

const faqGroupFr = {
  id: 'ritoko-sample-groupe',
  heading: 'Groupe de questions d’exemple',
  items: [
    {
      q: 'Cette FAQ d’exemple est-elle un vrai contenu\xa0?',
      a: 'Non. C’est un <strong>exemple</strong> avec le repère <code>ritoko-sample</code>.',
    },
    {
      q: 'Les réponses correspondent-elles aux données structurées\xa0?',
      a: 'Le contrôle compare chaque réponse visible au JSON-LD FAQPage de la même page.',
    },
  ],
}

const faqPageFr = {
  metaTitle: 'FAQ d’exemple (ritoko-sample) — Ritoko',
  description:
    'FAQ d’exemple servant uniquement à tester le modèle de FAQ et ses données structurées. Elle n’est jamais publiée. Repère\xa0: ritoko-sample.',
  h1: 'FAQ d’exemple (ritoko-sample)',
  shortAnswer: 'Une page FAQ d’exemple qui n’existe que si SITE_SAMPLES=1 est défini.',
  datePublished: '2026-10-01',
  dateModified: '2026-10-05',
}

export const samplePages = {
  problemPages: [problem],
  comparisonPages: [comparison],
  faqGroups: [faqGroup],
  faqPage,
  problemPagesFr: [problemFr],
  faqGroupsFr: [faqGroupFr],
  faqPageFr,
}
