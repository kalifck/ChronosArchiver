/**
 * dashboard.js
 * Main dashboard logic. Implements high-performance IndexedDB queries,
 * Chart.js rendering, interactive chart filtering, custom DOM Virtual Scrolling,
 * and filtered data exporting.
 */

document.addEventListener('DOMContentLoaded', async () => {
    // UI Elements
    const searchInput = document.getElementById('search-input');
    const btnClearSearch = document.getElementById('btn-clear-search');
    const sortSelect = document.getElementById('sort-select');
    const filterStartDate = document.getElementById('filter-start-date');
    const filterEndDate = document.getElementById('filter-end-date');
    const btnResetFilters = document.getElementById('btn-reset-filters');
    const btnExportFiltered = document.getElementById('btn-export-filtered');
    const chipsContainer = document.getElementById('chips-container');
    const chipsList = document.getElementById('chips-list');
    
    // Stats Elements
    const statTotalVisits = document.getElementById('stat-total-visits');
    const statUniqueDomains = document.getElementById('stat-unique-domains');
    const statDailyAvg = document.getElementById('stat-daily-avg');

    // Virtual Scroll Elements
    const vsViewport = document.getElementById('virtual-scroll-viewport');
    const vsSpacer = document.getElementById('virtual-scroll-spacer');
    const vsContent = document.getElementById('virtual-scroll-content');
    const emptyState = document.getElementById('history-empty-state');

    // Chart Canvas Elements
    const canvasDomains = document.getElementById('chart-top-domains');
    const canvasTrends = document.getElementById('chart-visits-trend');
    const placeholderDomains = document.getElementById('domain-chart-placeholder');
    const placeholderTrends = document.getElementById('trend-chart-placeholder');
    
    // New Advanced Selectors
    const canvasKeywords = document.getElementById('chart-top-keywords');
    const placeholderKeywords = document.getElementById('keywords-chart-placeholder');
    const heatmapGridContainer = document.getElementById('heatmap-grid-container');
    
    const drilldownPanel = document.getElementById('drilldown-panel');
    const drilldownDomainLabel = document.getElementById('drilldown-domain-label');
    const btnCloseDrilldown = document.getElementById('btn-close-drilldown');
    const drilldownPillsList = document.getElementById('drilldown-pills-list');
    
    const insightPeakTime = document.getElementById('insight-peak-time');
    const insightActiveDay = document.getElementById('insight-active-day');
    const insightSearchVelocity = document.getElementById('insight-search-velocity');
    const insightFocusCategory = document.getElementById('insight-focus-category');

    // Diagnostic Elements
    const diagnosticBanner = document.getElementById('diagnostic-banner');
    const diagnosticText = document.getElementById('diagnostic-text');

    // State Variables
    let activeDomainFilter = null;
    let startDateFilter = null;
    let endDateFilter = null;
    let sortOrder = 'desc'; // 'desc' (newest) or 'asc' (oldest)
    
    // Interactive Heatmap Filters
    let activeDayOfWeekFilter = null; // 0-6 (Mon-Sun) or null
    let activeHourOfDayFilter = null; // 0-23 or null

    // Cached lightweight metrics for zero-deserialization insights
    let lastComputedHeatmap = null;
    let lastDomainCounts = null;
    let renderTicket = 0; // Guard against out-of-order async render frames

    // Time-window state for dynamic rolling queries
    let keywordsTimeRange = 30; // 30, 90, 365, 'all'
    let trendsTimeRange = 14;   // 14, 30, 90

    // Cognitive Mindscape Neural Animation State
    let isMindTabActive = false;
    let mindscapeAnimFrameId = null;
    let topRecentSearchKeywords = ['build123d', 'fiat tris', 'google', 'archiver', 'vault'];

    // Chart.js instances
    let chartDomains = null;
    let chartTrends = null;
    let chartKeywords = null;

    // High-performance virtual scroll state
    let matchedIds = []; // Stores only the list of active numeric primary keys (extremely lightweight!)
    const ITEM_HEIGHT = 72; // height of each history row in CSS (var(--virtual-item-height))
    const VIEWPORT_HEIGHT = 520;
    const VISIBLE_COUNT = Math.ceil(VIEWPORT_HEIGHT / ITEM_HEIGHT);
    const BUFFER_COUNT = 5; // buffer items above and below visible window to prevent white flashing

    // ----------------------------------------------------
    // INITIALIZATION, DIAGNOSTICS & DYNAMIC STATISTICS
    // ----------------------------------------------------

    function showDiagnostic(type, msg) {
        if (!diagnosticBanner || !diagnosticText) return;
        diagnosticBanner.className = `diagnostic-banner ${type}`;
        diagnosticBanner.classList.remove('hidden');
        diagnosticText.textContent = msg;
    }

    async function initDashboard() {
        console.log('[ChronosDashboard] Initializing dashboard...');
        showDiagnostic('success', 'Checking Database Connection...');
        
        try {
            await db.open();
            const count = await db.visits.count();
            showDiagnostic('success', `Vault Connected. Local database contains ${count.toLocaleString()} browsing records.`);
            if (count === 0) {
                showDiagnostic('success', 'Vault Connected (Empty). Ingesting past 3 months of Chrome history in the background...');
            }
        } catch (e) {
            console.error('[ChronosDashboard] Diagnostics error:', e);
            showDiagnostic('error', `IndexedDB Connection Failed: ${e.message}. Please click the circular Reload button in chrome://extensions.`);
            document.getElementById('record-count-label').textContent = 'Error: DB offline';
            return;
        }

        try {
            // Load initial summary statistics
            await updateSummaryStats();

            // Query database and build the interactive charts
            await updateCharts();

            // Initialize Cognitive Mindscape Canvas Engine
            initCognitiveMindscape();

            // Run the first search query to populate the history chronicle
            await runFilterAndQuery();

            // Setup event listeners
            setupEventListeners();
        } catch (e) {
            console.error('[ChronosDashboard] Initialization error:', e);
            showDiagnostic('error', `Dashboard Render Failure: ${e.message}`);
        }
    }

    /**
     * Queries summary statistics using fast index counts without deserializing objects.
     */
    async function updateSummaryStats() {
        try {
            // 1. Total Visits count
            const totalVisits = await db.visits.count();
            statTotalVisits.textContent = totalVisits.toLocaleString();

            if (totalVisits === 0) {
                statUniqueDomains.textContent = '0';
                statDailyAvg.textContent = '0';
                return;
            }

            // 2. Unique Domains count using Dexie's fast index uniqueKeys
            const uniqueDomains = await db.visits.orderBy('domain').uniqueKeys();
            statUniqueDomains.textContent = uniqueDomains.length.toLocaleString();

            // 3. Daily Average Visits (over the active span of history)
            const oldestRecord = await db.visits.orderBy('timestamp').limit(1).toArray();
            const newestRecord = await db.visits.orderBy('timestamp').reverse().limit(1).toArray();

            if (oldestRecord.length > 0 && newestRecord.length > 0) {
                const spanMs = newestRecord[0].timestamp - oldestRecord[0].timestamp;
                const spanDays = Math.max(1, Math.ceil(spanMs / (1000 * 60 * 60 * 24)));
                const avg = Math.round(totalVisits / spanDays);
                statDailyAvg.textContent = avg.toLocaleString();
            } else {
                statDailyAvg.textContent = totalVisits.toLocaleString();
            }

        } catch (e) {
            console.error('[ChronosDashboard] Error loading summary statistics:', e);
        }
    }

    // ----------------------------------------------------
    // HIGH-PERFORMANCE DATABASE CHART GENERATION
    // ----------------------------------------------------

    async function updateCharts() {
        try {
            const total = await db.visits.count();
            if (total === 0) {
                placeholderDomains.classList.remove('hidden');
                placeholderTrends.classList.remove('hidden');
                placeholderKeywords.classList.remove('hidden');
                return;
            }

            placeholderDomains.classList.add('hidden');
            placeholderTrends.classList.add('hidden');
            placeholderKeywords.classList.add('hidden');

            await renderTopDomainsChart();
            await renderTrendsChart();
            await renderKeywordsChart();
            await renderHeatmap();
            await updateInsights();

        } catch (e) {
            console.error('[ChronosDashboard] Error loading charts:', e);
        }
    }

    /**
     * Extracts top domains by reading index keys in order.
     * Keeps memory usage near zero.
     */
    async function renderTopDomainsChart() {
        const domainCounts = {};

        // Fast index-only cursor traversal (only loads string keys into memory, not rows)
        await db.visits.orderBy('domain').eachKey(domain => {
            if (domain && domain !== 'unknown') {
                domainCounts[domain] = (domainCounts[domain] || 0) + 1;
            }
        });

        lastDomainCounts = domainCounts;

        // Sort domains by visit count
        const sortedDomains = Object.entries(domainCounts)
            .sort((a, b) => b[1] - a[1]);

        if (sortedDomains.length === 0) return;

        // Group into top 8 and label the rest as "Other"
        const topCount = Math.min(8, sortedDomains.length);
        const labels = [];
        const data = [];
        let otherSum = 0;

        for (let i = 0; i < sortedDomains.length; i++) {
            if (i < topCount) {
                labels.push(sortedDomains[i][0]);
                data.push(sortedDomains[i][1]);
            } else {
                otherSum += sortedDomains[i][1];
            }
        }

        if (otherSum > 0) {
            labels.push('Other Domains');
            data.push(otherSum);
        }

        // Destroy previous chart if it exists
        if (chartDomains) {
            chartDomains.destroy();
        }

        // Render Doughnut Chart
        chartDomains = new Chart(canvasDomains, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: [
                        '#818CF8', '#A78BFA', '#34D399', '#60A5FA', 
                        '#F472B6', '#FB7185', '#F59E0B', '#10B981', '#4B5563'
                    ],
                    borderWidth: 1,
                    borderColor: 'rgba(17, 24, 39, 0.8)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: '#F9FAFB',
                            font: { family: 'Inter', size: 11 },
                            padding: 12
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const val = context.raw;
                                const percent = ((val / data.reduce((a,b)=>a+b,0)) * 100).toFixed(1);
                                return ` ${context.label}: ${val.toLocaleString()} visits (${percent}%)`;
                            }
                        }
                    }
                },
                // CLICK INTERACTION: Clicking on a domain filters the history immediately!
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const index = elements[0].index;
                        const clickedDomain = labels[index];
                        if (clickedDomain && clickedDomain !== 'Other Domains') {
                            setDomainFilter(clickedDomain);
                        }
                    }
                }
            }
        });
    }

    /**
     * Generates a beautifully stacked area category spikes chart over the selected timeframe (14D, 30D, 90D).
     */
    async function renderTrendsChart(daysCount = trendsTimeRange) {
        const labels = [];
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;

        const dailyCounts = {
            'Tech & Learning': Array(daysCount).fill(0),
            'Entertainment': Array(daysCount).fill(0),
            'Social & Forums': Array(daysCount).fill(0),
            'Shopping': Array(daysCount).fill(0),
            'Search Engines': Array(daysCount).fill(0)
        };

        const startLimit = now - daysCount * oneDayMs;
        
        try {
            // Load only visits in the selected timeframe for speed
            const records = await db.visits.where('timestamp').above(startLimit).toArray();

            for (const r of records) {
                const daysAgo = Math.floor((now - r.timestamp) / oneDayMs);
                if (daysAgo >= 0 && daysAgo < daysCount) {
                    const cat = getCategory(r.domain);
                    if (dailyCounts[cat]) {
                        dailyCounts[cat][(daysCount - 1) - daysAgo]++;
                    }
                }
            }

            for (let i = daysCount - 1; i >= 0; i--) {
                const date = new Date(now - i * oneDayMs);
                if (daysCount > 30) {
                    // Reduce label crowding for 90-day views
                    if (i % 5 === 0 || i === 0) {
                        labels.push(`${date.getMonth() + 1}/${date.getDate()}`);
                    } else {
                        labels.push('');
                    }
                } else {
                    labels.push(`${date.getMonth() + 1}/${date.getDate()}`);
                }
            }

            // Compute daily total visits across all categories for the Cognitive Rhythm Analyzer
            const dailyTotals = Array(daysCount).fill(0);
            for (let i = 0; i < daysCount; i++) {
                for (const cat in dailyCounts) {
                    dailyTotals[i] += dailyCounts[cat][i];
                }
            }
            updateCognitiveRhythm(dailyCounts, dailyTotals, daysCount);

            if (chartTrends) {
                chartTrends.destroy();
            }

            chartTrends = new Chart(canvasTrends, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Tech & Learning',
                            data: dailyCounts['Tech & Learning'],
                            backgroundColor: 'rgba(52, 211, 153, 0.18)',
                            borderColor: '#34D399',
                            fill: true,
                            tension: 0.3
                        },
                        {
                            label: 'Entertainment',
                            data: dailyCounts['Entertainment'],
                            backgroundColor: 'rgba(129, 140, 248, 0.18)',
                            borderColor: '#818CF8',
                            fill: true,
                            tension: 0.3
                        },
                        {
                            label: 'Social & Forums',
                            data: dailyCounts['Social & Forums'],
                            backgroundColor: 'rgba(244, 114, 182, 0.18)',
                            borderColor: '#F472B6',
                            fill: true,
                            tension: 0.3
                        },
                        {
                            label: 'Shopping',
                            data: dailyCounts['Shopping'],
                            backgroundColor: 'rgba(245, 158, 11, 0.18)',
                            borderColor: '#F59E0B',
                            fill: true,
                            tension: 0.3
                        },
                        {
                            label: 'Search Engines',
                            data: dailyCounts['Search Engines'],
                            backgroundColor: 'rgba(96, 165, 250, 0.18)',
                            borderColor: '#60A5FA',
                            fill: true,
                            tension: 0.3
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                color: '#9CA3AF',
                                font: { family: 'Inter', size: 9 },
                                boxWidth: 10,
                                padding: 6
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(255, 255, 255, 0.02)' },
                            ticks: { color: '#9CA3AF', font: { family: 'Inter', size: 9 } }
                        },
                        y: {
                            stacked: true, // Stack the category areas
                            grid: { color: 'rgba(255, 255, 255, 0.04)' },
                            ticks: { color: '#9CA3AF', font: { family: 'Inter', size: 9 } },
                            beginAtZero: true
                        }
                    }
                }
            });

        } catch (err) {
            console.error('[ChronosDashboard] Category spikes render error:', err);
        }
    }

    /**
     * Categorizes a domain based on standard web categories.
     * @param {string} domain 
     * @returns {string}
     */
    function getCategory(domain) {
        const d = (domain || '').toLowerCase();
        if (d.includes('youtube.com') || d.includes('netflix.com') || d.includes('twitch.tv') || d.includes('vimeo.com') || d.includes('spotify.com') || d.includes('soundcloud.com')) {
            return 'Entertainment';
        }
        if (d.includes('github.com') || d.includes('stackoverflow.com') || d.includes('medium.com') || d.includes('dev.to') || d.includes('wikipedia.org') || d.includes('mdn.mozilla.org') || d.includes('w3schools.com') || d.includes('npmjs.com') || d.includes('openscad.org')) {
            return 'Tech & Learning';
        }
        if (d.includes('amazon.com') || d.includes('ebay.com') || d.includes('aliexpress.com') || d.includes('etsy.com') || d.includes('shopify.com') || d.includes('walmart.com') || d.includes('taobao.com')) {
            return 'Shopping';
        }
        if (d.includes('reddit.com') || d.includes('quora.com') || d.includes('discord.com') || d.includes('facebook.com') || d.includes('twitter.com') || d.includes('x.com') || d.includes('linkedin.com') || d.includes('instagram.com')) {
            return 'Social & Forums';
        }
        if (d.includes('google.com') || d.includes('bing.com') || d.includes('duckduckgo.com') || d.includes('yahoo.com') || d.includes('baidu.com')) {
            return 'Search Engines';
        }
        return 'Tech & Learning'; // General Default focus category
    }

    /**
     * Gathers and renders Top Search Keywords using rolling time ranges (30D, 90D, 1Y, All-Time).
     * Automatically feeds recent keywords to the Cognitive Mindscape thought particles.
     */
    async function renderKeywordsChart(days = keywordsTimeRange) {
        const counts = {};

        try {
            if (days === 'all') {
                // Rapidly iterate searchQuery index keys (O(log N) operations, memory-friendly)
                await db.visits.orderBy('searchQuery').eachKey(query => {
                    if (query && query.trim()) {
                        const lower = query.trim().toLowerCase();
                        counts[lower] = (counts[lower] || 0) + 1;
                    }
                });
            } else {
                const since = Date.now() - (Number(days) * 24 * 60 * 60 * 1000);
                await db.visits.where('timestamp').above(since).each(item => {
                    if (item.searchQuery && item.searchQuery.trim()) {
                        const lower = item.searchQuery.trim().toLowerCase();
                        counts[lower] = (counts[lower] || 0) + 1;
                    }
                });
            }

            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

            if (sorted.length === 0) {
                placeholderKeywords.classList.remove('hidden');
                if (chartKeywords) chartKeywords.destroy();
                return;
            }

            placeholderKeywords.classList.add('hidden');

            const topKeywords = sorted.slice(0, 8);
            const labels = topKeywords.map(x => x[0]);
            const data = topKeywords.map(x => x[1]);

            // Sync top recent search keywords to fuel the thought particles on the Mindscape canvas!
            if (labels.length > 0) {
                topRecentSearchKeywords = labels.slice(0, 8);
                refreshThoughtParticles();
            }

            if (chartKeywords) {
                chartKeywords.destroy();
            }

            chartKeywords = new Chart(canvasKeywords, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: 'rgba(167, 139, 250, 0.45)', // Violet hue
                        borderColor: '#A78BFA',
                        borderWidth: 1.5,
                        borderRadius: 4
                    }]
                },
                options: {
                    indexAxis: 'y', // Makes the bar chart horizontal
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return ` ${context.raw.toLocaleString()} searches`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(255, 255, 255, 0.02)' },
                            ticks: { color: '#9CA3AF', font: { family: 'Inter', size: 9 } }
                        },
                        y: {
                            grid: { display: false },
                            ticks: {
                                color: '#F9FAFB',
                                font: { family: 'Inter', size: 9, weight: '500' },
                                callback: function(val) {
                                    const label = this.getLabelForValue(val);
                                    return label.length > 18 ? label.substring(0, 15) + '...' : label;
                                }
                            }
                        }
                    },
                    onClick: (event, elements) => {
                        if (elements.length > 0) {
                            const index = elements[0].index;
                            const clickedPhrase = labels[index];
                            if (clickedPhrase) {
                                searchInput.value = clickedPhrase;
                                btnClearSearch.classList.remove('hidden');
                                runFilterAndQuery();
                            }
                        }
                    }
                }
            });

        } catch (e) {
            console.error('[ChronosDashboard] Error loading search keyword chart:', e);
        }
    }

    /**
     * Updates the Cognitive Rhythm model: momentum, hyperfocus sprints, recovery dips, and lobe HUD.
     */
    function updateCognitiveRhythm(dailyCounts, dailyTotals, daysCount) {
        if (!dailyTotals || dailyTotals.length < 2) return;

        const todayVisits = dailyTotals[daysCount - 1] || 0;
        const yesterdayVisits = dailyTotals[daysCount - 2] || 0;
        const momentum = yesterdayVisits > 0 
            ? Math.round(((todayVisits - yesterdayVisits) / yesterdayVisits) * 100)
            : 0;

        // Calculate median baseline of active window
        const sortedTotals = [...dailyTotals].sort((a, b) => a - b);
        const median = sortedTotals[Math.floor(sortedTotals.length / 2)] || 1;

        // Compute average sprint and dip sequences
        let sprintLengths = [];
        let dipLengths = [];
        let curSprint = 0;
        let curDip = 0;

        for (let i = 0; i < daysCount; i++) {
            if (dailyTotals[i] >= median) {
                curSprint++;
                if (curDip > 0) {
                    dipLengths.push(curDip);
                    curDip = 0;
                }
            } else {
                curDip++;
                if (curSprint > 0) {
                    sprintLengths.push(curSprint);
                    curSprint = 0;
                }
            }
        }
        if (curSprint > 0) sprintLengths.push(curSprint);
        if (curDip > 0) dipLengths.push(curDip);

        const avgSprint = sprintLengths.length > 0
            ? (sprintLengths.reduce((a, b) => a + b, 0) / sprintLengths.length)
            : 1.8;
        const avgDip = dipLengths.length > 0
            ? (dipLengths.reduce((a, b) => a + b, 0) / dipLengths.length)
            : 1.1;

        // Update DOM elements
        const momentumEl = document.getElementById('rhythm-momentum');
        const sprintLenEl = document.getElementById('rhythm-sprint-len');
        const dipLenEl = document.getElementById('rhythm-dip-len');
        const phasePill = document.getElementById('rhythm-status-pill');
        const phaseLabel = document.getElementById('rhythm-phase-label');
        const insightText = document.getElementById('rhythm-insight-text');

        if (momentumEl) {
            momentumEl.textContent = `${momentum >= 0 ? '+' : ''}${momentum}%`;
            momentumEl.style.color = momentum >= 0 ? '#34D399' : '#60A5FA';
        }
        if (sprintLenEl) sprintLenEl.textContent = `${avgSprint.toFixed(1)} Days`;
        if (dipLenEl) dipLenEl.textContent = `${avgDip.toFixed(1)} Days`;

        // Phase and predictive forecast
        if (todayVisits >= 1.25 * median || momentum >= 35) {
            if (phasePill) phasePill.className = 'rhythm-status-pill sprint';
            if (phaseLabel) phaseLabel.textContent = '⚡ Hyperfocus Sprint Phase';
            if (insightText) {
                insightText.textContent = `High-velocity focus sprint active (${todayVisits.toLocaleString()} visits, +${momentum}% vs yesterday). Your sprint rhythm averages ${avgSprint.toFixed(1)} days—historical data predicts a refractory recovery dip within 24-48 hours.`;
            }
        } else if (todayVisits <= 0.75 * median || momentum <= -25) {
            if (phasePill) phasePill.className = 'rhythm-status-pill dip';
            if (phaseLabel) phaseLabel.textContent = '🌊 Refractory Recovery Phase';
            if (insightText) {
                insightText.textContent = `Cognitive cooldown in progress (${todayVisits.toLocaleString()} visits, ${momentum}% vs yesterday). Your recharge dips typically reset after ${avgDip.toFixed(1)} day(s) before the next surge.`;
            }
        } else {
            if (phasePill) phasePill.className = 'rhythm-status-pill steady';
            if (phaseLabel) phaseLabel.textContent = '⚖️ Equilibrium Flow Phase';
            if (insightText) {
                insightText.textContent = `Browsing rhythm is balanced at baseline (${todayVisits.toLocaleString()} visits). Information ingestion is steady and sustainable.`;
            }
        }

        // Update HUD Category Breakdown
        let totalWindowVisits = 0;
        const categorySums = {};
        for (const cat in dailyCounts) {
            const sum = dailyCounts[cat].reduce((a, b) => a + b, 0);
            categorySums[cat] = sum;
            totalWindowVisits += sum;
        }

        const safeTotal = Math.max(1, totalWindowVisits);
        const techPct = Math.round(((categorySums['Tech & Learning'] || 0) / safeTotal) * 100);
        const searchPct = Math.round(((categorySums['Search Engines'] || 0) / safeTotal) * 100);
        const entPct = Math.round(((categorySums['Entertainment'] || 0) / safeTotal) * 100);
        const socPct = Math.round(((categorySums['Social & Forums'] || 0) / safeTotal) * 100);

        const hudTech = document.getElementById('hud-val-tech');
        const hudSearch = document.getElementById('hud-val-search');
        const hudEnt = document.getElementById('hud-val-entertainment');
        const hudSoc = document.getElementById('hud-val-social');

        if (hudTech) hudTech.textContent = `${techPct}%`;
        if (hudSearch) hudSearch.textContent = `${searchPct}%`;
        if (hudEnt) hudEnt.textContent = `${entPct}%`;
        if (hudSoc) hudSoc.textContent = `${socPct}%`;

        // Update brain lobe intensities
        if (brainLobes && brainLobes.length >= 4) {
            brainLobes[0].intensity = (categorySums['Tech & Learning'] || 0) / safeTotal;
            brainLobes[1].intensity = (categorySums['Search Engines'] || 0) / safeTotal;
            brainLobes[2].intensity = (categorySums['Entertainment'] || 0) / safeTotal;
            brainLobes[3].intensity = (categorySums['Social & Forums'] || 0) / safeTotal;
        }
    }

    // ----------------------------------------------------
    // COGNITIVE MINDSCAPE: NEURAL CANVAS ANIMATION ENGINE
    // ----------------------------------------------------

    const brainLobes = [
        { id: 'tech', name: 'Frontal (Tech & Code)', cat: 'Tech & Learning', nx: 0.36, ny: 0.40, color: '#10B981', rgb: '16, 185, 129', intensity: 0.5, radius: 24 },
        { id: 'search', name: 'Parietal (Exploration)', cat: 'Search Engines', nx: 0.64, ny: 0.35, color: '#60A5FA', rgb: '96, 165, 250', intensity: 0.3, radius: 22 },
        { id: 'media', name: 'Temporal (Media & Flow)', cat: 'Entertainment', nx: 0.44, ny: 0.66, color: '#818CF8', rgb: '129, 140, 248', intensity: 0.25, radius: 20 },
        { id: 'social', name: 'Limbic (Social)', cat: 'Social & Forums', nx: 0.66, ny: 0.64, color: '#F472B6', rgb: '244, 114, 182', intensity: 0.2, radius: 20 }
    ];

    const synapticConnections = [
        [0, 1], [0, 2], [1, 3], [2, 3], [0, 3], [1, 2]
    ];

    let hoveredLobe = null;
    let canvasMouse = { x: -1000, y: -1000 };
    let thoughtParticles = [];
    let synapticPulses = [];
    let brainCanvas = null;
    let brainCtx = null;

    function initCognitiveMindscape() {
        brainCanvas = document.getElementById('mind-brain-canvas');
        if (!brainCanvas) return;
        brainCtx = brainCanvas.getContext('2d');

        // Spawn traveling electrical pulses
        synapticPulses = [];
        for (let i = 0; i < 18; i++) {
            const conn = synapticConnections[Math.floor(Math.random() * synapticConnections.length)];
            synapticPulses.push({
                from: conn[0],
                to: conn[1],
                t: Math.random(),
                speed: 0.004 + Math.random() * 0.007,
                color: Math.random() > 0.5 ? '#38BDF8' : '#A78BFA'
            });
        }

        // Initialize thought particles with top search terms
        refreshThoughtParticles();

        // Mouse listeners
        brainCanvas.addEventListener('mousemove', (e) => {
            const rect = brainCanvas.getBoundingClientRect();
            canvasMouse.x = e.clientX - rect.left;
            canvasMouse.y = e.clientY - rect.top;

            const w = brainCanvas.clientWidth;
            const h = brainCanvas.clientHeight;

            let found = null;
            for (const lobe of brainLobes) {
                const lx = lobe.nx * w;
                const ly = lobe.ny * h;
                const dist = Math.hypot(canvasMouse.x - lx, canvasMouse.y - ly);
                if (dist <= lobe.radius + 12) {
                    found = lobe;
                    break;
                }
            }
            hoveredLobe = found;
            brainCanvas.style.cursor = found ? 'pointer' : 'default';
        });

        brainCanvas.addEventListener('mouseleave', () => {
            canvasMouse.x = -1000;
            canvasMouse.y = -1000;
            hoveredLobe = null;
        });

        brainCanvas.addEventListener('click', (e) => {
            const rect = brainCanvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            const w = brainCanvas.clientWidth;
            const h = brainCanvas.clientHeight;

            // Check if user clicked a lobe
            for (const lobe of brainLobes) {
                const lx = lobe.nx * w;
                const ly = lobe.ny * h;
                const dist = Math.hypot(cx - lx, cy - ly);
                if (dist <= lobe.radius + 12) {
                    // Filter history by this category!
                    searchInput.value = lobe.cat;
                    btnClearSearch.classList.remove('hidden');
                    runFilterAndQuery();
                    return;
                }
            }

            // Check if user clicked a thought particle
            for (const p of thoughtParticles) {
                const dist = Math.hypot(cx - p.x, cy - p.y);
                if (dist <= 25) {
                    searchInput.value = p.text;
                    btnClearSearch.classList.remove('hidden');
                    runFilterAndQuery();
                    return;
                }
            }
        });

        // Wire HUD clicks
        document.querySelectorAll('#mind-hud-overlay .hud-item').forEach(item => {
            item.addEventListener('click', () => {
                const cat = item.getAttribute('data-category');
                if (cat) {
                    searchInput.value = cat;
                    btnClearSearch.classList.remove('hidden');
                    runFilterAndQuery();
                }
            });
        });
    }

    function refreshThoughtParticles() {
        const pool = (topRecentSearchKeywords && topRecentSearchKeywords.length > 0)
            ? topRecentSearchKeywords
            : ['build123d', 'fiat tris', 'google', 'archiver', 'vault'];

        thoughtParticles = [];
        const count = Math.min(7, pool.length);
        const w = brainCanvas ? brainCanvas.clientWidth : 400;
        const h = brainCanvas ? brainCanvas.clientHeight : 240;

        for (let i = 0; i < count; i++) {
            thoughtParticles.push({
                text: pool[i],
                x: 30 + Math.random() * (w - 80),
                y: 25 + Math.random() * (h - 70),
                vx: (Math.random() - 0.5) * 0.35,
                vy: (Math.random() - 0.5) * 0.35,
                phase: Math.random() * Math.PI * 2,
                color: i % 2 === 0 ? '#C7D2FE' : '#67E8F9'
            });
        }
    }

    function resizeBrainCanvas() {
        if (!brainCanvas) return;
        const dpr = window.devicePixelRatio || 1;
        const w = brainCanvas.clientWidth;
        const h = brainCanvas.clientHeight;

        if (w > 0 && h > 0) {
            brainCanvas.width = w * dpr;
            brainCanvas.height = h * dpr;
            brainCtx.scale(dpr, dpr);
        }
    }

    function startMindscapeAnimation() {
        isMindTabActive = true;
        resizeBrainCanvas();
        if (!mindscapeAnimFrameId) {
            renderMindscapeFrame();
        }
    }

    function stopMindscapeAnimation() {
        isMindTabActive = false;
        if (mindscapeAnimFrameId) {
            cancelAnimationFrame(mindscapeAnimFrameId);
            mindscapeAnimFrameId = null;
        }
    }

    function renderMindscapeFrame(timestamp = 0) {
        if (!isMindTabActive) return;

        if (!brainCanvas || !brainCtx) {
            mindscapeAnimFrameId = requestAnimationFrame(renderMindscapeFrame);
            return;
        }

        const w = brainCanvas.clientWidth;
        const h = brainCanvas.clientHeight;
        if (w === 0 || h === 0) {
            mindscapeAnimFrameId = requestAnimationFrame(renderMindscapeFrame);
            return;
        }

        brainCtx.clearRect(0, 0, w, h);

        const time = timestamp * 0.001;

        // 1. Draw Stylized Cybernetic Cortex Silhouette (Breathing Beziers)
        const breathe = 1 + 0.015 * Math.sin(time * 2.2);
        const centerX = w * 0.51;
        const centerY = h * 0.50;
        const scaleX = (w * 0.40) * breathe;
        const scaleY = (h * 0.40) * breathe;

        brainCtx.save();
        brainCtx.translate(centerX, centerY);
        brainCtx.strokeStyle = 'rgba(129, 140, 248, 0.12)';
        brainCtx.lineWidth = 1.5;
        brainCtx.setLineDash([4, 6]);

        // Outer Cranial Envelope
        brainCtx.beginPath();
        brainCtx.ellipse(0, 0, scaleX, scaleY, 0, 0, Math.PI * 2);
        brainCtx.stroke();
        brainCtx.setLineDash([]);

        // Longitudinal Cerebral Fissure (Dividing the two hemispheres)
        brainCtx.strokeStyle = 'rgba(99, 102, 241, 0.2)';
        brainCtx.beginPath();
        brainCtx.moveTo(0, -scaleY * 0.9);
        brainCtx.bezierCurveTo(scaleX * 0.06, -scaleY * 0.3, -scaleX * 0.06, scaleY * 0.3, 0, scaleY * 0.9);
        brainCtx.stroke();
        brainCtx.restore();

        // 2. Draw Synaptic Arcs between connected Lobes
        for (const [aIdx, bIdx] of synapticConnections) {
            const a = brainLobes[aIdx];
            const b = brainLobes[bIdx];
            const ax = a.nx * w;
            const ay = a.ny * h;
            const bx = b.nx * w;
            const by = b.ny * h;
            const midX = (ax + bx) / 2 + Math.sin(time + aIdx) * 6;
            const midY = (ay + by) / 2 + Math.cos(time + bIdx) * 6;

            brainCtx.beginPath();
            brainCtx.moveTo(ax, ay);
            brainCtx.quadraticCurveTo(midX, midY, bx, by);
            brainCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            brainCtx.lineWidth = 1;
            brainCtx.stroke();
        }

        // 3. Draw Synaptic Traveling Sparks (Electrical Impulses)
        for (const pulse of synapticPulses) {
            pulse.t += pulse.speed;
            if (pulse.t >= 1) {
                pulse.t = 0;
                const newConn = synapticConnections[Math.floor(Math.random() * synapticConnections.length)];
                pulse.from = newConn[0];
                pulse.to = newConn[1];
            }

            const a = brainLobes[pulse.from];
            const b = brainLobes[pulse.to];
            const ax = a.nx * w;
            const ay = a.ny * h;
            const bx = b.nx * w;
            const by = b.ny * h;
            const midX = (ax + bx) / 2;
            const midY = (ay + by) / 2;

            // Quadratic Bezier interpolation
            const t = pulse.t;
            const px = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * midX + t * t * bx;
            const py = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * midY + t * t * by;

            brainCtx.save();
            brainCtx.fillStyle = pulse.color;
            brainCtx.shadowColor = pulse.color;
            brainCtx.shadowBlur = 8;
            brainCtx.beginPath();
            brainCtx.arc(px, py, 2.2, 0, Math.PI * 2);
            brainCtx.fill();
            brainCtx.restore();
        }

        // 4. Draw Brain Lobes (Functional Energy Zones)
        for (const lobe of brainLobes) {
            const lx = lobe.nx * w;
            const ly = lobe.ny * h;
            const isHovered = hoveredLobe === lobe;
            const baseRad = lobe.radius * (0.85 + lobe.intensity * 0.4);
            const pulseRad = baseRad + Math.sin(time * 3 + lobe.nx * 10) * 2;

            // Outer Radial Aura Glow
            const glow = brainCtx.createRadialGradient(lx, ly, 2, lx, ly, pulseRad * 1.8);
            glow.addColorStop(0, `rgba(${lobe.rgb}, ${0.35 + lobe.intensity * 0.3})`);
            glow.addColorStop(1, `rgba(${lobe.rgb}, 0)`);
            brainCtx.fillStyle = glow;
            brainCtx.beginPath();
            brainCtx.arc(lx, ly, pulseRad * 1.8, 0, Math.PI * 2);
            brainCtx.fill();

            // Core Energy Circle
            brainCtx.fillStyle = lobe.color;
            brainCtx.beginPath();
            brainCtx.arc(lx, ly, pulseRad * 0.6, 0, Math.PI * 2);
            brainCtx.fill();

            // Inner Core Hotspot
            brainCtx.fillStyle = '#FFFFFF';
            brainCtx.beginPath();
            brainCtx.arc(lx, ly, 2.5, 0, Math.PI * 2);
            brainCtx.fill();

            // Hover Neon Aura
            if (isHovered) {
                brainCtx.save();
                brainCtx.strokeStyle = '#FFFFFF';
                brainCtx.shadowColor = lobe.color;
                brainCtx.shadowBlur = 12;
                brainCtx.lineWidth = 1.5;
                brainCtx.beginPath();
                brainCtx.arc(lx, ly, pulseRad + 6, 0, Math.PI * 2);
                brainCtx.stroke();
                brainCtx.restore();
            }

            // Lobe Label & Category
            brainCtx.font = '600 9px Inter, system-ui, sans-serif';
            brainCtx.fillStyle = isHovered ? '#FFFFFF' : 'rgba(241, 245, 249, 0.85)';
            brainCtx.textAlign = 'center';
            brainCtx.fillText(lobe.cat, lx, ly + pulseRad + 13);
        }

        // 5. Draw Floating Thought Impulses (Search Keywords drifting through consciousness)
        for (const p of thoughtParticles) {
            p.x += p.vx;
            p.y += p.vy;

            // Wrap around boundaries
            if (p.x < 15) p.x = w - 25;
            if (p.x > w - 20) p.x = 20;
            if (p.y < 20) p.y = h - 50;
            if (p.y > h - 45) p.y = 25;

            const floatY = p.y + Math.sin(time * 1.5 + p.phase) * 3;

            // Pill box dimensions
            brainCtx.font = '500 8.5px Inter, system-ui, monospace';
            const textWidth = brainCtx.measureText(p.text).width;
            const boxW = textWidth + 14;
            const boxH = 16;
            const boxX = p.x - boxW / 2;
            const boxY = floatY - boxH / 2;

            // Pill background
            brainCtx.fillStyle = 'rgba(15, 23, 42, 0.72)';
            brainCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            brainCtx.lineWidth = 1;
            brainCtx.beginPath();
            brainCtx.roundRect(boxX, boxY, boxW, boxH, 8);
            brainCtx.fill();
            brainCtx.stroke();

            // Tiny dot indicator
            brainCtx.fillStyle = p.color;
            brainCtx.beginPath();
            brainCtx.arc(boxX + 6, floatY, 2, 0, Math.PI * 2);
            brainCtx.fill();

            // Text
            brainCtx.fillStyle = '#E2E8F0';
            brainCtx.textAlign = 'left';
            brainCtx.fillText(p.text, boxX + 11, floatY + 3);
        }

        mindscapeAnimFrameId = requestAnimationFrame(renderMindscapeFrame);
    }

    /**
     * Traverses timestamps to generate the 7x24 grid heatmap.
     */
    async function renderHeatmap() {
        const heatmap = Array(7).fill(0).map(() => Array(24).fill(0));
        const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;

        try {
            // Traverse timestamps index values (index-only scan, RAM-friendly)
            await db.visits.where('timestamp').above(ninetyDaysAgo).eachKey(timestamp => {
                const date = new Date(timestamp);
                const day = date.getDay(); // 0 (Sun) to 6 (Sat)
                
                // Adjusted to Mon-Sun visual sequence
                const adjustedDay = day === 0 ? 6 : day - 1;
                const hour = date.getHours();
                heatmap[adjustedDay][hour]++;
            });

            lastComputedHeatmap = heatmap;

            // Find maximum hourly value to establish visual color thresholds
            let maxVal = 0;
            for (let d = 0; d < 7; d++) {
                for (let h = 0; h < 24; h++) {
                    if (heatmap[d][h] > maxVal) maxVal = heatmap[d][h];
                }
            }

            const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            let html = '';

            for (let d = 0; d < 7; d++) {
                html += `<div class="heatmap-row">`;
                html += `<span class="heatmap-day-label">${dayNames[d]}</span>`;
                html += `<div class="heatmap-cells">`;
                
                for (let h = 0; h < 24; h++) {
                    const count = heatmap[d][h];
                    let level = 0;
                    if (count > 0) {
                        if (maxVal === 0) level = 1;
                        else level = Math.max(1, Math.min(5, Math.ceil((count / maxVal) * 5)));
                    }

                    const isSelected = activeDayOfWeekFilter === d && activeHourOfDayFilter === h;
                    const selectedClass = isSelected ? 'selected-cell' : '';

                    const amPmHour = h === 0 ? '12 AM' : h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`;
                    const tooltipText = `${dayNames[d]} at ${amPmHour}: ${count.toLocaleString()} visits`;

                    html += `<div class="heatmap-cell level-${level} ${selectedClass}" data-day="${d}" data-hour="${h}" data-tooltip="${tooltipText}"></div>`;
                }
                
                html += `</div>`;
                html += `</div>`;
            }

            heatmapGridContainer.innerHTML = html;

            // Cell click handler
            heatmapGridContainer.querySelectorAll('.heatmap-cell').forEach(cell => {
                cell.addEventListener('click', () => {
                    const d = parseInt(cell.getAttribute('data-day'));
                    const h = parseInt(cell.getAttribute('data-hour'));

                    if (activeDayOfWeekFilter === d && activeHourOfDayFilter === h) {
                        activeDayOfWeekFilter = null;
                        activeHourOfDayFilter = null;
                    } else {
                        activeDayOfWeekFilter = d;
                        activeHourOfDayFilter = h;
                    }

                    // Re-apply cell select highlights
                    heatmapGridContainer.querySelectorAll('.heatmap-cell').forEach(c => {
                        c.classList.remove('selected-cell');
                    });
                    
                    if (activeDayOfWeekFilter !== null) {
                        cell.classList.add('selected-cell');
                    }

                    runFilterAndQuery();
                });
            });

        } catch (e) {
            console.error('[ChronosDashboard] Error generating Heatmap:', e);
        }
    }

    /**
     * Aggregates database history metrics with zero object deserialization.
     * Computes metrics in O(1) from heatmap cache, domain index counts, and search index queries.
     */
    async function updateInsights() {
        try {
            const total = await db.visits.count();
            if (total === 0) return;

            // 1. Derive hourly and daily peak metrics from the heatmap grid (zero row deserialization)
            const hourlyCounts = Array(24).fill(0);
            const dailyCounts = Array(7).fill(0);

            if (lastComputedHeatmap) {
                for (let d = 0; d < 7; d++) {
                    for (let h = 0; h < 24; h++) {
                        const count = lastComputedHeatmap[d][h];
                        hourlyCounts[h] += count;
                        dailyCounts[d] += count;
                    }
                }
            }

            // Calculate Peak Hour
            let peakHour = 0;
            let peakHourVal = 0;
            for (let i = 0; i < 24; i++) {
                if (hourlyCounts[i] > peakHourVal) {
                    peakHourVal = hourlyCounts[i];
                    peakHour = i;
                }
            }
            const peakHourStr = peakHour === 0 ? '12 AM' : peakHour === 12 ? '12 PM' : peakHour > 12 ? `${peakHour - 12} PM` : `${peakHour} AM`;
            insightPeakTime.textContent = `${peakHourStr} (${peakHourVal.toLocaleString()} visits)`;

            // Calculate Peak Day (0=Mon, 1=Tue, ... 6=Sun)
            const dayNamesMonFirst = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
            let peakDay = 0;
            let peakDayVal = 0;
            for (let i = 0; i < 7; i++) {
                if (dailyCounts[i] > peakDayVal) {
                    peakDayVal = dailyCounts[i];
                    peakDay = i;
                }
            }
            insightActiveDay.textContent = `${dayNamesMonFirst[peakDay]} (${peakDayVal.toLocaleString()} visits)`;

            // 2. Search Ratio using fast index-only count (never loads rows into memory)
            const searchCount = await db.visits.where('searchQuery').above('').count();
            const searchRatio = ((searchCount / total) * 100).toFixed(1);
            insightSearchVelocity.textContent = `${searchRatio}% (${searchCount.toLocaleString()} queries)`;

            // 3. Focus Category derived from top domain counts
            if (lastDomainCounts && Object.keys(lastDomainCounts).length > 0) {
                const categorySums = {};
                for (const [dom, cnt] of Object.entries(lastDomainCounts)) {
                    const cat = getCategory(dom);
                    categorySums[cat] = (categorySums[cat] || 0) + cnt;
                }
                const sortedCategories = Object.entries(categorySums).sort((a, b) => b[1] - a[1]);
                if (sortedCategories.length > 0) {
                    insightFocusCategory.textContent = sortedCategories[0][0];
                }
            } else {
                insightFocusCategory.textContent = 'Tech & Learning';
            }

        } catch (e) {
            console.error('[ChronosDashboard] Error loading insights:', e);
        }
    }

    /**
     * Contextual directory path drill-down analyzer.
     */
    async function renderDrilldownPanel() {
        if (!activeDomainFilter) {
            drilldownPanel.classList.add('hidden');
            return;
        }

        try {
            // Retrieve only matching results for active domain
            const visits = await db.visits.where('domain').equals(activeDomainFilter).toArray();

            const pathCounts = {};
            for (const v of visits) {
                const subpath = extractSubpath(v.url, activeDomainFilter);
                if (subpath) {
                    pathCounts[subpath] = (pathCounts[subpath] || 0) + 1;
                }
            }

            const sortedPaths = Object.entries(pathCounts).sort((a, b) => b[1] - a[1]);

            if (sortedPaths.length === 0) {
                drilldownPanel.classList.add('hidden');
                return;
            }

            drilldownDomainLabel.textContent = activeDomainFilter;
            drilldownPanel.classList.remove('hidden');

            let html = '';
            // Display top 10 path segments
            const topPaths = sortedPaths.slice(0, 10);
            for (const [pathStr, count] of topPaths) {
                html += `<div class="drilldown-pill" data-path="${pathStr}">${pathStr} <span style="opacity: 0.5; font-size: 0.7rem; font-weight: bold; margin-left: 2px;">(${count})</span></div>`;
            }

            drilldownPillsList.innerHTML = html;

            // Drill-down filter triggers
            drilldownPillsList.querySelectorAll('.drilldown-pill').forEach(pill => {
                pill.addEventListener('click', () => {
                    const pathStr = pill.getAttribute('data-path');
                    searchInput.value = pathStr;
                    btnClearSearch.classList.remove('hidden');
                    runFilterAndQuery();
                });
            });

        } catch (e) {
            console.error('[ChronosDashboard] Drilldown builder error:', e);
            drilldownPanel.classList.add('hidden');
        }
    }

    /**
     * Extracts top subdirectory patterns based on the domain context.
     * @param {string} urlStr 
     * @param {string} domain 
     * @returns {string|null}
     */
    function extractSubpath(urlStr, domain) {
        try {
            const url = new URL(urlStr);
            const path = url.pathname;
            const parts = path.split('/').filter(Boolean);

            if (parts.length === 0) return null;

            const d = domain.toLowerCase();
            if (d.includes('reddit.com')) {
                if (parts[0] === 'r' && parts[1]) {
                    return `/r/${parts[1]}`;
                }
            }
            if (d.includes('github.com')) {
                if (parts[0] && parts[1]) {
                    return `/${parts[0]}/${parts[1]}`;
                }
                if (parts[0]) {
                    return `/${parts[0]}`;
                }
            }
            if (d.includes('youtube.com')) {
                if (parts[0] === 'watch' && url.searchParams.has('v')) {
                    return '/watch';
                }
                if (parts[0] === 'playlist') {
                    return '/playlist';
                }
            }

            // Fallback: Return first directory node
            return `/${parts[0]}`;

        } catch (e) {}
        return null;
    }

    // ----------------------------------------------------
    // HIGH-PERFORMANCE SEARCH & DYNAMIC FILTER QUERYING
    // ----------------------------------------------------

    /**
     * Executes filters and extracts matching primary keys.
     * This avoids loading bulk records into RAM, preserving high speed.
     */
    async function runFilterAndQuery() {
        try {
            // Parse keyword search input with multilingual Unicode support
            const searchVal = searchInput.value.trim().toLowerCase();
            const searchWords = searchVal ? (searchVal.match(/[\p{L}\p{N}]+/ug) || []) : [];
            
            let collection = null;

            // 1. Primary Ingestion Strategy
            if (searchWords.length > 0) {
                // If keywords exist, load matching key records using the multi-entry (*keywords) prefix index
                // Note: .distinct() is crucial for multi-entry indexes to avoid duplicate primary keys!
                collection = db.visits.where('keywords').startsWith(searchWords[0]).distinct();
            } else if (activeDomainFilter) {
                // If domain filter is active but no keywords, query by domain using compound index or domain index
                collection = db.visits.where('domain').equals(activeDomainFilter);
            } else {
                // Fetch all visits ordered chronologically using timestamp index
                collection = db.visits.orderBy('timestamp');
                if (sortOrder === 'desc') {
                    collection = collection.reverse();
                }
            }

            // 2. Perform key query
            // Exclude record deserialization by pulling ONLY primary keys to memory!
            let keys = await collection.primaryKeys();

            // 3. In-Memory Filter Refinements (for sub-attributes)
            // If we used a keyword prefix matching, we must resolve remaining keywords, sorting and secondary filters
            if (searchWords.length > 0 || activeDomainFilter || startDateFilter || endDateFilter || activeDayOfWeekFilter !== null || activeHourOfDayFilter !== null) {
                // Fetch only minimal object data (id, timestamp, title, url, domain) using bulkGet for speed
                const targetKeys = keys.slice(0, 30000);
                let records = typeof db.visits.bulkGet === 'function'
                    ? await db.visits.bulkGet(targetKeys)
                    : await Promise.all(targetKeys.map(id => db.visits.get(id)));
                
                // Clear null entries
                records = records.filter(Boolean);

                // Multi-word filtering
                if (searchWords.length > 1) {
                    for (let i = 1; i < searchWords.length; i++) {
                        const word = searchWords[i];
                        records = records.filter(r => 
                            (r.title && r.title.toLowerCase().includes(word)) || 
                            (r.url && r.url.toLowerCase().includes(word))
                        );
                    }
                }

                // Domain Filter
                if (activeDomainFilter && searchWords.length > 0) {
                    records = records.filter(r => r.domain === activeDomainFilter);
                }

                // Date Filters
                if (startDateFilter) {
                    records = records.filter(r => r.timestamp >= startDateFilter);
                }
                if (endDateFilter) {
                    records = records.filter(r => r.timestamp <= endDateFilter);
                }

                // Heatmap Day & Hour Filter
                if (activeDayOfWeekFilter !== null && activeHourOfDayFilter !== null) {
                    records = records.filter(r => {
                        const d = new Date(r.timestamp);
                        const day = d.getDay();
                        const adjustedDay = day === 0 ? 6 : day - 1; // Mon-Sun mapping
                        const hour = d.getHours();
                        return adjustedDay === activeDayOfWeekFilter && hour === activeHourOfDayFilter;
                    });
                }

                // Chronological Sorting
                records.sort((a, b) => sortOrder === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp);
                
                // Extract matching IDs
                matchedIds = records.map(r => r.id);
            } else {
                // If no filters are active, keys are already ordered properly from the index
                matchedIds = keys;
            }

            // Update filter chip UI
            updateFilterChips();

            // Refresh contextual path drill-down in sidebar
            await renderDrilldownPanel();

            // Refresh Virtual Scroll container
            resetVirtualScroll();

        } catch (e) {
            console.error('[ChronosDashboard] Filter query error:', e);
        }
    }

    // ----------------------------------------------------
    // DOM VIRTUAL SCROLL list IMPLEMENTATION
    // ----------------------------------------------------

    /**
     * Resets scrolling positions and sets the scrolling container spacer height.
     */
    function resetVirtualScroll() {
        const total = matchedIds.length;
        
        // Set height of scrollable area: total records * row height
        const totalHeight = total * ITEM_HEIGHT;
        vsSpacer.style.height = `${totalHeight}px`;

        // Reset scroll position to top
        vsViewport.scrollTop = 0;

        // Render initial view
        renderVirtualItems();

        // Update total matches label
        document.getElementById('record-count-label').textContent = `${total.toLocaleString()} matches`;

        if (total === 0) {
            emptyState.classList.remove('hidden');
        } else {
            emptyState.classList.add('hidden');
        }
    }

    /**
     * Core DOM Virtualizer function. Computes active slice and draws HTML.
     */
    async function renderVirtualItems() {
        const total = matchedIds.length;
        if (total === 0) {
            vsContent.innerHTML = '';
            return;
        }

        const currentTicket = ++renderTicket;
        const scrollTop = vsViewport.scrollTop;

        // Calculate index bounds based on current scroll offset
        let startIndex = Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_COUNT;
        let endIndex = Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ITEM_HEIGHT) + BUFFER_COUNT;

        // Clip to database array bounds
        if (startIndex < 0) startIndex = 0;
        if (endIndex >= total) endIndex = total - 1;

        // Fetch ONLY the visible rows from IndexedDB by ID (very high performance!)
        const visibleIds = matchedIds.slice(startIndex, endIndex + 1);
        
        try {
            const records = typeof db.visits.bulkGet === 'function'
                ? await db.visits.bulkGet(visibleIds)
                : await Promise.all(visibleIds.map(id => db.visits.get(id)));

            // Stale async render from previous scroll position! Discard!
            if (currentTicket !== renderTicket) return;

            // Build layout string
            let html = '';
            for (let i = 0; i < records.length; i++) {
                const item = records[i];
                if (!item) continue;

                const globalIndex = startIndex + i;
                const topPosition = globalIndex * ITEM_HEIGHT;
                
                const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const dateStr = new Date(item.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

                // Render row with strictly set height and absolute position
                html += `
                <div class="history-item" style="position: absolute; top: ${topPosition}px; left: 0; right: 0;">
                    <div class="item-left">
                        <div class="item-title-row">
                            <span class="item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
                            <span class="item-domain-badge">${escapeHtml(item.domain)}</span>
                        </div>
                        <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="item-url" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</a>
                    </div>
                    <div class="item-right">
                        <span class="item-time">${timeStr}</span>
                        <span class="item-date">${dateStr}</span>
                    </div>
                </div>
                `;
            }

            // Write only the visible window to the DOM
            vsContent.innerHTML = html;

        } catch (e) {
            console.error('[ChronosDashboard] Error loading virtual scroll batch:', e);
        }
    }

    // Bind scroll events to virtual list container
    vsViewport.addEventListener('scroll', () => {
        // High-frequency optimization: use requestAnimationFrame
        requestAnimationFrame(renderVirtualItems);
    });

    // ----------------------------------------------------
    // DYNAMIC FILTER CHIPS & USER CONTROLS
    // ----------------------------------------------------

    function setDomainFilter(domain) {
        activeDomainFilter = domain;
        runFilterAndQuery();
    }

    function removeDomainFilter() {
        activeDomainFilter = null;
        runFilterAndQuery();
    }

    function updateFilterChips() {
        chipsList.innerHTML = '';
        let hasActiveFilters = false;

        if (activeDomainFilter) {
            createChip(`Domain: ${activeDomainFilter}`, removeDomainFilter);
            hasActiveFilters = true;
        }

        const keyword = searchInput.value.trim();
        if (keyword) {
            createChip(`Search: "${keyword}"`, () => {
                searchInput.value = '';
                btnClearSearch.classList.add('hidden');
                runFilterAndQuery();
            });
            hasActiveFilters = true;
        }

        if (startDateFilter || endDateFilter) {
            let dateText = 'Date Range: ';
            if (startDateFilter && endDateFilter) {
                dateText += `${new Date(startDateFilter).toLocaleDateString()} - ${new Date(endDateFilter).toLocaleDateString()}`;
            } else if (startDateFilter) {
                dateText += `From ${new Date(startDateFilter).toLocaleDateString()}`;
            } else {
                dateText += `To ${new Date(endDateFilter).toLocaleDateString()}`;
            }
            
            createChip(dateText, () => {
                filterStartDate.value = '';
                filterEndDate.value = '';
                startDateFilter = null;
                endDateFilter = null;
                runFilterAndQuery();
            });
            hasActiveFilters = true;
        }

        // Heatmap Grid Active Filter Chip
        if (activeDayOfWeekFilter !== null && activeHourOfDayFilter !== null) {
            const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
            const amPmHour = activeHourOfDayFilter === 0 ? '12 AM' : activeHourOfDayFilter === 12 ? '12 PM' : activeHourOfDayFilter > 12 ? `${activeHourOfDayFilter - 12} PM` : `${activeHourOfDayFilter} AM`;
            
            createChip(`Time: ${dayNames[activeDayOfWeekFilter]} @ ${amPmHour}`, () => {
                activeDayOfWeekFilter = null;
                activeHourOfDayFilter = null;
                
                // Clear active selected borders in UI grid
                if (heatmapGridContainer) {
                    heatmapGridContainer.querySelectorAll('.heatmap-cell').forEach(c => {
                        c.classList.remove('selected-cell');
                    });
                }
                runFilterAndQuery();
            });
            hasActiveFilters = true;
        }

        if (hasActiveFilters) {
            chipsContainer.classList.remove('hidden');
            btnResetFilters.classList.remove('hidden');
        } else {
            chipsContainer.classList.add('hidden');
            btnResetFilters.classList.add('hidden');
        }
    }

    function createChip(text, onRemove) {
        const chip = document.createElement('div');
        chip.className = 'filter-chip';
        chip.innerHTML = `
            <span>${escapeHtml(text)}</span>
            <button>✕</button>
        `;
        chip.querySelector('button').addEventListener('click', onRemove);
        chipsList.appendChild(chip);
    }

    // ----------------------------------------------------
    // PARTIAL DATA EXPORT VIA DOWNLOADS API
    // ----------------------------------------------------

    btnExportFiltered.addEventListener('click', async () => {
        const total = matchedIds.length;
        if (total === 0) {
            alert('No filtered results available to export!');
            return;
        }

        btnExportFiltered.disabled = true;
        btnExportFiltered.textContent = '⚡ Exporting...';

        try {
            console.log(`[ChronosDashboard] Querying export content for ${total} records...`);
            
            // Fetch the filtered entries in small batches of 10,000 to prevent IndexedDB lock
            const records = [];
            const chunkSize = 10000;
            
            for (let i = 0; i < total; i += chunkSize) {
                const idsChunk = matchedIds.slice(i, i + chunkSize);
                const results = await Promise.all(idsChunk.map(id => db.visits.get(id)));
                records.push(...results.filter(Boolean));
            }

            // Convert array to CSV format
            let csvContent = 'title,url,domain,timestamp,timestamp_iso\n';
            for (const r of records) {
                const titleEscaped = `"${(r.title || '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
                const urlEscaped = `"${(r.url || '').replace(/"/g, '""')}"`;
                const domainEscaped = `"${(r.domain || '').replace(/"/g, '""')}"`;
                const isoDate = new Date(r.timestamp).toISOString();
                
                csvContent += `${titleEscaped},${urlEscaped},${domainEscaped},${r.timestamp},${isoDate}\n`;
            }

            // Prepend \uFEFF (UTF-8 BOM) so Excel renders Chinese, Arabic, and accented characters cleanly!
            const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
            const urlBlob = URL.createObjectURL(blob);

            const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
            
            // Execute Chrome native download
            chrome.downloads.download({
                url: urlBlob,
                filename: `chronos_filtered_history_${timestampStr}.csv`,
                saveAs: true
            }, () => {
                btnExportFiltered.disabled = false;
                btnExportFiltered.innerHTML = '📥 Export (CSV)';
                if (chrome.runtime.lastError) {
                    console.error('[ChronosDashboard] Partial CSV export download failed:', chrome.runtime.lastError.message);
                }
                // Revoke object URL after buffer period to prevent memory leak
                setTimeout(() => URL.revokeObjectURL(urlBlob), 60000);
            });

        } catch (error) {
            alert('Export failed: ' + error.message);
            btnExportFiltered.disabled = false;
            btnExportFiltered.innerHTML = '📥 Export (CSV)';
        }
    });

    // ----------------------------------------------------
    // USER EVENT BINDINGS
    // ----------------------------------------------------

    function setupEventListeners() {
        // Keyword search input (debounced search update)
        let searchTimeout = null;
        searchInput.addEventListener('input', () => {
            if (searchInput.value.trim().length > 0) {
                btnClearSearch.classList.remove('hidden');
            } else {
                btnClearSearch.classList.add('hidden');
            }

            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                runFilterAndQuery();
            }, 300); // 300ms debounce
        });

        btnClearSearch.addEventListener('click', () => {
            searchInput.value = '';
            btnClearSearch.classList.add('hidden');
            runFilterAndQuery();
        });

        // Sorting
        sortSelect.addEventListener('change', () => {
            sortOrder = sortSelect.value;
            runFilterAndQuery();
        });

        // Date selection (using local midnight to avoid UTC offsets!)
        filterStartDate.addEventListener('change', () => {
            const val = filterStartDate.value;
            if (val) {
                const [y, m, d] = val.split('-').map(Number);
                startDateFilter = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
            } else {
                startDateFilter = null;
            }
            runFilterAndQuery();
        });

        filterEndDate.addEventListener('change', () => {
            const val = filterEndDate.value;
            if (val) {
                const [y, m, d] = val.split('-').map(Number);
                endDateFilter = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
            } else {
                endDateFilter = null;
            }
            runFilterAndQuery();
        });

        // Reset all filters button
        btnResetFilters.addEventListener('click', () => {
            searchInput.value = '';
            btnClearSearch.classList.add('hidden');
            sortSelect.value = 'desc';
            sortOrder = 'desc';
            filterStartDate.value = '';
            filterEndDate.value = '';
            startDateFilter = null;
            endDateFilter = null;
            activeDomainFilter = null;
            activeDayOfWeekFilter = null;
            activeHourOfDayFilter = null;
            
            // Clear active cell highlights
            if (heatmapGridContainer) {
                heatmapGridContainer.querySelectorAll('.heatmap-cell').forEach(c => {
                    c.classList.remove('selected-cell');
                });
            }
            runFilterAndQuery();
        });

        // Close Drilldown panel
        if (btnCloseDrilldown) {
            btnCloseDrilldown.addEventListener('click', () => {
                activeDomainFilter = null;
                runFilterAndQuery();
            });
        }

        // Keywords Time-Window Pills
        const keywordsPillBtns = document.querySelectorAll('#keywords-time-pills .pill-btn');
        keywordsPillBtns.forEach(pBtn => {
            pBtn.addEventListener('click', async () => {
                keywordsPillBtns.forEach(b => b.classList.remove('active'));
                pBtn.classList.add('active');
                const range = pBtn.getAttribute('data-range');
                keywordsTimeRange = range === 'all' ? 'all' : parseInt(range, 10);
                await renderKeywordsChart(keywordsTimeRange);
            });
        });

        // Trends Time-Window Pills
        const trendsPillBtns = document.querySelectorAll('#trends-time-pills .pill-btn');
        trendsPillBtns.forEach(pBtn => {
            pBtn.addEventListener('click', async () => {
                trendsPillBtns.forEach(b => b.classList.remove('active'));
                pBtn.classList.add('active');
                const range = parseInt(pBtn.getAttribute('data-range'), 10);
                trendsTimeRange = range;
                await renderTrendsChart(trendsTimeRange);
            });
        });

        // Premium Segmented Control Tabs Event Listeners
        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabPanels = document.querySelectorAll('.analytics-tab-panel');

        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTabId = btn.getAttribute('data-tab');
                if (!targetTabId) return;

                // Deactivate all tab buttons and panels
                tabButtons.forEach(b => b.classList.remove('active'));
                tabPanels.forEach(p => p.classList.remove('active'));

                // Activate clicked button and target panel
                btn.classList.add('active');
                const targetPanel = document.getElementById(targetTabId);
                if (targetPanel) {
                    targetPanel.classList.add('active');
                }

                // Activate or pause Cognitive Mindscape neural animation loop
                if (targetTabId === 'tab-mind') {
                    startMindscapeAnimation();
                } else {
                    stopMindscapeAnimation();
                }

                // Smooth Chart.js redraw to fix 0-width dimensions from hidden tab state
                setTimeout(() => {
                    if (targetTabId === 'tab-domains' && chartDomains) {
                        chartDomains.resize();
                        chartDomains.update();
                    } else if (targetTabId === 'tab-trends' && chartTrends) {
                        chartTrends.resize();
                        chartTrends.update();
                    } else if (targetTabId === 'tab-keywords' && chartKeywords) {
                        chartKeywords.resize();
                        chartKeywords.update();
                    } else if (targetTabId === 'tab-mind') {
                        resizeBrainCanvas();
                    }
                }, 50);
            });
        });

        window.addEventListener('resize', () => {
            if (isMindTabActive) {
                resizeBrainCanvas();
            }
        });
    }

    // ----------------------------------------------------
    // HELPERS
    // ----------------------------------------------------

    function escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Start everything!
    await initDashboard();
});
