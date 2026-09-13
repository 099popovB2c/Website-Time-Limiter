# Website Time Limiter

A privacy-first Chrome extension for setting a daily time budget for distracting websites.

## Features

- Add the current website with one click.
- Set a separate daily minute limit for each website.
- Counts only time spent in the active tab of the focused browser window.
- Stops counting when Chrome detects that the user is idle.
- Blocks a limited website after its daily allowance is used.
- Optional 5-minute temporary access from the block screen.
- Edit or remove limits directly from the popup.
- Focus preset for X, YouTube, Reddit, Instagram and Facebook.
- Daily usage resets automatically on the user's local calendar day.
- Manual **Reset today** button.
- No account required.
- No external API.
- No backend.

## Default Focus preset

- X: 30 min/day
- YouTube: 60 min/day
- Reddit: 30 min/day
- Instagram: 30 min/day
- Facebook: 30 min/day

These are user-configurable productivity defaults, not medical recommendations.

## How tracking works

The background service worker tracks only the currently active HTTP/HTTPS tab in the focused Chrome window.

Time is flushed when:

- the active tab changes;
- the page URL changes;
- the focused Chrome window changes;
- Chrome reports the user as idle;
- the periodic one-minute alarm runs.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the extension folder.
6. Visit a website, open the extension, choose minutes, and click **Add / Update**.

## Privacy

All settings and usage counters stay inside Chrome extension storage.

The extension does not collect or transmit:

- page contents;
- passwords;
- cookies;
- authentication tokens;
- form data;
- private messages;
- browsing history to any external server.

The extension needs broad website access because its purpose is to enforce limits on websites selected by the user.

## Notes

Chrome Manifest V3 service workers can sleep when inactive. The extension stores timestamps and reconciles elapsed time on browser/tab/idle events and a periodic alarm rather than relying on an always-running timer.

## Disclaimer

This project is an independent productivity tool and is not affiliated with any website or browser vendor.
