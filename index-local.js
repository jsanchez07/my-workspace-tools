/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
/* eslint-disable no-console */

import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import { main as universalMain } from './index.js';

// ============================================================================
// LOCAL TESTING CONFIGURATION
// ============================================================================
// Cache for suggestions (needed for broken-internal-links Step 2)
// When addSuggestions is called, cache them so allByOpportunityIdAndStatus can return them
const suggestionCache = new Map(); // key: opportunityId, value: array of suggestion objects

// Read configuration from local-config.json (fallback) or environment variables
let localConfig = {};
try {
  const configPath = path.resolve('./local-config.json');
  if (fs.existsSync(configPath)) {
    const configContent = fs.readFileSync(configPath, 'utf8');
    localConfig = JSON.parse(configContent);
    console.log('✅ Loaded configuration from local-config.json');
  }
} catch (error) {
  console.log('⚠️  Could not load local-config.json, using environment variables only');
}

// Set to true to use local scraper data instead of S3
// Priority: environment variable > config file > default (false)
const USE_LOCAL_SCRAPER_DATA = process.env.USE_LOCAL_SCRAPER_DATA === 'true'
  || process.env.USE_LOCAL_SCRAPER_DATA === true
  || localConfig.USE_LOCAL_SCRAPER_DATA === true
  || false;

// Set to true to mock DynamoDB top pages queries with local urls-to-scrape.txt
// Priority: environment variable > config file > default (false)
const USE_LOCAL_TOP_PAGES = process.env.USE_LOCAL_TOP_PAGES === 'true'
  || process.env.USE_LOCAL_TOP_PAGES === true
  || localConfig.USE_LOCAL_TOP_PAGES === true
  || false;

// Get the path to the top pages file
// Priority: environment variable > config file > default
const TOP_PAGES_FILE = process.env.TOP_PAGES_FILE
  || localConfig.TOP_PAGES_FILE
  || path.join(process.env.HOME || '', 'Documents/my-workspace-tools/urls-to-scrape.txt');

// ============================================================================
// RUM API CONFIGURATION
// ============================================================================
// For broken-internal-links audit, ensure RUM_DOMAIN_KEY is available
// SAM's env.json sets Lambda environment variables, but we need to ensure
// they're available in process.env for the RUM API client
if (process.env.RUM_DOMAIN_KEY) {
  console.log('🔧 [LOCAL TEST MODE] RUM_DOMAIN_KEY found in environment');
  console.log(`   Key: ${process.env.RUM_DOMAIN_KEY.substring(0, 8)}...${process.env.RUM_DOMAIN_KEY.slice(-8)}`);
}

// Debug logging
console.log('🔧 [LOCAL TEST MODE] Configuration:');
console.log(`   Config file loaded: ${Object.keys(localConfig).length > 0}`);
console.log(`   USE_LOCAL_SCRAPER_DATA (env): ${process.env.USE_LOCAL_SCRAPER_DATA}`);
console.log(`   USE_LOCAL_SCRAPER_DATA (config): ${localConfig.USE_LOCAL_SCRAPER_DATA}`);
console.log(`   USE_LOCAL_SCRAPER_DATA (final): ${USE_LOCAL_SCRAPER_DATA}`);
console.log(`   USE_LOCAL_TOP_PAGES (env): ${process.env.USE_LOCAL_TOP_PAGES}`);
console.log(`   USE_LOCAL_TOP_PAGES (config): ${localConfig.USE_LOCAL_TOP_PAGES}`);
console.log(`   USE_LOCAL_TOP_PAGES (final): ${USE_LOCAL_TOP_PAGES}`);
console.log(`   TOP_PAGES_FILE (env): ${process.env.TOP_PAGES_FILE}`);
console.log(`   TOP_PAGES_FILE (config): ${localConfig.TOP_PAGES_FILE}`);
console.log(`   TOP_PAGES_FILE (final): ${TOP_PAGES_FILE}`);

