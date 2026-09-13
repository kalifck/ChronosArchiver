/**
 * db.js
 * Dexie.js database schema and queries for ChronosArchiver.
 * This file is loaded in background.js, options.js, dashboard.js, and import-worker.js.
 * Assumes Dexie.js is already loaded in the global scope.
 */

const db = new Dexie('LocalHistoryDB');

// Declare schema (Version 1, 2, and 3 for seamless migrations)
db.version(1).stores({
    visits: '++id, url, domain, timestamp, title, *keywords, [timestamp+domain], [url+timestamp]'
});

db.version(2).stores({
    visits: '++id, url, domain, timestamp, title, searchQuery, *keywords, [timestamp+domain], [url+timestamp]'
});

db.version(3).stores({
    visits: '++id, url, domain, timestamp, title, searchQuery, *keywords, [timestamp+domain], [url+timestamp]',
    meta: 'key'
});

/**
 * Extracts exact search query keywords from search engines and platform search URLs.
 * @param {string} urlStr 
 * @returns {string|null}
 */
function extractSearchQuery(urlStr) {
    if (!urlStr) return null;
    try {
        const url = new URL(urlStr);
        const host = url.hostname.toLowerCase();
        
        // Google Search
        if (host.includes('google.') && url.searchParams.has('q')) {
            return url.searchParams.get('q').trim();
        }
        // YouTube Search
        if (host.includes('youtube.com') && url.searchParams.has('search_query')) {
            return url.searchParams.get('search_query').trim();
        }
        // Bing Search
        if (host.includes('bing.com') && url.searchParams.has('q')) {
            return url.searchParams.get('q').trim();
        }
        // DuckDuckGo Search
        if ((host.includes('duckduckgo.com') || host.includes('ddg.gg')) && url.searchParams.has('q')) {
            return url.searchParams.get('q').trim();
        }
        // Yahoo Search
        if (host.includes('yahoo.com') && url.searchParams.has('p')) {
            return url.searchParams.get('p').trim();
        }
        // GitHub Search
        if (host.includes('github.com') && url.pathname.includes('/search') && url.searchParams.has('q')) {
            return url.searchParams.get('q').trim();
        }
        // Reddit Search
        if (host.includes('reddit.com') && (url.pathname.includes('/search') || url.pathname.includes('/search/')) && url.searchParams.has('q')) {
            return url.searchParams.get('q').trim();
        }
    } catch (e) {}
    return null;
}

/**
 * Extracts a unique set of lowercase alphanumeric and multilingual Unicode keywords.
 * Supports Latin, Chinese, Arabic, Cyrillic, and international scripts with CJK sub-grams.
 * @param {string} title 
 * @param {string} url 
 * @returns {string[]}
 */
function extractKeywords(title, url) {
    const tokens = new Set();
    
    // Normalize and combine title and URL
    const combined = ((title || '') + ' ' + (url || '')).toLowerCase();
    
    // Match any continuous sequence of Unicode letters or numbers
    const words = combined.match(/[\p{L}\p{N}]+/ug) || [];
    for (const word of words) {
        if (word.length >= 2) {
            tokens.add(word);
        }

        // For CJK (Chinese, Japanese, Korean) ideographic characters,
        // words are not space-separated. Index bi-grams and characters so searches match:
        const hasCjk = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/u.test(word);
        if (hasCjk) {
            // Index 2-character sub-grams for Chinese/Japanese text
            for (let i = 0; i < word.length - 1; i++) {
                tokens.add(word.slice(i, i + 2));
            }
            // Also index individual CJK characters
            for (let i = 0; i < word.length; i++) {
                tokens.add(word[i]);
            }
        }
    }
    return Array.from(tokens);
}

/**
 * Utility to extract the domain/hostname from a full URL.
 * @param {string} urlStr 
 * @returns {string}
 */
function getDomain(urlStr) {
    try {
        const url = new URL(urlStr);
        if (!url.hostname) {
            return url.protocol ? url.protocol.replace(':', '') : 'unknown';
        }
        return url.hostname.replace(/^www\./, '');
    } catch (e) {
        return 'unknown';
    }
}

/**
 * Safely inserts a batch of raw visit objects into Dexie.
 * Normalizes domain and populates the search keywords.
 * @param {Array<{url: string, title: string, timestamp: number}>} rawVisits 
 * @returns {Promise<void>}
 */
async function bulkInsertVisits(rawVisits) {
    if (!rawVisits || rawVisits.length === 0) return;
    
    const records = rawVisits.map(visit => {
        const timestamp = Number(visit.timestamp) || Date.now();
        const url = visit.url || '';
        const title = visit.title || '';
        const domain = getDomain(url);
        const keywords = extractKeywords(title, url);
        const searchQuery = extractSearchQuery(url);
        
        return {
            url,
            domain,
            timestamp,
            title,
            keywords,
            searchQuery
        };
    });
    
    // bulkAdd is extremely fast and optimized in Dexie for multi-row writes
    await db.visits.bulkAdd(records).catch(err => {
        // If some records fail (e.g. key collision or general error), log it
        console.error('Dexie bulkAdd error:', err);
    });
}
