# ICD-9 Lookup

A web app for searching ICD-9 medical codes, with favorites, billing code suggestions, and a time calculator for session-based billing.

## Features

### 🔍 Search & Browse
- Fuzzy search across ICD-9 codes, names, and synonyms
- Real-time search with instant results
- Browse all codes when no search term is entered
- Billing code search integrated into the main search bar

### ⭐ Favorites
- Star/unstar codes to add to favorites
- Favorites are pinned at the top of results
- Persist across sessions via localStorage
- Recently used favorites appear first

### ⏱ Time Calculator
- Enter any two of start time, end time, or duration
- Suggests billing codes that apply to the session length
- Two-column layout — individual vs. family/conjoint codes — sorted by fee descending

## File Structure

```
icd9/
├── index.html              # Main application
├── manifest.json           # Web app manifest
├── assets/
│   ├── css/styles.css
│   ├── js/
│   │   ├── app.js                 # Main app logic
│   │   ├── fuse.min.js            # Fuzzy search library
│   │   ├── time-calc.js           # Pure time math utilities
│   │   └── time-calc-widget.js    # Time calc UI widget
│   └── icons/                     # App icons
├── data/
│   ├── icd9.json                  # ICD-9 dataset
│   └── billing-codes.json         # Billing codes dataset
└── scripts/
    └── harvest.py                 # Dataset harvester
```

## Running Locally

Serve the files from any static web server:

```sh
python3 -m http.server 8765
```

Then open `http://localhost:8765/`.

## License

MIT.