// ============================================================================
// MOCK MESSAGE FOR LOCAL TESTING
// ============================================================================
export const main = async () => {
  const messageBody = {
    type: 'meta-tags', // <<-- name of the audit
    siteId: '1db7b770-db7f-4c52-a9dc-6e05add6c11e',

    auditContext: {
      next: 'run-audit-and-generate-suggestions',
      auditId: '00000000-0000-0000-0000-000000000000',
      scrapeJobId: '00000000-0000-0000-0000-000000000000',
    },
  };

  const message = {
    Records: [
      {
        body: JSON.stringify(messageBody),
      },
    ],
  };

  // ============================================================================
  // MOCK CONTEXT FOR LOCAL TESTING
  // ============================================================================
  const context = {
    env: process.env,
    log: {
      info: console.log,
      error: console.error,
      warn: console.warn,
      debug: () => {}, // Disable debug logging
    },
    runtime: {
      region: 'us-east-1',
    },
    func: {
      version: 'latest',
    },
    invocation: {
      event: {
        Records: [{
          body: JSON.stringify(messageBody),
        }],
      },
    },
    // Mock SQS to prevent "QueueDoesNotExist" errors for multi-step audits locally
    sqs: {
      sendMessage: async (queueUrl, payload) => {
        const payloadType = payload?.type || 'unknown';
        
        // Initialize counter if not exists
        if (!context._sqsMessageCounts) {
          context._sqsMessageCounts = new Map();
        }
        
        const currentCount = context._sqsMessageCounts.get(payloadType) || 0;
        context._sqsMessageCounts.set(payloadType, currentCount + 1);
        
        // Only log detailed info for specific payload types or first occurrence
        if (payloadType === 'guidance:broken-links' && payload?.data) {
          // Summary logging for broken-links (useful for debugging)
          const { brokenLinks, alternativeUrls } = payload.data;
          console.log('🔧 [MOCK SQS] Sending broken-links to Mystique AI (suppressed for local testing)');
          console.log(`   📊 Total broken links: ${brokenLinks?.length || 0}`);
          console.log(`   📊 Total alternative URLs: ${alternativeUrls?.length || 0}`);
          
          if (!alternativeUrls || alternativeUrls.length === 0) {
            console.log(`   ⚠️  NO ALTERNATIVE URLs - AI suggestions may be limited!`);
          }
        } else if (currentCount === 0) {
          // First message of this type - log it
          console.log(`🔧 [MOCK SQS] Sending ${payloadType} messages to Mystique AI (suppressed for local testing)`);
        }
        // Subsequent messages of same type are silently counted
        
        // Don't actually send - just return success
        return { MessageId: '00000000-0000-0000-0000-000000000000' };
      },
    },
  };

  // ============================================================================
  // MOCK S3 CLIENT (for local scraper data)
  // ============================================================================
  if (USE_LOCAL_SCRAPER_DATA) {
    console.log('🔧 [LOCAL TEST MODE] Using local scraper data');

    // Path to local scraper results
    // The run-audit-worker.sh script copies scraper data to ./scraper-data/
    // which is accessible inside the Docker container at /var/task/scraper-data/
    const localScraperPath = path.resolve('./scraper-data', messageBody.siteId);

    console.log(`📂 Local scraper path: ${localScraperPath}`);

    // Mock S3Client with local file system operations (AWS SDK v3 pattern)
    context.s3Client = {
      async send(command) {
        if (command instanceof ListObjectsV2Command) {
          const params = command.input;
          console.log('📋 [MOCK S3] ListObjectsV2Command called with:', params);

          try {
            const prefix = params.Prefix || '';
            const prefixPath = path.join(localScraperPath, prefix);

            if (!fs.existsSync(prefixPath)) {
              console.log(`⚠️  [MOCK S3] Directory not found: ${prefixPath}`);
              return { Contents: [] };
            }

            const files = [];
            const walkDir = (dir, basePath = '') => {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relativePath = path.join(basePath, entry.name);

                if (entry.isDirectory()) {
                  walkDir(fullPath, relativePath);
                } else {
                  files.push({
                    Key: path.join(prefix, relativePath),
                    Size: fs.statSync(fullPath).size,
                    LastModified: fs.statSync(fullPath).mtime,
                  });
                }
              }
            };

            walkDir(prefixPath);
            console.log(`✅ [MOCK S3] Found ${files.length} files`);

            return { Contents: files };
          } catch (error) {
            console.error('❌ [MOCK S3] Error listing files:', error.message);
            return { Contents: [] };
          }
        }

        if (command instanceof GetObjectCommand) {
          const params = command.input;
          console.log('📥 [MOCK S3] GetObjectCommand called with Key:', params.Key);

          try {
            // Remove the scrapes/siteId/ prefix from the key
            const keyWithoutPrefix = params.Key.replace(`scrapes/${messageBody.siteId}/`, '');
            const filePath = path.join(localScraperPath, keyWithoutPrefix);

            console.log(`   Reading from: ${filePath}`);

            if (!fs.existsSync(filePath)) {
              const error = new Error(`File not found: ${filePath}`);
              error.name = 'NoSuchKey';
              throw error;
            }

            const body = fs.readFileSync(filePath, 'utf8');
            console.log(`✅ [MOCK S3] Read file: ${filePath} (${body.length} bytes)`);

            // Return AWS SDK v3 format with ContentType header
            return {
              Body: {
                transformToString: async () => body,
              },
              ContentType: filePath.endsWith('.json') ? 'application/json' : 'text/plain',
              $metadata: {
                httpStatusCode: 200,
              },
            };
          } catch (error) {
            console.error('❌ [MOCK S3] Error reading file:', error.message);
            throw error;
          }
        }

        throw new Error(`[MOCK S3] Unsupported command: ${command.constructor.name}`);
      },
    };

    // Provide scrape result paths for multi-step audits
    // Recursively walk the directory tree to find all scrape files
    // scrapeResultPaths should be a Map<url, s3Path> where s3Path points to scrape.json
    try {
      const scrapeFilePaths = [];

      // Check if directory exists
      if (!fs.existsSync(localScraperPath)) {
        console.warn(`⚠️  [LOCAL TEST MODE] Scraper directory not found: ${localScraperPath}`);
        console.warn('   Checking parent directory...');
        const parentDir = path.dirname(localScraperPath);
        if (fs.existsSync(parentDir)) {
          const contents = fs.readdirSync(parentDir);
          console.warn(`   Parent directory contents: ${contents.join(', ')}`);
        } else {
          console.warn(`   Parent directory also not found: ${parentDir}`);
        }
      } else {
        console.log(`✅ [LOCAL TEST MODE] Scraper directory exists: ${localScraperPath}`);

        const walkDir = (dir, relativePath = '') => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

            if (entry.isDirectory()) {
              walkDir(fullPath, relPath);
            } else if (entry.isFile()) {
              // Only include scrape.json files (not screenshots)
              if (entry.name === 'scrape.json') {
                scrapeFilePaths.push(relPath);
              }
            }
          }
        };

        walkDir(localScraperPath);
      }

      console.log(`📂 [LOCAL TEST MODE] Found ${scrapeFilePaths.length} scrape.json files`);

      // Convert array of paths to Map<url, path>
      // Extract base URL from config or use fallback
      let baseURL = 'https://example.com';
      if (USE_LOCAL_TOP_PAGES && fs.existsSync(TOP_PAGES_FILE)) {
        try {
          const urlsContent = fs.readFileSync(TOP_PAGES_FILE, 'utf8');
          const urls = urlsContent.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
          if (urls.length > 0) {
            const url = new URL(urls[0]);
            baseURL = `${url.protocol}//${url.hostname}`;
          }
        } catch (e) {
          console.warn(`⚠️  Could not extract baseURL from ${TOP_PAGES_FILE}, using fallback`);
        }
      }

      // Create Map with URL as key and scrape.json path as value
      context.scrapeResultPaths = new Map();
      for (const filePath of scrapeFilePaths) {
        // Convert file path to URL path (remove /scrape.json)
        const urlPath = filePath.replace(/\/scrape\.json$/, '');
        const fullUrl = `${baseURL}/${urlPath}`;
        context.scrapeResultPaths.set(fullUrl, filePath);
      }

      console.log(`📂 [LOCAL TEST MODE] Created scrapeResultPaths Map with ${context.scrapeResultPaths.size} entries`);
    } catch (error) {
      console.error('❌ [LOCAL TEST MODE] Error loading scrape result paths:', error.message);
      console.error(error.stack);
      context.scrapeResultPaths = new Map();
    }
  }

  // ============================================================================
  // MOCK DYNAMODB TOP PAGES (for canonical/hreflang audits)
  // ============================================================================
  if (USE_LOCAL_TOP_PAGES) {
    console.log('🔧 [LOCAL TEST MODE] Using local top pages from urls-to-scrape.txt');

    // Use container path instead of local filesystem path
    const containerTopPagesPath = '/var/task/urls-to-scrape.txt';
    console.log(`📂 Top pages file (container path): ${containerTopPagesPath}`);

    try {
      const urlsContent = fs.readFileSync(containerTopPagesPath, 'utf8');
      const localTopPagesUrls = urlsContent
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));

      console.log(`✅ [LOCAL TEST MODE] Loaded ${localTopPagesUrls.length} URLs from ${containerTopPagesPath}`);

      // Mock dataAccess for SiteTopPage and Site
      if (!context.dataAccess) {
        context.dataAccess = {};
      }

      // Mock Site.findById
      context.dataAccess.Site = {
        findById: async (siteId) => {
          console.log(`🔧 [MOCK DynamoDB] Site.findById called with siteId: ${siteId}`);

          // Extract base URL from the first URL in the list
          let baseURL = 'https://example.com';
          if (localTopPagesUrls.length > 0) {
            try {
              const url = new URL(localTopPagesUrls[0]);
              baseURL = `${url.protocol}//${url.hostname}`;
            } catch (e) {
              console.warn(`⚠️  Could not parse URL: ${localTopPagesUrls[0]}`);
            }
          }

          return {
            getId: () => siteId,
            getBaseURL: () => baseURL,
            getDeliveryType: () => 'aem_edge',
            getGitHubURL: () => null,
            getOrganizationId: () => '00000000-0000-0000-0000-000000000000',
            getIsLive: () => true,
            getConfig: () => ({
              getFetchConfig: () => ({
                overrideBaseURL: null,
              }),
            }),
            getAudits: () => ({}),
          };
        },
      };

      // Mock SiteTopPage.allBySiteIdAndSourceAndGeo
      context.dataAccess.SiteTopPage = {
        allBySiteIdAndSourceAndGeo: async (siteId, source, geo) => {
          console.log('🔧 [MOCK DynamoDB] SiteTopPage.allBySiteIdAndSourceAndGeo called');
          console.log(`   siteId: ${siteId}, source: ${source}, geo: ${geo}`);
          console.log(`   Returning ${localTopPagesUrls.length} URLs from local file`);

          return localTopPagesUrls.map((url, index) => ({
            getURL: () => url,
            getUrl: () => url,
            getSiteId: () => siteId,
            getSource: () => source || 'rum',
            getGeo: () => geo || 'global',
            getTraffic: () => 100 - index, // Mock decreasing traffic
            getTopKeyword: () => null,
            getImportedAt: () => new Date().toISOString(),
          }));
        },
      };

      // Mock Audit data access to bypass audit enablement checks
      context.dataAccess.Audit = {
        findLatest: async () => {
          console.log('🔧 [MOCK DynamoDB] Audit.findLatest called - returning null (audit enabled)');
          return null;
        },
        allBySiteIdAndAuditType: async () => {
          console.log('🔧 [MOCK DynamoDB] Audit.allBySiteIdAndAuditType called - returning empty array');
          return [];
        },
        create: async (auditData) => {
          console.log('🔧 [MOCK DynamoDB] Audit.create called - simulating save');
          console.log(`   Audit type: ${auditData.auditType}`);
          console.log(`   Site ID: ${auditData.siteId}`);
          console.log(`   Score: ${auditData.fullAuditRef ? 'N/A (full audit)' : auditData.scores?.totalScore || 'N/A'}`);

          // Log the full audit data with all details
          console.log('\n');
          console.log('═══════════════════════════════════════════════════════════');
          console.log('📊 AUDIT DATA BEING SAVED TO DYNAMODB (MOCKED)');
          console.log('═══════════════════════════════════════════════════════════');
          console.log(JSON.stringify(auditData, null, 2));
          console.log('═══════════════════════════════════════════════════════════');
          console.log('\n');

          // Return a mock audit object
          return {
            getId: () => '00000000-0000-0000-0000-000000000000',
            getSiteId: () => auditData.siteId,
            getAuditType: () => auditData.auditType,
            getAuditedAt: () => new Date().toISOString(),
            getScores: () => auditData.scores || {},
            getFullAuditRef: () => auditData.fullAuditRef || null,
          };
        },
      };

      // Mock Opportunity data access for post-processing
      context.dataAccess.Opportunity = {
        allBySiteIdAndStatus: async () => {
          console.log('🔧 [MOCK DynamoDB] Opportunity.allBySiteIdAndStatus called');
          console.log('   Returning empty array (no existing opportunities)');
          return [];
        },
        create: async (opportunityData) => {
          console.log('🔧 [MOCK DynamoDB] Opportunity.create called - simulating save');
          console.log(`   Type: ${opportunityData.type}`);
          console.log(`   Site ID: ${opportunityData.siteId}`);

          const mockOpportunity = {
            getId: () => '00000000-0000-0000-0000-000000000001',
            getSiteId: () => opportunityData.siteId,
            getType: () => opportunityData.type,
            getStatus: () => opportunityData.status || 'NEW',
            getData: () => opportunityData.data || {},
            getSuggestions: () => opportunityData.suggestions || [],
            getTitle: () => opportunityData.title || '',
            getDescription: () => opportunityData.description || '',
            getGuidance: () => opportunityData.guidance || {},
            getTags: () => opportunityData.tags || [],
            addSuggestions: async (suggestions) => {
              console.log('🔧 [MOCK DynamoDB] Opportunity.addSuggestions called');
              console.log(`   Adding ${suggestions?.length || 0} suggestions`);
              
              // Log suggestions in a readable format
              if (suggestions && suggestions.length > 0) {
                console.log('\n');
                console.log('═══════════════════════════════════════════════════════════');
                console.log('💡 SUGGESTIONS BEING ADDED');
                console.log('═══════════════════════════════════════════════════════════');
                console.log(JSON.stringify(suggestions, null, 2));
                console.log('═══════════════════════════════════════════════════════════');
                console.log('\n');
              }
              
              // Return suggestion objects with getId() and getData() methods
              // The handler needs these to build the Mystique payload
              const suggestionObjects = suggestions.map((suggestion, index) => ({
                getId: () => `suggestion-${index + 1}`,
                getData: () => suggestion.data || {},
                getStatus: () => suggestion.status || 'NEW',
                getType: () => suggestion.type || 'CONTENT_UPDATE',
                getRank: () => suggestion.rank || 100,
              }));
              
              // Cache suggestions so Suggestion.allByOpportunityIdAndStatus can return them
              const oppId = mockOpportunity.getId();
              suggestionCache.set(oppId, suggestionObjects);
              console.log(`   💾 Cached ${suggestionObjects.length} suggestions for opportunity ${oppId}`);
              
              return suggestionObjects;
            },
            save: async () => {
              console.log('🔧 [MOCK DynamoDB] Opportunity.save called');
              return mockOpportunity;
            },
          };

          return mockOpportunity;
        },
        createOrUpdate: async (opportunityData) => {
          console.log('🔧 [MOCK DynamoDB] Opportunity.createOrUpdate called - simulating save');
          return {
            getId: () => '00000000-0000-0000-0000-000000000001',
            getSiteId: () => opportunityData.siteId,
            getType: () => opportunityData.type,
            getSuggestions: () => opportunityData.suggestions || [],
          };
        },
      };
    } catch (error) {
      console.error('❌ [LOCAL TEST MODE] Could not load top pages:', error.message);
      console.error('   Make sure urls-to-scrape.txt exists and is readable');
    }
  }

  // ============================================================================
  // MOCK RUM API CLIENT (for broken-internal-links audit)
  // ============================================================================
  // IMPORTANT: The RUM API client expects 'domainkey' to be passed in query OPTIONS,
  // not in process.env! We need to inject it into all RUM queries.
  if (process.env.RUM_DOMAIN_KEY && !context.rumApiClient) {
    console.log('🔧 [LOCAL TEST MODE] Creating mock RUM API client with domain key injection');
    
    // Create a mock RUM API client that automatically injects the domain key
    context.rumApiClient = {
      query: async (queryName, options) => {
        console.log(`🔧 [MOCK RUM] Query '${queryName}' called with options:`, JSON.stringify(options));
        
        // Inject the domain key into options
        const optionsWithKey = {
          ...options,
          domainkey: process.env.RUM_DOMAIN_KEY,
        };
        
        console.log(`🔧 [MOCK RUM] Injected domainkey into options`);
        
        // Now call the real RUM API client with the injected key
        // We need to import it dynamically
        const { default: RUMAPIClient } = await import('@adobe/spacecat-shared-rum-api-client');
        const realClient = new RUMAPIClient({}, context.log || console);
        
        return realClient.query(queryName, optionsWithKey);
      },
      queryMulti: async (queries, options) => {
        console.log(`🔧 [MOCK RUM] QueryMulti called with ${queries.length} queries`);
        
        // Inject the domain key into options
        const optionsWithKey = {
          ...options,
          domainkey: process.env.RUM_DOMAIN_KEY,
        };
        
        console.log(`🔧 [MOCK RUM] Injected domainkey into options`);
        
        // Now call the real RUM API client with the injected key
        const { default: RUMAPIClient } = await import('@adobe/spacecat-shared-rum-api-client');
        const realClient = new RUMAPIClient({}, context.log || console);
        
        return realClient.queryMulti(queries, optionsWithKey);
      },
      retrieveDomainkey: async (domain) => {
        console.log(`🔧 [MOCK RUM] retrieveDomainkey called for domain: ${domain}`);
        console.log(`🔧 [MOCK RUM] Returning injected domain key`);
        return process.env.RUM_DOMAIN_KEY;
      },
    };
    
    console.log('✅ [MOCK RUM] RUM API client mock installed with automatic domain key injection');
  }

  // ============================================================================
  // MOCK GENVAR AI CLIENT (for meta-tags audit)
  // ============================================================================
  // The GenvarClient is used by the meta-tags audit to generate AI suggestions.
  // Since the Genvar API requires presigned S3 URLs (which don't work locally),
  // we mock the client to return empty suggestions, similar to Mystique AI.
  if (!context.genvarClient) {
    console.log('🔧 [LOCAL TEST MODE] Creating mock Genvar AI client');
    context.genvarClient = {
      generateSuggestions: async (requestBody, endpoint) => {
        console.log('🔧 [MOCK GENVAR] generateSuggestions called');
        console.log(`   Endpoint: ${endpoint}`);
        console.log(`   ℹ️  AI suggestions are not available for local testing`);
        console.log(`   ℹ️  Returning original detected tags without AI enhancements`);
        
        // Parse the request body to extract detectedTags
        let parsedBody;
        try {
          parsedBody = JSON.parse(requestBody);
        } catch (e) {
          console.error('❌ [MOCK GENVAR] Could not parse request body:', e.message);
          return {};
        }
        
        // Return the detected tags structure without AI suggestions
        // This allows the audit to complete without external AI service
        const { detectedTags } = parsedBody;
        
        // Convert presigned URLs back to endpoint keys
        const result = {};
        for (const [endpoint, presignedUrl] of Object.entries(detectedTags || {})) {
          // Return empty tags structure for each endpoint
          result[endpoint] = {};
        }
        
        console.log(`   Returning empty suggestions for ${Object.keys(result).length} endpoints`);
        return result;
      },
    };
    
    console.log('✅ [MOCK GENVAR] Genvar AI client mock installed (returns empty suggestions)');
  }

  // ============================================================================
  // MOCK SITE DATA ACCESS (fallback for audits not using local top pages)
  // ============================================================================
  if (!context.dataAccess) {
    context.dataAccess = {};
  }

  if (!context.dataAccess.Site) {
    console.log('🔧 [LOCAL TEST MODE] Adding fallback Site mock');
    context.dataAccess.Site = {
      findById: async (siteId) => {
        console.log(`🔧 [MOCK DynamoDB] Site.findById called with siteId: ${siteId}`);

        // Map known site IDs to their base URLs
        const siteUrlMap = {
          '1db7b770-db7f-4c52-a9dc-6e05add6c11e': 'https://www.asianpaints.com',
          'cccdac43-1a22-4659-9086-b762f59b9928': 'https://www.bulk.com',
        };
        
        const baseURL = siteUrlMap[siteId] || 'https://example.com';
        console.log(`   Using base URL: ${baseURL}`);

        return {
          getId: () => siteId,
          getBaseURL: () => baseURL,
          getDeliveryType: () => 'aem_edge',
          getGitHubURL: () => null,
          getOrganizationId: () => '00000000-0000-0000-0000-000000000000',
          getIsLive: () => true,
          getConfig: () => ({
            getFetchConfig: () => ({
              overrideBaseURL: null,
            }),
          }),
          getAudits: () => ({}),
        };
      },
    };
  }

  // Mock Audit data access to bypass audit enablement checks
  if (!context.dataAccess.Audit) {
    console.log('🔧 [LOCAL TEST MODE] Adding Audit mock to bypass enablement checks');
    context.dataAccess.Audit = {
      findLatest: async () => {
        console.log('🔧 [MOCK DynamoDB] Audit.findLatest called - returning null (audit enabled)');
        return null;
      },
      allBySiteIdAndAuditType: async () => {
        console.log('🔧 [MOCK DynamoDB] Audit.allBySiteIdAndAuditType called - returning empty array');
        return [];
      },
      create: async (auditData) => {
        console.log('🔧 [MOCK DynamoDB] Audit.create called - simulating save');
        console.log(`   Audit type: ${auditData.auditType}`);
        console.log(`   Site ID: ${auditData.siteId}`);

        // For broken-internal-links, extract and log the broken links data from auditResult
        // (This is where the actual data is stored, NOT in the SQS continuation message)
        if (auditData.auditType === 'broken-internal-links' && auditData.auditResult) {
          const brokenLinks = auditData.auditResult.brokenInternalLinks || [];
          console.log('');
          console.log('═══════════════════════════════════════════════════════════════');
          console.log('🔍 BROKEN INTERNAL LINKS DATA (from Audit Record)');
          console.log('═══════════════════════════════════════════════════════════════');
          console.log(`Total broken links found: ${brokenLinks.length}`);
          if (brokenLinks.length > 0) {
            console.log('');
            console.log('Broken Links Data (JSON):');
            console.log(JSON.stringify({ brokenInternalLinks: brokenLinks }, null, 2));
          } else {
            console.log('✅ Site is healthy - no broken internal links detected!');
          }
          console.log('═══════════════════════════════════════════════════════════════');
          console.log('');
        }

        return {
          getId: () => '00000000-0000-0000-0000-000000000000',
          getSiteId: () => auditData.siteId,
          getAuditType: () => auditData.auditType,
          getAuditedAt: () => new Date().toISOString(),
          getScores: () => auditData.scores || {},
          getFullAuditRef: () => auditData.fullAuditRef || null,
          getAuditResult: () => auditData.auditResult || {},
        };
      },
      findById: async (auditId) => {
        console.log('🔧 [MOCK DynamoDB] Audit.findById called');
        console.log(`   Audit ID: ${auditId}`);
        
        // For Step 2 of broken-internal-links, load the data from the JSON file
        // created by fetch-broken-links.sh
        try {
          const fs = await import('fs');
          const path = await import('path');
          
          // Get the site ID from config
          const configPath = '/var/task/local-config.json';
          let siteId = null;
          
          if (fs.existsSync(configPath)) {
            const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            siteId = configData.siteId;
          }
          
          if (!siteId) {
            console.warn('⚠️ [MOCK] Could not find siteId in local-config.json');
            return null;
          }
          
          // Look for the broken links JSON file
          const jsonFileName = `broken-links-${siteId}.json`;
          const jsonPath = path.resolve('/var/task', '..', '..', 'my-workspace-tools', jsonFileName);
          
          console.log(`   Looking for broken links data: ${jsonFileName}`);
          
          if (fs.existsSync(jsonPath)) {
            const auditResult = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            console.log(`✅ [MOCK] Loaded broken links data from ${jsonFileName}`);
            console.log(`   Total broken links: ${auditResult.brokenInternalLinks?.length || 0}`);
            
            return {
              getId: () => auditId,
              getSiteId: () => siteId,
              getAuditType: () => 'broken-internal-links',
              getAuditedAt: () => new Date().toISOString(),
              getScores: () => ({}),
              getFullAuditRef: () => null,
              getAuditResult: () => auditResult,
            };
          } else {
            console.warn(`⚠️ [MOCK] Broken links JSON file not found: ${jsonPath}`);
            return null;
          }
        } catch (error) {
          console.error(`❌ [MOCK] Error loading audit data: ${error.message}`);
          return null;
        }
      },
    };
  }

  // Mock SiteTopPage for broken-internal-links suggestions
  if (!context.dataAccess.SiteTopPage) {
    console.log('🔧 [LOCAL TEST MODE] Adding SiteTopPage mock');
    context.dataAccess.SiteTopPage = {
      allBySiteIdAndSourceAndGeo: async (siteId, source, geo) => {
        console.log('🔧 [MOCK DynamoDB] SiteTopPage.allBySiteIdAndSourceAndGeo called');
        console.log(`   siteId: ${siteId}, source: ${source}, geo: ${geo}`);
        
        // Try to load top pages from local file (even if USE_LOCAL_TOP_PAGES is false)
        try {
          const topPagesPath = '/var/task/urls-to-scrape.txt';
          if (fs.existsSync(topPagesPath)) {
            const urlsContent = fs.readFileSync(topPagesPath, 'utf8');
            const localTopPagesUrls = urlsContent
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line && !line.startsWith('#'));
            
            console.log(`   ✅ Loaded ${localTopPagesUrls.length} URLs from ${topPagesPath}`);
            
            return localTopPagesUrls.map((url, index) => ({
              getURL: () => url,
              getUrl: () => url,
              getSiteId: () => siteId,
              getSource: () => source || 'rum',
              getGeo: () => geo || 'global',
              getTraffic: () => 1000 - index, // Mock traffic, decreasing by index
            }));
          }
        } catch (error) {
          console.warn(`   ⚠️  Could not load top pages: ${error.message}`);
        }
        
        console.log('   Returning empty array (no top pages file found)');
        return [];
      },
    };
  }

  // Mock Opportunity data access for post-processing
  if (!context.dataAccess.Opportunity) {
    console.log('🔧 [LOCAL TEST MODE] Adding Opportunity mock');
    context.dataAccess.Opportunity = {
      allBySiteIdAndStatus: async () => {
        console.log('🔧 [MOCK DynamoDB] Opportunity.allBySiteIdAndStatus - returning empty array');
        return [];
      },
      create: async (opportunityData) => {
        console.log('🔧 [MOCK DynamoDB] Opportunity.create called');
        const mockOpportunity = {
          getId: () => '00000000-0000-0000-0000-000000000001',
          getSiteId: () => opportunityData.siteId,
          getType: () => opportunityData.type,
          getSuggestions: () => opportunityData.suggestions || [],
          getData: () => opportunityData.data || {},
          addSuggestions: async (suggestions) => {
            console.log('🔧 [MOCK DynamoDB] Opportunity.addSuggestions called');
            console.log(`   Adding ${suggestions?.length || 0} suggestions`);
            
            // Log suggestions in a readable format
            if (suggestions && suggestions.length > 0) {
              console.log('\n');
              console.log('═══════════════════════════════════════════════════════════');
              console.log('💡 SUGGESTIONS BEING ADDED');
              console.log('═══════════════════════════════════════════════════════════');
              console.log(JSON.stringify(suggestions, null, 2));
              console.log('═══════════════════════════════════════════════════════════');
              console.log('\n');
            }
            
            // Return suggestion objects with getId() and getData() methods
            // The handler needs these to build the Mystique payload
            const suggestionObjects = suggestions.map((suggestion, index) => ({
              getId: () => `suggestion-${index + 1}`,
              getData: () => suggestion.data || {},
              getStatus: () => suggestion.status || 'NEW',
              getType: () => suggestion.type || 'CONTENT_UPDATE',
              getRank: () => suggestion.rank || 100,
            }));
            
            // Cache suggestions so Suggestion.allByOpportunityIdAndStatus can return them
            const oppId = mockOpportunity.getId();
            suggestionCache.set(oppId, suggestionObjects);
            console.log(`   💾 Cached ${suggestionObjects.length} suggestions for opportunity ${oppId}`);
            
            return suggestionObjects;
          },
          save: async () => {
            console.log('🔧 [MOCK DynamoDB] Opportunity.save called');
            return mockOpportunity;
          },
        };
        return mockOpportunity;
      },
      createOrUpdate: async (opportunityData) => {
        console.log('🔧 [MOCK DynamoDB] Opportunity.createOrUpdate called');
        return {
          getId: () => '00000000-0000-0000-0000-000000000001',
          getSiteId: () => opportunityData.siteId,
          getSuggestions: () => opportunityData.suggestions || [],
        };
      },
    };
  }

  // Mock Configuration to bypass feature flag checks
  if (!context.dataAccess.Configuration) {
    console.log('🔧 [LOCAL TEST MODE] Adding Configuration mock');
    context.dataAccess.Configuration = {
      findLatest: async () => {
        console.log('🔧 [MOCK DynamoDB] Configuration.findLatest - returning mock config');
        return {
          getHandlers: () => {
            console.log('🔧 [MOCK DynamoDB] Configuration.getHandlers - returning handlers with productCodes');
            // The audit-utils.js logic is:
            // if (isNonEmptyArray(handler?.productCodes)) {
            //   check entitlements (needs Organization/Entitlement mocks)
            // } else {
            //   return false  // FAILS!
            // }
            // 
            // So we MUST return handlers with productCodes array
            // AND have working Organization/Entitlement mocks
            return {
              'broken-internal-links': { productCodes: ['ASO'] },
              'canonical': { productCodes: ['ASO'] },
              'hreflang': { productCodes: ['ASO'] },
              'meta-tags': { productCodes: ['ASO'] },
              'product-metatags': { productCodes: ['ASO'] },
              'structured-data': { productCodes: ['ASO'] },
              'sitemap': { productCodes: ['ASO'] },
              'redirect-chains': { productCodes: ['ASO'] },
            };
          },
          isHandlerEnabledForSite: (type, site) => {
            console.log(`🔧 [MOCK DynamoDB] Configuration.isHandlerEnabledForSite('${type}') - returning true (enabled)`);
            return true;
          },
        };
      },
    };

    console.log('🔧 [LOCAL TEST MODE] Adding Suggestion mock');
    context.dataAccess.Suggestion = {
      STATUSES: {
        NEW: 'NEW',
        APPROVED: 'APPROVED',
        IN_PROGRESS: 'IN_PROGRESS',
        SKIPPED: 'SKIPPED',
        FIXED: 'FIXED',
        ERROR: 'ERROR',
        OUTDATED: 'OUTDATED',
      },
      allByOpportunityIdAndStatus: async (opportunityId, status) => {
        console.log('🔧 [MOCK DynamoDB] Suggestion.allByOpportunityIdAndStatus called');
        console.log(`   opportunityId: ${opportunityId}, status: ${status}`);
        
        // Return cached suggestions if available
        if (suggestionCache.has(opportunityId)) {
          const cached = suggestionCache.get(opportunityId);
          console.log(`   📦 Returning ${cached.length} cached suggestions from opportunity ${opportunityId}`);
          return cached;
        }
        
        console.log('   ⚠️  No cached suggestions found, returning empty array');
        return [];
      },
    };

    console.log('🔧 [LOCAL TEST MODE] Adding Organization mock');
    context.dataAccess.Organization = {
      findById: async (organizationId) => {
        console.log('🔧 [MOCK DynamoDB] Organization.findById called');
        console.log(`   organizationId: ${organizationId}`);
        console.log('   Returning mock organization (for entitlement check)');
        return {
          getId: () => organizationId,
          getName: () => 'Mock Organization',
          getImsOrgId: () => 'mock-ims-org-id@AdobeOrg',
        };
      },
    };

    console.log('🔧 [LOCAL TEST MODE] Adding Entitlement mock');
    context.dataAccess.Entitlement = {
      PRODUCT_CODES: {
        ASO: 'ASO',
      },
      TIERS: {
        FREE: 'FREE',
        PAID: 'PAID',
      },
      findByOrganizationIdAndProductCode: async (organizationId, productCode) => {
        console.log('🔧 [MOCK DynamoDB] Entitlement.findByOrganizationIdAndProductCode called');
        console.log(`   organizationId: ${organizationId}, productCode: ${productCode}`);
        console.log('   Returning mock entitlement (PAID tier)');
        return {
          getId: () => '00000000-0000-0000-0000-000000000002',
          getOrganizationId: () => organizationId,
          getProductCode: () => productCode,
          getTier: () => 'PAID',
          getCreatedAt: () => new Date().toISOString(),
          getUpdatedAt: () => new Date().toISOString(),
        };
      },
    };

    console.log('🔧 [LOCAL TEST MODE] Adding SiteEnrollment mock');
    context.dataAccess.SiteEnrollment = {
      allBySiteId: async (siteId) => {
        console.log('🔧 [MOCK DynamoDB] SiteEnrollment.allBySiteId called');
        console.log(`   siteId: ${siteId}`);
        console.log('   Returning mock site enrollment (PAID tier)');
        return [{
          getId: () => '00000000-0000-0000-0000-000000000003',
          getSiteId: () => siteId,
          getEntitlementId: () => '00000000-0000-0000-0000-000000000002', // Must match Entitlement ID
          getProductCode: () => 'ASO',
          getTier: () => 'PAID',
          getStatus: () => 'ACTIVE',
          getCreatedAt: () => new Date().toISOString(),
          getUpdatedAt: () => new Date().toISOString(),
        }];
      },
    };
  }

  // Note: We don't need to mock ScrapeJob or ScrapeResult because the run-audit-worker.sh
  // script patches step-audit.js to bypass getScrapeResultPaths() entirely and use
  // context.scrapeResultPaths directly (which we populate above from local files)

  // ============================================================================
  // PROXY CONTEXT TO INTERCEPT dataAccess INITIALIZATION
  // ============================================================================
  // The dataAccess wrapper from @adobe/spacecat-shared-data-access will replace
  // context.dataAccess entirely. We use a Proxy to intercept this and add our mocks.
  const contextProxy = new Proxy(context, {
    set(target, property, value) {
      if (property === 'dataAccess' && value) {
        console.log('🔧 [LOCAL TEST MODE] Intercepted dataAccess initialization, adding mocks');
        
        // Add Organization mock if it doesn't exist
        if (!value.Organization) {
          console.log('🔧 [LOCAL TEST MODE] Adding Organization mock');
          value.Organization = {
            findById: async (organizationId) => {
              console.log('🔧 [MOCK DynamoDB] Organization.findById called');
              console.log(`   organizationId: ${organizationId}`);
              console.log('   Returning mock organization (for entitlement check)');
              return {
                getId: () => organizationId,
                getName: () => 'Mock Organization',
                getImsOrgId: () => 'mock-ims-org-id@AdobeOrg',
              };
            },
          };
        }
        
        // Add Entitlement mock if it doesn't exist
        if (!value.Entitlement) {
          console.log('🔧 [LOCAL TEST MODE] Adding Entitlement mock');
          value.Entitlement = {
            PRODUCT_CODES: {
              ASO: 'ASO',
            },
            TIERS: {
              FREE: 'FREE',
              PAID: 'PAID',
            },
            findByOrganizationIdAndProductCode: async (organizationId, productCode) => {
              console.log('🔧 [MOCK DynamoDB] Entitlement.findByOrganizationIdAndProductCode called');
              console.log(`   organizationId: ${organizationId}, productCode: ${productCode}`);
              console.log('   Returning null (no entitlement - will bypass checks)');
              return null;
            },
          };
        }
      }
      
      // Set the property normally
      target[property] = value;
      return true;
    },
  });

  // ============================================================================
  // RUN AUDIT
  // ============================================================================
  const result = await universalMain(message, contextProxy);
  return result;
};
