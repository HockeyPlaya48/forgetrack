import React, { useState, useEffect, useRef } from 'react';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  serverTimestamp
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { JobSite, TimeEntry, UserProfile, COST_CODES } from '../types';
import { getHaversineDistance, getDrivingMinutes } from './MapMock';
import BiweeklyTimecardPanel from './BiweeklyTimecardPanel';
import TimeOffRequestPanel from './TimeOffRequestPanel';
import {
  Clock,
  Play,
  Square,
  Coffee,
  Navigation,
  FileText,
  CheckCircle2,
  AlertTriangle,
  History,
  Check,
  Wifi,
  WifiOff,
  AlertCircle,
  MapPin,
  CalendarDays,
  PenLine,
  TimerOff,
  ChevronDown,
  ChevronUp,
  Plane,
  Search,
  XSquare,
  BookOpen
} from 'lucide-react';

interface EmployeeDashboardProps {
  user: UserProfile;
  onSignOut: () => void;
}

export default function EmployeeDashboard({ user, onSignOut }: EmployeeDashboardProps) {
  const [jobs, setJobs] = useState<JobSite[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [selectedCostCode, setSelectedCostCode] = useState<string>(COST_CODES[0]);
  const [description, setDescription] = useState<string>('');
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [pastEntries, setPastEntries] = useState<TimeEntry[]>([]);

  // Travel tracking
  const [travelIn, setTravelIn] = useState<number>(0);
  const [travelOut, setTravelOut] = useState<number>(0);
  // Label for where travel-in originated: "Home" or a previous job site name
  const [travelFromLabel, setTravelFromLabel] = useState<string>('Home');
  // ID of the most recent same-day completed entry (to retroactively zero its travelTimeOut)
  const [prevSameDayEntryId, setPrevSameDayEntryId] = useState<string | null>(null);

  // Manual time entries
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualDate, setManualDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [manualJobId, setManualJobId] = useState<string>('');
  const [manualCostCode, setManualCostCode] = useState<string>(COST_CODES[0]);
  const [manualDescription, setManualDescription] = useState<string>('');
  const [manualHours, setManualHours] = useState<string>('8');
  const [manualTravelIn, setManualTravelIn] = useState<number>(0);
  const [manualTravelOut, setManualTravelOut] = useState<number>(0);
  const [manualLunch, setManualLunch] = useState<string>('30');

  // GPS — stored after each successful position fetch; used for clock-in/out coords
  const [userLat, setUserLat] = useState<number>(37.774929);
  const [userLng, setUserLng] = useState<number>(-122.419416);

  // GPS status shown near Clock In button
  const [gpsLoading, setGpsLoading] = useState<boolean>(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Set when a clock action's Firestore write itself fails (as opposed to GPS)
  // so a save failure is never silent — the employee sees exactly what to do next.
  const [saveError, setSaveError] = useState<string | null>(null);

  // Guards the Lunch/Clock-Out buttons while a GPS+Firestore round trip is in flight,
  // so a slow/failed GPS fix (bad signal) can't be double-tapped into a race
  const [isClockActionPending, setIsClockActionPending] = useState<boolean>(false);

  // Job site loading error (e.g. Firestore rules not deployed)
  const [jobsLoadError, setJobsLoadError] = useState<string | null>(null);

  // Manual lunch correction form
  const [showManualLunch, setShowManualLunch] = useState(false);
  const [manualLunchStart, setManualLunchStart] = useState('');
  const [manualLunchEnd, setManualLunchEnd] = useState('');
  const [manualLunchNote, setManualLunchNote] = useState('');
  const [lunchAcknowledged, setLunchAcknowledged] = useState(false);

  // Manual clock-out correction form
  const [showManualClockOutForm, setShowManualClockOutForm] = useState(false);
  const [manualClockOutTime, setManualClockOutTime] = useState('');
  const [manualClockOutNote, setManualClockOutNote] = useState('');

  // Auto-clocked-out correction — keyed by entry ID
  const [autoClockCorrectionId, setAutoClockCorrectionId] = useState<string | null>(null);
  const [autoClockCorrectionTime, setAutoClockCorrectionTime] = useState('');
  const [autoClockCorrectionNote, setAutoClockCorrectionNote] = useState('');

  // Declined-card resubmission
  const [declinedEditId, setDeclinedEditId] = useState<string | null>(null);
  const [declinedEditNote, setDeclinedEditNote] = useState('');
  const [declinedEditClockIn, setDeclinedEditClockIn] = useState('');
  const [declinedEditClockOut, setDeclinedEditClockOut] = useState('');
  const [declinedEditLunch, setDeclinedEditLunch] = useState('');

  // Step 3: time-off claim (both PTO and unpaid can be selected simultaneously)
  const [ptoEnabled, setPtoEnabled] = useState(false);
  const [ptoClaimHours, setPtoClaimHours] = useState<string>('8');
  const [unpaidEnabled, setUnpaidEnabled] = useState(false);
  const [unpaidClaimHours, setUnpaidClaimHours] = useState<string>('8');
  const [timeOffNote, setTimeOffNote] = useState('');

  // Partial-day PTO top-up (clock out early + claim remaining hours)
  const [showPTOTopUp, setShowPTOTopUp] = useState(false);
  const [ptoTopUpType, setPtoTopUpType] = useState<'pto' | 'unpaid'>('pto');
  const [ptoTopUpHours, setPtoTopUpHours] = useState(2);
  const [ptoTopUpNote, setPtoTopUpNote] = useState('');

  // Connection states
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [offlineQueue, setOfflineQueue] = useState<any[]>([]);

  // Time tracker auto log-out hour (Default 18:00 / 6:00 PM)
  const [autoLogoutHour, setAutoLogoutHour] = useState<number>(18); // legacy fallback
  const [autoClockOutTriggerHours, setAutoClockOutTriggerHours] = useState<number>(12);
  const [autoClockOutRevertHours, setAutoClockOutRevertHours] = useState<number>(7.5);

  // Company travel coverage from settings (default 30 min)
  const [companyTravelCoverageMinutes, setCompanyTravelCoverageMinutes] = useState<number>(30);

  // Cost code searchable dropdown
  const [costCodeSearch, setCostCodeSearch] = useState('');
  const [showCostCodeDropdown, setShowCostCodeDropdown] = useState(false);
  const costCodeRef = useRef<HTMLDivElement>(null);

  // Auto lunch return refs — keep entry ref in sync each render to avoid stale closures
  const activeEntryRef = useRef<TimeEntry | null>(null);
  const lunchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  activeEntryRef.current = activeEntry;

  // Ref-based guard for clock-in — prevents double entries from rapid taps.
  // useRef updates synchronously unlike setState, so it blocks within the same render cycle.
  const clockInFiringRef = useRef(false);

  // Set to true before any clock write we initiate so the onSnapshot guard only skips
  // snapshots caused by OUR writes, not stale pending writes from a previous app session.
  const localWritePendingRef = useRef(false);

  // Active dashboard tab
  const [activeTab, setActiveTab] = useState<'clock' | 'timecards' | 'timeoff' | 'help'>('clock');

  // Sync network connection
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      triggerOfflineSync();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Load local offline cached queue
    const cached = localStorage.getItem(`offline_queue_${user.uid}`);
    if (cached) {
      setOfflineQueue(JSON.parse(cached));
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Fetch Job Sites & configuration
  useEffect(() => {
    const defaultSiteList: JobSite[] = [
      { id: 'job_site_1', name: 'Golden Gate Retrofit', address: 'Presidio, San Francisco, CA', latitude: 37.819929, longitude: -122.478255, radius: 1609, createdAt: new Date() },
      { id: 'job_site_2', name: 'Downtown Highrise Site', address: '101 California St, San Francisco, CA', latitude: 37.793230, longitude: -122.399580, radius: 1609, createdAt: new Date() },
      { id: 'job_site_3', name: 'SFO Airport Hangar Base', address: 'SFO Airport, San Francisco, CA', latitude: 37.621313, longitude: -122.378955, radius: 1609, createdAt: new Date() }
    ];

    const unsubscribeJobs = onSnapshot(collection(db, 'jobs'), (snapshot) => {
      setJobsLoadError(null);
      if (snapshot.empty) {
        setJobs(defaultSiteList);
      } else {
        const fetched = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JobSite));
        setJobs(fetched);
      }
    }, (err) => {
      console.error("Job sites failed to load from Firestore:", err.code, err.message);
      setJobsLoadError('Job sites could not be loaded. Firestore rules may need to be deployed. Contact your administrator.');
      setJobs([]);
    });

    const unsubscribeSettings = onSnapshot(collection(db, 'settings'), (snapshot) => {
      const generalSetCard = snapshot.docs.find(doc => doc.id === 'general');
      if (generalSetCard) {
        const hour = parseInt(generalSetCard.data().autoClockOutTime?.split(':')[0] || '18', 10);
        setAutoLogoutHour(hour);
        setAutoClockOutTriggerHours(generalSetCard.data().autoClockOutHoursAfterClockIn ?? 12);
        setAutoClockOutRevertHours(generalSetCard.data().autoClockOutRevertHours ?? 7.5);
        setCompanyTravelCoverageMinutes(generalSetCard.data().companyTravelCoverageMinutes ?? 30);
      }
    }, (error) => {
      console.warn("Lacking general settings read accesses, keeping default 18:00 (6:00 PM) logout.");
    });

    return () => {
      unsubscribeJobs();
      unsubscribeSettings();
    };
  }, []);

  // Select first project by default
  useEffect(() => {
    if (jobs.length > 0 && !selectedJobId) {
      setSelectedJobId(jobs[0].id);
      setSelectedJobId(jobs[0].id);
    }
    if (jobs.length > 0 && !manualJobId) {
      setManualJobId(jobs[0].id);
    }
  }, [jobs]);

  const activeJob = jobs.find(j => j.id === selectedJobId) || jobs[0];

  // Auto-calculate travel time to site.
  // If there's a completed entry from today, travel is from that job site (site-to-site).
  // Otherwise travel is from the employee's home address.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const job = jobs.find(j => j.id === selectedJobId) || jobs[0];
      if (!job) { if (!cancelled) setTravelIn(0); return; }

      const todayStr = new Date().toISOString().split('T')[0];
      const todayCompleted = pastEntries
        .filter(e => e.date === todayStr && e.status === 'completed')
        .sort((a, b) => (b.clockInTime?.seconds ?? 0) - (a.clockInTime?.seconds ?? 0));
      const prevEntry = todayCompleted[0] ?? null;

      if (prevEntry) {
        const prevJob = jobs.find(j => j.id === prevEntry.jobId);
        if (prevJob) {
          const mins = await getDrivingMinutes(prevJob.latitude, prevJob.longitude, job.latitude, job.longitude);
          if (!cancelled) {
            setTravelIn(mins);
            setTravelFromLabel(prevEntry.jobName);
            setPrevSameDayEntryId(prevEntry.id);
          }
          return;
        }
      }

      if (!user.homeLatitude || !user.homeLongitude) { if (!cancelled) setTravelIn(0); return; }
      const mins = await getDrivingMinutes(user.homeLatitude, user.homeLongitude, job.latitude, job.longitude);
      if (!cancelled) {
        setTravelIn(mins);
        setTravelFromLabel('Home');
        setPrevSameDayEntryId(null);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedJobId, jobs, pastEntries, user.homeLatitude, user.homeLongitude]);

  // Auto-calculate travel time back when active session job is known
  useEffect(() => {
    if (!activeEntry) return;
    let cancelled = false;
    const job = jobs.find(j => j.id === activeEntry.jobId);
    if (!job || !user.homeLatitude || !user.homeLongitude) { setTravelOut(0); return; }
    (async () => {
      const mins = await getDrivingMinutes(job.latitude, job.longitude, user.homeLatitude!, user.homeLongitude!);
      if (!cancelled) setTravelOut(mins);
    })();
    return () => { cancelled = true; };
  }, [activeEntry?.jobId, jobs, user.homeLatitude, user.homeLongitude]);

  // Auto-calculate travel for manual entry form when job or home address changes
  useEffect(() => {
    let cancelled = false;
    const job = jobs.find(j => j.id === manualJobId);
    if (!job || !user.homeLatitude || !user.homeLongitude) {
      setManualTravelIn(0);
      setManualTravelOut(0);
      return;
    }
    (async () => {
      const mins = await getDrivingMinutes(user.homeLatitude!, user.homeLongitude!, job.latitude, job.longitude);
      if (!cancelled) {
        setManualTravelIn(mins);
        setManualTravelOut(mins);
      }
    })();
    return () => { cancelled = true; };
  }, [manualJobId, jobs, user.homeLatitude, user.homeLongitude]);

  // Close cost code dropdown on outside click
  useEffect(() => {
    if (!showCostCodeDropdown) return;
    const handleOutside = (e: MouseEvent) => {
      if (costCodeRef.current && !costCodeRef.current.contains(e.target as Node)) {
        setShowCostCodeDropdown(false);
        setCostCodeSearch('');
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showCostCodeDropdown]);

  // When a session becomes active, seed cost code + description from the entry
  useEffect(() => {
    if (activeEntry) {
      setSelectedCostCode(activeEntry.costCode || COST_CODES[0]);
      setDescription(activeEntry.description || '');
    }
  }, [activeEntry?.id]);

  // Auto-return from lunch after 75 minutes
  useEffect(() => {
    if (lunchTimerRef.current) {
      clearTimeout(lunchTimerRef.current);
      lunchTimerRef.current = null;
    }
    if (!activeEntry?.lunchStart) return;

    const lunchStartMs = activeEntry.lunchStart.seconds
      ? activeEntry.lunchStart.seconds * 1000
      : new Date(activeEntry.lunchStart).getTime();
    const remaining = (lunchStartMs + 75 * 60 * 1000) - Date.now();

    const doAutoReturn = async () => {
      const entry = activeEntryRef.current;
      if (!entry?.lunchStart) return;
      const startMs = entry.lunchStart.seconds
        ? entry.lunchStart.seconds * 1000
        : new Date(entry.lunchStart).getTime();
      const autoEnd = new Date(startMs + 75 * 60 * 1000);
      const newLunchDuration = (entry.lunchDuration || 0) + 75;
      setActiveEntry({ ...entry, lunchEnd: autoEnd, lunchEndCoords: null, lunchDuration: newLunchDuration, lunchStart: null, lunchStartCoords: null, updatedAt: autoEnd });
      updateDoc(doc(db, 'time_entries', entry.id), {
        lunchEnd: autoEnd,
        lunchEndCoords: null,
        lunchDuration: newLunchDuration,
        lunchStart: null,
        lunchStartCoords: null,
        updatedAt: serverTimestamp(),
      }).catch(err => console.error('Auto lunch return failed:', err));
    };

    if (remaining <= 0) {
      doAutoReturn();
    } else {
      lunchTimerRef.current = setTimeout(doAutoReturn, remaining);
    }

    return () => {
      if (lunchTimerRef.current) {
        clearTimeout(lunchTimerRef.current);
        lunchTimerRef.current = null;
      }
    };
  }, [activeEntry?.lunchStart, activeEntry?.id]);

  // Live Subscription of worker logs
  useEffect(() => {
    const q = query(
      collection(db, 'time_entries'),
      where('userId', '==', user.uid)
    );

    const unsubscribeEntries = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
      // Skip snapshots caused by OUR writes (optimistic state already applied).
      // Do NOT skip when there are stale pending writes from a previous session — that
      // would leave activeEntry null on fresh load and allow a duplicate clock-in.
      if (snapshot.metadata.hasPendingWrites && localWritePendingRef.current) return;
      if (!snapshot.metadata.hasPendingWrites) localWritePendingRef.current = false;

      const loaded: TimeEntry[] = [];
      let active: TimeEntry | null = null;

      snapshot.docs.forEach(doc => {
        const item = { id: doc.id, ...doc.data() } as TimeEntry;
        if (item.status === 'active') {
          active = item;
        } else {
          loaded.push(item);
        }
      });

      if (active) {
        const clockInMs = (active as TimeEntry).clockInTime?.seconds
          ? (active as TimeEntry).clockInTime.seconds * 1000
          : Date.now();
        const hoursElapsed = (Date.now() - clockInMs) / (1000 * 60 * 60);
        const isPastLimit = hoursElapsed >= autoClockOutTriggerHours;

        if (isPastLimit) {
          triggerAutoLogout(active);
        } else {
          setActiveEntry(active);
        }
      } else {
        setActiveEntry(null);
      }

      loaded.sort((a, b) => b.clockInTime?.seconds - a.clockInTime?.seconds);
      setPastEntries(loaded);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'time_entries');
    });

    return () => unsubscribeEntries();
  }, [user.uid, autoClockOutTriggerHours]);

  // Execute Auto clock-out cap
  const triggerAutoLogout = async (entry: TimeEntry) => {
    const clockInMs = entry.clockInTime?.seconds
      ? entry.clockInTime.seconds * 1000
      : new Date(entry.clockInTime).getTime();
    const lunchMs = (entry.lunchDuration || 0) * 60 * 1000;
    const autoOutTime = new Date(clockInMs + autoClockOutRevertHours * 60 * 60 * 1000 + lunchMs);

    const updatedData = {
      clockOutTime: autoOutTime,
      clockOutCoords: entry.clockInCoords,
      status: 'completed',
      description: `${entry.description} [Auto clocked-out — time set to ${autoClockOutRevertHours}h default. Please correct your actual hours.]`,
      travelTimeOut: 0,
      wasAutoClockedOut: true,
      updatedAt: serverTimestamp()
    };

    if (isOnline) {
      try {
        await updateDoc(doc(db, 'time_entries', entry.id), updatedData);
      } catch (err) {
        console.error('Auto clock-out sync failed', err);
      }
    } else {
      queueOfflineAction({ action: 'update', docId: entry.id, data: updatedData });
    }
  };

  // Queue background actions for offline recovery
  const queueOfflineAction = (action: any) => {
    const upToDate = [...offlineQueue, action];
    setOfflineQueue(upToDate);
    localStorage.setItem(`offline_queue_${user.uid}`, JSON.stringify(upToDate));
  };

  // Sync background triggers with cloud
  const triggerOfflineSync = async () => {
    const cached = localStorage.getItem(`offline_queue_${user.uid}`);
    if (!cached) return;
    const items = JSON.parse(cached);
    if (items.length === 0) return;

    console.log('Online signal detected. Syncing backlog of entries:', items.length);
    for (const item of items) {
      try {
        if (item.action === 'create') {
          await addDoc(collection(db, 'time_entries'), {
            ...item.data,
            createdAt: new Date(),
            updatedAt: serverTimestamp()
          });
        } else if (item.action === 'update') {
          const { id: _id, ...fields } = item.data;
          await updateDoc(doc(db, 'time_entries', item.docId), {
            ...fields,
            updatedAt: serverTimestamp()
          });
        }
      } catch (e) {
        console.error('Failed to sync item:', item, e);
      }
    }

    setOfflineQueue([]);
    localStorage.removeItem(`offline_queue_${user.uid}`);
  };

  // Fetch GPS — always resolves within 6s, returns null if unavailable.
  // Uses cell/WiFi positioning (works on any cellular signal). Never blocks the UI indefinitely.
  const fetchGPS = (): Promise<{ lat: number; lng: number } | null> =>
    new Promise((resolve) => {
      if (!navigator.geolocation) {
        setGpsError('Your browser does not support location. Try opening the app in Safari.');
        resolve(null);
        return;
      }
      const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
      const iosHint = isIOS
        ? ' On iPhone: go to Settings → Privacy & Security → Location Services → Safari → set to "While Using the App". If using the app from your home screen, open it in Safari instead and grant location there.'
        : ' Check your browser\'s location permissions for this site.';

      let settled = false;
      const finish = (val: { lat: number; lng: number } | null) => {
        if (settled) return;
        settled = true;
        resolve(val);
      };

      const outerTimer = setTimeout(() => {
        setGpsError('Location timed out — your action was saved without GPS.' + iosHint);
        finish(null);
      }, 6000);

      navigator.geolocation.getCurrentPosition(
        pos => {
          clearTimeout(outerTimer);
          setGpsError(null);
          finish({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        err => {
          clearTimeout(outerTimer);
          if (err.code === 1) {
            setGpsError('Location access denied.' + iosHint);
          } else if (err.code === 2) {
            setGpsError('Location unavailable — your action was saved without GPS.' + iosHint);
          } else {
            setGpsError('Location timed out — your action was saved without GPS.' + iosHint);
          }
          finish(null);
        },
        { enableHighAccuracy: false, timeout: 5500, maximumAge: 30000 }
      );
    });

  // Manual lunch correction — employee logs a lunch break they forgot to record
  const handleManualLunch = async () => {
    if (!activeEntry || !manualLunchStart || !manualLunchEnd || !manualLunchNote.trim()) return;

    const workDate = activeEntry.date;
    const startDate = new Date(`${workDate}T${manualLunchStart}:00`);
    const endDate = new Date(`${workDate}T${manualLunchEnd}:00`);

    if (endDate < startDate) {
      alert('Lunch end time cannot be before start time.');
      return;
    }

    const diffMins = Math.round((endDate.getTime() - startDate.getTime()) / 60000);

    const clockInMsLunch = activeEntry.clockInTime?.seconds
      ? activeEntry.clockInTime.seconds * 1000
      : new Date(activeEntry.clockInTime).getTime();
    const workedSoFarLunch = (Date.now() - clockInMsLunch) / 60000 - (activeEntry.lunchDuration || 0);

    if (diffMins === 0 && workedSoFarLunch >= 360) {
      alert('You have worked more than 6 hours. You must enter at least 30 minutes of lunch.');
      return;
    }

    const updatedDescription = diffMins === 0
      ? `${activeEntry.description} [No lunch taken — ${manualLunchNote}]`
      : `${activeEntry.description} [Manual Lunch: ${manualLunchStart}–${manualLunchEnd} (${diffMins}m) — ${manualLunchNote}]`;

    const payload = {
      ...activeEntry,
      lunchStart: null,
      lunchStartCoords: null,
      lunchEnd: endDate,
      lunchEndCoords: null,
      lunchDuration: (activeEntry.lunchDuration || 0) + diffMins,
      description: updatedDescription,
      updatedAt: serverTimestamp()
    };

    if (isOnline) {
      try {
        await updateDoc(doc(db, 'time_entries', activeEntry.id), payload);
        setShowManualLunch(false);
        setManualLunchStart('');
        setManualLunchEnd('');
        setManualLunchNote('');
        setLunchAcknowledged(true);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'time_entries');
      }
    } else {
      queueOfflineAction({ action: 'update', docId: activeEntry.id, data: payload });
      setActiveEntry(payload as any);
      setShowManualLunch(false);
      setLunchAcknowledged(true);
    }
  };

  // Manual clock-out — employee logs a clock-out time they forgot to record
  const handleManualClockOut = async () => {
    if (!activeEntry || !manualClockOutTime || !manualClockOutNote.trim()) return;

    const workDate = activeEntry.date;
    const clockOutDate = new Date(`${workDate}T${manualClockOutTime}:00`);
    const clockInMs = activeEntry.clockInTime?.seconds
      ? activeEntry.clockInTime.seconds * 1000
      : (activeEntry.clockInTime || 0);

    if (clockOutDate.getTime() <= clockInMs) {
      alert('Clock-out time must be after your clock-in time.');
      return;
    }

    const updatedDescription = `${description} [Manual Clock-Out: ${manualClockOutTime} — ${manualClockOutNote}]`;

    // GPS captured for admin visibility only — travel stays job-site-based
    const gpsManual = await fetchGPS();
    const manualClockOutCoords = gpsManual ? { latitude: gpsManual.lat, longitude: gpsManual.lng } : null;

    const payload = {
      ...activeEntry,
      clockOutTime: clockOutDate,
      clockOutCoords: manualClockOutCoords,
      status: 'completed' as const,
      costCode: selectedCostCode,
      description: updatedDescription,
      travelTimeOut: Number(travelOut) || 0,
      updatedAt: serverTimestamp()
    };

    if (isOnline) {
      try {
        await updateDoc(doc(db, 'time_entries', activeEntry.id), payload);
        setShowManualClockOutForm(false);
        setManualClockOutTime('');
        setManualClockOutNote('');
        setTravelOut(0);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'time_entries');
      }
    } else {
      queueOfflineAction({ action: 'update', docId: activeEntry.id, data: payload });
      setActiveEntry(null);
      setShowManualClockOutForm(false);
      setTravelOut(0);
    }
  };

  // Employee corrects clock-out time on an auto-clocked-out entry (sends for admin approval)
  const handleAutoClockCorrection = async (entry: TimeEntry) => {
    if (!autoClockCorrectionTime || !autoClockCorrectionNote.trim()) {
      alert('Please enter your actual clock-out time and a note explaining the correction.');
      return;
    }
    const clockOutDate = new Date(`${entry.date}T${autoClockCorrectionTime}:00`);
    const clockInMs = entry.clockInTime?.seconds
      ? entry.clockInTime.seconds * 1000
      : new Date(entry.clockInTime).getTime();
    if (isNaN(clockOutDate.getTime()) || clockOutDate.getTime() <= clockInMs) {
      alert('Clock-out time must be after your clock-in time.');
      return;
    }
    try {
      await updateDoc(doc(db, 'time_entries', entry.id), {
        clockOutTime: clockOutDate,
        description: `${entry.description} [Correction: actual clock-out ${autoClockCorrectionTime} — ${autoClockCorrectionNote.trim()}]`,
        isManualEdit: true,
        status: 'pending_approval',
        editRequestedAt: new Date(),
        wasAutoClockedOut: false,
        updatedAt: serverTimestamp(),
      });
      setAutoClockCorrectionId(null);
      setAutoClockCorrectionTime('');
      setAutoClockCorrectionNote('');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'time_entries');
    }
  };

  // Employee resubmits a declined entry for re-approval
  const handleResubmitDeclined = async (entry: TimeEntry) => {
    if (!declinedEditNote.trim()) {
      alert('Please add a note explaining the correction or resubmission.');
      return;
    }
    const payload: Record<string, any> = {
      isManualEdit: true,
      status: 'pending_approval',
      editRequestedAt: new Date(),
      description: `${entry.description} [Resubmitted: ${declinedEditNote.trim()}]`,
      updatedAt: serverTimestamp(),
    };
    if (declinedEditClockIn) {
      const d = new Date(`${entry.date}T${declinedEditClockIn}:00`);
      if (!isNaN(d.getTime())) payload.clockInTime = d;
    }
    if (declinedEditClockOut) {
      const d = new Date(`${entry.date}T${declinedEditClockOut}:00`);
      if (!isNaN(d.getTime())) payload.clockOutTime = d;
    }
    if (declinedEditLunch !== '') {
      const mins = Number(declinedEditLunch);
      if (!isNaN(mins) && mins >= 0) payload.lunchDuration = mins;
    }
    try {
      await updateDoc(doc(db, 'time_entries', entry.id), payload);
      setDeclinedEditId(null);
      setDeclinedEditNote('');
      setDeclinedEditClockIn('');
      setDeclinedEditClockOut('');
      setDeclinedEditLunch('');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'time_entries');
    }
  };

  // Step 3: submit time-off claim — can create PTO entry, unpaid entry, or both
  const handleSubmitPTODay = async () => {
    if (!timeOffNote.trim()) return;
    if (!ptoEnabled && !unpaidEnabled) return;
    const ptoHrs = Number(ptoClaimHours);
    const unpaidHrs = Number(unpaidClaimHours);
    if (ptoEnabled && (!ptoClaimHours || isNaN(ptoHrs) || ptoHrs < 0)) {
      alert('Please enter a valid number of PTO hours.');
      return;
    }
    if (unpaidEnabled && (!unpaidClaimHours || isNaN(unpaidHrs) || unpaidHrs < 0)) {
      alert('Please enter a valid number of unpaid hours.');
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];

    const makeEntry = (isPTO: boolean, hours: number) => {
      const clockIn = new Date(`${todayStr}T08:00:00`);
      const clockOutHour = Math.min(8 + Math.floor(hours), 20);
      const clockOut = new Date(`${todayStr}T${String(clockOutHour).padStart(2, '0')}:00:00`);
      return {
        userId: user.uid,
        employeeName: user.name,
        date: todayStr,
        jobId: isPTO ? 'time_off_pto' : 'time_off_unpaid',
        jobName: isPTO ? 'Paid Time Off' : 'Unpaid Time Off',
        costCode: isPTO ? 'PTO - Paid Time Off' : 'UPT - Unpaid Time Off',
        description: `${isPTO ? 'PTO' : 'Unpaid Time Off'}: ${timeOffNote.trim()}`,
        status: 'pending_approval',
        clockInTime: clockIn,
        clockInCoords: null,
        clockOutTime: clockOut,
        clockOutCoords: null,
        travelTimeIn: 0,
        travelTimeOut: 0,
        lunchStart: null,
        lunchStartCoords: null,
        lunchEnd: null,
        lunchEndCoords: null,
        lunchDuration: 0,
        isManualEdit: true,
        isApproved: false,
        editRequestedAt: new Date(),
        createdAt: new Date(),
        updatedAt: serverTimestamp(),
      };
    };

    try {
      if (ptoEnabled && ptoHrs > 0) {
        await addDoc(collection(db, 'time_entries'), makeEntry(true, ptoHrs));
      }
      if (unpaidEnabled && unpaidHrs > 0) {
        await addDoc(collection(db, 'time_entries'), makeEntry(false, unpaidHrs));
      }
      setPtoEnabled(false);
      setUnpaidEnabled(false);
      setTimeOffNote('');
      setPtoClaimHours('8');
      setUnpaidClaimHours('8');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'time_entries');
    }
  };

  // Clock out early + claim PTO/Unpaid for remaining hours
  const handleClockOutWithPTO = async () => {
    if (!activeEntry || !ptoTopUpNote.trim() || ptoTopUpHours <= 0) return;

    // Step 1: Clock out normally (best-effort GPS — null if unavailable)
    const gpsForPTO = await fetchGPS();
    const clockOutCoordsPTO = gpsForPTO ? { latitude: gpsForPTO.lat, longitude: gpsForPTO.lng } : null;
    if (gpsForPTO) { setUserLat(gpsForPTO.lat); setUserLng(gpsForPTO.lng); }

    const clockOutNow = new Date();
    const clockOutPayload = {
      ...activeEntry,
      clockOutTime: clockOutNow,
      clockOutCoords: clockOutCoordsPTO,
      status: 'completed' as const,
      costCode: selectedCostCode,
      description: description,
      travelTimeOut: Number(travelOut) || 0,
      updatedAt: serverTimestamp(),
    };

    // Step 2: PTO / Unpaid entry for the claimed hours
    const isPTO = ptoTopUpType === 'pto';
    const ptoStart = clockOutNow;
    const ptoEnd = new Date(ptoStart.getTime() + ptoTopUpHours * 3600000);

    const ptoPayload = {
      userId: user.uid,
      employeeName: user.name,
      date: activeEntry.date,
      jobId: isPTO ? 'time_off_pto' : 'time_off_unpaid',
      jobName: isPTO ? 'Paid Time Off' : 'Unpaid Time Off',
      costCode: isPTO ? 'PTO - Paid Time Off' : 'UPT - Unpaid Time Off',
      description: `Early departure — ${isPTO ? 'PTO' : 'Unpaid'} top-up (${ptoTopUpHours}h): ${ptoTopUpNote.trim()}`,
      status: 'pending_approval',
      clockInTime: ptoStart,
      clockInCoords: null,
      clockOutTime: ptoEnd,
      clockOutCoords: null,
      travelTimeIn: 0,
      travelTimeOut: 0,
      lunchStart: null,
      lunchStartCoords: null,
      lunchEnd: null,
      lunchEndCoords: null,
      lunchDuration: 0,
      isManualEdit: true,
      isApproved: false,
      editRequestedAt: new Date(),
      createdAt: new Date(),
      updatedAt: serverTimestamp(),
    };

    try {
      await updateDoc(doc(db, 'time_entries', activeEntry.id), clockOutPayload);
      await addDoc(collection(db, 'time_entries'), ptoPayload);
      setShowPTOTopUp(false);
      setPtoTopUpNote('');
      setPtoTopUpHours(2);
      setTravelOut(0);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'time_entries');
    }
  };

  // Clock In Action Handler
  const handleClockIn = async () => {
    if (!selectedJobId) {
      alert('Please select a job site before clocking in.');
      return;
    }
    // Ref guard fires synchronously — blocks double-taps even within the same render cycle.
    // State-based guard (isClockActionPending / activeEntry) can miss rapid taps because
    // React batches state updates, so a second tap may read stale false values.
    if (clockInFiringRef.current || activeEntry) return;
    clockInFiringRef.current = true;
    setIsClockActionPending(true);
    setGpsError(null);
    setGpsLoading(true);

    const gps = await fetchGPS();
    const clockInCoords = gps ? { latitude: gps.lat, longitude: gps.lng } : null;
    if (gps) { setUserLat(gps.lat); setUserLng(gps.lng); }

    setGpsLoading(false);

    // Secondary guard: the onSnapshot may have arrived during the GPS wait and loaded
    // an existing active entry — bail out now rather than create a duplicate.
    if (activeEntryRef.current) {
      clockInFiringRef.current = false;
      setIsClockActionPending(false);
      return;
    }

    // Recalculate travelTimeIn from home → actual GPS location at clock-in (not job site estimate)
    let actualTravelIn = Number(travelIn) || 0;
    if (gps && user.homeLatitude && user.homeLongitude) {
      actualTravelIn = await getDrivingMinutes(user.homeLatitude, user.homeLongitude, gps.lat, gps.lng);
    }

    const now = new Date();
    const payload = {
      userId: user.uid,
      employeeName: user.name,
      date: now.toISOString().split('T')[0],
      jobId: activeJob.id,
      jobName: activeJob.name,
      costCode: COST_CODES[0],
      description: '',
      status: 'active',
      clockInTime: now,
      clockInCoords,
      clockOutTime: null,
      clockOutCoords: null,
      travelTimeIn: actualTravelIn,
      travelTimeOut: 0,
      travelFromLabel,
      lunchStart: null,
      lunchStartCoords: null,
      lunchEnd: null,
      lunchEndCoords: null,
      lunchDuration: 0,
      isManualEdit: false,
      isApproved: false,
      editRequestedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      localWritePendingRef.current = true;
      const docRef = await addDoc(collection(db, 'time_entries'), payload);
      setActiveEntry({ id: docRef.id, ...payload } as unknown as TimeEntry);

      // Site-to-site day: zero out the previous entry's return-home travel since the
      // employee drove directly to this site instead of going home first.
      if (prevSameDayEntryId) {
        updateDoc(doc(db, 'time_entries', prevSameDayEntryId), {
          travelTimeOut: 0,
          updatedAt: serverTimestamp(),
        }).catch(err => console.error('Failed to zero prev entry travelTimeOut:', err));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'time_entries');
    } finally {
      clockInFiringRef.current = false;
      setIsClockActionPending(false);
    }
  };

  // Clock Out Action Handler
  const handleClockOut = async () => {
    if (!activeEntry || isClockActionPending) return;
    // Lunch gate: if worked > 6h, must have at least 30min lunch
    const clockInMs = activeEntry.clockInTime?.seconds
      ? activeEntry.clockInTime.seconds * 1000
      : new Date(activeEntry.clockInTime).getTime();
    const workedSoFarMins = (Date.now() - clockInMs) / 60000 - (activeEntry.lunchDuration || 0);
    const lunchDurGuard = activeEntry.lunchDuration || 0;
    const lunchOkGuard = lunchAcknowledged || lunchDurGuard > 0;
    if (workedSoFarMins > 240 && (workedSoFarMins <= 360 ? !lunchOkGuard : lunchDurGuard < 30)) {
      return;
    }
    setIsClockActionPending(true);
    setGpsError(null);
    setSaveError(null);

    // Capture all values before clearing UI state
    const now = new Date();
    const entryId = activeEntry.id;
    const capturedCostCode = selectedCostCode;
    const capturedDescription = description;
    const capturedTravelOut = travelOut;

    // 1. Register INSTANTLY — UI clears before GPS
    setActiveEntry(null);
    setTravelOut(0);
    setDescription('');
    setIsClockActionPending(false);

    // 2. GPS in background (max 4s) — recorded time is already locked in
    const gps = await fetchGPS();
    const clockOutCoords = gps ? { latitude: gps.lat, longitude: gps.lng } : null;
    if (gps) { setUserLat(gps.lat); setUserLng(gps.lng); }

    // 3. Save — persistentLocalCache writes locally immediately, server sync is automatic
    // Recalculate travelTimeOut from actual GPS location at clock-out → home
    let actualTravelOut = Number(capturedTravelOut) || 0;
    if (gps && user.homeLatitude && user.homeLongitude) {
      actualTravelOut = await getDrivingMinutes(gps.lat, gps.lng, user.homeLatitude, user.homeLongitude);
    }

    // Clean entry: no manual edits, no auto clock-out, both clock-in and clock-out on-site → auto-approve
    const entryJob = jobs.find(j => j.id === activeEntry.jobId);
    const isClockInOnSite = entryJob && activeEntry.clockInCoords
      ? getHaversineDistance(activeEntry.clockInCoords.latitude, activeEntry.clockInCoords.longitude, entryJob.latitude, entryJob.longitude) <= entryJob.radius
      : false;
    const isClockOutOnSite = entryJob && clockOutCoords
      ? getHaversineDistance(clockOutCoords.latitude, clockOutCoords.longitude, entryJob.latitude, entryJob.longitude) <= entryJob.radius
      : false;
    const isCleanEntry = !activeEntry.isManualEdit && !activeEntry.wasAutoClockedOut && isClockInOnSite && isClockOutOnSite;
    const clockOutFields: Record<string, any> = {
      clockOutTime: now,
      clockOutCoords,
      status: 'completed' as const,
      costCode: capturedCostCode,
      description: capturedDescription,
      travelTimeOut: actualTravelOut,
      ...(isCleanEntry && { isApproved: true }),
    };
    localWritePendingRef.current = true;
    updateDoc(doc(db, 'time_entries', entryId), {
      ...clockOutFields,
      updatedAt: serverTimestamp(),
    }).catch(err => {
      console.error('Clock-out save failed:', err);
      queueOfflineAction({ action: 'update', docId: entryId, data: clockOutFields });
    });
  };

  // Lunch Breaks Handler
  const handleLunchToggle = async () => {
    if (!activeEntry || isClockActionPending) return;
    setIsClockActionPending(true);
    setGpsError(null);
    setSaveError(null);

    const entryId = activeEntry.id;

    if (!activeEntry.lunchStart) {
      // ── START LUNCH ────────────────────────────────────────────────
      const now = new Date();

      // 1. Register INSTANTLY — timer starts, button flips
      setActiveEntry({ ...activeEntry, lunchStart: now, lunchStartCoords: null, updatedAt: now });
      setIsClockActionPending(false);

      // 2. GPS in background (max 4s)
      const gps = await fetchGPS();
      const lunchStartCoords = gps ? { latitude: gps.lat, longitude: gps.lng } : null;
      if (gps) { setUserLat(gps.lat); setUserLng(gps.lng); }

      // Guard: if the employee returned from lunch while GPS was running, don't overwrite
      if (!activeEntryRef.current?.lunchStart) return;
      if (lunchStartCoords) {
        setActiveEntry(prev => prev ? { ...prev, lunchStartCoords } : prev);
      }

      // 3. Save
      const fields = { lunchStart: now, lunchStartCoords };
      localWritePendingRef.current = true;
      updateDoc(doc(db, 'time_entries', entryId), { ...fields, updatedAt: serverTimestamp() })
        .catch(err => {
          console.error('Lunch start save failed:', err);
          queueOfflineAction({ action: 'update', docId: entryId, data: fields });
        });

    } else {
      // ── END LUNCH ──────────────────────────────────────────────────
      const startMs = activeEntry.lunchStart.seconds
        ? activeEntry.lunchStart.seconds * 1000
        : new Date(activeEntry.lunchStart).getTime();
      const end = new Date();
      const diffMins = Math.round((end.getTime() - startMs) / 60000);
      const newLunchDuration = (activeEntry.lunchDuration || 0) + diffMins;

      const lunchEndFields = {
        lunchEnd: end,
        lunchEndCoords: null as { latitude: number; longitude: number } | null,
        lunchDuration: newLunchDuration,
        lunchStart: null,
        lunchStartCoords: null,
      };

      // 1. Register INSTANTLY
      setActiveEntry({ ...activeEntry, ...lunchEndFields, updatedAt: end });
      setIsClockActionPending(false);

      // 2. GPS in background (max 4s)
      const gps = await fetchGPS();
      const lunchEndCoords = gps ? { latitude: gps.lat, longitude: gps.lng } : null;
      if (gps) { setUserLat(gps.lat); setUserLng(gps.lng); }
      if (lunchEndCoords) {
        setActiveEntry(prev => prev ? { ...prev, lunchEndCoords } : prev);
      }

      // 3. Save
      const fields = { ...lunchEndFields, lunchEndCoords };
      localWritePendingRef.current = true;
      updateDoc(doc(db, 'time_entries', entryId), { ...fields, updatedAt: serverTimestamp() })
        .catch(err => {
          console.error('Lunch end save failed:', err);
          queueOfflineAction({ action: 'update', docId: entryId, data: fields });
        });
    }
  };

  // Submit Manual Shift Request
  const submitManualEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualDate || !manualJobId || !manualCostCode || !manualDescription.trim() || !manualHours.trim() || Number(manualHours) <= 0) {
      alert('Provide date, project, cost code, paid hours, and description.');
      return;
    }

    const mJob = jobs.find(j => j.id === manualJobId) || jobs[0];

    const startHour = 8;
    const clockIn = new Date(manualDate);
    clockIn.setHours(startHour, 0, 0, 0);

    const clockOut = new Date(manualDate);
    clockOut.setHours(startHour + Number(manualHours), 0, 0, 0);

    const payload = {
      userId: user.uid,
      employeeName: user.name,
      date: manualDate,
      jobId: mJob.id,
      jobName: mJob.name,
      costCode: manualCostCode,
      description: manualDescription,
      status: 'pending_approval',
      clockInTime: clockIn,
      clockInCoords: { latitude: mJob.latitude, longitude: mJob.longitude },
      clockOutTime: clockOut,
      clockOutCoords: { latitude: mJob.latitude, longitude: mJob.longitude },
      travelTimeIn: Number(manualTravelIn) || 0,
      travelTimeOut: Number(manualTravelOut) || 0,
      lunchStart: null,
      lunchStartCoords: null,
      lunchEnd: null,
      lunchEndCoords: null,
      lunchDuration: Number(manualLunch) || 0,
      isManualEdit: true,
      isApproved: false,
      editRequestedAt: new Date(),
      createdAt: new Date(),
      updatedAt: serverTimestamp()
    };

    if (isOnline) {
      try {
        await addDoc(collection(db, 'time_entries'), payload);
        setShowManualForm(false);
        setManualDescription('');
        alert('Manual Shift submitted for Manager review.');
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'time_entries');
      }
    } else {
      queueOfflineAction({ action: 'create', data: payload });
      setShowManualForm(false);
      setManualDescription('');
      alert('Offline Note: Manual log entry cached. Will register with manager once unified online sync completes.');
    }
  };

  // Calculate billable and total hours in real-time
  const getTotals = (entry: TimeEntry) => {
    const rawIn = entry.clockInTime?.seconds * 1000 || entry.clockInTime || Date.now();
    const rawOut = entry.clockOutTime?.seconds * 1000 || entry.clockOutTime || Date.now();

    const diffMs = rawOut - rawIn;
    const totalMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)));
    const lunch = entry.lunchDuration || 0;

    const workMinutes = Math.max(0, totalMinutes - lunch);
    const travelIn = Number(entry.travelTimeIn || 0);
    const travelOut = Number(entry.travelTimeOut || 0);
    const companyTravelIn = Math.max(0, travelIn - companyTravelCoverageMinutes);
    const companyTravelOut = Math.max(0, travelOut - companyTravelCoverageMinutes);
    const billingMinutes = workMinutes + companyTravelIn + companyTravelOut;

    return {
      worked: (workMinutes / 60).toFixed(2),
      billable: (billingMinutes / 60).toFixed(2),
      lunch: lunch,
      travel: travelIn + travelOut
    };
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6" id="employee-dashboard-content">

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[#1c0a00] p-5 rounded-2xl mb-6 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center border border-white/20">
            <Clock className="text-white w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              Welcome, {user.name.split(' ')[0]}
            </h1>
            <p className="text-xs text-slate-300">{user.email}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Signal Indicator */}
          <div className={`p-2 py-1.5 rounded-lg flex items-center gap-2 text-xs border ${
            isOnline
              ? 'bg-green-500/20 text-green-300 border-green-500/30'
              : 'bg-red-500/20 text-red-300 border-red-500/30'
          }`} id="network-signal">
            {isOnline ? (
              <>
                <Wifi className="w-4 h-4" />
                <span>Online (Sync Ready)</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4" />
                <span>Offline Work Mode ({offlineQueue.length} queued)</span>
              </>
            )}
          </div>

          <button
            onClick={onSignOut}
            className="text-xs bg-white/10 hover:bg-white/20 font-bold px-3.5 py-2 rounded-lg text-white border border-white/20 hover:border-white/30 active:translate-y-px transition-all cursor-pointer"
            id="employee-signout-btn"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Declined entries alert — shows the single most recent declined entry at a time */}
      {(() => {
        const declined = pastEntries
          .filter(e => e.status === 'declined')
          .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
        const top = declined[0];
        if (!top) return null;
        const remaining = declined.length - 1;
        return (
          <div className="bg-red-50 border border-red-300 rounded-2xl px-5 py-4 space-y-2 mb-2">
            <div className="flex items-start gap-3">
              <XSquare className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-red-800 text-sm">Action required: time entry declined by your manager.</p>
                <p className="text-xs text-red-700 mt-0.5">
                  Correct the entry and resubmit for approval.
                  {remaining > 0 && <span className="ml-1 font-semibold">({remaining} more declined {remaining === 1 ? 'entry' : 'entries'} after this one.)</span>}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('clock')}
                className="shrink-0 text-[11px] font-bold text-red-700 bg-red-100 hover:bg-red-200 border border-red-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                View in Time Clock
              </button>
            </div>
            <div className="ml-8 flex items-start gap-2 text-xs text-red-700 bg-red-100 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                <strong>{top.jobName}</strong> — {top.date}
                {top.declineReason && <span>: {top.declineReason}</span>}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Auto clock-out warning — visible on all tabs */}
      {pastEntries.some(e => e.wasAutoClockedOut && e.status !== 'pending_approval') && (
        <div className="bg-amber-50 border border-amber-400 rounded-2xl px-5 py-4 mb-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 space-y-0.5">
            <p className="font-bold">Action required: You were auto clocked-out on one or more shifts.</p>
            <p className="text-xs text-amber-700">Your time was set to {autoClockOutRevertHours}h as a default. If you worked more than {autoClockOutRevertHours} hours, go to Time Clock → Recent Personal Logs, tap "Correct My Clock-Out Time", enter your actual time, and submit for approval.</p>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-2 sticky top-0 z-20 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveTab('clock')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 sm:px-4 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
            activeTab === 'clock'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Clock className="w-4 h-4" />
          Time Clock
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('timecards')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 sm:px-4 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
            activeTab === 'timecards'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <CalendarDays className="w-4 h-4" />
          Pay Periods
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('timeoff')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 sm:px-4 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
            activeTab === 'timeoff'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Plane className="w-4 h-4" />
          Time Off
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('help')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 sm:px-4 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
            activeTab === 'help'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          How-To
        </button>
      </div>

      {/* Timecards tab */}
      {activeTab === 'timecards' && (
        <BiweeklyTimecardPanel
          mode="employee"
          currentUser={user}
          allEntries={pastEntries}
        />
      )}

      {/* Time Off tab */}
      {activeTab === 'timeoff' && (
        <TimeOffRequestPanel user={user} />
      )}

      {/* Help / SOP tab */}
      {activeTab === 'help' && (
        <div className="space-y-4 text-sm">
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-5">
            <h2 className="text-base font-black text-gray-800 uppercase tracking-wide flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-orange-500" />
              Employee Time Tracking — How It Works
            </h2>

            {[
              {
                title: '1. Clocking In',
                body: 'Tap "Time Clock" → select your job site → tap Clock In. Your GPS location is recorded. You must be at or near the site (within the site\'s allowed radius) to clock in. If GPS is unavailable, the clock-in still works but will be flagged for review.',
              },
              {
                title: '2. Lunch Breaks',
                body: 'Tap "Clock Out: Go to Lunch" to pause your timer. Tap "Clock In: Return from Lunch" when you\'re back. Lunch auto-ends at 75 minutes. If you worked more than 6 hours without recording lunch, you must log a break before clocking out. Use "Forgot to log a lunch break?" to add one retroactively.',
              },
              {
                title: '3. Clocking Out',
                body: 'Tap Clock Out at the end of your shift. You must have filled in a shift description. If you worked more than 6 hours, lunch must be recorded first. Your time is submitted and visible to your manager.',
              },
              {
                title: '4. Travel Pay',
                body: 'Travel time is calculated automatically from your home address to the job site (and back). You cover the first 30 minutes each way. Anything beyond 30 minutes per direction is paid by the company. Travel is estimated using real road routing (OSRM) based on your home address and the job site. Actual drive time may vary — contact admin if your route is significantly different.',
              },
              {
                title: '5. Auto Clock-Out',
                body: `If you forget to clock out, the system will automatically close your shift ${autoClockOutTriggerHours} hours after clock-in and set your time to ${autoClockOutRevertHours} hours as a default. A warning banner will appear at the top of your screen. Tap "Correct My Clock-Out Time" in Recent Personal Logs, enter your actual clock-out time, and submit for manager approval. If you worked more than ${autoClockOutRevertHours} hours, you must submit a correction — your pay will reflect the ${autoClockOutRevertHours}h default until approved.`,
              },
              {
                title: '6. Manual Entries (Missed Punches)',
                body: 'If you forgot to clock in for a shift, use "Log a Missed Shift" at the bottom of the Time Clock tab. Fill in the job site, times, and description. These are flagged as manual edits and must be approved by your manager before appearing in your payroll.',
              },
              {
                title: '7. Declined Entries',
                body: 'If your manager declines an entry, it shows in red in your Recent Personal Logs. Tap "Edit & Resubmit" to correct it and send it back for approval. The decline reason is shown on the card.',
              },
              {
                title: '8. Pay Periods & Timecards',
                body: 'Go to "Pay Periods" to review your biweekly timecard. You can sign your timecard once all entries for the period are complete. Admin countersigns to finalize.',
              },
              {
                title: '9. Time Off Requests',
                body: 'Go to "Time Off" to submit PTO or unpaid time off requests. Specify the dates, type, and reason. Admin reviews and approves or denies the request. Approved time off appears on your timecard automatically.',
              },
              {
                title: '10. Profile & Home Address',
                body: 'Your home address is set by your manager and used to calculate travel pay. If your address is wrong or missing, contact admin. Correct home address is required for travel calculation on manual entries.',
              },
            ].map(({ title, body }) => (
              <div key={title} className="border-l-4 border-orange-200 pl-4 space-y-1">
                <h3 className="font-bold text-gray-800 text-sm">{title}</h3>
                <p className="text-gray-600 text-xs leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Time Clock tab */}
      {activeTab === 'clock' && <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Auto-clocked-out alert banner — shown at top of clock tab when any recent entry was auto-closed */}
        {pastEntries.some(e => e.wasAutoClockedOut && e.status !== 'pending_approval') && (
          <div className="lg:col-span-3 bg-amber-50 border border-amber-300 rounded-2xl px-5 py-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 space-y-0.5">
              <p className="font-bold">Action required: You were auto-clocked out on one or more shifts.</p>
              <p className="text-xs text-amber-700">This usually means you forgot to clock out before leaving. Review the entries below, correct your actual clock-out time, and submit for approval.</p>
            </div>
          </div>
        )}

        {/* Left column: clock in interface */}
        <div className="lg:col-span-2 space-y-6">

          {/* Main Controls Card */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 shadow-sm" id="work-controls-card">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider border-b border-gray-100 pb-3 mb-5 flex items-center gap-2">
              <Play className="w-4 h-4 text-orange-500" />
              Active Timecard Operations
            </h2>

            {/* Check if active timecard exists */}
            {activeEntry ? (
              <div className="space-y-6">
                {/* Save-failure banner — shown when a clock action's write itself failed */}
                {saveError && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{saveError}</span>
                  </div>
                )}

                {/* Active Session Status */}
                <div className="bg-green-50 rounded-xl p-5 border border-green-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="flex items-start gap-3">
                    <div className="w-3 h-3 bg-green-500 rounded-full animate-ping mt-1 shrink-0" />
                    <div>
                      <h3 className="text-xs font-bold text-green-700 uppercase tracking-wide">
                        ACTIVE SESSION ON:
                      </h3>
                      <p className="text-lg font-bold text-gray-900 mt-0.5">
                        {activeEntry.jobName}
                      </p>
                      <div className="text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1 mt-1">
                        <span>Cost Code: {activeEntry.costCode}</span>
                        <span>In: {new Date(activeEntry.clockInTime?.seconds * 1000 || activeEntry.clockInTime).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end text-right shrink-0">
                    <span className="text-xs text-gray-500">Live Session Duration</span>
                    <span className="text-2xl font-bold font-mono text-green-600">
                      {getTotals(activeEntry).worked} hrs
                    </span>
                    {activeEntry.lunchDuration > 0 && (
                      <span className="text-[11px] text-gray-400 font-mono">
                        Break Deducted: {activeEntry.lunchDuration}m
                      </span>
                    )}
                  </div>
                </div>

                {/* Sub-Actions: Travel Out and Lunch break */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Lunch Actions */}
                  <div className={`p-4 rounded-xl border space-y-3 transition-colors ${
                    activeEntry.lunchStart
                      ? 'bg-amber-50 border-amber-200'
                      : 'bg-gray-50 border-gray-200'
                  }`}>
                    <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${
                      activeEntry.lunchStart ? 'text-amber-700' : 'text-gray-600'
                    }`}>
                      <Coffee className={`w-4 h-4 ${activeEntry.lunchStart ? 'text-amber-500' : 'text-orange-500'}`} />
                      {activeEntry.lunchStart ? 'Lunch Break Active' : 'Break Manager'}
                    </div>

                    {activeEntry.lunchStart ? (() => {
                      const lunchStartMs = activeEntry.lunchStart.seconds
                        ? activeEntry.lunchStart.seconds * 1000
                        : new Date(activeEntry.lunchStart).getTime();
                      const autoReturnTime = new Date(lunchStartMs + 75 * 60 * 1000);
                      return (
                        <div className="bg-amber-100 border border-amber-200 rounded-lg px-3 py-2.5 text-center space-y-0.5">
                          <div className="text-[11px] font-semibold text-amber-800 animate-pulse">
                            ● On lunch since {new Date(lunchStartMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          <div className="text-[10.5px] text-amber-600">
                            Work timer paused — auto-returns at {autoReturnTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      );
                    })() : (
                      <p className="text-[11.5px] text-gray-500 leading-relaxed">
                        Meal periods automatically deduct from overall log duration. Tap below to pause/resume work timers.
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={handleLunchToggle}
                      disabled={isClockActionPending}
                      className={`w-full py-2.5 px-3 rounded-lg text-xs font-bold transition-all shadow-sm active:translate-y-px flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                        activeEntry.lunchStart
                          ? 'bg-green-600 hover:bg-green-700 text-white'
                          : 'bg-orange-500 hover:bg-orange-600 text-white'
                      }`}
                      id="lunch-toggle-btn"
                    >
                      <Coffee className="w-4 h-4" />
                      {isClockActionPending
                        ? 'Getting location…'
                        : activeEntry.lunchStart
                          ? 'Clock In: Return from Lunch'
                          : 'Clock Out: Go to Lunch'}
                    </button>
                    {isClockActionPending && (
                      <p className="text-[10.5px] text-center text-gray-400">
                        Getting your location — this can take a few seconds on weak signal. Please don't tap again.
                      </p>
                    )}

                    {/* Manual lunch correction — only show when not currently on lunch */}
                    {!activeEntry.lunchStart && (
                      <div className="border-t border-gray-200 pt-2">
                        <button
                          type="button"
                          onClick={() => setShowManualLunch(v => !v)}
                          className="w-full flex items-center justify-between text-[11px] text-gray-400 hover:text-gray-600 transition-colors cursor-pointer py-0.5"
                        >
                          <span className="flex items-center gap-1">
                            <PenLine className="w-3 h-3" />
                            Forgot to log a lunch break?
                          </span>
                          {showManualLunch ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>

                        {showManualLunch && (
                          <div className="mt-2 bg-orange-50 border border-orange-200 rounded-lg p-3 space-y-2.5">
                            <p className="text-[10.5px] text-orange-700 font-semibold">
                              Enter the times you were on lunch. A note will be appended to this entry.
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[10px] text-gray-500 mb-1 font-semibold uppercase tracking-wide">Start</label>
                                <input
                                  type="time"
                                  value={manualLunchStart}
                                  onChange={e => setManualLunchStart(e.target.value)}
                                  className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-xs font-mono text-gray-900 focus:outline-none focus:border-orange-400"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] text-gray-500 mb-1 font-semibold uppercase tracking-wide">End</label>
                                <input
                                  type="time"
                                  value={manualLunchEnd}
                                  onChange={e => setManualLunchEnd(e.target.value)}
                                  className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-xs font-mono text-gray-900 focus:outline-none focus:border-orange-400"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-[10px] text-gray-500 mb-1 font-semibold uppercase tracking-wide">Reason / Note</label>
                              <input
                                type="text"
                                value={manualLunchNote}
                                onChange={e => setManualLunchNote(e.target.value)}
                                placeholder="e.g. Forgot to tap lunch button"
                                className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-orange-400"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={handleManualLunch}
                              disabled={!manualLunchStart || !manualLunchEnd || !manualLunchNote.trim()}
                              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-2 rounded-lg text-xs cursor-pointer active:translate-y-px transition-all"
                            >
                              Submit Manual Lunch
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Travel Back (Exit) — Auto-calculated read-only */}
                  <div className="bg-orange-50 p-4 rounded-xl border border-orange-200 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-orange-700">
                      <Navigation className="w-4 h-4 text-orange-500" />
                      Travel Back (Auto-calculated)
                    </div>
                    {!user.homeLatitude || !user.homeLongitude ? (
                      <p className="text-[11px] text-amber-600 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        Home address not set — contact admin.
                      </p>
                    ) : (
                      <div className="space-y-1 text-xs font-mono">
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">Estimated travel back:</span>
                          <span className="font-bold text-orange-700">{travelOut} min</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">Your portion (first {companyTravelCoverageMinutes}m):</span>
                          <span className="font-bold text-amber-600">{Math.min(travelOut, companyTravelCoverageMinutes)} min</span>
                        </div>
                        {travelOut > companyTravelCoverageMinutes && (
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">Company covers (beyond {companyTravelCoverageMinutes}m):</span>
                            <span className="font-bold text-green-600">{travelOut - companyTravelCoverageMinutes} min</span>
                          </div>
                        )}
                      </div>
                    )}
                    <p className="text-[10px] text-gray-400 italic">
                      Paid outside regular hours. Based on your home address on file.
                    </p>
                  </div>
                </div>

                {/* Cost Code + Work Description — filled before clocking out */}
                <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
                  <p className="text-xs font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-orange-500" />
                    Job Details (Required Before Clock-Out)
                  </p>

                  {/* Searchable cost code */}
                  <div className="relative" ref={costCodeRef}>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Cost Code
                    </label>
                    <button
                      type="button"
                      onClick={() => { setShowCostCodeDropdown(v => !v); setCostCodeSearch(''); }}
                      className="flex items-center justify-between w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-orange-500 text-left"
                    >
                      <span className="truncate">{selectedCostCode}</span>
                      {showCostCodeDropdown
                        ? <ChevronUp className="w-4 h-4 shrink-0 text-gray-400 ml-2" />
                        : <ChevronDown className="w-4 h-4 shrink-0 text-gray-400 ml-2" />}
                    </button>

                    {showCostCodeDropdown && (
                      <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                        <div className="p-2 border-b border-gray-100">
                          <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                            <input
                              type="text"
                              autoFocus
                              placeholder="Search cost codes..."
                              value={costCodeSearch}
                              onChange={e => setCostCodeSearch(e.target.value)}
                              className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-orange-400 bg-gray-50"
                            />
                          </div>
                        </div>
                        <div className="max-h-48 overflow-y-auto">
                          {(() => {
                            const filtered = costCodeSearch.trim()
                              ? COST_CODES.filter(c => c.toLowerCase().includes(costCodeSearch.toLowerCase()))
                              : COST_CODES;
                            return filtered.length === 0 ? (
                              <div className="px-3 py-4 text-xs text-gray-400 text-center italic">
                                No codes match "{costCodeSearch}"
                              </div>
                            ) : filtered.map(code => (
                              <button
                                key={code}
                                type="button"
                                onClick={() => { setSelectedCostCode(code); setShowCostCodeDropdown(false); setCostCodeSearch(''); }}
                                className={`w-full text-left px-3 py-2.5 text-xs transition-colors border-b border-gray-50 last:border-0 ${
                                  selectedCostCode === code ? 'bg-orange-50 text-orange-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'
                                }`}
                              >{code}</button>
                            ));
                          })()}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Work Description <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      rows={3}
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder="Describe the work completed on this shift..."
                      className="block w-full bg-white border border-gray-300 rounded-lg p-2.5 text-sm text-gray-900 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 resize-none"
                    />
                    {!description.trim() && (
                      <p className="mt-1 text-[11px] text-amber-600 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        Required before you can clock out.
                      </p>
                    )}
                  </div>
                </div>

                {/* Manual clock-out correction */}
                {!activeEntry.lunchStart && (
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowManualClockOutForm(v => !v)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-xs text-gray-500 hover:text-gray-700 font-semibold transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <TimerOff className="w-3.5 h-3.5 text-amber-500" />
                        Forgot to clock out on time?
                      </span>
                      {showManualClockOutForm ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                    {showManualClockOutForm && (
                      <div className="bg-amber-50 border-t border-amber-200 p-4 space-y-3">
                        <p className="text-[10.5px] text-amber-700 leading-relaxed">
                          Enter the time you actually stopped work. A correction note will be saved to this timecard and flagged for manager review.
                        </p>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-wide mb-1">Actual Clock-Out Time</label>
                          <input
                            type="time"
                            value={manualClockOutTime}
                            onChange={e => setManualClockOutTime(e.target.value)}
                            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-amber-400"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-wide mb-1">Reason / Note (Required)</label>
                          <input
                            type="text"
                            value={manualClockOutNote}
                            onChange={e => setManualClockOutNote(e.target.value)}
                            placeholder="e.g. Left site without clocking out, forgot phone"
                            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-amber-400"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleManualClockOut}
                          disabled={!manualClockOutTime || !manualClockOutNote.trim()}
                          className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg text-xs cursor-pointer active:translate-y-px transition-all flex items-center justify-center gap-1.5"
                        >
                          <TimerOff className="w-3.5 h-3.5" />
                          Submit Manual Clock-Out
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* PTO / Unpaid top-up on early departure */}
                {!activeEntry?.lunchStart && (
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowPTOTopUp(v => !v)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-xs text-gray-500 hover:text-gray-700 font-semibold transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <Plane className="w-3.5 h-3.5 text-green-500" />
                        Leaving early? Claim PTO for remaining hours
                      </span>
                      {showPTOTopUp ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                    {showPTOTopUp && (
                      <div className="bg-green-50 border-t border-green-200 p-4 space-y-3">
                        <p className="text-[10.5px] text-green-800 leading-relaxed">
                          Clock out now and claim PTO or unpaid time for the hours you won't be working. Both entries go to your manager for approval.
                        </p>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setPtoTopUpType('pto')} className={`flex-1 text-xs font-bold py-2 rounded-lg border transition-all cursor-pointer ${ptoTopUpType === 'pto' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-500 border-gray-300 hover:border-green-400'}`}>Paid (PTO)</button>
                          <button type="button" onClick={() => setPtoTopUpType('unpaid')} className={`flex-1 text-xs font-bold py-2 rounded-lg border transition-all cursor-pointer ${ptoTopUpType === 'unpaid' ? 'bg-gray-600 text-white border-gray-600' : 'bg-white text-gray-500 border-gray-300 hover:border-gray-500'}`}>Unpaid</button>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-wide mb-1">Hours to Claim</label>
                          <input type="number" min="0.5" max="8" step="0.5" value={ptoTopUpHours} onChange={e => setPtoTopUpHours(Number(e.target.value) || 1)} className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-green-400" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-wide mb-1">Reason <span className="text-red-500">*</span></label>
                          <input type="text" value={ptoTopUpNote} onChange={e => setPtoTopUpNote(e.target.value)} placeholder="e.g. Doctor appointment, family obligation..." className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-green-400" />
                        </div>
                        <button type="button" onClick={handleClockOutWithPTO} disabled={!ptoTopUpNote.trim() || ptoTopUpHours <= 0} className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg text-xs cursor-pointer active:translate-y-px transition-all flex items-center justify-center gap-1.5">
                          <Plane className="w-3.5 h-3.5" />
                          Clock Out + Claim {ptoTopUpHours}h {ptoTopUpType === 'pto' ? 'PTO' : 'Unpaid'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Lunch notice + Clock Out — computed together so both share the same gate */}
                {(() => {
                  const ciMs = activeEntry.clockInTime?.seconds
                    ? activeEntry.clockInTime.seconds * 1000
                    : new Date(activeEntry.clockInTime).getTime();
                  const workedMins = (Date.now() - ciMs) / 60000 - (activeEntry.lunchDuration || 0);
                  const lunchDur = activeEntry.lunchDuration || 0;
                  // 4–6h: any lunch logged OR acknowledged (0-min "no lunch" counts); 6h+: at least 30 min
                  const lunchOk = lunchAcknowledged || lunchDur > 0;
                  const lunchBlocked = workedMins > 240 && (workedMins <= 360 ? !lunchOk : lunchDur < 30);
                  return (
                    <>
                      {workedMins > 240 && !lunchOk && workedMins <= 360 && (
                        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-700">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span><strong>Lunch required:</strong> You've worked more than 4 hours. Please log a lunch break before clocking out.</span>
                        </div>
                      )}
                      {workedMins > 360 && lunchDur < 30 && (
                        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-xs text-red-700">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span><strong>Lunch required:</strong> You've worked more than 6 hours. Lunch entry must be at least 30 minutes before you can clock out.{lunchDur > 0 ? ` (Currently: ${lunchDur}m)` : ''}</span>
                        </div>
                      )}
                      {!lunchBlocked && (
                        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-[11px] text-gray-500">
                          <Coffee className="w-3 h-3 shrink-0 text-orange-400" />
                          {workedMins > 360 && lunchDur >= 30
                            ? `Lunch recorded: ${lunchDur}m (30m required — you're good)`
                            : workedMins > 240 && lunchDur > 0
                            ? `Lunch recorded: ${lunchDur}m`
                            : `Lunch policy: required if you work more than 4 hours`}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={handleClockOut}
                        disabled={!!activeEntry.lunchStart || !description.trim() || isClockActionPending || lunchBlocked}
                        className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed active:translate-y-px transition-all font-bold text-white text-base py-5 rounded-xl shadow-md flex items-center justify-center gap-2 cursor-pointer"
                        id="clockout-trigger-btn"
                      >
                        <Square className="w-5 h-5 fill-white" />
                        {isClockActionPending ? 'Working…' : 'Clock Out'}
                      </button>
                      {activeEntry.lunchStart && (
                        <p className="text-[11px] text-center text-red-600 leading-tight">
                          * You must finish your active Lunch Break before clocking out.
                        </p>
                      )}
                      {isClockActionPending && (
                        <p className="text-[10.5px] text-center text-gray-400">
                          Getting your location — this can take a few seconds on weak signal. Please don't tap again.
                        </p>
                      )}
                    </>
                  );
                })()}

                {/* GPS status note — amber info only, never blocks */}
                {gpsError && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{gpsError}</span>
                  </div>
                )}
              </div>
            ) : (
              /* Clock In flow */
              <div className="space-y-4">

                {/* 1. Select Job Site */}
                {jobsLoadError && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{jobsLoadError}</span>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-gray-600 uppercase tracking-wider mb-1.5">
                    1. Select Job Site
                  </label>
                  <select
                    value={selectedJobId}
                    onChange={(e) => setSelectedJobId(e.target.value)}
                    className="block w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                    id="job-select"
                  >
                    {jobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.name} ({job.address})
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. Estimated Travel Time */}
                <div className="bg-orange-50 p-4 rounded-xl border border-orange-200">
                  <div className="text-xs font-bold text-orange-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Navigation className="w-3.5 h-3.5" />
                    2. Estimated Travel Time (Auto-calculated)
                  </div>
                  {!user.homeLatitude || !user.homeLongitude ? (
                    <p className="text-xs text-amber-600 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      Home address not set. Contact your administrator to enable auto travel time.
                    </p>
                  ) : (
                    <div className="space-y-1.5 text-xs font-mono">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Estimated from {travelFromLabel}:</span>
                        <span className="font-bold text-orange-700">{travelIn} min</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Your portion (first {companyTravelCoverageMinutes}m):</span>
                        <span className="font-bold text-amber-600">{Math.min(travelIn, companyTravelCoverageMinutes)} min</span>
                      </div>
                      {travelIn > companyTravelCoverageMinutes && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">Company covers (beyond {companyTravelCoverageMinutes}m):</span>
                          <span className="font-bold text-green-600">{travelIn - companyTravelCoverageMinutes} min</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 3. Claim Time Off (Optional) */}
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                  <div className="text-xs font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
                    <Plane className="w-3.5 h-3.5 text-slate-400" />
                    3. Not Coming In? Claim Time Off
                  </div>

                  <div className="space-y-2">
                    {/* PTO row */}
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setPtoEnabled(v => !v)}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-all cursor-pointer w-28 justify-center shrink-0 ${
                          ptoEnabled
                            ? 'bg-green-600 text-white border-green-600'
                            : 'bg-white text-gray-500 border-gray-300 hover:border-green-400'
                        }`}
                      >
                        <Plane className="w-3 h-3" />
                        Paid (PTO)
                      </button>
                      <input
                        type="number"
                        min="0.5" max="12" step="0.5"
                        value={ptoClaimHours}
                        onChange={e => setPtoClaimHours(e.target.value)}
                        disabled={!ptoEnabled}
                        className="w-20 bg-white border border-gray-300 rounded-lg px-2 py-2 text-sm font-mono text-center text-gray-900 focus:outline-none focus:border-green-400 disabled:opacity-40 disabled:bg-gray-100"
                      />
                      <span className="text-xs text-gray-500">hrs</span>
                    </div>

                    {/* Unpaid row */}
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setUnpaidEnabled(v => !v)}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-all cursor-pointer w-28 justify-center shrink-0 ${
                          unpaidEnabled
                            ? 'bg-gray-600 text-white border-gray-600'
                            : 'bg-white text-gray-500 border-gray-300 hover:border-gray-500'
                        }`}
                      >
                        Unpaid
                      </button>
                      <input
                        type="number"
                        min="0.5" max="12" step="0.5"
                        value={unpaidClaimHours}
                        onChange={e => setUnpaidClaimHours(e.target.value)}
                        disabled={!unpaidEnabled}
                        className="w-20 bg-white border border-gray-300 rounded-lg px-2 py-2 text-sm font-mono text-center text-gray-900 focus:outline-none focus:border-gray-400 disabled:opacity-40 disabled:bg-gray-100"
                      />
                      <span className="text-xs text-gray-500">hrs</span>
                    </div>
                  </div>

                  {(ptoEnabled || unpaidEnabled) && (
                    <div className="space-y-2 pt-2 border-t border-gray-200">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-wide mb-1">
                          Reason <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={timeOffNote}
                          onChange={e => setTimeOffNote(e.target.value)}
                          placeholder="e.g. Sick day, scheduled time off, personal day..."
                          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-orange-400"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleSubmitPTODay}
                        disabled={!timeOffNote.trim()}
                        className="w-full disabled:opacity-50 bg-orange-600 hover:bg-orange-700 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer active:translate-y-px transition-all"
                      >
                        <Plane className="w-3.5 h-3.5" />
                        Submit {[ptoEnabled && ptoClaimHours && `${ptoClaimHours}h PTO`, unpaidEnabled && unpaidClaimHours && `${unpaidClaimHours}h Unpaid`].filter(Boolean).join(' + ')}
                      </button>
                    </div>
                  )}
                </div>

                {/* Clock In Button */}
                <button
                  type="button"
                  onClick={handleClockIn}
                  disabled={gpsLoading || !!jobsLoadError || jobs.length === 0}
                  className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 active:translate-y-px transition-all font-bold text-white text-base py-5 rounded-xl shadow-md flex items-center justify-center gap-2 cursor-pointer"
                  id="clockin-trigger-btn"
                >
                  {gpsLoading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Getting Location...
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 fill-white" />
                      Clock In
                    </>
                  )}
                </button>

                {/* GPS status note — amber info only, never blocks */}
                {gpsError && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{gpsError}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Manual Shift Request Form */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-4">
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4 text-orange-500" />
                Missed Punch? Log a Manual Entry
              </h2>
              <button
                type="button"
                onClick={() => setShowManualForm(!showManualForm)}
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold px-3 py-1.5 rounded-lg border border-gray-200 hover:border-gray-300 transition-all cursor-pointer"
                id="toggle-manual-form"
              >
                {showManualForm ? 'Hide Form' : 'File Manual Log'}
              </button>
            </div>

            {showManualForm && (
              <form onSubmit={submitManualEntry} className="space-y-4" id="manual-entry-form">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1">
                      Shift Date
                    </label>
                    <input
                      type="date"
                      value={manualDate}
                      onChange={(e) => setManualDate(e.target.value)}
                      required
                      className="block w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-orange-500"
                      id="manual-date-input"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1">
                      Assigned Project Location
                    </label>
                    <select
                      value={manualJobId}
                      onChange={(e) => setManualJobId(e.target.value)}
                      className="block w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-orange-500"
                      id="manual-job-select"
                    >
                      {jobs.map((job) => (
                        <option key={job.id} value={job.id}>
                          {job.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1">
                      Cost Code
                    </label>
                    <select
                      value={manualCostCode}
                      onChange={(e) => setManualCostCode(e.target.value)}
                      className="block w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-900 focus:outline-none"
                      id="manual-cost-code-select"
                    >
                      {COST_CODES.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1">
                      Paid Hours (Duration)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      max="24"
                      value={manualHours}
                      onChange={(e) => setManualHours(e.target.value)}
                      required
                      className="block w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-900 font-mono"
                      id="manual-hours-input"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1">
                      Lunch Break (Minutes)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={manualLunch}
                      onChange={(e) => setManualLunch(e.target.value)}
                      className="block w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-900 font-mono"
                      id="manual-lunch-input"
                    />
                  </div>
                </div>

                <div className="bg-orange-50 p-3 rounded-lg border border-orange-200 space-y-1 text-xs font-mono">
                  <div className="text-[10px] font-bold text-orange-700 uppercase tracking-wide mb-1.5">Travel (Auto-calculated)</div>
                  {!user.homeLatitude || !user.homeLongitude ? (
                    <p className="text-amber-600 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      Home address not set — travel cannot be calculated. Contact admin.
                    </p>
                  ) : (
                    <>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Travel in (home → site):</span>
                        <span className="font-bold text-orange-700">{manualTravelIn} min</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Travel out (site → home):</span>
                        <span className="font-bold text-orange-700">{manualTravelOut} min</span>
                      </div>
                    </>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1">
                    Work Description / Manager Explanation
                  </label>
                  <input
                    type="text"
                    value={manualDescription}
                    onChange={(e) => setManualDescription(e.target.value)}
                    required
                    placeholder="Explain what was accomplished and why a manual timecard is needed..."
                    className="block w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-900"
                    id="manual-description-input"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2 rounded-lg text-xs transition-all active:translate-y-px cursor-pointer"
                  id="manual-submit-btn"
                >
                  Request Shift Approval
                </button>
              </form>
            )}
            {!showManualForm && (
              <p className="text-xs text-gray-500 leading-relaxed">
                Manual corrections allow logging missed shifts directly. Submissions generate auditing flags and must be approved by your manager before being added to billing sheets.
              </p>
            )}
          </div>
        </div>

        {/* Right column: Session Logs */}
        <div className="space-y-6">
          {/* Past History Logs */}
          <div className="bg-white border border-gray-200 p-4 sm:p-5 rounded-2xl shadow-sm space-y-4" id="worker-history-panel">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700 flex items-center gap-2 border-b border-gray-100 pb-2 mb-2">
              <History className="w-4 h-4 text-gray-400" />
              Recent Personal Logs
            </h3>

            {pastEntries.length === 0 ? (
              <p className="text-xs text-gray-400 italic text-center py-4">No completed logs recorded yet.</p>
            ) : (
              <div className="space-y-3 sm:overflow-y-auto sm:max-h-96 pr-1 custom-scrollbar">
                {pastEntries.map((item) => {
                  const data = getTotals(item);
                  const isAutoClosed = !!item.wasAutoClockedOut && item.status !== 'pending_approval';
                  const isDeclined = item.status === 'declined';
                  const isCorrectingThis = autoClockCorrectionId === item.id;
                  const isResubmittingThis = declinedEditId === item.id;
                  return (
                    <div key={item.id} className={`border rounded-xl p-3 space-y-2 text-xs ${isDeclined ? 'bg-red-50 border-red-300' : isAutoClosed ? 'bg-amber-50 border-amber-300' : 'bg-gray-50 border-gray-200'}`}>
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-gray-800 truncate max-w-[130px]" title={item.jobName}>
                          {item.jobName}
                        </span>
                        <span className="text-[10px] text-gray-400 font-mono">
                          {item.date}
                        </span>
                      </div>

                      {isAutoClosed && (
                        <div className="flex items-center gap-1.5 text-amber-700 font-semibold text-[11px]">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          Auto-clocked out — please correct your actual time
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] font-mono border-t border-gray-200 pt-1.5 text-gray-500">
                        <span>Worked: <strong className="text-orange-600">{data.worked}h</strong></span>
                        {item.lunchDuration > 0 && <span>Lunch: {item.lunchDuration}m</span>}
                        {(item.travelTimeIn > 0 || item.travelTimeOut > 0) && (
                          <span>
                            Travel: {item.travelFromLabel || 'Home'}→here {item.travelTimeIn}m
                            {item.travelTimeOut > 0 ? ` | here→home ${item.travelTimeOut}m` : ''}
                          </span>
                        )}
                      </div>

                      <div className="bg-white border border-gray-100 p-2 rounded text-gray-600 leading-normal line-clamp-2 italic text-[11px]">
                        "{item.description}"
                      </div>

                      <div className="flex justify-between items-center border-t border-gray-100 pt-1 text-[10px]">
                        <span className="text-gray-400 font-mono shrink-0 truncate max-w-[140px] block">
                          Code: {item.costCode.split(' ')[0]}
                        </span>

                        {item.isApproved ? (
                          <span className="text-green-600 flex items-center gap-1 font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            Approved
                          </span>
                        ) : isDeclined ? (
                          <span className="text-red-600 flex items-center gap-1 font-bold">
                            <XSquare className="w-3.5 h-3.5 shrink-0" />
                            Declined
                          </span>
                        ) : item.status === 'pending_approval' ? (
                          <span className="text-amber-600 flex items-center gap-1 font-semibold">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            Correction Pending Approval
                          </span>
                        ) : (
                          <span className="text-amber-600 flex items-center gap-1 font-semibold">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            Pending Review
                          </span>
                        )}
                      </div>

                      {/* Declined reason + resubmit form */}
                      {isDeclined && (
                        <div className="border-t border-red-200 pt-2 space-y-2">
                          {item.declineReason && (
                            <div className="flex items-start gap-1.5 text-[11px] text-red-700 bg-red-100 rounded-lg px-2.5 py-2">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span><strong>Reason:</strong> {item.declineReason}</span>
                            </div>
                          )}
                          {!isResubmittingThis ? (
                            <button
                              onClick={() => {
                                setDeclinedEditId(item.id);
                                setDeclinedEditNote('');
                                setDeclinedEditClockIn('');
                                setDeclinedEditClockOut('');
                                setDeclinedEditLunch('');
                              }}
                              className="w-full text-[11px] font-semibold text-red-700 bg-red-100 hover:bg-red-200 border border-red-300 rounded-lg py-1.5 px-3 transition-colors"
                            >
                              Edit &amp; Resubmit
                            </button>
                          ) : (
                            <div className="space-y-2">
                              <p className="text-[10px] text-red-700 font-medium">Only fill in what needs to change — blank fields keep the original value.</p>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[10px] text-gray-500 mb-1 font-semibold uppercase tracking-wide">Clock-in (optional)</label>
                                  <input
                                    type="time"
                                    value={declinedEditClockIn}
                                    onChange={e => setDeclinedEditClockIn(e.target.value)}
                                    className="w-full border border-red-300 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-red-400"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[10px] text-gray-500 mb-1 font-semibold uppercase tracking-wide">Clock-out (optional)</label>
                                  <input
                                    type="time"
                                    value={declinedEditClockOut}
                                    onChange={e => setDeclinedEditClockOut(e.target.value)}
                                    className="w-full border border-red-300 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-red-400"
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="block text-[10px] text-gray-500 mb-1 font-semibold uppercase tracking-wide">Lunch duration in minutes (optional)</label>
                                <input
                                  type="number"
                                  min="0"
                                  max="480"
                                  value={declinedEditLunch}
                                  onChange={e => setDeclinedEditLunch(e.target.value)}
                                  placeholder={`Current: ${item.lunchDuration || 0}m`}
                                  className="w-full border border-red-300 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-red-400"
                                />
                              </div>
                              <textarea
                                value={declinedEditNote}
                                onChange={e => setDeclinedEditNote(e.target.value)}
                                placeholder="Explain the correction... (required)"
                                rows={2}
                                className="w-full border border-red-300 rounded-lg px-3 py-1.5 text-xs bg-white resize-none focus:outline-none focus:ring-2 focus:ring-red-400"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleResubmitDeclined(item)}
                                  className="flex-1 text-[11px] font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg py-1.5 transition-colors"
                                >
                                  Resubmit for Approval
                                </button>
                                <button
                                  onClick={() => setDeclinedEditId(null)}
                                  className="text-[11px] text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg px-3 py-1.5 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Inline correction form for auto-clocked entries */}
                      {isAutoClosed && (
                        <div className="border-t border-amber-200 pt-2 space-y-2">
                          {!isCorrectingThis ? (
                            <button
                              onClick={() => {
                                setAutoClockCorrectionId(item.id);
                                setAutoClockCorrectionTime('');
                                setAutoClockCorrectionNote('');
                              }}
                              className="w-full text-[11px] font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg py-1.5 px-3 transition-colors"
                            >
                              Correct My Clock-Out Time
                            </button>
                          ) : (
                            <div className="space-y-2">
                              <p className="text-[10px] text-amber-700 font-medium">Enter your actual clock-out time:</p>
                              <input
                                type="time"
                                value={autoClockCorrectionTime}
                                onChange={e => setAutoClockCorrectionTime(e.target.value)}
                                className="w-full border border-amber-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                              />
                              <textarea
                                value={autoClockCorrectionNote}
                                onChange={e => setAutoClockCorrectionNote(e.target.value)}
                                placeholder="Reason (e.g. forgot to clock out at 3:30 PM)"
                                rows={2}
                                className="w-full border border-amber-300 rounded-lg px-3 py-1.5 text-xs bg-white resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleAutoClockCorrection(item)}
                                  className="flex-1 text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg py-1.5 transition-colors"
                                >
                                  Submit for Approval
                                </button>
                                <button
                                  onClick={() => setAutoClockCorrectionId(null)}
                                  className="text-[11px] text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg px-3 py-1.5 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>} {/* end clock tab grid */}
    </div>
  );
}
