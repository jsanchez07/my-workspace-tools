#!/usr/bin/env node
/**
 * Fetches broken-backlinks opportunity data from the SpaceCat API
 * and writes broken-backlinks-local.json to the audit worker directory.
 *
 * Env vars:
 *   SITE_ID       — SpaceCat site ID
 *   BB_API_KEY    — API key from spacecat-config.sh (SPACECAT_API_KEY_STAGE or _PROD)
 *   BB_API_URL    — API base URL (e.g. https://spacecat.experiencecloud.live/api/v1/)
 *   OUTPUT_FILE   — absolute path to write broken-backlinks-local.json
 */

const fs = require('fs');

const EXCLUDED_STATUSES = new Set(['OUTDATED', 'FIXED', 'REJECTED', 'SKIPPED']);

async function apiFetch(apiBase, apiKey, path) {
  const url = `${apiBase}${path}`;
  const res = await fetch(url, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status} from ${url}${body ? `: ${body.slice(0, 200)}` : ''}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function main() {
  const siteId = process.env.SITE_ID;
  const apiKey = process.env.BB_API_KEY;
  const apiBase = (process.env.BB_API_URL || 'https://spacecat.experiencecloud.live/api/v1/').replace(/\/?$/, '/');
  const outputFile = process.env.OUTPUT_FILE;

  if (!siteId) { console.error('❌ Error: SITE_ID is required'); process.exit(1); }
  if (!apiKey) { console.error('❌ Error: BB_API_KEY is required'); process.exit(1); }
  if (!outputFile) { console.error('❌ Error: OUTPUT_FILE is required'); process.exit(1); }

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║            FETCH BROKEN BACKLINKS FROM SPACECAT            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Site ID : ${siteId}`);
  console.log(`API     : ${apiBase}`);
  console.log('');

  // 1. Get opportunities
  console.log('🔍 Fetching opportunities...');
  let allOpps;
  try {
    allOpps = await apiFetch(apiBase, apiKey, `sites/${siteId}/opportunities`);
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      console.error('❌ Auth error — check that the API key in spacecat-config.sh is correct.');
    }
    throw err;
  }

  const opps = allOpps.filter((o) => o.type === 'broken-backlinks');
  console.log(`   Found ${opps.length} broken-backlinks opportunity(ies) (${allOpps.length} total opportunities)`);

  if (opps.length === 0) {
    console.log('');
    console.log('⚠️  No broken-backlinks opportunities found for this site.');
    console.log('   The site may not have had a recent audit, or all suggestions are already fixed/rejected.');
    fs.writeFileSync(outputFile, JSON.stringify({ importedAt: new Date().toISOString(), backlinks: [] }, null, 2));
    console.log(`✅ Written empty backlinks file to: ${outputFile}`);
    console.log('');
    process.exit(0);
  }

  // 2. Fetch suggestions for each opportunity
  const backlinks = [];

  for (const opp of opps) {
    console.log('');
    console.log(`📋 Fetching suggestions for opportunity ${opp.id}...`);
    const suggestions = await apiFetch(apiBase, apiKey, `sites/${siteId}/opportunities/${opp.id}/suggestions`);
    const active = suggestions.filter((s) => !EXCLUDED_STATUSES.has(s.status));
    const excluded = suggestions.length - active.length;
    console.log(`   ${suggestions.length} total → ${active.length} active, ${excluded} excluded (${[...EXCLUDED_STATUSES].join('/')})`);

    for (const s of active) {
      backlinks.push({
        url_from: s.data?.url_from ?? '',
        url_to: s.data?.url_to ?? '',
        traffic_domain: s.data?.traffic_domain ?? 0,
        title: s.data?.title ?? '',
      });
    }
  }

  // 3. Write output
  const output = {
    importedAt: new Date().toISOString(),
    backlinks,
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

  console.log('');
  console.log(`✅ Total backlinks fetched : ${backlinks.length}`);
  console.log(`✅ Written to              : ${outputFile}`);
  console.log('');

  // Show sample
  if (backlinks.length > 0) {
    console.log('📋 First 3 entries:');
    console.log('─────────────────────────────────────────────────────────────');
    for (const b of backlinks.slice(0, 3)) {
      console.log(`  FROM : ${b.url_from}`);
      console.log(`  TO   : ${b.url_to}`);
      console.log('');
    }
    console.log('─────────────────────────────────────────────────────────────');
  }
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
