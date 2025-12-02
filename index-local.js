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
// SUPPRESS X-RAY TRACING ERRORS IN LOCAL MODE
// ============================================================================
// AWS X-Ray is not available locally, so we disable it entirely
// This prevents X-Ray SDK from auto-instrumenting AWS SDK and other libraries
process.env.AWS_XRAY_CONTEXT_MISSING = 'IGNORE_ERROR';
process.env.AWS_XRAY_SDK_ENABLED = 'false';
process.env._X_AMZN_TRACE_ID = '';

// Monkey-patch console.error to filter out X-Ray noise
const originalConsoleError = console.error;
console.error = (...args) => {
  // Filter out X-Ray trace data errors
  const message = args[0]?.message || args[0] || '';
  if (typeof message === 'string' && message.includes('Missing AWS Lambda trace data for X-Ray')) {
    return; // Silently ignore X-Ray errors
  }
  // Also check if it's an Error object with X-Ray message
  if (args[0] instanceof Error && args[0].message?.includes('Missing AWS Lambda trace data for X-Ray')) {
    return; // Silently ignore X-Ray errors
  }
  // Pass through all other errors
  originalConsoleError.apply(console, args);
};

console.log('🔧 [LOCAL TEST MODE] X-Ray tracing disabled and error logging filtered');

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
            addSuggestions: async () => {
              console.log('🔧 [MOCK DynamoDB] Opportunity.addSuggestions called');
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

        return {
          getId: () => siteId,
          getBaseURL: () => 'https://example.com',
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
          addSuggestions: async () => {
            console.log('🔧 [MOCK DynamoDB] Opportunity.addSuggestions called');
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
  }

  // ============================================================================
  // RUN AUDIT WITH DATA ACCESS MOCKING
  // ============================================================================
  // Store our mocks before universalMain initializes the real dataAccess
  const mockDataAccess = context.dataAccess;

  // Create a proxy to preserve our mocks when dataAccess is set by wrappers
  const contextProxy = new Proxy(context, {
    // eslint-disable-next-line no-param-reassign
    set(target, prop, value) {
      if (prop === 'dataAccess' && mockDataAccess) {
        // The wrapper is setting dataAccess - merge our mocks into it
        console.log('🔧 [LOCAL TEST MODE] Merging mocks into real dataAccess');

        // Wrap the Audit methods to use our mocks
        if (mockDataAccess.Audit) {
          const originalAudit = value.Audit;
          // eslint-disable-next-line no-param-reassign
          value.Audit = {
            ...originalAudit,
            findLatest: async (...args) => {
              console.log('🔧 [MOCK DynamoDB] Audit.findLatest intercepted - returning null');
              return mockDataAccess.Audit.findLatest(...args);
            },
            allBySiteIdAndAuditType: async (...args) => {
              console.log('🔧 [MOCK DynamoDB] Audit.allBySiteIdAndAuditType intercepted');
              return mockDataAccess.Audit.allBySiteIdAndAuditType(...args);
            },
          };
        }

        // Wrap SiteTopPage if we have a mock
        if (mockDataAccess.SiteTopPage) {
          // eslint-disable-next-line no-param-reassign
          value.SiteTopPage = mockDataAccess.SiteTopPage;
        }

        // Wrap Site if we have a mock
        if (mockDataAccess.Site) {
          // eslint-disable-next-line no-param-reassign
          value.Site = mockDataAccess.Site;
        }
      }
      // eslint-disable-next-line no-param-reassign
      target[prop] = value;
      return true;
    },
  });

  const result = await universalMain(message, contextProxy);
  return result;
};
