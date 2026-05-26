/**
 * options.js
 * Settings page logic. Manages CSV importing via Web Worker,
 * database JSON backup exports/restores, and clean DB wipes.
 */

document.addEventListener('DOMContentLoaded', () => {
    // CSV Drag & Drop / Input elements
    const csvDropZone = document.getElementById('csv-drop-zone');
    const csvFileInput = document.getElementById('csv-file-input');
    const importProgressContainer = document.getElementById('import-progress-container');
    const importProgressBar = document.getElementById('import-progress-bar');
    const importStatus = document.getElementById('import-status');
    const importCount = document.getElementById('import-count');

    // Migration elements
    const btnExportDb = document.getElementById('btn-export-db');
    const btnTriggerRestore = document.getElementById('btn-trigger-restore');
    const restoreFileInput = document.getElementById('restore-file-input');
    const restoreProgressContainer = document.getElementById('restore-progress-container');
    const restoreProgressBar = document.getElementById('restore-progress-bar');
    const restoreStatus = document.getElementById('restore-status');
    const restoreCount = document.getElementById('restore-count');

    // Wipe Database elements
    const btnWipeDb = document.getElementById('btn-wipe-db');
    const confirmModal = document.getElementById('confirm-modal');
    const modalCancel = document.getElementById('modal-cancel');
    const modalConfirm = document.getElementById('modal-confirm');

    // ----------------------------------------------------
    // CSV IMPORT SYSTEM (PapaParse Streaming Web Worker)
    // ----------------------------------------------------

    // Wire drag & drop
    csvDropZone.addEventListener('click', () => csvFileInput.click());
    
    csvDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        csvDropZone.classList.add('dragover');
    });

    csvDropZone.addEventListener('dragleave', () => {
        csvDropZone.classList.remove('dragover');
    });

    csvDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        csvDropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleCsvFile(e.dataTransfer.files[0]);
        }
    });

    csvFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleCsvFile(e.target.files[0]);
        }
    });

    function handleCsvFile(file) {
        if (!file.name.endsWith('.csv')) {
            alert('Please select a valid CSV file.');
            return;
        }

        // Reset and show progress indicators
        importProgressContainer.classList.remove('hidden');
        importProgressBar.style.width = '0%';
        importStatus.textContent = 'Spawning importer thread...';
        importCount.textContent = '0 items';
        csvDropZone.style.pointerEvents = 'none';
        csvDropZone.style.opacity = '0.5';

        // Initialize Web Worker to process parsing off the main UI thread
        const worker = new Worker('import-worker.js');

        // Send file object to worker
        worker.postMessage({ file });

        worker.onmessage = function(event) {
            const { type, count, error } = event.data;

            if (type === 'progress') {
                importStatus.textContent = 'Streaming & importing records into IndexedDB...';
                // Estimate or display raw progress counter (since CSV streaming is chunked,
                // we show the actual committed record count to the user in real time)
                importCount.textContent = `${count.toLocaleString()} visits`;
                // Animate progress bar slightly to show activity
                importProgressBar.style.width = `${Math.min(100, 5 + (count / 20000) * 95)}%`;
            } else if (type === 'complete') {
                importProgressBar.style.width = '100%';
                importStatus.textContent = 'Import finished successfully!';
                importCount.textContent = `${count.toLocaleString()} visits stored`;
                csvDropZone.style.pointerEvents = 'auto';
                csvDropZone.style.opacity = '1';
                console.log(`[ChronosArchiver] Successfully imported ${count} records.`);
                worker.terminate();
            } else if (type === 'error') {
                importStatus.textContent = 'Error during import.';
                importCount.textContent = error;
                importProgressBar.style.background = 'var(--color-danger-gradient)';
                csvDropZone.style.pointerEvents = 'auto';
                csvDropZone.style.opacity = '1';
                console.error('[ChronosArchiver] Worker error:', error);
                worker.terminate();
            }
        };
    }

    // ----------------------------------------------------
    // FULL DATABASE EXPORT (JSON Backup)
    // ----------------------------------------------------

    btnExportDb.addEventListener('click', async () => {
        btnExportDb.disabled = true;
        const originalText = btnExportDb.innerHTML;
        btnExportDb.innerHTML = '⚡ Exporting...';

        try {
            console.log('[ChronosArchiver] Starting full DB export extraction...');
            const allVisits = [];
            let offset = 0;
            const limit = 50000;

            // Fetch in chunks of 50,000 to prevent IndexedDB lockups or RAM explosion
            while (true) {
                const chunk = await db.visits.offset(offset).limit(limit).toArray();
                if (chunk.length === 0) break;
                
                // Keep only essential fields for export to keep backup size compact
                for (const item of chunk) {
                    allVisits.push({
                        url: item.url,
                        title: item.title,
                        timestamp: item.timestamp
                    });
                }
                offset += limit;
                console.log(`[ChronosArchiver] Extracted ${allVisits.length} items so far...`);
            }

            if (allVisits.length === 0) {
                alert('Database is currently empty. Nothing to export!');
                btnExportDb.disabled = false;
                btnExportDb.innerHTML = originalText;
                return;
            }

            const backupData = {
                exportedAt: new Date().toISOString(),
                version: 1,
                visits: allVisits
            };

            const jsonString = JSON.stringify(backupData);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const blobUrl = URL.createObjectURL(blob);

            const timestampStr = new Date().toISOString().slice(0, 10);
            
            // Trigger download via Chrome extension downloads API
            chrome.downloads.download({
                url: blobUrl,
                filename: `chronos_history_backup_${timestampStr}.json`,
                saveAs: true
            }, (downloadId) => {
                btnExportDb.disabled = false;
                btnExportDb.innerHTML = originalText;
                if (chrome.runtime.lastError) {
                    console.error('[ChronosArchiver] Export download failed:', chrome.runtime.lastError.message);
                } else {
                    console.log(`[ChronosArchiver] Backup download initiated. Download ID: ${downloadId}`);
                }
            });

        } catch (error) {
            alert('Error during backup generation: ' + error.message);
            btnExportDb.disabled = false;
            btnExportDb.innerHTML = originalText;
        }
    });

    // ----------------------------------------------------
    // FULL DATABASE RESTORE (JSON Backup Import)
    // ----------------------------------------------------

    btnTriggerRestore.addEventListener('click', () => restoreFileInput.click());

    restoreFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleRestoreFile(e.target.files[0]);
        }
    });

    function handleRestoreFile(file) {
        if (!file.name.endsWith('.json')) {
            alert('Please select a valid JSON backup file.');
            return;
        }

        const reader = new FileReader();
        
        restoreProgressContainer.classList.remove('hidden');
        restoreProgressBar.style.width = '0%';
        restoreStatus.textContent = 'Reading backup file...';
        restoreCount.textContent = '0%';
        btnTriggerRestore.disabled = true;

        reader.onload = async function(event) {
            try {
                restoreStatus.textContent = 'Parsing backup JSON...';
                const backupData = JSON.parse(event.target.result);

                if (!backupData || !Array.isArray(backupData.visits)) {
                    throw new Error('Invalid backup file structure. Must contain a "visits" array.');
                }

                const visits = backupData.visits;
                const totalItems = visits.length;
                restoreStatus.textContent = 'Restoring database records...';

                // Insert into Dexie in chunks of 5000 records to prevent long transactions
                let index = 0;
                const chunkSize = 5000;

                while (index < totalItems) {
                    const chunk = visits.slice(index, index + chunkSize);
                    
                    // We run our db.js helper bulkInsertVisits
                    await bulkInsertVisits(chunk);
                    
                    index += chunkSize;
                    const percent = Math.min(100, Math.round((index / totalItems) * 100));
                    restoreProgressBar.style.width = `${percent}%`;
                    restoreCount.textContent = `${percent}% (${Math.min(index, totalItems).toLocaleString()} / ${totalItems.toLocaleString()})`;
                }

                restoreStatus.textContent = 'Restore completed successfully!';
                restoreProgressBar.style.width = '100%';
                console.log(`[ChronosArchiver] Restored ${totalItems} records from backup file.`);
                
            } catch (error) {
                restoreStatus.textContent = 'Restore failed.';
                restoreCount.textContent = error.message;
                restoreProgressBar.style.background = 'var(--color-danger-gradient)';
                console.error('[ChronosArchiver] Restore error:', error);
            } finally {
                btnTriggerRestore.disabled = false;
                restoreFileInput.value = ''; // Reset input element
            }
        };

        reader.onerror = () => {
            restoreStatus.textContent = 'Error reading file.';
            restoreCount.textContent = '';
            btnTriggerRestore.disabled = false;
        };

        reader.readAsText(file);
    }

    // ----------------------------------------------------
    // DANGER ZONE (Database Wipe)
    // ----------------------------------------------------

    btnWipeDb.addEventListener('click', () => {
        confirmModal.classList.remove('hidden');
    });

    modalCancel.addEventListener('click', () => {
        confirmModal.classList.add('hidden');
    });

    // Close modal on click outside modal content
    confirmModal.addEventListener('click', (e) => {
        if (e.target === confirmModal) {
            confirmModal.classList.add('hidden');
        }
    });

    modalConfirm.addEventListener('click', async () => {
        confirmModal.classList.add('hidden');
        btnWipeDb.disabled = true;
        btnWipeDb.innerHTML = '⚡ Wiping...';

        try {
            console.log('[ChronosArchiver] Clearing visits table...');
            await db.visits.clear();
            console.log('[ChronosArchiver] Database wiped successfully.');
            alert('All stored history has been permanently deleted.');
        } catch (error) {
            alert('Failed to clear database: ' + error.message);
        } finally {
            btnWipeDb.disabled = false;
            btnWipeDb.innerHTML = 'Wipe All History';
        }
    });

    // ----------------------------------------------------
    // SUPPORT & CRYPTO DONATION COPY HANDLERS (WITH EASTER EGG BURST)
    // ----------------------------------------------------
    const btnCopyEth = document.getElementById('btn-copy-eth');
    const btnCopyEns = document.getElementById('btn-copy-ens');
    const ethAddressEl = document.getElementById('eth-address');
    const ensDomainEl = document.getElementById('ens-domain');

    // Super Cool Easter Egg Particle Spawner
    function spawnParticleBurst(btnElement, emojiList) {
        const rect = btnElement.getBoundingClientRect();
        const spawnX = rect.left + rect.width / 2 + window.scrollX;
        const spawnY = rect.top + rect.height / 2 + window.scrollY;
        
        const count = 12;
        for (let i = 0; i < count; i++) {
            const particle = document.createElement('span');
            const randomEmoji = emojiList[Math.floor(Math.random() * emojiList.length)];
            
            particle.textContent = randomEmoji;
            particle.style.position = 'absolute';
            particle.style.left = `${spawnX}px`;
            particle.style.top = `${spawnY}px`;
            particle.style.fontSize = `${12 + Math.random() * 12}px`;
            particle.style.pointerEvents = 'none';
            particle.style.zIndex = '10000';
            particle.style.userSelect = 'none';
            // Custom spring dynamics transition
            particle.style.transition = 'all 0.85s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            
            document.body.appendChild(particle);
            
            // Random radial physics directions
            const angle = Math.random() * Math.PI * 2;
            const distance = 45 + Math.random() * 75;
            const targetX = Math.cos(angle) * distance;
            const targetY = Math.sin(angle) * distance - 35; // Floats upwards
            
            requestAnimationFrame(() => {
                particle.style.transform = `translate(${targetX}px, ${targetY}px) scale(0) rotate(${Math.random() * 360}deg)`;
                particle.style.opacity = '0';
            });
            
            // Clean up DOM element
            setTimeout(() => {
                particle.remove();
            }, 900);
        }
    }

    if (btnCopyEth && ethAddressEl) {
        btnCopyEth.addEventListener('click', () => {
            navigator.clipboard.writeText(ethAddressEl.textContent.trim())
                .then(() => {
                    const originalText = btnCopyEth.textContent;
                    btnCopyEth.textContent = 'Copied! ✓';
                    btnCopyEth.style.background = 'var(--color-success)';
                    btnCopyEth.style.borderColor = 'var(--color-success)';
                    btnCopyEth.style.color = '#FFFFFF';
                    
                    // Trigger custom Morrocan & Crypto particle burst!
                    spawnParticleBurst(btnCopyEth, ['⟠', '💎', '❤️', '🇲🇦', '✨']);
                    
                    setTimeout(() => {
                        btnCopyEth.textContent = originalText;
                        btnCopyEth.style.background = '';
                        btnCopyEth.style.borderColor = '';
                        btnCopyEth.style.color = '';
                    }, 2000);
                })
                .catch(err => console.error('Failed to copy ETH address: ', err));
        });
    }

    if (btnCopyEns && ensDomainEl) {
        btnCopyEns.addEventListener('click', () => {
            navigator.clipboard.writeText(ensDomainEl.textContent.trim())
                .then(() => {
                    const originalText = btnCopyEns.textContent;
                    btnCopyEns.textContent = 'Copied! ✓';
                    btnCopyEns.style.background = 'var(--color-success)';
                    btnCopyEns.style.borderColor = 'var(--color-success)';
                    btnCopyEns.style.color = '#FFFFFF';
                    
                    // Trigger custom Morrocan & Web Domain particle burst!
                    spawnParticleBurst(btnCopyEns, ['🌐', '☕', '🇲🇦', '✨', '🔥']);
                    
                    setTimeout(() => {
                        btnCopyEns.textContent = originalText;
                        btnCopyEns.style.background = '';
                        btnCopyEns.style.borderColor = '';
                        btnCopyEns.style.color = '';
                    }, 2000);
                })
                .catch(err => console.error('Failed to copy ENS domain: ', err));
        });
    }
});
