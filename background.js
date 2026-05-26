/**
 * background.js
 * Background service worker for ChronosArchiver Chrome Extension.
 * Handles high-performance asynchronous history ingestion with debouncing.
 */

// Import Dexie and Database Schema
importScripts('vendor/dexie.min.js', 'db.js');

// In-memory queue to batch inserts
let inMemoryQueue = [];
let flushTimer = null;

const FLUSH_INTERVAL_MS = 5000; // 5 seconds
const MAX_QUEUE_SIZE = 100; // Trigger immediate batch insert if buffer is full

/**
 * Commits all items in the in-memory queue to IndexedDB.
 * Clears the buffer and resets timers.
 */
async function flushQueue() {
    if (inMemoryQueue.length === 0) return;

    // Snapshot the current queue and clear the main buffer
    const itemsToInsert = [...inMemoryQueue];
    inMemoryQueue = [];

    // Clear timer reference
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }

    try {
        console.log(`[ChronosArchiver] Flushing batch of ${itemsToInsert.length} visits to local database.`);
        await bulkInsertVisits(itemsToInsert);
    } catch (error) {
        console.error('[ChronosArchiver] Error during batch history save:', error);
        // Put items back in queue if the write failed to avoid data loss
        inMemoryQueue = [...itemsToInsert, ...inMemoryQueue];
    }
}

/**
 * Imports existing browser history up to a specified number of days.
 * @param {number} days 
 * @returns {Promise<void>}
 */
async function importExistingHistory(days) {
    const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    console.log(`[ChronosArchiver] Fetching existing Chrome history since ${new Date(startTime).toLocaleString()}...`);

    return new Promise((resolve) => {
        chrome.history.search({
            text: '',
            startTime: startTime,
            maxResults: 150000 // Retrieve a generous history range
        }, async (historyItems) => {
            if (!historyItems || historyItems.length === 0) {
                console.log('[ChronosArchiver] No pre-existing Chrome history found.');
                resolve();
                return;
            }

            console.log(`[ChronosArchiver] Found ${historyItems.length} historical items in Chrome. Populating database...`);

            const visits = historyItems.map(item => ({
                url: item.url,
                title: item.title || 'Untitled Page',
                timestamp: item.lastVisitTime || Date.now()
            }));

            // Insert records in small chunks to avoid database connection lockups
            const chunkSize = 3000;
            try {
                for (let i = 0; i < visits.length; i += chunkSize) {
                    const chunk = visits.slice(i, i + chunkSize);
                    await bulkInsertVisits(chunk);
                }
                console.log(`[ChronosArchiver] Successfully imported ${visits.length} past Chrome history records!`);
            } catch (err) {
                console.error('[ChronosArchiver] Failed to bulk insert historical records:', err);
            }
            resolve();
        });
    });
}

/**
 * Verifies if database is empty and automatically triggers historical import.
 */
async function checkAndInitializeDatabase() {
    try {
        const count = await db.visits.count();
        console.log(`[ChronosArchiver] Startup check: Database contains ${count} visits.`);
        if (count === 0) {
            console.log('[ChronosArchiver] Database is empty. Running initial 90-day history import...');
            await importExistingHistory(90);
        }
    } catch (e) {
        console.error('[ChronosArchiver] Database startup initialization failed:', e);
    }
}

// Run startup check immediately
checkAndInitializeDatabase();

// 1. Listen to history.onVisited
chrome.history.onVisited.addListener((historyItem) => {
    // Record visit details
    const visitRecord = {
        url: historyItem.url,
        title: historyItem.title || 'Untitled Page',
        timestamp: historyItem.lastVisitTime || Date.now()
    };

    inMemoryQueue.push(visitRecord);

    // If buffer exceeds threshold, flush immediately to avoid RAM build-up and disk overhead
    if (inMemoryQueue.length >= MAX_QUEUE_SIZE) {
        flushQueue();
    } else if (!flushTimer) {
        // Otherwise, set a debounced timeout of 5 seconds to write to disk in a single batch
        flushTimer = setTimeout(flushQueue, FLUSH_INTERVAL_MS);
    }
});

// 2. Handle Extension Icon Clicks -> Open high-performance dashboard
chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: 'dashboard.html' });
});

// 3. Trigger automatic import on first install
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log(`[ChronosArchiver] Extension runtime installed. Reason: ${details.reason}`);
    if (details.reason === 'install') {
        await checkAndInitializeDatabase();
    }
});

// 4. Prevent Data Loss on Service Worker Suspend
chrome.runtime.onSuspend.addListener(() => {
    console.log('[ChronosArchiver] Service worker suspending. Flushing remaining queue...');
    flushQueue();
});
