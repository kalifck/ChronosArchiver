/**
 * import-worker.js
 * Web Worker for parsing large history CSVs in a separate thread.
 * Utilizes PapaParse for streaming and inserts into IndexedDB via Dexie.js in chunks of 1000.
 */

// Load vendor dependencies and database module in the worker environment
importScripts('vendor/papaparse.min.js', 'vendor/dexie.min.js', 'db.js');

self.onmessage = async function(event) {
    const { file } = event.data;
    if (!file) {
        self.postMessage({ type: 'error', error: 'No file object was provided to the worker.' });
        return;
    }

    let batch = [];
    let processedCount = 0;

    console.log('[ChronosWorker] Initializing streaming CSV import...');

    // Use PapaParse streaming feature
    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        // Step callback is executed row-by-row
        step: function(results, parser) {
            const row = results.data;
            if (!row || typeof row !== 'object') return;
            
            // Normalize header names to lowercase and trim spaces for maximum tool compatibility
            const norm = {};
            for (const key of Object.keys(row)) {
                if (key) norm[key.trim().toLowerCase()] = row[key];
            }

            const rawUrl = norm.url || norm.link || norm.href || norm.address || '';
            const rawTitle = norm.title || norm.name || norm.subject || rawUrl;
            const rawTime = norm.timestamp || norm.time || norm.date || norm.timestamp_iso || norm.lastvisittime;

            // Basic validation - check if URL exists and is a valid web URL
            if (rawUrl && (rawUrl.startsWith('http://') || rawUrl.startsWith('https://'))) {
                let timestamp = Number(rawTime);
                if (isNaN(timestamp) || !rawTime) {
                    // Try parsing as ISO or date string
                    const dateParsed = Date.parse(rawTime);
                    timestamp = isNaN(dateParsed) ? Date.now() : dateParsed;
                } else if (timestamp < 100000000000) {
                    // If Unix timestamp is in seconds, convert to milliseconds
                    timestamp = timestamp * 1000;
                }

                batch.push({
                    url: rawUrl,
                    title: rawTitle || rawUrl,
                    timestamp: timestamp
                });

                // Write in batches of 1000 to balance write transactions and memory footprint
                if (batch.length >= 1000) {
                    parser.pause(); // Pause stream parsing during database I/O write
                    
                    const toInsert = [...batch];
                    batch = [];

                    bulkInsertVisits(toInsert)
                        .then(() => {
                            processedCount += toInsert.length;
                            self.postMessage({ type: 'progress', count: processedCount });
                            parser.resume(); // Resume streaming once disk write completes
                        })
                        .catch(err => {
                            self.postMessage({ type: 'error', error: 'Batch insert error: ' + err.toString() });
                            parser.resume();
                        });
                }
            }
        },
        complete: function() {
            // Write any remaining records in the final batch
            if (batch.length > 0) {
                bulkInsertVisits(batch)
                    .then(() => {
                        processedCount += batch.length;
                        self.postMessage({ type: 'progress', count: processedCount });
                        self.postMessage({ type: 'complete', count: processedCount });
                    })
                    .catch(err => {
                        self.postMessage({ type: 'error', error: 'Final batch insert error: ' + err.toString() });
                    });
            } else {
                self.postMessage({ type: 'complete', count: processedCount });
            }
        },
        error: function(err) {
            self.postMessage({ type: 'error', error: 'CSV Parse error: ' + err.message });
        }
    });
};
