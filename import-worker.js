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
            
            // Basic validation - check if URL exists
            if (row.url) {
                // Ensure timestamp is parsed properly. 
                // Handles standard Unix timestamp formats (s or ms)
                let timestamp = Number(row.timestamp);
                if (isNaN(timestamp)) {
                    // Try parsing as ISO string
                    const dateParsed = Date.parse(row.timestamp);
                    timestamp = isNaN(dateParsed) ? Date.now() : dateParsed;
                } else if (timestamp < 100000000000) {
                    // If Unix timestamp is in seconds, convert to milliseconds
                    timestamp = timestamp * 1000;
                }

                batch.push({
                    url: row.url,
                    title: row.title || row.url,
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
