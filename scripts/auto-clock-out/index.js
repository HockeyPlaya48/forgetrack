// Scheduled job (see .github/workflows/auto-clock-out.yml) that force-closes any
// time_entries left in status 'active' after the configured trigger window (hours after
// clock-in). Clock-out is set to clockIn + revertHours so the record defaults to a
// reasonable shift length; employees who worked longer must submit a correction.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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
  const settingsData = settingsSnap.data() || {};

  // Hours after clock-in before auto clock-out fires (default 12)
  const triggerHours = Number(settingsData.autoClockOutHoursAfterClockIn) || 12;
  // Hours the entry reverts to when auto clocked out (default 7.5)
  const revertHours = Number(settingsData.autoClockOutRevertHours) || 7.5;

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

    const hoursElapsed = (now.getTime() - clockInTime.getTime()) / (1000 * 60 * 60);
    if (hoursElapsed < triggerHours) continue; // still within allowed window

    const lunchMs = (entry.lunchDuration || 0) * 60 * 1000;
    const autoOutTime = new Date(clockInTime.getTime() + revertHours * 60 * 60 * 1000 + lunchMs);

    await docSnap.ref.update({
      clockOutTime: autoOutTime,
      clockOutCoords: entry.clockInCoords ?? null,
      status: 'completed',
      description: `${entry.description || ''} [Auto clocked-out — time set to ${revertHours}h default. Please correct your actual hours.]`.trim(),
      travelTimeOut: 0,
      wasAutoClockedOut: true,
      updatedAt: now,
    });
    closedCount++;
    console.log(`Closed ${entry.employeeName || entry.userId} (${docSnap.id}) — clocked in ${clockInTime.toISOString()}, elapsed ${hoursElapsed.toFixed(1)}h, reverted to ${revertHours}h`);
  }

  console.log(`Done. Closed ${closedCount} of ${activeSnap.size} active entries.`);
}

main().catch((err) => {
  console.error('auto-clock-out job failed:', err);
  process.exitCode = 1;
});
