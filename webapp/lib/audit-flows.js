// Defines the step-by-step flow for each audit type.
// Each step has: what it does, what data it needs, what it produces, and the terminal command.

const FLOWS = {
  'broken-backlinks': {
    label: 'Broken Backlinks',
    description: 'Finds external backlinks pointing to broken (404) pages on the site.',
    requiresScraper: false,
    isMultiStep: true,
    usesMystique: true,
    steps: [
      {
        id: 'import-mock',
        label: 'Load Backlink Data',
        description: 'Load broken-backlinks data for this run. Fetch real data from the SpaceCat API, or paste rows manually. When loaded, the audit uses this data instead of calling Semrush.',
        dataRequired: [],
        dataProduced: ['broken-backlinks-local.json (in audit worker dir)'],
        terminalCmd: '',
        optional: true,
        isMockImport: true,
      },
      {
        id: 'top-pages',
        label: 'Get Top Pages',
        description: 'Fetches the top pages for this site from the SpaceCat API (uses the stage/prod key from your config). These are sent to the AI as candidate replacement URLs when generating suggestions for broken backlinks. Required — without them the audit skips suggestion generation.',
        dataRequired: [],
        dataProduced: ['local-data/urls-to-scrape.txt'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./get-top-pages.sh',
      },
      {
        id: 'audit',
        label: 'Run Audit',
        description: 'Runs the broken-backlinks audit. Uses mock data if imported above, otherwise calls Semrush. Uses top pages fetched above as candidate replacement URLs for AI suggestions.',
        dataRequired: ['local-data/urls-to-scrape.txt'],
        dataProduced: ['audit result (console output)'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./run-audit-worker.sh',
      },
    ],
  },

  'broken-internal-links': {
    label: 'Broken Internal Links',
    description: 'Multi-step audit. First fetches RUM data for broken links, then runs the suggestion step.',
    requiresScraper: false,
    steps: [
      {
        id: 'fetch-rum',
        label: 'Step 1 — Fetch RUM Data',
        description: 'Fetches broken internal links from the RUM API. Requires a RUM domain key.',
        dataRequired: [],
        dataProduced: ['local-data/broken-links-{siteId}.json'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./fetch-broken-links.sh',
      },
      {
        id: 'audit',
        label: 'Step 2 — Run Suggestions',
        description: 'Uses the Step 1 JSON to generate fix suggestions.',
        dataRequired: ['local-data/broken-links-{siteId}.json'],
        dataProduced: ['audit result (console output)'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./run-audit-worker.sh',
      },
    ],
  },

  'canonical': {
    label: 'Canonical',
    description: 'Checks canonical tags across pages. Can use local URLs or fetch live from site.',
    requiresScraper: false,
    steps: [
      {
        id: 'top-pages',
        label: 'Get Top Pages (optional)',
        description: 'Fetches the top pages from the SpaceCat API to use as the URL list.',
        dataRequired: [],
        dataProduced: ['local-data/urls-to-scrape.txt'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./get-top-pages.sh',
        optional: true,
      },
      {
        id: 'audit',
        label: 'Run Audit',
        description: 'Validates canonical tags on each page.',
        dataRequired: [],
        dataProduced: ['audit result (console output)'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./run-audit-worker.sh',
      },
    ],
  },

  'hreflang': {
    label: 'Hreflang',
    description: 'Checks hreflang tags for correctness. Can use local URLs or fetch live.',
    requiresScraper: false,
    steps: [
      {
        id: 'top-pages',
        label: 'Get Top Pages (optional)',
        description: 'Fetches the top pages from the SpaceCat API to use as the URL list.',
        dataRequired: [],
        dataProduced: ['local-data/urls-to-scrape.txt'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./get-top-pages.sh',
        optional: true,
      },
      {
        id: 'audit',
        label: 'Run Audit',
        description: 'Validates hreflang annotations on each page.',
        dataRequired: [],
        dataProduced: ['audit result (console output)'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./run-audit-worker.sh',
      },
    ],
  },

  'meta-tags': {
    label: 'Meta Tags',
    description: 'Checks meta title and description tags. Requires scraped page data.',
    requiresScraper: true,
    steps: [
      {
        id: 'top-pages',
        label: 'Get Top Pages',
        description: 'Fetches the top pages from the SpaceCat API to build the scrape list.',
        dataRequired: [],
        dataProduced: ['local-data/urls-to-scrape.txt'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./get-top-pages.sh',
      },
      {
        id: 'scrape',
        label: 'Run Scraper',
        description: 'Scrapes the pages and saves HTML/data locally.',
        dataRequired: ['local-data/urls-to-scrape.txt'],
        dataProduced: ['scraper/tmp/scrapes/{siteId}/'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./run-scraper.sh',
      },
      {
        id: 'audit',
        label: 'Run Audit',
        description: 'Analyzes the scraped data for meta tag issues.',
        dataRequired: ['scraper/tmp/scrapes/{siteId}/'],
        dataProduced: ['audit result (console output)'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./run-audit-worker.sh',
      },
    ],
  },

  'headings': {
    label: 'Headings',
    description: 'Checks heading structure (H1, H2, etc.). Requires scraped page data.',
    requiresScraper: true,
    steps: [
      {
        id: 'top-pages',
        label: 'Get Top Pages',
        description: 'Fetches the top pages from the SpaceCat API to build the scrape list.',
        dataRequired: [],
        dataProduced: ['local-data/urls-to-scrape.txt'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./get-top-pages.sh',
      },
      {
        id: 'scrape',
        label: 'Run Scraper',
        description: 'Scrapes the pages and saves HTML/data locally.',
        dataRequired: ['local-data/urls-to-scrape.txt'],
        dataProduced: ['scraper/tmp/scrapes/{siteId}/'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./run-scraper.sh',
      },
      {
        id: 'audit',
        label: 'Run Audit',
        description: 'Analyzes heading structure across the scraped pages.',
        dataRequired: ['scraper/tmp/scrapes/{siteId}/'],
        dataProduced: ['audit result (console output)'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./run-audit-worker.sh',
      },
    ],
  },

  'structured-data': {
    label: 'Structured Data',
    description: 'Validates JSON-LD and other structured data markup. Requires scraped page data.',
    requiresScraper: true,
    steps: [
      {
        id: 'top-pages',
        label: 'Get Top Pages',
        description: 'Fetches the top pages from the SpaceCat API to build the scrape list.',
        dataRequired: [],
        dataProduced: ['local-data/urls-to-scrape.txt'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./get-top-pages.sh',
      },
      {
        id: 'scrape',
        label: 'Run Scraper',
        description: 'Scrapes the pages and saves HTML/data locally.',
        dataRequired: ['local-data/urls-to-scrape.txt'],
        dataProduced: ['scraper/tmp/scrapes/{siteId}/'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./run-scraper.sh',
      },
      {
        id: 'audit',
        label: 'Run Audit',
        description: 'Validates structured data markup on each scraped page.',
        dataRequired: ['scraper/tmp/scrapes/{siteId}/'],
        dataProduced: ['audit result (console output)'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./run-audit-worker.sh',
      },
    ],
  },

  'product-metatags': {
    label: 'Product Meta Tags',
    description: 'Checks product page meta tags for e-commerce sites. Requires scraped page data.',
    requiresScraper: true,
    steps: [
      {
        id: 'top-pages',
        label: 'Get Top Pages',
        description: 'Fetches the top pages from the SpaceCat API to build the scrape list.',
        dataRequired: [],
        dataProduced: ['local-data/urls-to-scrape.txt'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./get-top-pages.sh',
      },
      {
        id: 'scrape',
        label: 'Run Scraper',
        description: 'Scrapes the pages and saves HTML/data locally.',
        dataRequired: ['local-data/urls-to-scrape.txt'],
        dataProduced: ['scraper/tmp/scrapes/{siteId}/'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./run-scraper.sh',
      },
      {
        id: 'audit',
        label: 'Run Audit',
        description: 'Analyzes product page meta tags from scraped data.',
        dataRequired: ['scraper/tmp/scrapes/{siteId}/'],
        dataProduced: ['audit result (console output)'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./run-audit-worker.sh',
      },
    ],
  },

  'sitemap': {
    label: 'Sitemap',
    description: 'Validates the sitemap.xml and the URLs it contains. Fetches live.',
    requiresScraper: false,
    steps: [
      {
        id: 'audit',
        label: 'Run Audit',
        description: 'Fetches and validates the sitemap live from the site.',
        dataRequired: [],
        dataProduced: ['audit result (console output)'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./run-audit-worker.sh',
      },
    ],
  },

  'redirect-chains': {
    label: 'Redirect Chains',
    description: 'Detects redirect chains and loops. Fetches live from the site.',
    requiresScraper: false,
    steps: [
      {
        id: 'audit',
        label: 'Run Audit',
        description: 'Crawls the site live to detect redirect chains.',
        dataRequired: [],
        dataProduced: ['audit result (console output)'],
        terminalCmd: 'cd $SPACECAT_TOOLS_DIR && ./run-audit-worker.sh',
      },
    ],
  },
};

module.exports = { FLOWS };
