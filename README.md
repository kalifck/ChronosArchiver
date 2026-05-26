# ⏳ ChronosArchiver

> **Uncapped, Persistent Local Browsing Vault & Interactive Analytics Dashboard**

ChronosArchiver is a production-grade, highly optimized, and **100% private** Chrome Extension (Manifest V3) designed to permanently archive your browsing history locally in an IndexedDB database—bypassing Google Chrome's native 90-day history deletion limit. It features a stunning, zero-scroll SaaS-style analytics dashboard to explore, query, and analyze your browsing footprints in real-time.

---

## 🌟 Core Features

* **🔒 100% Local & Private First**: All indexing and storage occurs entirely on your device using IndexedDB. Zero external network calls, zero tracking, zero data collections.
* **📂 Uncapped Persistent Storage**: Holds 500,000+ visit records seamlessly by utilizing Dexie's index-only cursor scans to perform statistics and search queries without loading bulk rows into RAM.
* **⚡ 60FPS DOM Virtual Scroll**: Custom-engineered virtualized list chronicle that renders only 20–30 DOM rows in the viewport, pulling records by primary key dynamically during scrolls to prevent browser lag.
* **📅 Interactive "When" Heatmap**: A custom HTML/CSS Grid (7 days × 24 hours) showing hourly density. Click any cell to instantly filter your entire history to visits that occurred during that specific hour and weekday.
* **🔍 "What" Multi-Word Keyword Search**: Uses a dynamic multi-entry prefix index (`*keywords`) to deliver instant results over massive datasets. Features automatic query extraction for Google, YouTube, Bing, Yahoo, DuckDuckGo, GitHub, and Reddit.
* **📈 Stacked Interest Trends**: Line chart displaying your topic interest spikes (*Tech & Learning, Entertainment, Forums, Shopping, and Search Engines*) over a rolling 14-day timeline.
* **🍩 Domain & Subpath Drill-Down**: Interactive doughnut chart showing top domains. Click a slice to filter, revealing an active drill-down pane that parses and ranks the top subdirectories you browse (e.g., specific subreddits or GitHub repositories).
* **📤 Instant JSON & CSV Migrations**: Export your custom query segments to a CSV instantly via Chrome's native downloads API, or drag-and-drop chunked JSON backups to move your database to a new system.
* **🇲🇦 Built in Morocco with Pizzazz**: Warm personal greeting and a fully animated **"Confetti & Emoji Spawner"** easter egg triggered when copying your support addresses!

---

## 🛠️ Technology Stack

1. **Database Layer**: [Dexie.js](https://dexie.org/) — a highly optimized, promise-based wrapper around IndexedDB.
2. **Visualizations**: [Chart.js](https://www.chartjs.org/) — local, responsive vector canvas drawing.
3. **CSV Ingestion Engine**: [PapaParse](https://www.papaparse.com/) — multi-threaded stream parsing offloaded to a dedicated Web Worker (`import-worker.js`) to prevent main-thread UI blockage.
4. **Front-End Styling**: Vanilla CSS — modern glassmorphism, responsive flex grids, linear gradients, and scale-fade entry animations.

---

## 📂 File Architecture

```bash
├── manifest.json         # Extension Manifest V3 metadata and permissions config
├── background.js         # Debounced background worker (listens to visit notifications)
├── db.js                 # Database schema definition (Schema Version 2) and keyword indexer
├── import-worker.js      # Multi-threaded streaming Web Worker for CSV parser
├── dashboard.html        # Main dashboard interface
├── dashboard.css         # Styling system, responsive grid layouts, animations
├── dashboard.js          # Chart rendering, virtualized scroll logic, filters, and tab controllers
├── options.html          # Settings, database backup migration panel, and Moroccan support card
├── options.css           # Option styles, drag-and-drop drop zones, custom success indicators
├── options.js            # JSON backup engine, options event bindings, and interactive copy burst
├── LICENSE               # Permissive open-source MIT License
├── README.md             # Repository documentation
├── icons/                # High-fidelity transparent suite
│   ├── icon16.png        # 16x16 pixels
│   ├── icon48.png        # 48x48 pixels
│   ├── icon128.png       # 128x128 pixels
│   └── Designer (24).png # Original transparent master logo
└── vendor/               # Local library bundles (CSP-compliant, no remote CDNs)
    ├── dexie.min.js
    ├── chart.umd.js
    └── papaparse.min.js
```

---

## 🚀 Installation & Local Development

To run **ChronosArchiver** locally as an unpacked extension:

1. Clone or download this repository to your local system:
   ```bash
   git clone https://github.com/your-username/ChronosArchiver.git
   ```
2. Open Google Chrome and navigate to **`chrome://extensions/`**.
3. Toggle the **Developer mode** switch in the top-right corner.
4. Click **Load unpacked** in the top-left.
5. Select the `ChronosArchiver` repository folder.
6. The extension is now active! Click the extension pin in your toolbar to launch your local history vault dashboard.

---

## ☕ Support the Project

ChronosArchiver is free and open-source. If thispersistent offline vault has saved your digital browsing footprint and helped you explore your memory, feel free to support the developer!

* 💎 **Ethereum (ETH) Address**: `0xA3f17d559900FEA12C18C184C2483E53626FED62`
* 🌐 **ENS Domain**: `charif.eth`

*Built with 💻, ☕, and love in **Morocco 🇲🇦 Salam!***

---

## 📄 License

Distributed under the permissive MIT License. See [LICENSE](LICENSE) for details.
