---
name: arbox-auto-booking
description: Automatically book fitness classes on Arbox-powered gym platforms the moment booking opens. Use when a user wants to automate class bookings at their Arbox gym in Israel, avoid missing sold-out CrossFit or fitness classes, set up a recurring booking schedule, or manage monthly booking limits. Arbox (arboxapp.com) is a popular gym management platform used by many Israeli gyms.
---

# Arbox Auto-Booking

Automatically books fitness classes at the exact moment booking opens — before popular classes sell out.

## Prerequisites

- Node.js v16+
- An Arbox account at a gym using the Arbox platform

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/WolfikOz/arbox-auto-booking.git
cd arbox-auto-booking
```

### 2. Find your gym's IDs

You need three IDs specific to your gym. Get them by opening Chrome DevTools → Network tab, logging into the Arbox web app, and booking a class manually. Look for these values in the request payloads:

| Variable | What it is |
|----------|-----------|
| `ARBOX_WHITELABEL` | Your gym's subdomain slug (e.g. `mygym-tlv`) |
| `ARBOX_BOX_ID` | Your gym's numeric box ID |
| `ARBOX_MEMBERSHIP_ID` | Your membership record ID (`membership_user_id` in booking requests) |
| Location IDs | Per-room IDs in the schedule API response as `locations_box_id` |

### 3. Configure your schedule

```bash
cp arbox-schedule.example.json arbox-schedule.json
```

Edit `arbox-schedule.json` — set your classes, times, location IDs, and when booking opens (`bookAt`).

### 4. Set environment variables

```bash
export ARBOX_EMAIL="your@email.com"
export ARBOX_PASSWORD="yourpassword"
export ARBOX_WHITELABEL="your-gym-slug"
export ARBOX_BOX_ID="12345"
export ARBOX_MEMBERSHIP_ID="67890"
```

For production, store credentials in macOS Keychain or a secrets manager — never hardcode them.

### 5. Test with dry run

```bash
ARBOX_DRY_RUN=true node arbox-book.js
```

You should see `🔵 DRY: 07:00 CrossFit` — no actual booking made.

### 6. Run for real

```bash
node arbox-book.js
```

## Automation

The script waits internally until the booking window opens, so schedule it ~1 minute early:

```
# Cron: runs at 21:59, waits until 22:00 to fire booking
59 21 * * 5  ARBOX_EMAIL=... node /path/to/arbox-book.js
```

Works with any scheduler — cron, AI agent platforms (e.g. OpenClaw), or task runners.

## How It Works

The script uses a **pre-fetch + wait** strategy:

1. Before booking opens: fetch the full schedule
2. Wait until the exact booking window time
3. Fire the booking POST at T+0 — no fetch latency at the critical moment

This matters because popular classes fill in seconds.

## Key Options

| Variable | Default | Description |
|----------|---------|-------------|
| `ARBOX_MONTHLY_LIMIT` | `18` | Max bookings per month |
| `ARBOX_TARGET_DATE` | 3 days ahead | Override target date (YYYY-MM-DD) |
| `ARBOX_DRY_RUN` | `false` | Simulate without booking |
| `ARBOX_STATE_PATH` | `./arbox-bookings.json` | Path to state file |
| `ARBOX_CONFIG_PATH` | `./arbox-schedule.json` | Path to config file |
