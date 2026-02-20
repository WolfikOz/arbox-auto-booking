#!/usr/bin/env node
/**
 * Arbox Auto-Booking Script
 *
 * Automatically books fitness classes on Arbox-powered gym platforms
 * the moment booking opens — before they sell out.
 *
 * Credentials via environment variables (never hardcoded).
 * See README.md for setup instructions.
 *
 * Env vars:
 *   ARBOX_EMAIL            — Your Arbox account email
 *   ARBOX_PASSWORD         — Your Arbox account password
 *   ARBOX_WHITELABEL       — Your gym's whitelabel slug (e.g. fithub-namal)
 *   ARBOX_BOX_ID           — Your gym's box ID (find via API or network inspector)
 *   ARBOX_MEMBERSHIP_ID    — Your membership ID (find via API or network inspector)
 *   ARBOX_MONTHLY_LIMIT    — Max bookings per month (default: 18)
 *   ARBOX_TARGET_DATE      — YYYY-MM-DD (default: auto 3 days ahead)
 *   ARBOX_OPENS_AT         — Override booking window open time (HH:MM)
 *   ARBOX_DRY_RUN=true     — Simulate without actually booking
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const WHITELABEL = process.env.ARBOX_WHITELABEL || '';
const BOX_ID = parseInt(process.env.ARBOX_BOX_ID || '0', 10);
const MEMBERSHIP_ID = parseInt(process.env.ARBOX_MEMBERSHIP_ID || '0', 10);
const MONTHLY_LIMIT = parseInt(process.env.ARBOX_MONTHLY_LIMIT || '18', 10);
const CONFIG_PATH = process.env.ARBOX_CONFIG_PATH || path.join(__dirname, 'arbox-schedule.json');
const STATE_PATH = process.env.ARBOX_STATE_PATH || path.join(__dirname, 'arbox-bookings.json');
const DRY_RUN = process.env.ARBOX_DRY_RUN === 'true';

if (!WHITELABEL || !BOX_ID || !MEMBERSHIP_ID) {
  console.log('ERROR: Missing required env vars: ARBOX_WHITELABEL, ARBOX_BOX_ID, ARBOX_MEMBERSHIP_ID');
  process.exit(1);
}

// ─── HTTP helper ───────────────────────────────────────────────
function api(endpoint, method, body, token, refreshToken) {
  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': 'application/json',
      whitelabel: WHITELABEL,
      version: '11',
      referername: 'app',
    };
    if (token) {
      headers.accesstoken = token;
      headers.refreshtoken = refreshToken;
    }
    const req = https.request(
      `https://apiappv2.arboxapp.com${endpoint}`,
      { method, headers, timeout: 20000 },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
          catch { resolve({ status: res.statusCode, body: buf.substring(0, 300) }); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── State management ──────────────────────────────────────────
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { bookings: [], monthlyCount: 0, lastReset: currentMonth() }; }
}
function saveState(s) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}
function currentMonth() { return new Date().toISOString().substring(0, 7); }

// ─── Target date logic ─────────────────────────────────────────
function getTargetDate() {
  if (process.env.ARBOX_TARGET_DATE) return process.env.ARBOX_TARGET_DATE;
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return d.toISOString().substring(0, 10);
}

function dayOfWeek(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
}

// ─── Booking window timing ─────────────────────────────────────
function getBookingWindowTime(config, classes) {
  if (process.env.ARBOX_OPENS_AT) return process.env.ARBOX_OPENS_AT;
  const times = [...new Set(classes.map((c) => c.bookAt).filter(Boolean))];
  if (times.length === 1) return times[0];
  return config.bookingWindow?.defaultOpensAt || '22:00';
}

async function waitUntilBookingWindow(opensAt) {
  const [targetHour, targetMin] = opensAt.split(':').map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(targetHour, targetMin, 0, 0);

  const waitMs = target - now;
  if (waitMs <= 0) {
    console.log(`⏰ Booking window (${opensAt}) already open — proceeding immediately`);
    return;
  }
  console.log(`⏰ Waiting ${Math.ceil(waitMs / 1000)}s until booking window opens at ${opensAt}...`);
  await new Promise((r) => setTimeout(r, waitMs));
  console.log(`✅ Booking window open — firing now`);
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  const email = process.env.ARBOX_EMAIL;
  const password = process.env.ARBOX_PASSWORD;
  if (!email || !password) { console.log('ERROR: Missing credentials'); process.exit(1); }

  // Login
  const login = await api('/api/v2/user/login', 'POST', { email, password });
  if (login.status !== 200) {
    console.log(`ERROR: Login failed (HTTP ${login.status})`);
    process.exit(1);
  }
  const { token, refreshToken } = login.body.data;
  console.log(`✅ Logged in as ${login.body.data.full_name}`);

  // Load config & state
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const state = loadState();
  if (state.lastReset !== currentMonth()) {
    state.monthlyCount = 0;
    state.lastReset = currentMonth();
  }

  const targetDate = getTargetDate();
  const day = dayOfWeek(targetDate);
  const classesToBook = config.classes
    .filter((c) => c.day === day && c.enabled)
    .sort((a, b) => (a.priority || 99) - (b.priority || 99));

  console.log(`📅 ${targetDate} (${day}) — ${classesToBook.length} class(es) to book`);
  if (!classesToBook.length) { console.log('Nothing to book.'); process.exit(0); }

  // ─── PRE-FETCH: collect schedule BEFORE booking window opens ───
  const opensAt = getBookingWindowTime(config, classesToBook);
  const locationIds = [...new Set(classesToBook.map((c) => c.locationId))];

  console.log(`🔍 Pre-fetching schedule before window opens at ${opensAt}...`);
  const allClasses = [];
  for (const locId of locationIds) {
    const res = await api('/api/v2/schedule/betweenDates', 'POST', {
      from: `${targetDate}T00:00:00+02:00`,
      to: `${targetDate}T23:59:59+02:00`,
      locations_box_id: locId,
      boxes_id: BOX_ID,
    }, token, refreshToken);
    if (res.status === 200) allClasses.push(...(res.body.data || []));
  }
  console.log(`📊 ${allClasses.length} classes pre-fetched from ${locationIds.length} location(s)`);

  // Wait until booking window opens
  await waitUntilBookingWindow(opensAt);

  const results = [];

  for (const cfg of classesToBook) {
    const apiName = cfg.apiName || cfg.name;
    const match = allClasses.find(
      (s) =>
        (s.box_categories?.name || '').toLowerCase() === apiName.toLowerCase() &&
        s.time === cfg.time &&
        s.locations_box_fk === cfg.locationId
    );

    if (!match) {
      results.push(`❌ NOT FOUND: ${cfg.time} ${cfg.name}`);
      continue;
    }
    if (match.user_booked) {
      results.push(`✅ ALREADY: ${cfg.time} ${cfg.name}`);
      continue;
    }
    if (match.free <= 0 && !match.stand_by) {
      results.push(`🚫 FULL: ${cfg.time} ${cfg.name} (${match.registered}/${match.max_users})`);
      continue;
    }
    if (state.monthlyCount >= MONTHLY_LIMIT) {
      results.push(`⚠️ LIMIT: ${state.monthlyCount}/${MONTHLY_LIMIT} — skipped ${cfg.time} ${cfg.name}`);
      continue;
    }

    if (DRY_RUN) {
      results.push(`🔵 DRY: ${cfg.time} ${cfg.name} (id:${match.id}, ${match.free} free)`);
      continue;
    }

    // Book
    const book = await api('/api/v2/scheduleUser/insert', 'POST', {
      extras: null,
      schedule_id: match.id,
      membership_user_id: MEMBERSHIP_ID,
    }, token, refreshToken);

    if (book.status === 200 || book.status === 201) {
      state.monthlyCount++;
      state.bookings.push({
        date: targetDate,
        time: cfg.time,
        class: cfg.name,
        scheduleId: match.id,
        bookedAt: new Date().toISOString(),
      });
      results.push(`✅ BOOKED: ${cfg.time} ${cfg.name}`);
    } else {
      const err = book.body?.error?.messageToUser || book.body?.error?.message || `HTTP ${book.status}`;
      results.push(`❌ FAIL: ${cfg.time} ${cfg.name} — ${err}`);
    }

    await new Promise((r) => setTimeout(r, 800));
  }

  saveState(state);

  console.log('\n═══ RESULTS ═══');
  results.forEach((r) => console.log(r));
  console.log(`Monthly: ${state.monthlyCount}/${MONTHLY_LIMIT}`);

  const hasFailure = results.some((r) => r.startsWith('❌'));
  process.exit(hasFailure ? 1 : 0);
}

main().catch((err) => { console.log(`ERROR: ${err.message}`); process.exit(1); });
