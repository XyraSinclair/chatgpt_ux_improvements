# ChatGPT Context Counter Extension

This Chrome extension adds a compact widget to ChatGPT conversations that estimates how many tokens have been used in the current thread.

## Features

- Estimates token usage by scanning the text inside each `main > article` node on `chatgpt.com` and `chat.openai.com`, with per-role tallies tucked into an expandable drawer.
- Uses language-aware heuristics (via `Intl.Segmenter` when available) to stay accurate for international text.
- Attempts to account for uploaded files by parsing any file size strings it finds (e.g. `1.2 MB`) and converting them to an approximate token contribution—even for the in-progress composer area.
- Refreshes automatically in response to DOM changes, navigation hash updates, and visibility/resize events so the count stays in sync without polling.
- Defaults to an ultra-compact overlay that shows just the running token total; tap the “+” button to reveal the detailed breakdown, or dismiss it with the close button if you want a clean page.

## Installation

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the root of this repository (the folder containing `manifest.json`).
4. Visit `https://chatgpt.com` (or `https://chat.openai.com`); the counter appears automatically after the page finishes loading.

## Repository Layout

- `manifest.json`, `content.js`, `tokenEstimator.js`, `styles.css`, and `icons/`: the extension payload loaded by Chrome.
- `scripts/package_extension.sh`: deterministic packager that emits store-ready zips in `dist/`.
- `docs/`: project overview and operational notes (this file).

## Notes & Limitations

- The counts are approximate because the actual tokeniser used by OpenAI is not available in this unbundled form.
- Uploaded files are treated as plain byte blobs: `≈ bytes / 4` tokens. This errs on the conservative (higher) side for binary formats.
- If ChatGPT renders the conversation outside of `main > article`, the script may need selector adjustments.
- The expansion state of the drawer is remembered per browser via `localStorage`. If you dismiss the overlay entirely, reload the page to bring it back.

## Packaging for Chrome Web Store

1. Ensure the version in `manifest.json` matches the release you want to ship.
2. Run `./scripts/package_extension.sh` from the project root. The script stages the extension, removes docs/scripts, and writes `dist/chatgpt-context-counter-extension-v<version>.zip`.
3. Upload the generated zip to the Chrome Web Store dashboard along with the required listing assets and text.
