# arbox-auto-booking

> Automatically book your CrossFit (or any Arbox gym) classes the moment booking opens — before they sell out.

I'm not a developer. I wrote this with Claude because I was tired of waking up to sold-out classes.

It works.

---

## The Problem

My gym runs on [Arbox](https://www.arboxapp.com/). Popular classes fill up within minutes of booking opening at 22:00. I missed Monday morning classes repeatedly because I forgot to check my phone at exactly 10 PM.

So I automated it.

## What It Does

- Books classes at the **exact moment** booking opens (pre-fetches schedule first, then fires the booking POST at T+0)
- Handles **multiple classes** and **multiple locations** in one run
- Tracks **monthly booking limits**
- Supports **dry run mode** for testing
- Zero credentials on disk — everything via environment variables

## Setup

### 1. Prerequisites

- Node.js (v16+)
- An Arbox account at a gym that uses the Arbox platform

### 2. Find your gym's IDs

You need 3 IDs that are specific to your gym:

| ID | What it is | How to find it |
|----|-----------|----------------|
| `BOX_ID` | Your gym's ID | Inspect network requests in the Arbox app |
| `MEMBERSHIP_ID` | Your membership record ID | Same — look for `membership_user_id` in booking requests |
| `WHITELABEL` | Your gym's slug | The subdomain of your gym's app (e.g. `mygym-tlv`) |
| `LOCATION_ID` | Per-room IDs | In the schedule API response as `locations_box_id` |

**Tip:** Open Chrome DevTools → Network tab, log into the Arbox web app, and book a class manually. You'll see all these IDs in the request payloads.

### 3. Configure

```bash
cp arbox-schedule.example.json arbox-schedule.json
```

Edit `arbox-schedule.json` with your gym's classes, times, and location IDs.

### 4. Set environment variables

```bash
export ARBOX_EMAIL="your@email.com"
export ARBOX_PASSWORD="yourpassword"
export ARBOX_WHITELABEL="your-gym-slug"
export ARBOX_BOX_ID="12345"
export ARBOX_MEMBERSHIP_ID="67890"
```

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

The script is designed to be run by a scheduler (cron, AI agent, whatever). It waits internally until the booking window opens, so you can trigger it a minute early without worrying about timing.

**Example cron** (runs at 21:59, waits internally until 22:00):
```
59 21 * * 5    ARBOX_EMAIL=... ARBOX_BOX_ID=... node /path/to/arbox-book.js
```

I run mine via [OpenClaw](https://openclaw.ai) — an AI agent platform — which also sends me a WhatsApp confirmation after each booking.

## Configuration Reference

```json
{
  "bookingWindow": {
    "defaultOpensAt": "22:00"
  },
  "classes": [
    {
      "name": "CrossFit",        // Display name
      "apiName": "CROSSFIT",     // Must match Arbox API exactly (case-sensitive)
      "day": "monday",           // Day of week (lowercase)
      "time": "07:00",           // Class time
      "locationId": 123,          // Location/room ID from Arbox (find yours via network inspector)
      "bookAt": "22:00",         // When booking opens for this class
      "priority": 1,             // Lower = booked first
      "enabled": true
    }
  ]
}
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ARBOX_EMAIL` | ✅ | — | Your Arbox login email |
| `ARBOX_PASSWORD` | ✅ | — | Your Arbox password |
| `ARBOX_WHITELABEL` | ✅ | — | Gym's whitelabel slug |
| `ARBOX_BOX_ID` | ✅ | — | Gym's box ID |
| `ARBOX_MEMBERSHIP_ID` | ✅ | — | Your membership ID |
| `ARBOX_MONTHLY_LIMIT` | ❌ | `18` | Max bookings per month |
| `ARBOX_TARGET_DATE` | ❌ | 3 days ahead | Override target date (YYYY-MM-DD) |
| `ARBOX_OPENS_AT` | ❌ | from config | Override booking window time |
| `ARBOX_CONFIG_PATH` | ❌ | `./arbox-schedule.json` | Path to config file |
| `ARBOX_STATE_PATH` | ❌ | `./arbox-bookings.json` | Path to state file |
| `ARBOX_DRY_RUN` | ❌ | `false` | Set to `true` to simulate |

## How It Works

The script uses a **pre-fetch + wait** strategy:

1. **Before booking opens:** fetch the full schedule from the API
2. **Wait** until the exact booking window time
3. **Immediately fire** the booking POST — no fetch latency at the critical moment

This matters because popular classes fill in seconds. The first version fetched and booked at the same time; I kept missing classes. This version grabs the data early, then fires the booking at T+0.

## Limitations

- Only works with gyms on the Arbox platform
- Requires your login credentials (standard HTTP — no hacks)
- No support for waitlist booking (yet)

## License

MIT

---

*Built with Claude. Deployed on a Mac mini. Books my CrossFit classes so I don't have to.*
