// Scheduled job (see .github/workflows/auto-clock-out.yml) that force-closes any
// time_entries left in status 'active' past the configured cutoff hour. This exists
// because the in-app auto-logout only runs in an employee's open browser tab and does
// nothing while the app/tab is closed — this job is the real enforcement, independent
// of whether anyone has the app open.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// The business operates in this timezone; the cutoff hour from Firestore settings
// ("18:00" etc) is interpreted as a wall-clock time here, not the CI runner's local time.
const TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/New_York';

function zonedComponents(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24, // Intl reports midnight as '24' in some environments
  };
}

// Converts a wall-clock year/month/day/hour:00:00 in `timeZone` to the equivalent UTC instant.
function zonedHourToUtc(year, month, day, hour, timeZone) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, 0, 0));
  const inZone = new Date(utcGuess.toLocaleString('en-US', { timeZone }));
  const offsetMs = utcGuess.getTime() - inZone.getTime();
  return new Date(utcGuess.getTime() + offsetMs);
}

function toJsDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountRaw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is not set.');
  }
  const serviceAccount = JSON.parse(serviceAccountRaw);

  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  const settingsSnap = await db.collection('settings').doc('general').get();
  const cutoffHour = parseInt((settingsSnap.data()?.autoClockOutTime || '18:00').split(':')[0], 10);

  const now = new Date();
  const activeSnap = await db.collection('time_entries').where('status', '==', 'active').get();

  if (activeSnap.empty) {
    console.log('No active time entries found.');
    return;
  }

  let closedCount = 0;
  for (const docSnap of activeSnap.docs) {
    const entry = docSnap.data();
    const clockInTime = toJsDate(entry.clockInTime);
    if (!clockInTime) {
      console.warn(`Skipping ${docSnap.id} — missing/invalid clockInTime.`);
      continue;
    }

    const { year, month, day } = zonedComponents(clockInTime, TIMEZONE);
    const cutoff = zonedHourToUtc(year, month, day, cutoffHour, TIMEZONE);

    if (now.getTime() < cutoff.getTime()) continue; // still within the workday — leave it alone

    await docSnap.ref.update({
      clockOutTime: cutoff,
      clockOutCoords: entry.clockInCoords ?? null,
      status: 'completed',
      description: `${entry.description || ''} (Auto clocked-out at ${String(cutoffHour).padStart(2, '0')}:00 by scheduled job)`.trim(),
      updatedAt: now,
    });
    closedCount++;
    console.log(`Closed out ${entry.employeeName || entry.userId} (${docSnap.id}) — clocked in ${clockInTime.toISOString()}`);
  }

  console.log(`Done. Closed ${closedCount} of ${activeSnap.size} active entries.`);
}

main().catch((err) => {
  console.error('auto-clock-out job failed:', err);
  process.exitCode = 1;
});
