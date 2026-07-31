import { onSchedule } from 'firebase-functions/v2/scheduler';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

initializeApp();

// Runs every night at 11:55 PM Eastern — clocks out any employees still active
export const autoClockOut = onSchedule(
  {
    schedule: '55 23 * * *',
    timeZone: 'America/New_York',
  },
  async () => {
    const db = getFirestore();

    // Read the admin-configured clockout hour from Firestore settings
    const settingsSnap = await db.collection('settings').doc('general').get();
    const autoClockOutTime: string = settingsSnap.data()?.autoClockOutTime ?? '18:00';
    const [hourStr, minStr] = autoClockOutTime.split(':');
    const clockOutHour = parseInt(hourStr, 10);
    const clockOutMin = parseInt(minStr ?? '0', 10);

    const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    const snapshot = await db
      .collection('time_entries')
      .where('status', '==', 'active')
      .get();

    if (snapshot.empty) {
      console.log('autoClockOut: no active entries.');
      return;
    }

    const batch = db.batch();
    let count = 0;

    snapshot.docs.forEach((docSnap) => {
      const entry = docSnap.data();
      if (typeof entry.date === 'string' && entry.date <= todayET) {
        const [y, m, d] = entry.date.split('-').map(Number);
        const clockOut = new Date(y, m - 1, d, clockOutHour, clockOutMin, 0, 0);

        batch.update(docSnap.ref, {
          status: 'completed',
          clockOutTime: Timestamp.fromDate(clockOut),
          clockOutCoords: entry.clockInCoords ?? null,
          travelTimeOut: entry.travelTimeOut ?? 0,
          updatedAt: Timestamp.now(),
        });
        count++;
        console.log(`autoClockOut: closing entry ${docSnap.id} for ${entry.employeeName} on ${entry.date}`);
      }
    });

    await batch.commit();
    console.log(`autoClockOut: closed ${count} entries.`);
  }
);
