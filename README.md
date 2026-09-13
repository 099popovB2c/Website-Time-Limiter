# Website Time Limiter

A privacy-first Chrome extension for setting daily time budgets on websites.

## v1.1.0

- Added a **master enable/disable** switch.
- Added **Include subdomains** per website rule.
- Subdomains can share the parent domain's time budget.
- Fixed **Close this tab** by asking the background service worker to close the current Chrome tab instead of relying on `window.close()`.
- Focus preset now shares limits with subdomains.
- Existing v1.0 rules remain exact-host rules unless subdomain support is enabled.
- Added extension icons.
- Replaced the abbreviated license with the full MIT License.

## How tracking works

Only the active HTTP/HTTPS tab in the focused Chrome window is counted.

Tracking pauses when Chrome reports the user as idle for 60 seconds.

Manifest V3 service-worker sleeping is handled by saving timestamps and reconciling elapsed time when the tracker wakes.

## Rules

A rule contains:

- host;
- minutes per day;
- enabled state;
- optional `includeSubdomains`.

Example:

`example.com` with **Include subdomains** enabled shares one daily budget across:

- `example.com`
- `app.example.com`
- `news.example.com`

## Focus preset

- X: 30 minutes/day
- YouTube: 60 minutes/day
- Reddit: 30 minutes/day
- Instagram: 30 minutes/day
- Facebook: 30 minutes/day

Subdomains are included for preset rules.

## Limit screen

When a budget is exhausted, the extension shows a local blocking screen with:

- today's used time;
- daily limit;
- remaining time;
- **Allow 5 more minutes**;
- **Close this tab**.

## Privacy

No external API or backend is used.

The extension does not send page contents, passwords, cookies, authentication tokens, form data, private messages or browsing history to an external server.

Rules use Chrome sync storage. Daily usage and temporary unlock timestamps use local extension storage.

## Permissions

`<all_urls>` is used because the extension must enforce user-created rules on whichever websites the user chooses to limit.

The `tabs`, `idle`, `alarms` and `storage` permissions support active-tab tracking, idle detection, periodic reconciliation and local settings.

## Install

1. Download or clone the repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this extension folder.
