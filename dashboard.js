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
    let activeCategoryFilter = null;
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
    let topRecentSearchKeywords = ['local history', 'indexeddb', 'privacy vault', 'offline first', 'chronos'];
    let activeThoughtPool = ['local history', 'indexeddb', 'privacy vault', 'offline first', 'chronos', 'analytics'];
    let thoughtPoolCursor = 0;

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

            // Populate rich dynamic thought pool from user history
            await updateDynamicThoughtPool(keywordsTimeRange);

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
                    },
                    onClick: (event, elements) => {
                        if (elements.length > 0) {
                            const datasetIndex = elements[0].datasetIndex;
                            const catName = chartTrends.data.datasets[datasetIndex]?.label;
                            if (catName) {
                                toggleCategoryFilter(catName);
                            }
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
        const d = (domain || '').toLowerCase().trim();
        if (!d || d === 'unknown') return 'Tech & Learning';

        // 1. Entertainment (Media, streaming, gaming, audio, video)
        const entTargets = [
            'youtube.com', 'youtu.be', 'netflix.com', 'twitch.tv', 'vimeo.com',
            'spotify.com', 'soundcloud.com', 'disneyplus.com', 'hulu.com',
            'max.com', 'hbomax.com', 'primevideo.com', 'crunchyroll.com',
            'imdb.com', 'steampowered.com', 'steamcommunity.com', 'epicgames.com',
            'ign.com', 'kotaku.com', 'dailymotion.com', 'deezer.com'
        ];
        if (entTargets.some(t => d === t || d.endsWith('.' + t))) return 'Entertainment';
        if (d.includes('stream') || d.includes('anime') || d.includes('manga') || d.includes('movie')) return 'Entertainment';

        // 2. Social & Forums (Social networks, forums, chat, communities)
        const socialTargets = [
            'reddit.com', 'redd.it', 'quora.com', 'discord.com', 'discord.gg',
            'facebook.com', 'fb.com', 'twitter.com', 't.co', 'x.com',
            'linkedin.com', 'instagram.com', 'tiktok.com', 'threads.net',
            'pinterest.com', 'tumblr.com', 'bluesky.app', 'bsky.app', 'mastodon.social',
            'telegram.org', 't.me', 'whatsapp.com', 'messenger.com',
            'wechat.com', 'weibo.com', 'vk.com', 'news.ycombinator.com',
            'lobste.rs', 'discourse.org', 'slack.com'
        ];
        if (socialTargets.some(t => d === t || d.endsWith('.' + t))) return 'Social & Forums';
        if (d.includes('forum') || d.includes('community') || d.includes('discuss')) return 'Social & Forums';

        // 3. Search Engines (Web search, portals)
        const searchTargets = [
            'bing.com', 'duckduckgo.com', 'ddg.gg', 'yahoo.com',
            'baidu.com', 'ecosia.org', 'kagi.com', 'brave.com',
            'startpage.com', 'searx.be', 'searx.me', 'qwant.com', 'yandex.ru', 'yandex.com'
        ];
        if (searchTargets.some(t => d === t || d.endsWith('.' + t))) return 'Search Engines';
        if (d.startsWith('google.') || d.includes('.google.') || d.startsWith('yandex.')) return 'Search Engines';

        // 4. Shopping (E-commerce, marketplaces)
        const shoppingTargets = [
            'ebay.com', 'aliexpress.com', 'etsy.com', 'shopify.com',
            'walmart.com', 'taobao.com', 'target.com', 'bestbuy.com', 'costco.com',
            'temu.com', 'shein.com', 'ikea.com', 'newegg.com', 'craigslist.org'
        ];
        if (shoppingTargets.some(t => d === t || d.endsWith('.' + t))) return 'Shopping';
        if (d.startsWith('amazon.') || d.includes('.amazon.')) return 'Shopping';
        if (d.includes('shop') || d.includes('store')) return 'Shopping';

        // 5. Tech & Learning (Development, documentation, knowledge, AI, research)
        const techTargets = [
            'github.com', 'gitlab.com', 'stackoverflow.com', 'stackexchange.com',
            'superuser.com', 'serverfault.com', 'medium.com', 'dev.to',
            'wikipedia.org', 'wikimedia.org', 'mdn.mozilla.org', 'developer.mozilla.org',
            'w3schools.com', 'npmjs.com', 'pypi.org', 'openscad.org', 'arxiv.org',
            'docs.google.com', 'notion.so', 'chatgpt.com', 'openai.com',
            'claude.ai', 'anthropic.com', 'gemini.google.com', 'huggingface.co',
            'kaggle.com', 'codepen.io', 'replit.com', 'coursera.org', 'edx.org',
            'udemy.com', 'freecodecamp.org', 'css-tricks.com', 'geeksforgeeks.org',
            'hashnode.com', 'sublimehq.com', 'jetbrains.com'
        ];
        if (techTargets.some(t => d === t || d.endsWith('.' + t))) return 'Tech & Learning';
        if (d.includes('learn') || d.includes('docs') || d.includes('dev') || d.includes('code') || d.includes('wiki') || d.includes('.edu')) return 'Tech & Learning';

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
                await updateDynamicThoughtPool(days);
                return;
            }

            placeholderKeywords.classList.add('hidden');

            const topKeywords = sorted.slice(0, 8);
            const labels = topKeywords.map(x => x[0]);
            const data = topKeywords.map(x => x[1]);

            // Sync top recent search keywords to fuel the thought particles on the Mindscape canvas!
            if (labels.length > 0) {
                topRecentSearchKeywords = labels;
            }
            await updateDynamicThoughtPool(days);

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
        updateHudCategoryHighlight();

        // Update 3D cognitive brain activity distribution & rhythm mode
        cognitiveRhythmMode = (todayVisits >= 1.25 * median || momentum >= 35) ? 'sprint' : ((todayVisits <= 0.75 * median || momentum <= -25) ? 'dip' : 'steady');

        cognitiveActivityDistribution['Tech & Learning'] = (categorySums['Tech & Learning'] || 0) / safeTotal;
        cognitiveActivityDistribution['Search Engines'] = (categorySums['Search Engines'] || 0) / safeTotal;
        cognitiveActivityDistribution['Entertainment'] = (categorySums['Entertainment'] || 0) / safeTotal;
        cognitiveActivityDistribution['Social & Forums'] = (categorySums['Social & Forums'] || 0) / safeTotal;

        if (brainNodes3D && brainNodes3D.length > 0) {
            for (const node of brainNodes3D) {
                if (cognitiveActivityDistribution[node.cat] !== undefined) {
                    node.activity = 0.25 + cognitiveActivityDistribution[node.cat] * 1.5;
                }
            }
        }
    }

    // ----------------------------------------------------
    // COGNITIVE MINDSCAPE: 3D HOLOGRAPHIC NEURAL MATRIX
    // ----------------------------------------------------

    let brainNodes3D = [];
    let brainSynapses3D = [];
    let actionPotentials = [];
    let neuralShockwaves = [];
    let holographicThoughts = [];
    let ambientDustParticles = [];

    let cameraRotation = { yaw: 0, pitch: 0.15 };
    let targetRotation = { yaw: 0, pitch: 0.15 };
    let isDraggingCanvas = false;
    let lastDragMouse = { x: 0, y: 0 };
    let hasUserDragged = false;
    let hoveredLobe = null;
    let hoveredThought = null;
    let canvasMouse = { x: -1000, y: -1000 };

    let cognitiveRhythmMode = 'steady'; // 'sprint', 'dip', 'steady'
    let cognitiveActivityDistribution = {
        'Tech & Learning': 0.4,
        'Search Engines': 0.3,
        'Entertainment': 0.2,
        'Social & Forums': 0.1
    };

    let brainCanvas = null;
    let brainCtx = null;

    /**
     * Generates an anatomically structured 3D human brain point cloud:
     * Dual cerebral hemispheres with longitudinal fissure, gyri convolutions,
     * cerebellum, brainstem, and inter-hemispheric corpus callosum.
     */
    function generate3DBrainModel() {
        const nodes = [];

        // 1. Dual Cerebral Hemispheres (Left: s = -1, Right: s = +1)
        for (const s of [-1, 1]) {
            const N = 135;
            for (let i = 0; i < N; i++) {
                const u = Math.acos(1 - 2 * (i + 0.5) / N); // 0 to PI
                const v = Math.PI * (1 + Math.sqrt(5)) * i; // Golden spiral

                // Gyri & Sulci Convolutions (organic cortex fold harmonics)
                const gyri = 0.085 * Math.sin(5 * u) * Math.cos(6 * v) + 0.045 * Math.sin(10 * u + 4 * v);
                const r = 1.0 + gyri;

                // Spatial coordinates with hemisphere separation for longitudinal fissure
                let x = s * (Math.abs(Math.sin(u) * Math.cos(v)) * 0.68 + 0.075) * r;
                let y = (Math.sin(u) * Math.sin(v) * 0.94) * r;
                let z = (Math.cos(u) * 0.72) * r;

                // Anatomical shaping
                if (y > 0.25) {
                    z += 0.08 * (y - 0.25); // Frontal pole elevation
                }
                if (y > -0.25 && y < 0.25 && z < 0.05 && z > -0.4) {
                    x *= 1.18; // Temporal lateral bulge
                    z -= 0.06;
                }
                if (z < -0.2) {
                    x *= 0.88; // Basal tuck
                    y *= 0.92;
                }

                // Categorization by functional cerebral lobes
                let region = 'parietal';
                let cat = 'Search Engines';
                let color = '#38BDF8';
                let rgb = '56, 189, 248';

                if (y > 0.15) {
                    region = 'frontal';
                    cat = 'Tech & Learning';
                    color = '#10B981';
                    rgb = '16, 185, 129';
                } else if (z < -0.05 && Math.abs(x) > 0.32) {
                    region = 'temporal';
                    cat = 'Entertainment';
                    color = '#818CF8';
                    rgb = '129, 140, 248';
                } else if (y < -0.2) {
                    region = 'limbic';
                    cat = 'Social & Forums';
                    color = '#F472B6';
                    rgb = '244, 114, 182';
                }

                nodes.push({
                    x, y, z,
                    baseX: x, baseY: y, baseZ: z,
                    region, cat, color, rgb,
                    type: 'cortex',
                    flashIntensity: 0,
                    activity: 0.5,
                    connections: []
                });
            }
        }

        // 2. Cerebellum (Dual posterior inferior lobes)
        for (const s of [-1, 1]) {
            const N = 26;
            for (let i = 0; i < N; i++) {
                const u = Math.acos(1 - 2 * (i + 0.5) / N);
                const v = Math.PI * (1 + Math.sqrt(5)) * i;
                const x = s * (Math.abs(Math.sin(u) * Math.cos(v)) * 0.34 + 0.06);
                const y = -0.58 + Math.sin(u) * Math.sin(v) * 0.28;
                const z = -0.42 + Math.cos(u) * 0.22;
                nodes.push({
                    x, y, z,
                    baseX: x, baseY: y, baseZ: z,
                    region: 'limbic', cat: 'Social & Forums',
                    color: '#EC4899', rgb: '236, 72, 153',
                    type: 'cerebellum',
                    flashIntensity: 0,
                    activity: 0.4,
                    connections: []
                });
            }
        }

        // 3. Brainstem (Descending central neural pathway)
        for (let i = 0; i < 16; i++) {
            const t = i / 15;
            const z = -0.32 - t * 0.42;
            const y = -0.22 - t * 0.08;
            const spread = (1 - t * 0.4) * 0.12;
            const x = Math.sin(i * 1.7) * spread;
            nodes.push({
                x, y, z,
                baseX: x, baseY: y, baseZ: z,
                region: 'frontal', cat: 'Tech & Learning',
                color: '#34D399', rgb: '52, 211, 153',
                type: 'stem',
                flashIntensity: 0,
                activity: 0.6,
                connections: []
            });
        }

        // 4. Corpus Callosum (Deep inter-hemispheric bridging core)
        for (let i = 0; i < 30; i++) {
            const t = (i / 29) * 2 - 1;
            const y = t * 0.48;
            const z = 0.04 - (t * t) * 0.14;
            const x = Math.sin(i * 3.14) * 0.12;
            nodes.push({
                x, y, z,
                baseX: x, baseY: y, baseZ: z,
                region: 'parietal', cat: 'Search Engines',
                color: '#67E8F9', rgb: '103, 232, 249',
                type: 'core',
                flashIntensity: 0,
                activity: 0.5,
                connections: []
            });
        }

        // Inter-synaptic 3D Proximity Mesh
        const connections = [];
        const threshold = 0.235;
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const dx = nodes[i].x - nodes[j].x;
                const dy = nodes[i].y - nodes[j].y;
                const dz = nodes[i].z - nodes[j].z;
                const dist = Math.hypot(dx, dy, dz);
                if (dist < threshold) {
                    connections.push({ a: i, b: j, dist });
                    nodes[i].connections.push(j);
                    nodes[j].connections.push(i);
                }
            }
        }

        return { nodes, connections };
    }

    function initAmbientDust() {
        ambientDustParticles = [];
        for (let i = 0; i < 35; i++) {
            ambientDustParticles.push({
                x: (Math.random() - 0.5) * 3.2,
                y: (Math.random() - 0.5) * 3.2,
                z: (Math.random() - 0.5) * 2.2,
                vx: (Math.random() - 0.5) * 0.0015,
                vy: (Math.random() - 0.5) * 0.0015,
                vz: (Math.random() - 0.5) * 0.0015,
                size: 1.0 + Math.random() * 1.5,
                alpha: 0.2 + Math.random() * 0.4
            });
        }
    }

    /**
     * Extracts an intelligent, rich pool of 20-40 actual search queries, domains,
     * and browsing topics directly from the user's IndexedDB history.
     */
    async function updateDynamicThoughtPool(days = keywordsTimeRange) {
        try {
            const counts = {};
            const since = (days === 'all') ? 0 : (Date.now() - (Number(days) * 24 * 60 * 60 * 1000));

            // Pull a sample of recent visits (up to 1500)
            let collection = (since > 0)
                ? db.visits.where('timestamp').above(since)
                : db.visits.orderBy('timestamp').reverse();

            const visits = await collection.limit(1500).toArray();

            for (const v of visits) {
                // 1. Direct search query field
                let q = v.searchQuery;
                // 2. Extract on the fly from URL if missing
                if (!q && v.url) {
                    q = extractSearchQuery(v.url);
                }

                if (q && q.trim()) {
                    const clean = q.trim().toLowerCase();
                    if (clean.length >= 2 && clean.length <= 26) {
                        counts[clean] = (counts[clean] || 0) + 3;
                    }
                }

                // 3. Domain topic (e.g. openscad.org, github.com)
                if (v.domain && v.domain !== 'unknown' && !v.domain.includes('google.') && !v.domain.includes('bing.') && !v.domain.includes('duckduckgo.')) {
                    const cleanDom = v.domain.replace(/^www\./, '');
                    if (cleanDom.length >= 3 && cleanDom.length <= 24) {
                        counts[cleanDom] = (counts[cleanDom] || 0) + 1;
                    }
                }
            }

            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            const terms = sorted.map(x => x[0]);

            if (terms.length > 0) {
                activeThoughtPool = terms;
                topRecentSearchKeywords = terms.slice(0, 15);
            } else {
                activeThoughtPool = ['local history', 'indexeddb', 'privacy vault', 'offline first', 'chronos', 'analytics'];
                topRecentSearchKeywords = activeThoughtPool;
            }

            // Stagger next swap times for the satellites so they start morphing smoothly
            const nowSec = performance.now() * 0.001;
            holographicThoughts.forEach((th, idx) => {
                th.nextSwapTime = nowSec + 2.0 + idx * 2.2;
            });

            // If thought satellites haven't been spawned yet, initialize them
            if (holographicThoughts.length === 0 && brainNodes3D.length > 0) {
                refreshHolographicThoughts();
            }

        } catch (e) {
            console.error('[ChronosDashboard] Error updating thought pool:', e);
            if (activeThoughtPool.length === 0) {
                activeThoughtPool = ['local history', 'indexeddb', 'privacy vault', 'offline first', 'chronos'];
            }
        }
    }

    function refreshHolographicThoughts() {
        const pool = (activeThoughtPool && activeThoughtPool.length > 0)
            ? activeThoughtPool
            : ((topRecentSearchKeywords && topRecentSearchKeywords.length > 0)
                ? topRecentSearchKeywords
                : ['local history', 'indexeddb', 'privacy vault', 'offline first', 'chronos']);

        holographicThoughts = [];
        const count = Math.min(6, Math.max(3, pool.length));
        const nowSec = performance.now() * 0.001;

        for (let i = 0; i < count; i++) {
            const baseAngle = (i / count) * Math.PI * 2;
            const tetherIdx = Math.floor(Math.random() * Math.max(1, brainNodes3D.length));

            const colorPalette = [
                { color: '#38BDF8', rgb: '56, 189, 248' },
                { color: '#A78BFA', rgb: '167, 139, 250' },
                { color: '#34D399', rgb: '52, 211, 153' },
                { color: '#F472B6', rgb: '244, 114, 182' },
                { color: '#F59E0B', rgb: '245, 158, 11' }
            ];
            const pal = colorPalette[i % colorPalette.length];

            holographicThoughts.push({
                text: pool[i % pool.length],
                angle: baseAngle,
                orbitSpeed: 0.0035 + (i % 2 === 0 ? 0.0015 : -0.0015),
                radius: 1.45 + (i % 3) * 0.12,
                height: -0.25 + (i % 4) * 0.18,
                color: pal.color,
                rgb: pal.rgb,
                tetherIdx: tetherIdx,
                dataPackets: [
                    { t: 0.1, speed: 0.012 },
                    { t: 0.5, speed: 0.015 },
                    { t: 0.8, speed: 0.010 }
                ],
                projX: 0,
                projY: 0,
                projDepth: 1,
                boxW: 60,
                boxH: 20,
                opacity: 1.0,
                fadeState: 'idle',
                nextSwapTime: nowSec + 2.5 + i * 2.2, // Staggered initial swap intervals
                flash: 0
            });
        }
    }

    // Backwards-compatible alias for keyword chart sync
    function refreshThoughtParticles() {
        refreshHolographicThoughts();
    }

    function initCognitiveMindscape() {
        brainCanvas = document.getElementById('mind-brain-canvas');
        if (!brainCanvas) return;
        brainCtx = brainCanvas.getContext('2d');

        // Generate 3D anatomical model
        const model = generate3DBrainModel();
        brainNodes3D = model.nodes;
        brainSynapses3D = model.connections;

        // Initialize traveling electrical action potentials
        actionPotentials = [];
        const sparkCount = 38;
        for (let i = 0; i < sparkCount; i++) {
            if (brainSynapses3D.length === 0) break;
            const syn = brainSynapses3D[Math.floor(Math.random() * brainSynapses3D.length)];
            const na = brainNodes3D[syn.a];
            actionPotentials.push({
                from: syn.a,
                to: syn.b,
                t: Math.random(),
                speed: 0.006 + Math.random() * 0.009,
                color: na ? na.color : '#38BDF8',
                rgb: na ? na.rgb : '56, 189, 248'
            });
        }

        initAmbientDust();
        refreshHolographicThoughts();

        // Mouse & Touch Orbit Event Listeners
        brainCanvas.addEventListener('mousedown', (e) => {
            isDraggingCanvas = true;
            hasUserDragged = false;
            lastDragMouse = { x: e.clientX, y: e.clientY };
            brainCanvas.classList.add('grabbing');
        });

        window.addEventListener('mouseup', () => {
            if (isDraggingCanvas) {
                isDraggingCanvas = false;
                if (brainCanvas) brainCanvas.classList.remove('grabbing');
            }
        });

        brainCanvas.addEventListener('mousemove', (e) => {
            const rect = brainCanvas.getBoundingClientRect();
            canvasMouse.x = e.clientX - rect.left;
            canvasMouse.y = e.clientY - rect.top;

            const w = brainCanvas.clientWidth;
            const h = brainCanvas.clientHeight;

            if (isDraggingCanvas) {
                hasUserDragged = true;
                const dx = e.clientX - lastDragMouse.x;
                const dy = e.clientY - lastDragMouse.y;
                cameraRotation.yaw += dx * 0.009;
                cameraRotation.pitch = Math.max(-0.65, Math.min(0.85, cameraRotation.pitch - dy * 0.009));
                targetRotation.yaw = cameraRotation.yaw;
                targetRotation.pitch = cameraRotation.pitch;
                lastDragMouse = { x: e.clientX, y: e.clientY };
            } else {
                // Subtle responsive parallax tilt
                targetRotation.pitch = ((canvasMouse.y / h) - 0.5) * 0.55 + 0.15;
                targetRotation.yaw = cameraRotation.yaw + ((canvasMouse.x / w) - 0.5) * 0.7;
            }

            // Hit test thought badges first
            let foundThought = null;
            for (const th of holographicThoughts) {
                const dist = Math.hypot(canvasMouse.x - th.projX, canvasMouse.y - th.projY);
                if (dist <= 30) {
                    foundThought = th;
                    break;
                }
            }
            hoveredThought = foundThought;

            // Hit test functional lobes
            let foundLobe = null;
            if (!hoveredThought) {
                let minDist = 45;
                for (const n of brainNodes3D) {
                    const dist = Math.hypot(canvasMouse.x - n.projX, canvasMouse.y - n.projY);
                    if (dist < minDist) {
                        minDist = dist;
                        foundLobe = n.cat;
                    }
                }
            }
            hoveredLobe = foundLobe;

            if (hoveredThought || hoveredLobe) {
                brainCanvas.style.cursor = 'pointer';
            } else if (isDraggingCanvas) {
                brainCanvas.style.cursor = 'grabbing';
            } else {
                brainCanvas.style.cursor = 'grab';
            }
        });

        brainCanvas.addEventListener('mouseleave', () => {
            canvasMouse.x = -1000;
            canvasMouse.y = -1000;
            hoveredLobe = null;
            hoveredThought = null;
        });

        brainCanvas.addEventListener('click', (e) => {
            if (hasUserDragged) return; // Prevent firing filter after rotating camera

            const rect = brainCanvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;

            // Spawn radial EMP Shockwave at click point
            neuralShockwaves.push({
                x: cx,
                y: cy,
                radius: 0,
                maxRadius: 240,
                alpha: 1.0,
                color: hoveredThought ? hoveredThought.color : (hoveredLobe ? '#38BDF8' : '#818CF8')
            });

            // If user clicked an orbiting thought satellite:
            if (hoveredThought) {
                const thoughtText = (hoveredThought.text || '').trim();
                if (thoughtText.includes('.') && !thoughtText.includes(' ')) {
                    setDomainFilter(thoughtText);
                } else {
                    searchInput.value = thoughtText;
                    btnClearSearch.classList.remove('hidden');
                    runFilterAndQuery();
                }
                return;
            }

            // If user clicked a functional brain lobe:
            if (hoveredLobe) {
                toggleCategoryFilter(hoveredLobe);
                return;
            }
        });

        // Wire reset orbit button
        const btnResetOrbit = document.getElementById('btn-reset-brain-orbit');
        if (btnResetOrbit) {
            btnResetOrbit.addEventListener('click', () => {
                cameraRotation.yaw = 0;
                cameraRotation.pitch = 0.15;
                targetRotation.yaw = 0;
                targetRotation.pitch = 0.15;
            });
        }

        // Wire HUD items click and hover
        document.querySelectorAll('#mind-hud-overlay .hud-item').forEach(item => {
            const cat = item.getAttribute('data-category');
            item.addEventListener('mouseenter', () => {
                hoveredLobe = cat;
            });
            item.addEventListener('mouseleave', () => {
                if (hoveredLobe === cat) hoveredLobe = null;
            });
            item.addEventListener('click', () => {
                if (cat) {
                    toggleCategoryFilter(cat);
                }
            });
        });
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

    /**
     * Real-time 60FPS 3D Holographic Rendering Pipeline:
     * Additive luminous synapses, action potential sparks, depth attenuation,
     * brainwave oscillation, orbiting thought satellites, and telemetry callouts.
     */
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

        brainCtx.save();
        brainCtx.setTransform(1, 0, 0, 1, 0, 0);
        brainCtx.clearRect(0, 0, brainCanvas.width, brainCanvas.height);
        brainCtx.restore();

        const time = timestamp * 0.001;
        const centerX = w * 0.50;
        const centerY = h * 0.48;

        // Camera dynamics
        if (!isDraggingCanvas) {
            cameraRotation.yaw += 0.0045; // Hypnotic slow celestial drift
            cameraRotation.pitch += (targetRotation.pitch - cameraRotation.pitch) * 0.06;
        }

        const cosY = Math.cos(cameraRotation.yaw);
        const sinY = Math.sin(cameraRotation.yaw);
        const cosP = Math.cos(cameraRotation.pitch);
        const sinP = Math.sin(cameraRotation.pitch);

        const fov = 340;
        const cameraDist = 2.45;
        const baseScale = Math.min(w, h) * 0.42;

        // 1. Ambient Cosmic Dust Particles
        for (const p of ambientDustParticles) {
            p.x += p.vx;
            p.y += p.vy;
            p.z += p.vz;
            if (p.x < -1.6) p.x = 1.6;
            if (p.x > 1.6) p.x = -1.6;
            if (p.y < -1.6) p.y = 1.6;
            if (p.y > 1.6) p.y = -1.6;
            if (p.z < -1.1) p.z = 1.1;
            if (p.z > 1.1) p.z = -1.1;

            const x1 = p.x * cosY - p.y * sinY;
            const y1 = p.x * sinY + p.y * cosY;
            const y2 = y1 * cosP - p.z * sinP;
            const z2 = y1 * sinP + p.z * cosP;
            const depth = fov / (fov + (y2 + cameraDist) * 110);

            const px = centerX + x1 * baseScale * depth;
            const py = centerY - z2 * baseScale * depth;

            brainCtx.fillStyle = `rgba(167, 139, 250, ${p.alpha * depth * 0.6})`;
            brainCtx.beginPath();
            brainCtx.arc(px, py, p.size * depth, 0, Math.PI * 2);
            brainCtx.fill();
        }

        // Holographic Gyroscope / Base Coordinate Rings
        brainCtx.save();
        brainCtx.strokeStyle = 'rgba(99, 102, 241, 0.1)';
        brainCtx.lineWidth = 1;
        brainCtx.setLineDash([3, 5]);
        brainCtx.beginPath();
        brainCtx.ellipse(centerX, centerY + baseScale * 0.72, baseScale * 0.85, baseScale * 0.22, 0, 0, Math.PI * 2);
        brainCtx.stroke();
        brainCtx.setLineDash([]);
        brainCtx.restore();

        // 2. Project 3D Nodes to 2D
        const waveSpeed = cognitiveRhythmMode === 'sprint' ? 3.5 : 2.0;
        const wavePhase = time * waveSpeed;

        for (let i = 0; i < brainNodes3D.length; i++) {
            const node = brainNodes3D[i];

            // Coherent Brainwave (travelling along Y axis)
            const brainwave = Math.sin(wavePhase - node.baseY * 3.2);
            const waveGlow = Math.max(0, brainwave) * 0.35;

            // Breathing expansion
            const breathe = 1.0 + Math.sin(time * 2.0) * 0.015 + (node.flashIntensity * 0.08);

            const nx = node.baseX * breathe;
            const ny = node.baseY * breathe;
            const nz = node.baseZ * breathe;

            // 3D Yaw Rotation
            const x1 = nx * cosY - ny * sinY;
            const y1 = nx * sinY + ny * cosY;
            const z1 = nz;

            // 3D Pitch Rotation
            const y2 = y1 * cosP - z1 * sinP;
            const z2 = y1 * sinP + z1 * cosP;
            const x2 = x1;

            // Perspective projection
            const depth = fov / (fov + (y2 + cameraDist) * 110);
            node.projX = centerX + x2 * baseScale * depth;
            node.projY = centerY - z2 * baseScale * depth;
            node.projDepth = depth;
            node.depthZ = y2;
            node.waveGlow = waveGlow;
        }

        // 3. Render Synaptic Filament Plexus (Additive Glowing Fibers)
        brainCtx.save();
        brainCtx.globalCompositeOperation = 'lighter'; // Additive blending for luminous bloom

        for (let i = 0; i < brainSynapses3D.length; i++) {
            const syn = brainSynapses3D[i];
            const na = brainNodes3D[syn.a];
            const nb = brainNodes3D[syn.b];

            const avgDepth = (na.projDepth + nb.projDepth) * 0.5;
            let alpha = (1.0 - syn.dist / 0.235) * 0.32 * avgDepth;

            const isHighlighted = hoveredLobe && (na.cat === hoveredLobe || nb.cat === hoveredLobe);
            if (isHighlighted) {
                alpha *= 2.5;
            }

            if (alpha <= 0.015) continue;

            brainCtx.beginPath();
            brainCtx.moveTo(na.projX, na.projY);
            brainCtx.lineTo(nb.projX, nb.projY);
            brainCtx.strokeStyle = `rgba(${na.rgb}, ${Math.min(1, alpha)})`;
            brainCtx.lineWidth = (isHighlighted ? 1.4 : 0.8) * avgDepth;
            brainCtx.stroke();
        }

        // 4. Render Action Potential Sparks (Electric Impulses)
        const pulseSpeedMult = cognitiveRhythmMode === 'sprint' ? 1.5 : (cognitiveRhythmMode === 'dip' ? 0.7 : 1.0);

        for (const spark of actionPotentials) {
            spark.t += spark.speed * pulseSpeedMult;
            if (spark.t >= 1) {
                spark.t = 0;
                const destNode = brainNodes3D[spark.to];
                if (destNode) {
                    destNode.flashIntensity = 1.0;
                    // Branch into next synapse
                    if (destNode.connections.length > 0 && Math.random() < 0.7) {
                        spark.from = spark.to;
                        spark.to = destNode.connections[Math.floor(Math.random() * destNode.connections.length)];
                    } else {
                        const randomSyn = brainSynapses3D[Math.floor(Math.random() * brainSynapses3D.length)];
                        spark.from = randomSyn.a;
                        spark.to = randomSyn.b;
                    }
                }
            }

            const na = brainNodes3D[spark.from];
            const nb = brainNodes3D[spark.to];
            if (!na || !nb) continue;

            const t = spark.t;
            const sx = na.projX + (nb.projX - na.projX) * t;
            const sy = na.projY + (nb.projY - na.projY) * t;
            const avgDepth = (na.projDepth + nb.projDepth) * 0.5;

            // Glowing Comet Head
            brainCtx.fillStyle = '#FFFFFF';
            brainCtx.beginPath();
            brainCtx.arc(sx, sy, 2.0 * avgDepth, 0, Math.PI * 2);
            brainCtx.fill();

            // Glowing Halo
            brainCtx.fillStyle = `rgba(${na.rgb}, ${0.8 * avgDepth})`;
            brainCtx.beginPath();
            brainCtx.arc(sx, sy, 5.0 * avgDepth, 0, Math.PI * 2);
            brainCtx.fill();
        }

        // 5. Render Brain Nodes (Synaptic Neurons)
        for (let i = 0; i < brainNodes3D.length; i++) {
            const n = brainNodes3D[i];
            const isLobeHovered = hoveredLobe && n.cat === hoveredLobe;

            const baseR = (n.type === 'stem' ? 1.5 : (n.type === 'cerebellum' ? 1.7 : 2.1));
            const rad = baseR * n.projDepth * (1 + n.flashIntensity * 1.6 + (isLobeHovered ? 0.9 : 0));

            // Radial Aura Glow
            const auraRad = rad * 4.5;
            const auraAlpha = (0.28 + n.flashIntensity * 0.55 + n.waveGlow + (isLobeHovered ? 0.45 : 0)) * n.projDepth;

            const grad = brainCtx.createRadialGradient(n.projX, n.projY, 1, n.projX, n.projY, auraRad);
            grad.addColorStop(0, `rgba(${n.rgb}, ${Math.min(1, auraAlpha)})`);
            grad.addColorStop(1, `rgba(${n.rgb}, 0)`);
            brainCtx.fillStyle = grad;
            brainCtx.beginPath();
            brainCtx.arc(n.projX, n.projY, auraRad, 0, Math.PI * 2);
            brainCtx.fill();

            // Core Hotspot
            brainCtx.fillStyle = (n.flashIntensity > 0.4) ? '#FFFFFF' : n.color;
            brainCtx.beginPath();
            brainCtx.arc(n.projX, n.projY, rad, 0, Math.PI * 2);
            brainCtx.fill();

            // Decay flash
            if (n.flashIntensity > 0) {
                n.flashIntensity = Math.max(0, n.flashIntensity - 0.045);
            }
        }

        brainCtx.restore(); // Exit lighter mode for crisp text & badges

        // 6. Render Radial Shockwaves (Click EMP Lightning Burst)
        for (let i = neuralShockwaves.length - 1; i >= 0; i--) {
            const sw = neuralShockwaves[i];
            sw.radius += 8;
            sw.alpha -= 0.038;

            if (sw.alpha <= 0 || sw.radius >= sw.maxRadius) {
                neuralShockwaves.splice(i, 1);
                continue;
            }

            // Excite nodes passing the shockwave
            for (const n of brainNodes3D) {
                const dist = Math.hypot(n.projX - sw.x, n.projY - sw.y);
                if (Math.abs(dist - sw.radius) < 14) {
                    n.flashIntensity = Math.max(n.flashIntensity, 0.9);
                }
            }

            brainCtx.save();
            brainCtx.strokeStyle = sw.color;
            brainCtx.lineWidth = 2.0 * sw.alpha;
            brainCtx.globalAlpha = sw.alpha;
            brainCtx.shadowColor = sw.color;
            brainCtx.shadowBlur = 14;
            brainCtx.beginPath();
            brainCtx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
            brainCtx.stroke();
            brainCtx.restore();
        }

        // 7. Render Orbiting Holographic Thought Satellites (Search Ingestion Streams)
        for (const th of holographicThoughts) {
            th.angle += th.orbitSpeed;

            // Dynamic thought cycling across consciousness
            if (th.fadeState === 'idle') {
                if (time >= th.nextSwapTime && activeThoughtPool.length > 1) {
                    th.fadeState = 'fading_out';
                }
            } else if (th.fadeState === 'fading_out') {
                th.opacity -= 0.045; // Smooth fade out
                if (th.opacity <= 0) {
                    th.opacity = 0;

                    // Pick next thought from activeThoughtPool
                    thoughtPoolCursor = (thoughtPoolCursor + 1) % activeThoughtPool.length;
                    let nextTerm = activeThoughtPool[thoughtPoolCursor];

                    // Ensure not duplicating an already visible satellite
                    const currentlyShown = holographicThoughts.map(x => x.text);
                    if (currentlyShown.includes(nextTerm) && activeThoughtPool.length > 6) {
                        thoughtPoolCursor = (thoughtPoolCursor + 1) % activeThoughtPool.length;
                        nextTerm = activeThoughtPool[thoughtPoolCursor];
                    }

                    th.text = nextTerm;

                    // Re-tether to a random cortex node
                    th.tetherIdx = Math.floor(Math.random() * Math.max(1, brainNodes3D.length));

                    // Cycle colors dynamically
                    const colorChoices = [
                        { color: '#38BDF8', rgb: '56, 189, 248' },
                        { color: '#A78BFA', rgb: '167, 139, 250' },
                        { color: '#34D399', rgb: '52, 211, 153' },
                        { color: '#F472B6', rgb: '244, 114, 182' },
                        { color: '#F59E0B', rgb: '245, 158, 11' }
                    ];
                    const chosen = colorChoices[Math.floor(Math.random() * colorChoices.length)];
                    th.color = chosen.color;
                    th.rgb = chosen.rgb;

                    th.fadeState = 'fading_in';
                }
            } else if (th.fadeState === 'fading_in') {
                th.opacity += 0.045;
                if (th.opacity >= 1.0) {
                    th.opacity = 1.0;
                    th.fadeState = 'idle';
                    th.flash = 1.0; // Emergence bloom
                    th.nextSwapTime = time + 7.0 + Math.random() * 5.0; // Stay visible for 7-12 seconds

                    // Excite tether node in the cortex
                    const tn = brainNodes3D[th.tetherIdx];
                    if (tn) tn.flashIntensity = 1.0;
                }
            }

            if (th.flash > 0) {
                th.flash = Math.max(0, th.flash - 0.04);
            }

            const ox = Math.cos(th.angle) * th.radius;
            const oy = Math.sin(th.angle) * th.radius;
            const oz = th.height + Math.sin(th.angle * 2) * 0.15;

            // Rotate with camera
            const x1 = ox * cosY - oy * sinY;
            const y1 = ox * sinY + oy * cosY;
            const z1 = oz;

            const y2 = y1 * cosP - z1 * sinP;
            const z2 = y1 * sinP + z1 * cosP;
            const x2 = x1;

            const depth = fov / (fov + (y2 + cameraDist) * 110);
            th.projX = centerX + x2 * baseScale * depth;
            th.projY = centerY - z2 * baseScale * depth;
            th.projDepth = depth;

            // Connect to tether node in cortex
            const tetherNode = brainNodes3D[th.tetherIdx] || brainNodes3D[0];
            const isHovered = hoveredThought === th;
            const effectiveAlpha = th.opacity * depth;

            if (effectiveAlpha <= 0.01) continue;

            // Draw Curved Energy Filament (Tether spline)
            const midX = (th.projX + tetherNode.projX) * 0.5;
            const midY = (th.projY + tetherNode.projY) * 0.5 - 18 * depth;

            brainCtx.save();
            brainCtx.beginPath();
            brainCtx.moveTo(th.projX, th.projY);
            brainCtx.quadraticCurveTo(midX, midY, tetherNode.projX, tetherNode.projY);
            brainCtx.strokeStyle = isHovered ? '#FFFFFF' : `rgba(${th.rgb}, ${0.28 * effectiveAlpha})`;
            brainCtx.lineWidth = (isHovered ? 1.6 : 0.9) * th.opacity;
            brainCtx.stroke();

            // Stream Ingestion Data Particles along tether into the brain!
            for (const dp of th.dataPackets) {
                dp.t += dp.speed;
                if (dp.t >= 1) dp.t = 0;

                const t = dp.t;
                const px = (1 - t) * (1 - t) * th.projX + 2 * (1 - t) * t * midX + t * t * tetherNode.projX;
                const py = (1 - t) * (1 - t) * th.projY + 2 * (1 - t) * t * midY + t * t * tetherNode.projY;

                brainCtx.fillStyle = isHovered ? '#FFFFFF' : th.color;
                brainCtx.globalAlpha = effectiveAlpha;
                brainCtx.beginPath();
                brainCtx.arc(px, py, 1.8 * depth, 0, Math.PI * 2);
                brainCtx.fill();
            }

            // Draw Holographic Thought Badge
            brainCtx.font = '600 9px Inter, system-ui, sans-serif';
            const textW = brainCtx.measureText(th.text).width;
            const boxW = textW + 18;
            const boxH = 18;
            const boxX = th.projX - boxW / 2;
            const boxY = th.projY - boxH / 2;
            th.boxW = boxW;
            th.boxH = boxH;

            // Glassmorphic background
            brainCtx.globalAlpha = effectiveAlpha;
            brainCtx.fillStyle = isHovered ? 'rgba(30, 41, 59, 0.95)' : 'rgba(10, 15, 29, 0.78)';
            brainCtx.strokeStyle = isHovered ? '#FFFFFF' : `rgba(${th.rgb}, ${0.5 * effectiveAlpha})`;
            brainCtx.lineWidth = isHovered ? 1.5 : 1;
            if (isHovered || th.flash > 0) {
                brainCtx.shadowColor = th.color;
                brainCtx.shadowBlur = isHovered ? 14 : (th.flash * 16);
            }
            brainCtx.beginPath();
            brainCtx.roundRect(boxX, boxY, boxW, boxH, 9);
            brainCtx.fill();
            brainCtx.stroke();
            brainCtx.shadowBlur = 0;

            // Neon accent dot
            brainCtx.fillStyle = th.color;
            brainCtx.beginPath();
            brainCtx.arc(boxX + 7, th.projY, 2.5, 0, Math.PI * 2);
            brainCtx.fill();

            // Text
            brainCtx.fillStyle = isHovered ? '#FFFFFF' : '#E2E8F0';
            brainCtx.textAlign = 'left';
            brainCtx.fillText(th.text, boxX + 13, th.projY + 3.2);

            brainCtx.restore();
        }

        // 8. Hover Telemetry HUD Callout
        if (hoveredLobe && !hoveredThought) {
            let sumX = 0, sumY = 0, count = 0;
            let lobeColor = '#38BDF8';
            for (const n of brainNodes3D) {
                if (n.cat === hoveredLobe) {
                    sumX += n.projX;
                    sumY += n.projY;
                    count++;
                    lobeColor = n.color;
                }
            }
            if (count > 0) {
                const cx = sumX / count;
                const cy = sumY / count;
                const pct = Math.round((cognitiveActivityDistribution[hoveredLobe] || 0) * 100);

                brainCtx.save();
                brainCtx.font = '700 9.5px Inter, system-ui, sans-serif';
                const labelText = `⚡ ${hoveredLobe.toUpperCase()} (${pct}%)`;
                const lw = brainCtx.measureText(labelText).width;

                const lx = Math.max(10, Math.min(w - lw - 24, cx - lw / 2));
                const ly = Math.max(30, cy - 35);

                brainCtx.fillStyle = 'rgba(15, 23, 42, 0.9)';
                brainCtx.strokeStyle = lobeColor;
                brainCtx.lineWidth = 1.2;
                brainCtx.shadowColor = lobeColor;
                brainCtx.shadowBlur = 10;
                brainCtx.beginPath();
                brainCtx.roundRect(lx, ly, lw + 16, 20, 6);
                brainCtx.fill();
                brainCtx.stroke();

                brainCtx.shadowBlur = 0;
                brainCtx.fillStyle = '#FFFFFF';
                brainCtx.textAlign = 'left';
                brainCtx.fillText(labelText, lx + 8, ly + 13.5);
                brainCtx.restore();
            }
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
            } else if (activeCategoryFilter && searchWords.length === 0 && !activeDomainFilter) {
                // High-performance streaming filter directly on timestamp index
                let col = null;
                if (startDateFilter && endDateFilter) {
                    col = db.visits.where('timestamp').between(startDateFilter, endDateFilter, true, true);
                } else if (startDateFilter) {
                    col = db.visits.where('timestamp').aboveOrEqual(startDateFilter);
                } else if (endDateFilter) {
                    col = db.visits.where('timestamp').belowOrEqual(endDateFilter);
                } else {
                    col = db.visits.orderBy('timestamp');
                }

                if (sortOrder === 'desc') {
                    col = col.reverse();
                }

                matchedIds = await col.filter(r => {
                    if (getCategory(r.domain) !== activeCategoryFilter) return false;
                    if (activeDayOfWeekFilter !== null && activeHourOfDayFilter !== null) {
                        const d = new Date(r.timestamp);
                        const day = d.getDay();
                        const adjustedDay = day === 0 ? 6 : day - 1;
                        const hour = d.getHours();
                        return adjustedDay === activeDayOfWeekFilter && hour === activeHourOfDayFilter;
                    }
                    return true;
                }).limit(30000).primaryKeys();

                // Update filter chip UI
                updateFilterChips();
                await renderDrilldownPanel();
                resetVirtualScroll();
                return;
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
            if (searchWords.length > 0 || activeDomainFilter || activeCategoryFilter || startDateFilter || endDateFilter || activeDayOfWeekFilter !== null || activeHourOfDayFilter !== null) {
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

                // Category Filter (when combined with keywords or domain filter)
                if (activeCategoryFilter) {
                    records = records.filter(r => getCategory(r.domain) === activeCategoryFilter);
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

    function setCategoryFilter(category) {
        activeCategoryFilter = category;
        updateHudCategoryHighlight();
        runFilterAndQuery();
    }

    function toggleCategoryFilter(category) {
        activeCategoryFilter = (activeCategoryFilter === category) ? null : category;
        updateHudCategoryHighlight();
        runFilterAndQuery();
    }

    function removeCategoryFilter() {
        activeCategoryFilter = null;
        updateHudCategoryHighlight();
        runFilterAndQuery();
    }

    function updateHudCategoryHighlight() {
        document.querySelectorAll('#mind-hud-overlay .hud-item').forEach(el => {
            const cat = el.getAttribute('data-category');
            if (activeCategoryFilter && cat === activeCategoryFilter) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        });
    }

    function updateFilterChips() {
        chipsList.innerHTML = '';
        let hasActiveFilters = false;

        if (activeDomainFilter) {
            createChip(`Domain: ${activeDomainFilter}`, removeDomainFilter);
            hasActiveFilters = true;
        }

        if (activeCategoryFilter) {
            createChip(`Category: ${activeCategoryFilter}`, removeCategoryFilter);
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
            activeCategoryFilter = null;
            activeDayOfWeekFilter = null;
            activeHourOfDayFilter = null;
            updateHudCategoryHighlight();
            
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
