# Open Budget local (prototype)

Local-first variant of Open Budget. A static PWA with no backend: all
data stays in the browser storage (IndexedDB) of the phone. Single user,
no login. Design choices: `docs/decisions.md`, section "Local-first
prototype".

Features: quick entry (amount first, expense or income, 8 most used
categories, "Note de frais" toggle), operations of the month with
delete, pending expense reports with "Remboursé", JSON export and
import, offline use.

## Files

- `index.html`, `style.css` (copied from the server app), `icon*`.
- `js/app.js`: screens and routing (URL hash).
- `js/db.js`: IndexedDB wrapper. `js/money.js`: cents parsing and format.
- `js/categories.js`: default categories. `js/backup.js`: export format.
- `sw.js`: offline cache. Bump `VERSION` at each change.

## Run on the computer

```bash
uv run python -m http.server 8766 --bind 127.0.0.1 --directory local
```

Open <http://localhost:8766>. A service worker needs HTTPS or
`localhost`. To test offline: stop the server, then reload the page.

Tests of the logic (Node 20+):

```bash
node --test local/tests/*.test.mjs
```

## Test on an iPhone

The iPhone needs the files over HTTPS. Two ways:

1. **Hosted** (target): publish the `local/` folder on a static host
   (see decisions). Open the URL in Safari.
2. **Quick test from the Mac**, if the Mac and the iPhone are on the
   same tailnet: `tailscale serve --bg 8766` on the Mac, then open the
   `https://<mac-name>.<tailnet>.ts.net` URL in Safari. Stop it with
   `tailscale serve reset`. The origin then changes, so this is for tests
   only, not for real data.

Then:

1. In Safari, tap Partager, then "Sur l'écran d'accueil". Install
   **before** you enter data: the Home Screen app has its own storage,
   separate from Safari.
2. Open the app from the icon. Check "Sauvegarde" > "Stockage".
3. Enter some operations, then "Exporter (JSON)" > "Enregistrer dans
   Fichiers".
4. Turn on airplane mode, close and reopen the app: it must work.
5. Restore: "Sauvegarde" > choose the JSON file.

## Data loss risks

- Deleting the app icon deletes the data.
- iOS can evict data that is not in persistent mode.
- A new URL (new host) starts with empty storage: export, then import.

So export often. The entry screen shows a warning after 7 days without
export.
