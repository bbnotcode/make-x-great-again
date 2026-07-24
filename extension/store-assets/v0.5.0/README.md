# Chrome Web Store screenshots · MXGA v0.5.0

Official requirements checked on 2026-07-24:

- 1–5 screenshots; this set targets the maximum 5.
- `1280×800` preferred (`640×400` is also accepted).
- JPEG or PNG.
- Square corners, full bleed, no padding.
- Show the actual current extension experience and current functionality.

Sources:

- https://developer.chrome.com/docs/webstore/cws-dashboard-listing/
- https://developer.chrome.com/docs/webstore/best-listing

Planned order:

1. `01-on-x-detection.jpg` — inline detection badge and action popover on X.
2. `02-on-x-queue-panel.jpg` — corner queue panel with a detected account.
3. `03-overview.jpg` — local statistics and synchronized-list status.
4. `04-strategy-settings.jpg` — scope, auto-tier, and per-category actions.
5. `05-processed-records.jpg` — processed-account history and recovery.

The first two files are current drafts from the signed-in Chrome profile.
The remaining files must be captured from the actual reloaded v0.5.0 options
page. Older mock screenshots are not reusable because they show `v0.5.1`
while the release manifest is `0.5.0`.
