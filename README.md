# Y-Football Player List Export

`Y-Football Player List Export` is a Chromium Manifest V3 browser extension for exporting Yahoo Fantasy Football Player List data to `CSV`, `TSV`, and `JSON`.

## What It Does

- Exports Yahoo Fantasy Player List data to `CSV`, `TSV`, and `JSON`
- Runs locally in the browser
- Requires the user to be logged into Yahoo manually
- Does not store Yahoo credentials
- Does not make roster moves
- Does not send extracted data to a server
- Supports screen-reader friendly controls
- Is intended for personal league analysis and accessibility support

## Privacy

This extension operates entirely inside the local browser session. It reads table data from the Yahoo Fantasy Player List page that you already have open and uses the browser download flow to save files locally on your machine.

- The extension does not collect or store Yahoo usernames, passwords, cookies, or session tokens
- The extension does not transmit extracted player data to any remote server
- The extension does not sync league data to cloud storage
- The extension relies on your existing Yahoo login session and never performs authentication itself
- The repository intentionally excludes personal league exports, screenshots, and account-specific data

## How It Works

1. Open Yahoo Fantasy in your browser and navigate to a Player List page.
2. Click the extension icon to open the exporter page.
3. Choose the target Yahoo tab and extract either the visible page or all available pages.
4. Download the results as `CSV`, `TSV`, or `JSON`.

## Accessibility

- Keyboard-operable controls
- Visible focus styling
- Live status announcements for progress and errors
- Full-page interface instead of a cramped popup
- Screen-reader friendly labels and grouping

## Development

### Requirements

- Node.js 20+

### Install

```bash
npm install
```

### Build

```bash
npm run build
```

The build output is written to `dist/`.

### Test

```bash
npm test
```

### Load In Chromium

1. Open `chrome://extensions` or another Chromium extension page.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select the generated `dist/` directory.

## Project Structure

- `src/`: TypeScript extension source, HTML, CSS, and manifest
- `fixtures/`: Sanitized Yahoo-style sample table fixtures
- `tests/`: Parser tests
- `scripts/`: Build tooling

## Known Limitations

1. Yahoo page structure can change.
2. The extension only reads visible data.
3. All-page extraction depends on Yahoo pagination.
4. It may need parser updates if Yahoo changes the Player List table.
