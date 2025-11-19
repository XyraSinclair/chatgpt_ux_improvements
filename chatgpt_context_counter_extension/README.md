# ChatGPT Context Counter

This is a tiny Chrome extension whose entire job is to guess how many tokens your current ChatGPT thread is chewing through and to show that number in the corner. No extra dashboards, no config maze—just a live token estimate with a minimal amount of extra detail when you want it.

## What You Get

- Runs on both `https://chatgpt.com` and `https://chat.openai.com` using a Manifest V3 content-script bundle (`tokenEstimator.js`, `content.js`, `styles.css`).
- Scrapes the visible conversation (`main > article`) and totals tokens per role (you vs. ChatGPT). Toggle the “+” to see the breakdown; hit “×” to hide it.
- Uses `Intl.Segmenter` when available, mixing word- and character-based math so the estimates stay sane across languages.
- Spots most attachment widgets, parses the size labels, and rolls those bytes into the token total so uploads don’t surprise you.
- Listens for DOM mutations, hash changes, resizes, and visibility changes so the overlay stays in sync without manual refreshes.
- Remembers whether you left the detail drawer open by persisting to `localStorage`.

## Install (Unpacked)

1. Open Chrome and visit `chrome://extensions`.
2. Flip on **Developer mode**.
3. Click **Load unpacked** and select the repo root (the folder with `manifest.json`).
4. Open ChatGPT; the counter pops in near the top-left of the conversation area as soon as the page settles.

## Package a Release

1. Update the `version` field in `manifest.json`.
2. Run `./scripts/package_extension.sh` from the repo root. It stages a clean tree, strips dev-only files, and writes `dist/chatgpt-context-counter-extension-v<version>.zip`.
3. Upload that zip to the Chrome Web Store listing (or wherever else you need it).

## Repo Map

- `manifest.json` — MV3 metadata.
- `content.js` — mounts the overlay, watches the DOM, aggregates tokens + attachments.
- `tokenEstimator.js` — word segmentation helpers, byte parsing, and token math.
- `styles.css` — compact monospace widget styling.
- `icons/` — extension icons.
- `scripts/package_extension.sh` — deterministic release zip generator.
- `dist/` — packaged artifacts (ignored by the pack script when creating a new bundle).

The former `docs/` overview now lives right here to keep the tree flat.

## Limitations & Tips

- The numbers are estimates because we can’t bundle OpenAI’s real tokenizer. Expect a slight buffer in either direction.
- Attachments are treated as raw byte blobs (`≈ bytes / 4` tokens). That intentionally overshoots to keep you under the limit.
- If ChatGPT radically changes its markup and stops using `main > article`, the selectors here will need an update.
- Dismissing the overlay removes it until you refresh the page.
- If you ever need true tokenizer parity, you can wire up something like [`gpt-tokenizer`](https://github.com/niieani/gpt-tokenizer); for this lightweight extension, the additional bundle size and initialization time aren’t worth the marginal accuracy gain.

## License

Released under the MIT License (`LICENSE`).

