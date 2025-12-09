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

    console.log(`📂 Top pages file: ${TOP_PAGES_FILE}`);

    try {
      const urlsContent = fs.readFileSync(TOP_PAGES_FILE, 'utf8');
      const localTopPagesUrls = urlsContent
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));

      console.log(`✅ [LOCAL TEST MODE] Loaded ${localTopPagesUrls.length} URLs from ${TOP_PAGES_FILE}`);

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
              
              // Just return the mock opportunity with updated suggestions
              return mockOpportunity;
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
            
            return mockOpportunity;
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
          isHandlerEnabledForSite: () => {
            console.log('🔧 [MOCK DynamoDB] Configuration.isHandlerEnabledForSite - returning false (skip auto-suggest)');
            return false;
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
        console.log('   Returning empty array (SQS sending skipped for local testing)');
        return [];
      },
    };

    // Note: Organization and Entitlement mocks are now added via Proxy intercept
    // at the bottom of this file, after dataAccess is initialized by the wrapper
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
