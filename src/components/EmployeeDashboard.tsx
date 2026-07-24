import React, { useState, useEffect, useRef } from 'react';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  onSnapshot
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth } from '../firebase';
import { JobSite, TimeEntry, UserProfile, COST_CODES } from '../types';
import { getHaversineDistance } from './MapMock';
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
  Search
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

  // Manual time entries
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualDate, setManualDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [manualJobId, setManualJobId] = useState<string>('');
  const [manualCostCode, setManualCostCode] = useState<string>(COST_CODES[0]);
  const [manualDescription, setManualDescription] = useState<string>('');
  const [manualHours, setManualHours] = useState<number>(8);
  const [manualTravelIn, setManualTravelIn] = useState<number>(0);
  const [manualTravelOut, setManualTravelOut] = useState<number>(0);
  const [manualLunch, setManualLunch] = useState<number>(30);

  // GPS — stored after each successful position fetch; used for clock-in/out coords
  const [userLat, setUserLat] = useState<number>(37.774929);
  const [userLng, setUserLng] = useState<number>(-122.419416);

  // GPS status shown near Clock In button
  const [gpsLoading, setGpsLoading] = useState<boolean>(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

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

  // Manual clock-out correction form
  const [showManualClockOutForm, setShowManualClockOutForm] = useState(false);
  const [manualClockOutTime, setManualClockOutTime] = useState('');
  const [manualClockOutNote, setManualClockOutNote] = useState('');

  // Step 3: time-off claim (both PTO and unpaid can be selected simultaneously)
  const [ptoEnabled, setPtoEnabled] = useState(false);
  const [ptoClaimHours, setPtoClaimHours] = useState(8);
  const [unpaidEnabled, setUnpaidEnabled] = useState(false);
  const [unpaidClaimHours, setUnpaidClaimHours] = useState(8);
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
  const [autoLogoutHour, setAutoLogoutHour] = useState<number>(18);

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

  // Active dashboard tab
  const [activeTab, setActiveTab] = useState<'clock' | 'timecards' | 'timeoff'>('clock');

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

  // Auto-calculate travel time to site when job selection or home address changes
  useEffect(() => {
    const job = jobs.find(j => j.id === selectedJobId) || jobs[0];
    if (!job || !user.homeLatitude || !user.homeLongitude) {
      setTravelIn(0);
      return;
    }
    const distMeters = getHaversineDistance(user.homeLatitude, user.homeLongitude, job.latitude, job.longitude);
    const distKm = distMeters / 1000;
    const rawMinutes = (distKm / 40) * 60 + 5;
    setTravelIn(Math.round(rawMinutes / 5) * 5);
  }, [selectedJobId, jobs, user.homeLatitude, user.homeLongitude]);

  // Auto-calculate travel time back when active session job is known
  useEffect(() => {
    if (!activeEntry) return;
    const job = jobs.find(j => j.id === activeEntry.jobId);
    if (!job || !user.homeLatitude || !user.homeLongitude) {
      setTravelOut(0);
      return;
    }
    const distMeters = getHaversineDistance(user.homeLatitude, user.homeLongitude, job.latitude, job.longitude);
    const distKm = distMeters / 1000;
    const rawMinutes = (distKm / 40) * 60 + 5;
    setTravelOut(Math.round(rawMinutes / 5) * 5);
  }, [activeEntry?.jobId, jobs, user.homeLatitude, user.homeLongitude]);

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
      const payload = {
        ...entry,
        lunchEnd: autoEnd,
        lunchEndCoords: null,
        lunchDuration: (entry.lunchDuration || 0) + 75,
        lunchStart: null,
        lunchStartCoords: null,
        updatedAt: new Date(),
      };
      try {
        await updateDoc(doc(db, 'time_entries', entry.id), payload);
      } catch (err) {
        console.error('Auto lunch return failed:', err);
      }
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

    const unsubscribeEntries = onSnapshot(q, (snapshot) => {
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

      // Temporal integrity Auto-logout monitoring
      if (active) {
        const clockInDate = new Date((active as TimeEntry).clockInTime?.seconds * 1000 || Date.now());
        const curDate = new Date();

        // Only auto-logout if the session started before the cutoff hour (not sessions that begin after it)
        const isPastLimit = curDate.getHours() >= autoLogoutHour && clockInDate.getHours() < autoLogoutHour;
        const isDifferentDay = curDate.getDate() !== clockInDate.getDate() || curDate.getMonth() !== clockInDate.getMonth();

        if (isPastLimit || isDifferentDay) {
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
  }, [user.uid, autoLogoutHour]);

  // Execute Auto clock-out cap
  const triggerAutoLogout = async (entry: TimeEntry) => {
    const clockInDate = new Date(entry.clockInTime?.seconds * 1000 || Date.now());
    const autoOutTime = new Date(clockInDate);
    autoOutTime.setHours(autoLogoutHour, 0, 0, 0);

    const updatedData = {
      clockOutTime: autoOutTime,
      clockOutCoords: entry.clockInCoords,
      status: 'completed',
      description: `${entry.description} (Auto clocked-out at ${autoLogoutHour}:00 PM by security protocol)`,
      travelTimeOut: 0,
      updatedAt: new Date()
    };

    if (isOnline) {
      try {
        await updateDoc(doc(db, 'time_entries', entry.id), updatedData);
        alert(`You were automatically clocked out at ${autoLogoutHour}:00 PM to protect record integrity.`);
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
            updatedAt: new Date()
          });
        } else if (item.action === 'update') {
          await updateDoc(doc(db, 'time_entries', item.docId), {
            ...item.data,
            updatedAt: new Date()
          });
        }
      } catch (e) {
        console.error('Failed to sync item:', item, e);
      }
    }

    setOfflineQueue([]);
    localStorage.removeItem(`offline_queue_${user.uid}`);
    alert('All offline log entries synchronized with database!');
  };

  // Silently fetch GPS — returns coords or throws a user-facing error string
  const fetchGPS = (): Promise<{ lat: number; lng: number }> =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject('Your device does not support GPS. Contact your manager.');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => reject('Location access denied. Enable GPS permissions in your browser settings and try again.'),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });

  // Manual lunch correction — employee logs a lunch break they forgot to record
  const handleManualLunch = async () => {
    if (!activeEntry || !manualLunchStart || !manualLunchEnd || !manualLunchNote.trim()) return;

    const workDate = activeEntry.date;
    const startDate = new Date(`${workDate}T${manualLunchStart}:00`);
    const endDate = new Date(`${workDate}T${manualLunchEnd}:00`);

    if (endDate <= startDate) {
      alert('Lunch end time must be after start time.');
      return;
    }

    const diffMins = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
    const updatedDescription = `${activeEntry.description} [Manual Lunch: ${manualLunchStart}–${manualLunchEnd} (${diffMins}m) — ${manualLunchNote}]`;

    const payload = {
      ...activeEntry,
      lunchStart: null,
      lunchStartCoords: null,
      lunchEnd: endDate,
      lunchEndCoords: null,
      lunchDuration: (activeEntry.lunchDuration || 0) + diffMins,
      description: updatedDescription,
      updatedAt: new Date()
    };

    if (isOnline) {
      try {
        await updateDoc(doc(db, 'time_entries', activeEntry.id), payload);
        setShowManualLunch(false);
        setManualLunchStart('');
        setManualLunchEnd('');
        setManualLunchNote('');
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'time_entries');
      }
    } else {
      queueOfflineAction({ action: 'update', docId: activeEntry.id, data: payload });
      setActiveEntry(payload as any);
      setShowManualLunch(false);
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

    const payload = {
      ...activeEntry,
      clockOutTime: clockOutDate,
      clockOutCoords: null,
      status: 'completed' as const,
      costCode: selectedCostCode,
      description: updatedDescription,
      travelTimeOut: Number(travelOut) || 0,
      updatedAt: new Date()
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

  // Step 3: submit time-off claim — can create PTO entry, unpaid entry, or both
  const handleSubmitPTODay = async () => {
    if (!timeOffNote.trim()) return;
    if (!ptoEnabled && !unpaidEnabled) return;

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
        updatedAt: new Date(),
      };
    };

    try {
      if (ptoEnabled && ptoClaimHours > 0) {
        await addDoc(collection(db, 'time_entries'), makeEntry(true, ptoClaimHours));
      }
      if (unpaidEnabled && unpaidClaimHours > 0) {
        await addDoc(collection(db, 'time_entries'), makeEntry(false, unpaidClaimHours));
      }
      setPtoEnabled(false);
      setUnpaidEnabled(false);
      setTimeOffNote('');
      setPtoClaimHours(8);
      setUnpaidClaimHours(8);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'time_entries');
    }
  };

  // Clock out early + claim PTO/Unpaid for remaining hours
  const handleClockOutWithPTO = async () => {
    if (!activeEntry || !ptoTopUpNote.trim() || ptoTopUpHours <= 0) return;

    // Step 1: Clock out normally (best-effort GPS — null if unavailable)
    let clockOutCoordsPTO: { latitude: number; longitude: number } | null = null;
    try {
      const coords = await fetchGPS();
      clockOutCoordsPTO = { latitude: coords.lat, longitude: coords.lng };
      setUserLat(coords.lat);
      setUserLng(coords.lng);
    } catch { /* non-blocking */ }

    const clockOutNow = new Date();
    const clockOutPayload = {
      ...activeEntry,
      clockOutTime: clockOutNow,
      clockOutCoords: clockOutCoordsPTO,
      status: 'completed' as const,
      costCode: selectedCostCode,
      description: description,
      travelTimeOut: Number(travelOut) || 0,
      updatedAt: clockOutNow,
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
      updatedAt: new Date(),
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

  // Clock In Action Handler — GPS is captured but never blocks clock-in
  const handleClockIn = async () => {
    if (!selectedJobId) {
      alert('Please select a job site before clocking in.');
      return;
    }

    setGpsError(null);
    setGpsLoading(true);

    let clockInCoords: { latitude: number; longitude: number } | null = null;

    try {
      const coords = await fetchGPS();
      clockInCoords = { latitude: coords.lat, longitude: coords.lng };
      setUserLat(coords.lat);
      setUserLng(coords.lng);
    } catch {
      // GPS unavailable — proceed without location, note it for admin visibility
      setGpsError('No GPS signal detected. Clocked in without location — your manager will see this on the timecard.');
    }

    setGpsLoading(false);

    const payload = {
      userId: user.uid,
      employeeName: user.name,
      date: new Date().toISOString().split('T')[0],
      jobId: activeJob.id,
      jobName: activeJob.name,
      costCode: COST_CODES[0],
      description: '',
      status: 'active',
      clockInTime: new Date(),
      clockInCoords,
      clockOutTime: null,
      clockOutCoords: null,
      travelTimeIn: Number(travelIn) || 0,
      travelTimeOut: 0,
      lunchStart: null,
      lunchStartCoords: null,
      lunchEnd: null,
      lunchEndCoords: null,
      lunchDuration: 0,
      isManualEdit: false,
      isApproved: false,
      editRequestedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (isOnline) {
      try {
        await addDoc(collection(db, 'time_entries'), payload);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'time_entries');
      }
    } else {
      queueOfflineAction({ action: 'create', data: payload });
      alert('Offline Mode: Your clock-in has been cached locally. Ensure database synchronizations when online!');
      setActiveEntry(payload as any);
    }
  };

  // Clock Out Action Handler
  const handleClockOut = async () => {
    if (!activeEntry || isClockActionPending) return;
    setIsClockActionPending(true);

    try {
      // Best-effort GPS — store null if unavailable, never block
      let clockOutCoords: { latitude: number; longitude: number } | null = null;
      try {
        const coords = await fetchGPS();
        clockOutCoords = { latitude: coords.lat, longitude: coords.lng };
        setUserLat(coords.lat);
        setUserLng(coords.lng);
      } catch {
        // Non-blocking — null coords stored
      }

      const payload = {
        ...activeEntry,
        clockOutTime: new Date(),
        clockOutCoords,
        status: 'completed' as const,
        costCode: selectedCostCode,
        description: description,
        travelTimeOut: Number(travelOut) || 0,
        updatedAt: new Date()
      };

      if (isOnline) {
        try {
          await updateDoc(doc(db, 'time_entries', activeEntry.id), payload);
          setTravelOut(0);
          setDescription('');
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, 'time_entries');
        }
      } else {
        queueOfflineAction({ action: 'update', docId: activeEntry.id, data: payload });
        setActiveEntry(null);
        setTravelOut(0);
        setDescription('');
        alert('Offline Mode: Your clock-out has been cached locally.');
      }
    } finally {
      setIsClockActionPending(false);
    }
  };

  // Lunch Breaks Handler
  const handleLunchToggle = async () => {
    if (!activeEntry || isClockActionPending) return;
    setIsClockActionPending(true);

    try {
      if (!activeEntry.lunchStart) {
        // Starting lunch — capture GPS best-effort
        let lunchStartCoords: { latitude: number; longitude: number } | null = null;
        try {
          const coords = await fetchGPS();
          lunchStartCoords = { latitude: coords.lat, longitude: coords.lng };
          setUserLat(coords.lat);
          setUserLng(coords.lng);
        } catch { /* non-blocking */ }

        const payload = {
          ...activeEntry,
          lunchStart: new Date(),
          lunchStartCoords,
          updatedAt: new Date()
        };

        if (isOnline) {
          try {
            await updateDoc(doc(db, 'time_entries', activeEntry.id), payload);
          } catch (error) {
            handleFirestoreError(error, OperationType.UPDATE, 'time_entries');
          }
        } else {
          queueOfflineAction({ action: 'update', docId: activeEntry.id, data: payload });
          setActiveEntry(payload);
        }
      } else {
        const start = new Date(activeEntry.lunchStart.seconds * 1000 || activeEntry.lunchStart);
        const end = new Date();
        const diffMs = end.getTime() - start.getTime();
        const diffMins = Math.round(diffMs / (60 * 1000));

        // Ending lunch — capture GPS best-effort
        let lunchEndCoords: { latitude: number; longitude: number } | null = null;
        try {
          const coords = await fetchGPS();
          lunchEndCoords = { latitude: coords.lat, longitude: coords.lng };
          setUserLat(coords.lat);
          setUserLng(coords.lng);
        } catch { /* non-blocking */ }

        const payload = {
          ...activeEntry,
          lunchEnd: end,
          lunchEndCoords,
          lunchDuration: (activeEntry.lunchDuration || 0) + diffMins,
          lunchStart: null,
          updatedAt: end
        };

        if (isOnline) {
          try {
            await updateDoc(doc(db, 'time_entries', activeEntry.id), payload);
          } catch (error) {
            handleFirestoreError(error, OperationType.UPDATE, 'time_entries');
          }
        } else {
          queueOfflineAction({ action: 'update', docId: activeEntry.id, data: payload });
          setActiveEntry(payload);
        }
      }
    } finally {
      setIsClockActionPending(false);
    }
  };

  // Submit Manual Shift Request
  const submitManualEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualDate || !manualJobId || !manualCostCode || !manualDescription.trim()) {
      alert('Provide date, project, cost code, and description.');
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
      updatedAt: new Date()
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
    const billingMinutes = workMinutes + Number(entry.travelTimeIn || 0) + Number(entry.travelTimeOut || 0);

    return {
      worked: (workMinutes / 60).toFixed(2),
      billable: (billingMinutes / 60).toFixed(2),
      lunch: lunch,
      travel: (Number(entry.travelTimeIn || 0) + Number(entry.travelTimeOut || 0))
    };
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6" id="employee-dashboard-content">

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

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-2">
        <button
          type="button"
          onClick={() => setActiveTab('clock')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-4 rounded-lg text-sm font-bold transition-all cursor-pointer ${
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
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-4 rounded-lg text-sm font-bold transition-all cursor-pointer ${
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
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-4 rounded-lg text-sm font-bold transition-all cursor-pointer ${
            activeTab === 'timeoff'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Plane className="w-4 h-4" />
          Time Off
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

      {/* Time Clock tab */}
      {activeTab === 'clock' && <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left column: clock in interface */}
        <div className="lg:col-span-2 space-y-6">

          {/* Main Controls Card */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm" id="work-controls-card">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider border-b border-gray-100 pb-3 mb-5 flex items-center gap-2">
              <Play className="w-4 h-4 text-orange-500" />
              Active Timecard Operations
            </h2>

            {/* Check if active timecard exists */}
            {activeEntry ? (
              <div className="space-y-6">
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
                  <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-600">
                      <Coffee className="w-4 h-4 text-orange-500" />
                      Break Manager
                    </div>
                    <p className="text-[11.5px] text-gray-500 leading-relaxed">
                      Meal periods automatically deduct from overall log duration. Tap below to pause/resume work timers.
                    </p>

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
                        ? 'Working…'
                        : activeEntry.lunchStart ? 'End Lunch (Resume Work)' : 'Clock Out: Go to Lunch'}
                    </button>
                    {isClockActionPending && (
                      <p className="text-[10.5px] text-center text-gray-400">
                        Getting your location — this can take a few seconds on weak signal. Please don't tap again.
                      </p>
                    )}

                    {activeEntry.lunchStart && (() => {
                      const lunchStartMs = activeEntry.lunchStart.seconds
                        ? activeEntry.lunchStart.seconds * 1000
                        : new Date(activeEntry.lunchStart).getTime();
                      const autoReturnTime = new Date(lunchStartMs + 75 * 60 * 1000);
                      return (
                        <div className="text-[11px] font-mono text-center space-y-0.5">
                          <div className="text-orange-600 animate-pulse">● On lunch since: {new Date(lunchStartMs).toLocaleTimeString()}</div>
                          <div className="text-orange-500">Auto-returns at: {autoReturnTime.toLocaleTimeString()}</div>
                        </div>
                      );
                    })()}

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
                          <span className="text-gray-600">Company covers:</span>
                          <span className="font-bold text-green-600">{Math.min(travelOut, companyTravelCoverageMinutes)} min</span>
                        </div>
                        {travelOut > companyTravelCoverageMinutes && (
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">On your account:</span>
                            <span className="font-bold text-amber-600">{travelOut - companyTravelCoverageMinutes} min</span>
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

                {/* Clock Out Trigger */}
                <button
                  type="button"
                  onClick={handleClockOut}
                  disabled={!!activeEntry.lunchStart || !description.trim() || isClockActionPending}
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

                        {/* PTO / Unpaid toggle */}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setPtoTopUpType('pto')}
                            className={`flex-1 text-xs font-bold py-2 rounded-lg border transition-all cursor-pointer ${ptoTopUpType === 'pto' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-500 border-gray-300 hover:border-green-400'}`}
                          >
                            Paid (PTO)
                          </button>
                          <button
                            type="button"
                            onClick={() => setPtoTopUpType('unpaid')}
                            className={`flex-1 text-xs font-bold py-2 rounded-lg border transition-all cursor-pointer ${ptoTopUpType === 'unpaid' ? 'bg-gray-600 text-white border-gray-600' : 'bg-white text-gray-500 border-gray-300 hover:border-gray-500'}`}
                          >
                            Unpaid
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-wide mb-1">Hours to Claim</label>
                            <input
                              type="number"
                              min="0.5" max="8" step="0.5"
                              value={ptoTopUpHours}
                              onChange={e => setPtoTopUpHours(Number(e.target.value) || 1)}
                              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 focus:outline-none focus:border-green-400"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-wide mb-1">Travel Back (min)</label>
                            <div className="w-full bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-sm font-mono text-orange-700 font-bold">
                              {travelOut} min
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 uppercase tracking-wide mb-1">Reason <span className="text-red-500">*</span></label>
                          <input
                            type="text"
                            value={ptoTopUpNote}
                            onChange={e => setPtoTopUpNote(e.target.value)}
                            placeholder="e.g. Doctor appointment, family obligation..."
                            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-900 focus:outline-none focus:border-green-400"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={handleClockOutWithPTO}
                          disabled={!ptoTopUpNote.trim() || ptoTopUpHours <= 0}
                          className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg text-xs cursor-pointer active:translate-y-px transition-all flex items-center justify-center gap-1.5"
                        >
                          <Plane className="w-3.5 h-3.5" />
                          Clock Out + Claim {ptoTopUpHours}h {ptoTopUpType === 'pto' ? 'PTO' : 'Unpaid'}
                        </button>
                      </div>
                    )}
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
                        <span className="text-gray-600">Estimated to site:</span>
                        <span className="font-bold text-orange-700">{travelIn} min</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Company covers:</span>
                        <span className="font-bold text-green-600">{Math.min(travelIn, companyTravelCoverageMinutes)} min</span>
                      </div>
                      {travelIn > companyTravelCoverageMinutes && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-600">On your account:</span>
                          <span className="font-bold text-amber-600">{travelIn - companyTravelCoverageMinutes} min</span>
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
                        onChange={e => setPtoClaimHours(Number(e.target.value) || 1)}
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
                        onChange={e => setUnpaidClaimHours(Number(e.target.value) || 1)}
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
                          placeholder="e.g. Doctor appointment, sick day, personal travel..."
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
                        Submit {[ptoEnabled && `${ptoClaimHours}h PTO`, unpaidEnabled && `${unpaidClaimHours}h Unpaid`].filter(Boolean).join(' + ')}
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
                      onChange={(e) => setManualHours(Number(e.target.value) || 8)}
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
                      onChange={(e) => setManualLunch(Number(e.target.value) || 0)}
                      className="block w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-900 font-mono"
                      id="manual-lunch-input"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50 p-3 rounded-lg border border-gray-200">
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">Travel time to Site (Minutes):</label>
                    <input
                      type="number"
                      value={manualTravelIn}
                      onChange={(e) => setManualTravelIn(Number(e.target.value) || 0)}
                      className="w-full bg-white border border-gray-300 rounded px-2.5 py-1 text-xs font-mono text-gray-900"
                      id="manual-travel-in"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">Travel time from Site (Minutes):</label>
                    <input
                      type="number"
                      value={manualTravelOut}
                      onChange={(e) => setManualTravelOut(Number(e.target.value) || 0)}
                      className="w-full bg-white border border-gray-300 rounded px-2.5 py-1 text-xs font-mono text-gray-900"
                      id="manual-travel-out"
                    />
                  </div>
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
          <div className="bg-white border border-gray-200 p-5 rounded-2xl shadow-sm space-y-4" id="worker-history-panel">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700 flex items-center gap-2 border-b border-gray-100 pb-2 mb-2">
              <History className="w-4 h-4 text-gray-400" />
              Recent Personal Logs
            </h3>

            {pastEntries.length === 0 ? (
              <p className="text-xs text-gray-400 italic text-center py-4">No completed logs recorded yet.</p>
            ) : (
              <div className="space-y-3 overflow-y-auto max-h-96 pr-1 custom-scrollbar">
                {pastEntries.map((item) => {
                  const data = getTotals(item);
                  return (
                    <div key={item.id} className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-gray-800 truncate max-w-[130px]" title={item.jobName}>
                          {item.jobName}
                        </span>
                        <span className="text-[10px] text-gray-400 font-mono">
                          {item.date}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] font-mono border-t border-gray-200 pt-1.5 text-gray-500">
                        <span>Worked: <strong className="text-orange-600">{data.worked}h</strong></span>
                        {item.lunchDuration > 0 && <span>Lunch: {item.lunchDuration}m</span>}
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
                        ) : item.status === 'pending_approval' ? (
                          <span className="text-amber-600 flex items-center gap-1 font-semibold">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            Awaiting Approval
                          </span>
                        ) : (
                          <span className="text-amber-600 flex items-center gap-1 font-semibold">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            Pending Review
                          </span>
                        )}
                      </div>
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
