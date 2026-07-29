# Viernheim Triathlon Times

A mobile-first, dependency-free results dashboard for the Viernheimer V-Card
Triathlon. It reads `trialogevent_results_2023_2025.csv` directly in the
browser and displays:

- Filters for year, gender, and normalized age group
- Median finish, swim, bike, and run times
- Adaptive histograms with finisher counts for total, swim, T1, bike, T2, and run times
- Responsive layouts for phones, tablets, and desktop screens

## Run locally

The CSV is loaded with `fetch`, so the site must be served over HTTP:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Publish with GitHub Pages

The workflow in `.github/workflows/pages.yml` deploys the site whenever
`master` or `main` is pushed.

In the GitHub repository, open **Settings → Pages** and set **Source** to
**GitHub Actions**. The next matching push publishes the dashboard.

Only the four site assets are included in the Pages artifact:

- `index.html`
- `styles.css`
- `app.js`
- `trialogevent_results_2023_2025.csv`
