import React, { useState, useEffect } from 'react';
import BiweeklyTimecardPanel from './BiweeklyTimecardPanel';
import WeeklyRemindersPanel from './WeeklyRemindersPanel';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { JobSite, TimeEntry, AppSettings, COST_CODES, TimeOffRequest, PendingEmployee } from '../types';
import { getHaversineDistance } from './MapMock';
import {
  Briefcase,
  FileSpreadsheet,
  Filter,
  CheckCircle,
  XSquare,
  Plus,
  Trash2,
  Clock,
  Users,
  TrendingUp,
  Wrench,
  Search,
  MapPin,
  Calendar,
  Settings,
  AlertCircle,
  ExternalLink,
  Navigation,
  Coffee,
  ChevronDown,
  ChevronUp,
  CalendarDays,
  LayoutDashboard,
  Plane,
  CheckCircle2,
  XCircle,
  Bell
} from 'lucide-react';

import { UserProfile } from '../types';

interface AdminDashboardProps {
  onSignOut: () => void;
  user: UserProfile;
}

// ── Pay period helpers (shared EPOCH with BiweeklyTimecardPanel) ──────────────
const PAY_EPOCH = new Date('2024-01-01T00:00:00');
function buildPayPeriods(count = 12) {
  const today = new Date();
  const diffDays = Math.floor((today.getTime() - PAY_EPOCH.getTime()) / 86400000);
  const currentIdx = Math.floor(diffDays / 14);
  return Array.from({ length: count }, (_, i) => {
    const idx = currentIdx - i;
    const start = new Date(PAY_EPOCH);
    start.setDate(PAY_EPOCH.getDate() + idx * 14);
    const end = new Date(start);
    end.setDate(start.getDate() + 13);
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return {
      label: `${fmt(start)} – ${fmt(end)}${i === 0 ? ' (Current)' : ''}`,
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
    };
  });
}

export default function AdminDashboard({ onSignOut, user }: AdminDashboardProps) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [jobs, setJobs] = useState<JobSite[]>([]);
  const [autoLogout, setAutoLogout] = useState<string>('18:00');

  // Create job site fields
  const [newJobName, setNewJobName] = useState('');
  const [newJobAddress, setNewJobAddress] = useState('');
  const [newJobLat, setNewJobLat] = useState(37.774929);
  const [newJobLng, setNewJobLng] = useState(-122.419416);
  const [newJobRadius, setNewJobRadius] = useState(1609);

  // Registered employees for the employee filter dropdown
  const [registeredEmployees, setRegisteredEmployees] = useState<{ uid: string; name: string; email: string; homeAddress?: string; homeLatitude?: number; homeLongitude?: number }[]>([]);

  // Filters
  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterJob, setFilterJob] = useState('');
  const [filterCostCode, setFilterCostCode] = useState('');
  const [filterDate, setFilterDate] = useState('');

  // Date filter mode
  const [filterDateMode, setFilterDateMode] = useState<'single' | 'period' | 'range'>('single');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterPeriodIdx, setFilterPeriodIdx] = useState(0);
  const payPeriods = buildPayPeriods();

  // Local notifications
  const [notif, setNotif] = useState<string | null>(null);

  // Active dashboard tab
  const [activeTab, setActiveTab] = useState<'overview' | 'timecards' | 'reminders'>('overview');

  // Expanded location panel — stores the entry ID currently expanded in the table
  const [expandedLocationId, setExpandedLocationId] = useState<string | null>(null);

  // Time off requests
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [denyNotes, setDenyNotes] = useState<Record<string, string>>({});

  // Company travel coverage & employee home address editor
  const [companyTravelCoverage, setCompanyTravelCoverage] = useState<number>(30);
  const [selectedEmpForTravel, setSelectedEmpForTravel] = useState<string>('');
  const [travelHomeAddress, setTravelHomeAddress] = useState<string>('');
  const [travelHomeLat, setTravelHomeLat] = useState<number>(0);
  const [travelHomeLng, setTravelHomeLng] = useState<number>(0);

  // Pre-register employee form
  const [preRegFirstName, setPreRegFirstName] = useState('');
  const [preRegLastName, setPreRegLastName] = useState('');
  const [preRegEmail, setPreRegEmail] = useState('');
  const [preRegPhone, setPreRegPhone] = useState('');
  const [preRegJobTitle, setPreRegJobTitle] = useState('');
  const [preRegRate, setPreRegRate] = useState('');
  const [preRegAddress, setPreRegAddress] = useState('');
  const [preRegLat, setPreRegLat] = useState('');
  const [preRegLng, setPreRegLng] = useState('');
  const [preRegRole, setPreRegRole] = useState<'employee' | 'admin'>('employee');
  const [preRegLoading, setPreRegLoading] = useState(false);
  const [pendingEmployees, setPendingEmployees] = useState<PendingEmployee[]>([]);

  // Map helpers
  const osmEmbedUrl = (lat: number, lng: number) =>
    `https://www.openstreetmap.org/export/embed.html?bbox=${(lng - 0.003).toFixed(6)},${(lat - 0.003).toFixed(6)},${(lng + 0.003).toFixed(6)},${(lat + 0.003).toFixed(6)}&layer=mapnik&marker=${lat},${lng}`;

  const gMapsUrl = (lat: number, lng: number) =>
    `https://www.google.com/maps?q=${lat},${lng}`;

  const DEFAULT_SITES: JobSite[] = [
    { id: 'job_site_1', name: 'Golden Gate Retrofit', address: 'Presidio, San Francisco, CA', latitude: 37.819929, longitude: -122.478255, radius: 1609, createdAt: new Date() },
    { id: 'job_site_2', name: 'Downtown Highrise Site', address: '101 California St, San Francisco, CA', latitude: 37.793230, longitude: -122.399580, radius: 1609, createdAt: new Date() },
    { id: 'job_site_3', name: 'SFO Airport Hangar Base', address: 'SFO Airport, San Francisco, CA', latitude: 37.621313, longitude: -122.378955, radius: 1609, createdAt: new Date() }
  ];

  const seedDefaultSites = async () => {
    for (const site of DEFAULT_SITES) {
      await setDoc(doc(db, 'jobs', site.id), site);
    }
  };

  // Load configuration & entries
  useEffect(() => {
    const unsubscribeEntries = onSnapshot(collection(db, 'time_entries'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TimeEntry));
      data.sort((a, b) => {
        const tA = a.clockInTime?.seconds * 1000 || a.clockInTime || 0;
        const tB = b.clockInTime?.seconds * 1000 || b.clockInTime || 0;
        return tB - tA;
      });
      setEntries(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'time_entries');
    });

    const unsubscribeJobs = onSnapshot(collection(db, 'jobs'), (snapshot) => {
      if (snapshot.empty) {
        // Seed defaults to Firestore so both admin and employees share the same data source.
        // Once written, the snapshot will re-fire with the real documents.
        seedDefaultSites();
        setJobs(DEFAULT_SITES);
      } else {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JobSite));
        setJobs(data);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'jobs');
      setJobs(DEFAULT_SITES); // show fallback in UI on permission error
    });

    const unsubscribeSettings = onSnapshot(collection(db, 'settings'), (snapshot) => {
      const generalSetCard = snapshot.docs.find(doc => doc.id === 'general');
      if (generalSetCard) {
        setAutoLogout(generalSetCard.data().autoClockOutTime || '18:00');
        setCompanyTravelCoverage(generalSetCard.data().companyTravelCoverageMinutes ?? 30);
      }
    });

    // Load all registered employees for the filter dropdown
    const unsubscribeUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      const employees = snapshot.docs
        .map(d => ({
          uid: d.id,
          name: d.data().name as string,
          email: d.data().email as string,
          homeAddress: d.data().homeAddress as string | undefined,
          homeLatitude: d.data().homeLatitude as number | undefined,
          homeLongitude: d.data().homeLongitude as number | undefined,
        }))
        .filter(u => u.name && u.name !== 'Anonymous Worker')
        .sort((a, b) => a.name.localeCompare(b.name));
      setRegisteredEmployees(employees);
    }, () => {
      // Permission fallback: derive names from loaded entries
      setRegisteredEmployees([]);
    });

    const unsubscribeTimeOff = onSnapshot(collection(db, 'time_off_requests'), (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as TimeOffRequest));
      data.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      setTimeOffRequests(data);
    }, () => {
      setTimeOffRequests([]);
    });

    const unsubscribePending = onSnapshot(collection(db, 'pending_employees'), (snapshot) => {
      const data = snapshot.docs.map(d => d.data() as PendingEmployee);
      data.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      setPendingEmployees(data);
    }, () => {
      setPendingEmployees([]);
    });

    return () => {
      unsubscribeEntries();
      unsubscribeJobs();
      unsubscribeSettings();
      unsubscribeUsers();
      unsubscribeTimeOff();
      unsubscribePending();
    };
  }, []);

  // Helper calculations for time values
  const getTotals = (entry: TimeEntry) => {
    const rawIn = entry.clockInTime?.seconds * 1000 || entry.clockInTime || Date.now();
    const rawOut = entry.clockOutTime?.seconds * 1000 || entry.clockOutTime || Date.now();

    const diffMs = rawOut - rawIn;
    const totalMinutes = Math.max(0, Math.floor(diffMs / (1050 * 60)));
    const lunch = entry.lunchDuration || 0;

    const workMinutes = Math.max(0, totalMinutes - lunch);
    const billingMinutes = workMinutes + Number(entry.travelTimeIn || 0) + Number(entry.travelTimeOut || 0);

    return {
      worked: (workMinutes / 60),
      billable: (billingMinutes / 60),
      lunch: lunch,
      travel: (Number(entry.travelTimeIn || 0) + Number(entry.travelTimeOut || 0))
    };
  };

  // Filter application
  const filteredEntries = entries.filter(e => {
    const matchesEmp = filterEmployee ? e.employeeName.toLowerCase().includes(filterEmployee.toLowerCase()) : true;
    const matchesJob = filterJob ? e.jobId === filterJob : true;
    const matchesCode = filterCostCode ? e.costCode === filterCostCode : true;

    let matchesDate = true;
    if (filterDateMode === 'single' && filterDate) {
      matchesDate = e.date === filterDate;
    } else if (filterDateMode === 'range') {
      if (filterDateFrom) matchesDate = matchesDate && e.date >= filterDateFrom;
      if (filterDateTo)   matchesDate = matchesDate && e.date <= filterDateTo;
    } else if (filterDateMode === 'period') {
      const p = payPeriods[filterPeriodIdx];
      if (p) matchesDate = e.date >= p.start && e.date <= p.end;
    }

    return matchesEmp && matchesJob && matchesCode && matchesDate;
  });

  // Approvals operations
  const handleApprove = async (id: string) => {
    try {
      await updateDoc(doc(db, 'time_entries', id), {
        isApproved: true,
        status: 'completed',
        updatedAt: new Date()
      });
      triggerToast('Time entry approved successfully.');
    } catch (err) {
      console.error(err);
      alert('Approval action rejected.');
    }
  };

  const handleDecline = async (id: string) => {
    if (!confirm('Are you sure you want to delete/reject this manual log request?')) return;
    try {
      await deleteDoc(doc(db, 'time_entries', id));
      triggerToast('Time entry rejected / deleted.');
    } catch (err) {
      console.error(err);
      alert('Rejection failed.');
    }
  };

  const handleApproveTimeOff = async (request: TimeOffRequest) => {
    try {
      // Create a time_entry for each day in the date range
      const start = new Date(request.startDate + 'T12:00:00');
      const end = new Date(request.endDate + 'T12:00:00');
      const current = new Date(start);

      const isPTO = request.type === 'pto';
      const jobId = isPTO ? 'time_off_pto' : 'time_off_unpaid';
      const jobName = isPTO ? 'Paid Time Off' : 'Unpaid Time Off';
      const costCode = isPTO ? 'PTO - Paid Time Off' : 'UPT - Unpaid Time Off';

      while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];
        const clockIn = new Date(`${dateStr}T08:00:00`);
        const clockOutHour = Math.min(8 + Math.floor(request.hoursPerDay), 20);
        const clockOut = new Date(`${dateStr}T${String(clockOutHour).padStart(2, '0')}:00:00`);

        await addDoc(collection(db, 'time_entries'), {
          userId: request.employeeId,
          employeeName: request.employeeName,
          date: dateStr,
          jobId,
          jobName,
          costCode,
          description: `${jobName} — ${request.reason}`,
          status: 'completed',
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
          isManualEdit: false,
          isApproved: true,
          editRequestedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        current.setDate(current.getDate() + 1);
      }

      // Mark the request as approved
      await updateDoc(doc(db, 'time_off_requests', request.id), {
        status: 'approved',
        reviewedById: user.uid,
        reviewedByName: user.name,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      });

      triggerToast(`Time off approved for ${request.employeeName}.`);
    } catch (err) {
      console.error(err);
      alert('Failed to approve time off request.');
    }
  };

  const handleDenyTimeOff = async (request: TimeOffRequest) => {
    const note = denyNotes[request.id] || '';
    try {
      await updateDoc(doc(db, 'time_off_requests', request.id), {
        status: 'denied',
        adminNotes: note.trim() || null,
        reviewedById: user.uid,
        reviewedByName: user.name,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      });
      setDenyNotes(prev => {
        const next = { ...prev };
        delete next[request.id];
        return next;
      });
      triggerToast(`Time off request denied for ${request.employeeName}.`);
    } catch (err) {
      console.error(err);
      alert('Failed to deny request.');
    }
  };

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newJobName.trim() || !newJobAddress.trim()) {
      alert('Please fill out name and address info.');
      return;
    }

    try {
      const jobId = 'job_' + Date.now();
      await setDoc(doc(db, 'jobs', jobId), {
        id: jobId,
        name: newJobName,
        address: newJobAddress,
        latitude: Number(newJobLat) || 37.77,
        longitude: Number(newJobLng) || -122.41,
        radius: Number(newJobRadius) || 100,
        createdAt: new Date()
      });

      setNewJobName('');
      setNewJobAddress('');
      triggerToast('New Job Site added to network list!');
    } catch (err) {
      console.error(err);
      alert('Failed to register Job site.');
    }
  };

  const handleDeleteJob = async (id: string) => {
    if (!confirm('Are you sure you want to remove this Job site? Workers cannot clock in here after removal.')) return;
    try {
      await deleteDoc(doc(db, 'jobs', id));
      triggerToast('Job site removed.');
    } catch (err) {
      console.error(err);
      alert('Remove job failed.');
    }
  };

  const handleSaveSettings = async () => {
    try {
      await setDoc(doc(db, 'settings', 'general'), {
        id: 'general',
        autoClockOutTime: autoLogout,
        companyTravelCoverageMinutes: Number(companyTravelCoverage) || 30,
        updatedAt: new Date()
      });
      triggerToast('Settings saved.');
    } catch (err) {
      console.error(err);
      alert('Failed to save general configuration.');
    }
  };

  const triggerToast = (text: string) => {
    setNotif(text);
    setTimeout(() => setNotif(null), 4000);
  };

  // Sync employee travel form when selection changes
  useEffect(() => {
    const emp = registeredEmployees.find(e => e.uid === selectedEmpForTravel);
    if (emp) {
      setTravelHomeAddress(emp.homeAddress || '');
      setTravelHomeLat(emp.homeLatitude || 0);
      setTravelHomeLng(emp.homeLongitude || 0);
    } else {
      setTravelHomeAddress('');
      setTravelHomeLat(0);
      setTravelHomeLng(0);
    }
  }, [selectedEmpForTravel, registeredEmployees]);

  const handleSaveEmployeeTravel = async () => {
    if (!selectedEmpForTravel) return;
    try {
      await updateDoc(doc(db, 'users', selectedEmpForTravel), {
        homeAddress: travelHomeAddress.trim(),
        homeLatitude: Number(travelHomeLat) || 0,
        homeLongitude: Number(travelHomeLng) || 0,
      });
      triggerToast('Employee home address updated.');
    } catch (err) {
      console.error(err);
      alert('Failed to update employee travel profile.');
    }
  };

  // Pre-register a new employee
  const handlePreRegisterEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailKey = preRegEmail.trim().toLowerCase();
    if (!emailKey || !preRegFirstName.trim() || !preRegLastName.trim()) return;
    setPreRegLoading(true);
    try {
      const name = `${preRegFirstName.trim()} ${preRegLastName.trim()}`;
      const payload: Record<string, any> = {
        email: emailKey,
        name,
        role: preRegRole,
        createdAt: new Date(),
        createdBy: user.uid,
        claimed: false,
      };
      if (preRegJobTitle.trim())  payload.jobTitle = preRegJobTitle.trim();
      if (preRegRate)             payload.billableRate = Number(preRegRate);
      if (preRegPhone.trim())     payload.phoneNumber = preRegPhone.trim();
      if (preRegAddress.trim())   payload.homeAddress = preRegAddress.trim();
      if (preRegLat)              payload.homeLatitude = Number(preRegLat);
      if (preRegLng)              payload.homeLongitude = Number(preRegLng);

      await setDoc(doc(db, 'pending_employees', emailKey), payload);
      setPreRegFirstName(''); setPreRegLastName(''); setPreRegEmail('');
      setPreRegPhone(''); setPreRegJobTitle(''); setPreRegRate('');
      setPreRegAddress(''); setPreRegLat(''); setPreRegLng('');
      setPreRegRole('employee');
      triggerToast(`Profile created for ${name}. They can now sign in with ${emailKey}.`);
    } catch (err) {
      console.error(err);
      alert('Failed to create employee profile.');
    }
    setPreRegLoading(false);
  };

  const handleDeletePendingEmployee = async (email: string) => {
    if (!confirm(`Remove pending registration for ${email}?`)) return;
    try {
      await deleteDoc(doc(db, 'pending_employees', email));
      triggerToast('Pending registration removed.');
    } catch (err) {
      console.error(err);
    }
  };

  // CSV Data compiler
  const handleExportCSV = () => {
    if (filteredEntries.length === 0) {
      alert('No logged records exist for selected filter parameters to export.');
      return;
    }

    const headers = [
      'Employee',
      'Date',
      'Job Site',
      'Cost Code',
      'Clock In Time',
      'Clock In Location',
      'Clock Out Time',
      'Clock Out Location',
      'Travel Time (Mins)',
      'Lunch Duration (Mins)',
      'Regular Hours',
      'Total Billable Hours',
      'Description'
    ];

    const rows = filteredEntries.map(e => {
      const metrics = getTotals(e);
      const inTime = e.clockInTime?.seconds ? new Date(e.clockInTime.seconds * 1000).toISOString() : '';
      const outTime = e.clockOutTime?.seconds ? new Date(e.clockOutTime.seconds * 1000).toISOString() : 'STILL ACTIVE';
      const inCoords = e.clockInCoords ? `${e.clockInCoords.latitude};${e.clockInCoords.longitude}` : '';
      const outCoords = e.clockOutCoords ? `${e.clockOutCoords.latitude};${e.clockOutCoords.longitude}` : '';

      return [
        `"${e.employeeName.replace(/"/g, '""')}"`,
        `"${e.date}"`,
        `"${e.jobName.replace(/"/g, '""')}"`,
        `"${e.costCode.replace(/"/g, '""')}"`,
        `"${inTime}"`,
        `"${inCoords}"`,
        `"${outTime}"`,
        `"${outCoords}"`,
        `"${metrics.travel}"`,
        `"${metrics.lunch}"`,
        `"${metrics.worked.toFixed(2)}"`,
        `"${metrics.billable.toFixed(2)}"`,
        `"${e.description.replace(/"/g, '""')}"`
      ];
    });

    const csvContent = "data:text/csv;charset=utf-8,"
      + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `ForgeTrack_Billing_Invoice_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Aggregate stats logic
  const statsByJob = filteredEntries.reduce((acc: any, e) => {
    const hours = getTotals(e).billable;
    acc[e.jobName] = (acc[e.jobName] || 0) + hours;
    return acc;
  }, {});

  const statsByCode = filteredEntries.reduce((acc: any, e) => {
    const hours = getTotals(e).billable;
    acc[e.costCode.split(' ')[0]] = (acc[e.costCode.split(' ')[0]] || 0) + hours;
    return acc;
  }, {});

  const statsByUser = filteredEntries.reduce((acc: any, e) => {
    const hours = getTotals(e).billable;
    acc[e.employeeName] = (acc[e.employeeName] || 0) + hours;
    return acc;
  }, {});

  // Renders the expandable location history panel for a time entry
  const renderLocationPanel = (entry: any) => {
    // Include all events that have occurred (regardless of whether GPS was captured)
    const events: { label: string; icon: React.ReactNode; coords: { latitude: number; longitude: number } | null }[] = [
      { label: 'Clock In', icon: <MapPin className="w-3.5 h-3.5 text-green-600" />, coords: entry.clockInCoords || null },
      ...(entry.lunchStart ? [{ label: 'Lunch Start', icon: <Coffee className="w-3.5 h-3.5 text-orange-500" />, coords: entry.lunchStartCoords || null }] : []),
      ...(entry.lunchEnd ? [{ label: 'Lunch End', icon: <Coffee className="w-3.5 h-3.5 text-orange-500" />, coords: entry.lunchEndCoords || null }] : []),
      ...(entry.clockOutTime ? [{ label: 'Clock Out', icon: <Navigation className="w-3.5 h-3.5 text-red-500" />, coords: entry.clockOutCoords || null }] : []),
    ];

    // Use first available GPS fix for the embedded map
    const primaryCoords = events.find(ev => ev.coords)?.coords || null;

    return (
      <div className="bg-orange-50 border-t border-blue-100 px-4 py-4">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Embedded map */}
          {primaryCoords && (
            <div className="shrink-0 rounded-xl overflow-hidden border border-orange-200 shadow-sm" style={{ width: 260, height: 180 }}>
              <iframe
                title={`Location map for ${entry.employeeName}`}
                src={osmEmbedUrl(primaryCoords.latitude, primaryCoords.longitude)}
                width="260"
                height="180"
                style={{ border: 0 }}
                loading="lazy"
              />
            </div>
          )}

          {/* Location event stamps */}
          <div className="flex-1 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-orange-600 mb-1">Location History</p>
            {events.map((ev, i) => (
              <div key={i} className="flex items-center justify-between bg-white border border-blue-100 rounded-lg px-3 py-2 text-xs shadow-sm">
                <div className="flex items-center gap-2">
                  {ev.icon}
                  <span className="font-semibold text-gray-700">{ev.label}</span>
                  {ev.coords ? (
                    <span className="font-mono text-gray-400 text-[10px]">
                      {ev.coords.latitude.toFixed(5)}, {ev.coords.longitude.toFixed(5)}
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-300 italic">No GPS recorded</span>
                  )}
                </div>
                {ev.coords ? (
                  <a
                    href={gMapsUrl(ev.coords.latitude, ev.coords.longitude)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-orange-600 hover:text-blue-800 font-semibold shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Maps
                  </a>
                ) : (
                  <span className="text-[10px] text-gray-300">—</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6" id="admin-dashboard-wrapper">

      {/* Toast Notification */}
      {notif && (
        <div className="fixed top-5 right-5 z-50 bg-green-50 border-2 border-green-400 text-green-700 font-semibold rounded-xl p-4 shadow-lg flex items-center gap-2">
          <CheckCircle className="w-5 h-5 shrink-0" />
          <span>{notif}</span>
        </div>
      )}

      {/* Manager Workspace Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-800 p-6 rounded-2xl shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center border border-white/20">
            <TrendingUp className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">
              ForgeTrack Control Console
            </h1>
            <p className="text-xs text-slate-300 uppercase tracking-widest">
              Role: Master System Administrator / Manager
            </p>
          </div>
        </div>

        <button
          onClick={onSignOut}
          className="bg-white/10 hover:bg-white/20 text-xs font-bold text-white border border-white/20 hover:border-white/30 rounded-xl px-4 py-2 cursor-pointer active:translate-y-px transition-all"
          id="admin-signout-btn"
        >
          Logout Administrator
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-4 rounded-lg text-sm font-bold transition-all cursor-pointer ${
            activeTab === 'overview'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <LayoutDashboard className="w-4 h-4" />
          Overview
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
          Pay Period Sign-offs
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('reminders')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-4 rounded-lg text-sm font-bold transition-all cursor-pointer ${
            activeTab === 'reminders'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Bell className="w-4 h-4" />
          Reminders
        </button>
      </div>

      {/* Timecards tab */}
      {activeTab === 'timecards' && (
        <BiweeklyTimecardPanel
          mode="admin"
          currentUser={user}
          allEntries={entries}
          registeredEmployees={registeredEmployees}
        />
      )}

      {/* Reminders tab */}
      {activeTab === 'reminders' && (
        <WeeklyRemindersPanel
          timeOffRequests={timeOffRequests}
        />
      )}

      {/* Overview tab */}
      {activeTab === 'overview' && <>

      {/* Aggregate Overview Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6" id="analytics-statistics-grid">
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500">Global Operational Jobs</span>
            <h2 className="text-2xl font-black text-gray-900 mt-1 font-mono">{jobs.length} Sites</h2>
            <div className="text-[10.5px] text-gray-500 mt-1 max-w-[170px] truncate leading-normal" title={jobs.map(j => j.name).join(', ')}>
              {jobs.map(j => j.name).join(', ') || 'No locations recorded.'}
            </div>
          </div>
          <Briefcase className="w-10 h-10 text-orange-400 opacity-60" />
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500">Pending Approvals</span>
            <h2 className="text-2xl font-black text-amber-600 mt-1 font-mono">
              {entries.filter(e => e.status !== 'active' && !e.isApproved).length} Timecards
            </h2>
            <p className="text-[10.5px] text-gray-500 mt-1">GPS-verified and manual entries awaiting review.</p>
          </div>
          <AlertCircle className="w-10 h-10 text-amber-500 opacity-60 animate-bounce" />
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500">Reporting Log Pool</span>
            <h2 className="text-2xl font-black text-green-600 mt-1 font-mono">
              {filteredEntries.reduce((sum, item) => sum + getTotals(item).billable, 0).toFixed(1)} hrs
            </h2>
            <p className="text-[10.5px] text-gray-500 mt-1">Aggregated billables across active filters.</p>
          </div>
          <Clock className="w-10 h-10 text-green-500 opacity-60" />
        </div>
      </div>

      {/* Main Core Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

        {/* Right Sidebar: Admin Tools */}
        <div className="space-y-6 lg:col-span-1 lg:order-2">

          {/* Settings Section */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4" id="settings-card">
            <h3 className="text-xs uppercase font-bold tracking-wider text-gray-600 pb-2 border-b border-gray-100 flex items-center gap-1.5">
              <Settings className="w-4 h-4 text-gray-400" />
              Operational Parameters
            </h3>

            <div>
              <label className="block text-[11px] text-gray-600 mb-1.5 font-semibold">
                Daily Company Auto-Clockout Hour
              </label>
              <input
                type="time"
                value={autoLogout}
                onChange={(e) => setAutoLogout(e.target.value)}
                className="w-full bg-white border border-gray-300 px-2 py-1.5 rounded-lg text-xs text-gray-900 focus:outline-none focus:border-orange-500"
              />
              <p className="text-[9.5px] text-gray-400 leading-tight mt-1">
                Workers left clocked in beyond this time will be clipped to this capping limit dynamically.
              </p>
            </div>

            <div>
              <label className="block text-[11px] text-gray-600 mb-1.5 font-semibold">
                Company Travel Coverage (Minutes)
              </label>
              <input
                type="number"
                min="0"
                max="240"
                value={companyTravelCoverage}
                onChange={(e) => setCompanyTravelCoverage(Number(e.target.value) || 0)}
                className="w-full bg-white border border-gray-300 px-2 py-1.5 rounded-lg text-xs text-gray-900 font-mono focus:outline-none focus:border-orange-500"
              />
              <p className="text-[9.5px] text-gray-400 leading-tight mt-1">
                Company pays this many travel minutes per shift. Travel beyond this is on the employee.
              </p>
            </div>

            <button
              type="button"
              onClick={handleSaveSettings}
              className="w-full bg-orange-600 hover:bg-orange-700 text-[10px] font-bold text-white uppercase px-3 py-2 rounded-lg active:translate-y-px cursor-pointer transition-all"
            >
              Save Settings
            </button>
          </div>

          {/* Add Employee Card */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
            <h3 className="text-xs uppercase font-bold tracking-wider text-gray-600 pb-2 border-b border-gray-100 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-gray-400" />
              Add Employee
            </h3>
            <p className="text-[10px] text-gray-400 leading-tight -mt-1">
              Create a profile. Employee signs in with this email to claim it.
            </p>

            <form onSubmit={handlePreRegisterEmployee} className="space-y-3">
              {/* Name row */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">First Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="John"
                    value={preRegFirstName}
                    onChange={e => setPreRegFirstName(e.target.value)}
                    className="w-full bg-white border border-gray-300 text-xs px-2 py-1.5 text-gray-900 rounded-lg focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Last Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="Doe"
                    value={preRegLastName}
                    onChange={e => setPreRegLastName(e.target.value)}
                    className="w-full bg-white border border-gray-300 text-xs px-2 py-1.5 text-gray-900 rounded-lg focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  placeholder="worker@company.com"
                  value={preRegEmail}
                  onChange={e => setPreRegEmail(e.target.value)}
                  className="w-full bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 rounded-lg focus:outline-none focus:border-orange-500"
                />
              </div>

              {/* Phone */}
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Phone Number</label>
                <input
                  type="tel"
                  placeholder="(555) 000-0000"
                  value={preRegPhone}
                  onChange={e => setPreRegPhone(e.target.value)}
                  className="w-full bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 rounded-lg focus:outline-none focus:border-orange-500"
                />
              </div>

              {/* Job Title */}
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Job Title</label>
                <input
                  type="text"
                  placeholder="e.g. Field Technician"
                  value={preRegJobTitle}
                  onChange={e => setPreRegJobTitle(e.target.value)}
                  className="w-full bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 rounded-lg focus:outline-none focus:border-orange-500"
                />
              </div>

              {/* Billable Rate */}
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Billable Rate ($/hr)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={preRegRate}
                  onChange={e => setPreRegRate(e.target.value)}
                  className="w-full bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 rounded-lg font-mono focus:outline-none focus:border-orange-500"
                />
              </div>

              {/* Address */}
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Home Address</label>
                <input
                  type="text"
                  placeholder="123 Main St, City, State"
                  value={preRegAddress}
                  onChange={e => setPreRegAddress(e.target.value)}
                  className="w-full bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 rounded-lg focus:outline-none focus:border-orange-500"
                />
              </div>

              {/* GPS Coords for travel calc */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Latitude <span className="text-gray-300">(GPS)</span></label>
                  <input
                    type="number"
                    step="0.000001"
                    placeholder="37.7749"
                    value={preRegLat}
                    onChange={e => setPreRegLat(e.target.value)}
                    className="w-full bg-white border border-gray-300 text-xs px-2 py-1.5 text-gray-900 rounded-lg font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">Longitude <span className="text-gray-300">(GPS)</span></label>
                  <input
                    type="number"
                    step="0.000001"
                    placeholder="-122.4194"
                    value={preRegLng}
                    onChange={e => setPreRegLng(e.target.value)}
                    className="w-full bg-white border border-gray-300 text-xs px-2 py-1.5 text-gray-900 rounded-lg font-mono focus:outline-none"
                  />
                </div>
              </div>
              <p className="text-[9px] text-gray-400 leading-tight">
                GPS coordinates used for auto travel-time calculation.{' '}
                <a href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer" className="text-orange-500 underline">
                  Find on Google Maps
                </a>
              </p>

              {/* Role toggle */}
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Access Level</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPreRegRole('employee')}
                    className={`py-1.5 text-[10px] font-bold rounded-lg border transition-all cursor-pointer ${
                      preRegRole === 'employee'
                        ? 'bg-orange-50 text-orange-700 border-orange-300'
                        : 'bg-white text-gray-400 border-gray-200 hover:text-gray-600'
                    }`}
                  >
                    Employee
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreRegRole('admin')}
                    className={`py-1.5 text-[10px] font-bold rounded-lg border transition-all cursor-pointer ${
                      preRegRole === 'admin'
                        ? 'bg-amber-50 text-amber-700 border-amber-300'
                        : 'bg-white text-gray-400 border-gray-200 hover:text-gray-600'
                    }`}
                  >
                    Admin
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={preRegLoading}
                className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-xs text-white font-bold py-2.5 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer active:translate-y-px shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                {preRegLoading ? 'Creating...' : 'Create Employee Profile'}
              </button>
            </form>
          </div>

          {/* Pending Registrations list */}
          {pendingEmployees.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-3">
              <h3 className="text-xs uppercase font-bold tracking-wider text-gray-600 pb-2 border-b border-gray-100 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-gray-400" />
                  Pending Invites
                </span>
                <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-500">
                  {pendingEmployees.filter(p => !p.claimed).length} unclaimed
                </span>
              </h3>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {pendingEmployees.map(p => (
                  <div key={p.email} className={`rounded-xl border px-3 py-2 text-xs flex items-start justify-between gap-2 ${p.claimed ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                    <div className="min-w-0 space-y-0.5">
                      <div className="font-bold text-gray-800 truncate">{p.name}</div>
                      <div className="text-[10px] text-gray-500 truncate">{p.email}</div>
                      {p.jobTitle && <div className="text-[10px] text-gray-400">{p.jobTitle}</div>}
                      <span className={`inline-block text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${
                        p.claimed
                          ? 'bg-green-100 border-green-200 text-green-700'
                          : 'bg-amber-50 border-amber-200 text-amber-700'
                      }`}>
                        {p.claimed ? 'Claimed' : 'Pending'}
                      </span>
                    </div>
                    {!p.claimed && (
                      <button
                        type="button"
                        onClick={() => handleDeletePendingEmployee(p.email)}
                        className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1 rounded-lg shrink-0 transition-all cursor-pointer"
                        title="Remove invite"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Job Sites Creation Card */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4" id="jobs-creator-card">
            <h3 className="text-xs uppercase font-bold tracking-wider text-gray-600 pb-2 border-b border-gray-100 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-gray-400" />
              Register Site Location
            </h3>

            <form onSubmit={handleCreateJob} className="space-y-3">
              <div>
                <label className="block text-[10.5px] text-gray-500 mb-1">Site / Project Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sola Airfield Retro"
                  value={newJobName}
                  onChange={(e) => setNewJobName(e.target.value)}
                  className="w-full bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 placeholder-gray-400 rounded-lg focus:outline-none focus:border-orange-500"
                  id="new-job-title"
                />
              </div>

              <div>
                <label className="block text-[10.5px] text-gray-500 mb-1">Physical Address</label>
                <input
                  type="text"
                  required
                  placeholder="Street and City coordinates"
                  value={newJobAddress}
                  onChange={(e) => setNewJobAddress(e.target.value)}
                  className="w-full bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 placeholder-gray-400 rounded-lg focus:outline-none focus:border-orange-500"
                  id="new-job-address"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] text-gray-500">GPS Coordinates</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!navigator.geolocation) return;
                      navigator.geolocation.getCurrentPosition(
                        (pos) => {
                          setNewJobLat(pos.coords.latitude);
                          setNewJobLng(pos.coords.longitude);
                        },
                        () => alert('Could not retrieve your location. Enter coordinates manually.')
                      );
                    }}
                    className="text-[10px] text-orange-600 hover:text-orange-700 font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <MapPin className="w-3 h-3" />
                    Use My Location
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <label className="block text-gray-500 mb-1">Latitude</label>
                    <input
                      type="number"
                      step="0.000001"
                      required
                      value={newJobLat}
                      onChange={(e) => setNewJobLat(Number(e.target.value))}
                      className="w-full bg-white border border-gray-300 p-1.5 rounded-lg text-gray-900 font-mono focus:outline-none"
                      id="new-job-lat"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-500 mb-1">Longitude</label>
                    <input
                      type="number"
                      step="0.000001"
                      required
                      value={newJobLng}
                      onChange={(e) => setNewJobLng(Number(e.target.value))}
                      className="w-full bg-white border border-gray-300 p-1.5 rounded-lg text-gray-900 font-mono focus:outline-none"
                      id="new-job-lng"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10.5px] text-gray-500 mb-1">Proximity Bounds (Meters) <span className="text-gray-400">— 1 mile = 1609m</span></label>
                <input
                  type="number"
                  min="100"
                  max="16090"
                  value={newJobRadius}
                  onChange={(e) => setNewJobRadius(Number(e.target.value) || 1609)}
                  className="w-full bg-white border border-gray-300 text-xs p-1.5 rounded-lg text-gray-900 font-mono focus:outline-none"
                  id="new-job-radius"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-green-600 hover:bg-green-700 active:translate-y-px text-xs text-white font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer shadow-sm"
                id="sumbit-new-job-btn"
              >
                <Plus className="w-4 h-4" />
                Register Site
              </button>
            </form>
          </div>

          {/* Job Sites List Manager */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-3" id="jobs-list-panel">
            <h3 className="text-xs uppercase font-bold tracking-wider text-gray-600 pb-1.5 border-b border-gray-100 flex items-center justify-between">
              <span>Managed Locations</span>
              <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-500">{jobs.length} sites</span>
            </h3>

            <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
              {jobs.map((j) => (
                <div key={j.id} className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex justify-between items-start gap-4 text-xs">
                  <div className="space-y-0.5 min-w-0">
                    <div className="font-bold text-gray-800 truncate" title={j.name}>{j.name}</div>
                    <div className="text-[10px] text-gray-500 truncate" title={j.address}>{j.address}</div>
                    <span className="text-[8.5px] font-mono text-gray-400 block">
                      Coords: {j.latitude?.toFixed(4)}, {j.longitude?.toFixed(4)} (±{j.radius}m)
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteJob(j.id)}
                    className="text-red-500 hover:bg-red-50 p-1 rounded-lg shrink-0 transition-all cursor-pointer"
                    title="Remove Job"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main Reporting Area */}
        <div className="space-y-6 lg:col-span-3 lg:order-1">

          {/* Time Off Requests — pending review */}
          {timeOffRequests.some(r => r.status === 'pending') && (
            <div className="bg-orange-50 border-2 border-orange-200 rounded-2xl p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <h2 className="text-base font-black text-orange-700 flex items-center gap-2 uppercase tracking-wide">
                  <Plane className="w-5 h-5 text-orange-600 shrink-0" />
                  Time Off Requests — Pending Approval
                </h2>
                <span className="text-xs font-bold bg-orange-200 text-blue-800 px-3 py-1 rounded-full">
                  {timeOffRequests.filter(r => r.status === 'pending').length} pending
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {timeOffRequests.filter(r => r.status === 'pending').map(req => {
                  const days = (() => {
                    const s = new Date(req.startDate + 'T12:00:00');
                    const e = new Date(req.endDate + 'T12:00:00');
                    return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
                  })();
                  const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                  const note = denyNotes[req.id] || '';

                  return (
                    <div key={req.id} className="bg-white border border-orange-200 rounded-xl p-4 space-y-3 text-xs shadow-sm flex flex-col justify-between">
                      <div className="space-y-2">
                        {/* Header */}
                        <div className="flex justify-between items-start gap-2">
                          <span className="font-bold text-gray-800 text-sm">{req.employeeName}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                            req.type === 'pto'
                              ? 'bg-green-100 text-green-700 border-green-200'
                              : 'bg-gray-100 text-gray-700 border-gray-200'
                          }`}>
                            {req.type === 'pto' ? 'Paid (PTO)' : 'Unpaid'}
                          </span>
                        </div>

                        {/* Dates */}
                        <div className="flex items-center gap-1.5 text-gray-700 font-semibold">
                          <Calendar className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                          {fmtDate(req.startDate)}{req.startDate !== req.endDate && ` – ${fmtDate(req.endDate)}`}
                        </div>

                        <div className="flex items-center gap-3 font-mono text-gray-500 text-[11px]">
                          <span>{days} day{days !== 1 ? 's' : ''}</span>
                          <span>{days * req.hoursPerDay} hours</span>
                          <span>{req.hoursPerDay}h/day</span>
                        </div>

                        {/* Reason */}
                        <p className="italic text-gray-600 leading-relaxed border-t border-gray-100 pt-2">
                          "{req.reason}"
                        </p>

                        {/* Deny note input */}
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">
                            Denial Note (optional)
                          </label>
                          <input
                            type="text"
                            value={note}
                            onChange={e => setDenyNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
                            placeholder="Reason for denial..."
                            className="w-full bg-white border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-orange-400"
                          />
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex gap-2 pt-2 border-t border-gray-100">
                        <button
                          type="button"
                          onClick={() => handleApproveTimeOff(req)}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-lg text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all active:translate-y-px shadow-sm"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDenyTimeOff(req)}
                          className="flex-1 bg-white hover:bg-red-50 text-red-600 border border-gray-200 hover:border-red-200 font-bold py-2.5 rounded-lg text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all active:translate-y-px"
                        >
                          <XCircle className="w-4 h-4" />
                          Deny
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Timecard Approval Queue — all completed entries pending review */}
          {entries.some(e => e.status !== 'active' && !e.isApproved) && (
            <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-6 shadow-sm space-y-5" id="approvals-requests-panel">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <h2 className="text-base font-black text-amber-700 flex items-center gap-2 uppercase tracking-wide">
                  <AlertCircle className="w-5 h-5 text-amber-600 animate-pulse shrink-0" />
                  Timecard Approvals — Awaiting Review
                </h2>
                <span className="text-xs font-bold bg-amber-200 text-amber-800 px-3 py-1 rounded-full">
                  {entries.filter(e => e.status !== 'active' && !e.isApproved).length} pending
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {entries
                  .filter(e => e.status !== 'active' && !e.isApproved)
                  .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
                  .map((item) => {
                  const data = getTotals(item);
                  const isManual = item.isManualEdit;

                  // Off-site detection — compare each GPS event against job site radius
                  const jobSite = jobs.find(j => j.id === item.jobId);
                  const isOffSite = (coords: { latitude: number; longitude: number } | null) => {
                    if (!coords || !jobSite) return false;
                    return getHaversineDistance(coords.latitude, coords.longitude, jobSite.latitude, jobSite.longitude) > jobSite.radius;
                  };
                  const gpsEvents = [
                    { label: 'Clock In',    icon: <MapPin className="w-3 h-3 text-green-600" />,   coords: item.clockInCoords  || null },
                    ...(item.lunchStart ? [{ label: 'Lunch Start', icon: <Coffee className="w-3 h-3 text-orange-500" />, coords: item.lunchStartCoords || null }] : []),
                    ...(item.lunchEnd   ? [{ label: 'Lunch End',   icon: <Coffee className="w-3 h-3 text-orange-500" />,   coords: item.lunchEndCoords   || null }] : []),
                    ...(item.clockOutTime ? [{ label: 'Clock Out', icon: <Navigation className="w-3 h-3 text-red-500" />, coords: item.clockOutCoords || null }] : []),
                  ];
                  const anyOffSite = gpsEvents.some(ev => isOffSite(ev.coords));
                  const anyMissingGps = gpsEvents.some(ev => !ev.coords);

                  return (
                    <div key={item.id} className={`bg-white rounded-xl p-4 space-y-3 text-xs flex flex-col justify-between shadow-sm border ${anyOffSite ? 'border-red-200' : 'border-amber-200'}`}>
                      <div className="space-y-2">

                        {/* Header row */}
                        <div className="flex justify-between items-start gap-2">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <span className="font-bold text-gray-800 text-sm truncate">{item.employeeName}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                              isManual
                                ? 'bg-amber-100 text-amber-700 border-amber-200'
                                : 'bg-orange-50 text-orange-700 border-orange-200'
                            }`}>
                              {isManual ? 'Manual Entry' : 'GPS Verified'}
                            </span>
                            {anyOffSite && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-red-50 text-red-700 border-red-200 shrink-0 flex items-center gap-0.5">
                                * Off-site
                              </span>
                            )}
                            {!anyOffSite && anyMissingGps && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-gray-50 text-gray-500 border-gray-200 shrink-0 flex items-center gap-0.5">
                                * GPS Missing
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-gray-400 shrink-0">{item.date}</span>
                        </div>

                        {/* Job + cost code + hours */}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono border-y border-gray-100 py-2 text-gray-500">
                          <div className="col-span-2">Job: <span className="text-gray-800 font-bold">{item.jobName}</span></div>
                          <div>Cost: <span className="text-gray-700">{item.costCode.split(' ')[0]}</span></div>
                          <div>Clock-in: <span className="text-gray-700">{item.clockInTime?.seconds ? new Date(item.clockInTime.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span></div>
                          <div>Regular: <span className="text-orange-600 font-extrabold">{data.worked.toFixed(2)} hrs</span></div>
                          {(item.travelTimeIn + item.travelTimeOut) > 0 && (
                            <div>Travel: <span className="text-gray-500">{item.travelTimeIn + item.travelTimeOut}m</span></div>
                          )}
                          {item.lunchDuration > 0 && (
                            <div>Lunch: <span className="text-gray-500">{item.lunchDuration}m</span></div>
                          )}
                        </div>

                        {/* Description */}
                        <p className="italic text-gray-600 leading-relaxed line-clamp-2">
                          "{item.description}"
                        </p>

                        {/* GPS Tracking — all events with off-site flags */}
                        <div className="border-t border-gray-100 pt-2 space-y-1">
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">GPS Tracking</p>
                          {gpsEvents.map((ev, i) => {
                            const offSite = isOffSite(ev.coords);
                            const dist = ev.coords && jobSite
                              ? Math.round(getHaversineDistance(ev.coords.latitude, ev.coords.longitude, jobSite.latitude, jobSite.longitude))
                              : null;
                            return (
                            <div key={i} className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[10.5px] border ${offSite ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                {ev.icon}
                                <span className="font-semibold text-gray-600 shrink-0">{ev.label}</span>
                                {ev.coords ? (
                                  <span className="font-mono text-gray-400 truncate">{ev.coords.latitude.toFixed(4)}, {ev.coords.longitude.toFixed(4)}</span>
                                ) : (
                                  <span className="text-gray-300 italic">No GPS</span>
                                )}
                                {offSite && dist !== null && (
                                  <span className="text-red-600 font-bold shrink-0">* {(dist / 1609).toFixed(1)} mi off-site</span>
                                )}
                              </div>
                              {ev.coords ? (
                                <a
                                  href={gMapsUrl(ev.coords.latitude, ev.coords.longitude)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-orange-600 hover:text-blue-800 flex items-center gap-0.5 font-semibold shrink-0 ml-2"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  Map
                                </a>
                              ) : null}
                            </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex gap-2 pt-2 border-t border-gray-100">
                        <button
                          type="button"
                          onClick={() => handleApprove(item.id)}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-lg text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all active:translate-y-px shadow-sm"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDecline(item.id)}
                          className="flex-1 bg-white hover:bg-red-50 text-red-600 border border-gray-200 hover:border-red-200 font-bold py-2.5 rounded-lg text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all active:translate-y-px"
                        >
                          <XSquare className="w-4 h-4" />
                          Decline
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Time logs filters workspace */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-6" id="records-workspace-panel">

            {/* Headers and Exporter */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-100 pb-4">
              <div>
                <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                  <FileSpreadsheet className="w-5 h-5 text-green-600" />
                  Full Timesheet Records ({filteredEntries.length} entries)
                </h2>
                <p className="text-xs text-gray-500 leading-normal mt-0.5">
                  Refined and filtered list compiled for payroll processing.
                </p>
              </div>

              <button
                type="button"
                onClick={handleExportCSV}
                className="bg-green-600 hover:bg-green-700 font-bold text-white px-4 py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm active:translate-y-px transition-all cursor-pointer"
                id="export-csv-btn"
              >
                <Plus className="w-4 h-4" />
                Export CSV Invoice Sheet
              </button>
            </div>

            {/* Filtering Matrix Grid */}
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 space-y-3" id="filter-matrix-grid">

              {/* Row 1: Dropdowns */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Employee</label>
                  {(() => {
                    const registeredNames = new Set(registeredEmployees.map(u => u.name));
                    const entryNames = [...new Set(entries.map(e => e.employeeName))].filter(n => !registeredNames.has(n)).sort();
                    const allNames = [...registeredEmployees.map(u => u.name), ...entryNames];
                    return (
                      <select
                        value={filterEmployee}
                        onChange={e => setFilterEmployee(e.target.value)}
                        className="w-full bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 rounded-lg focus:outline-none focus:border-orange-500"
                        id="filter-worker-name-input"
                      >
                        <option value="">All Employees</option>
                        {allNames.map(name => <option key={name} value={name}>{name}</option>)}
                      </select>
                    );
                  })()}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Job Site</label>
                  <select
                    value={filterJob}
                    onChange={e => setFilterJob(e.target.value)}
                    className="w-full bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 rounded-lg focus:outline-none focus:border-orange-500"
                    id="filter-job-select"
                  >
                    <option value="">All Sites</option>
                    {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">Cost Code</label>
                  <select
                    value={filterCostCode}
                    onChange={e => setFilterCostCode(e.target.value)}
                    className="w-full bg-white border border-gray-300 text-xs px-2 py-1.5 text-gray-900 rounded-lg focus:outline-none focus:border-orange-500"
                    id="filter-costcode-select"
                  >
                    <option value="">All Codes</option>
                    {COST_CODES.map(code => <option key={code} value={code}>{code}</option>)}
                  </select>
                </div>
              </div>

              {/* Row 2: Date filter with mode toggle */}
              <div className="border-t border-gray-200 pt-3 space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Date Filter</label>
                  <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-0.5">
                    {(['single', 'period', 'range'] as const).map(mode => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setFilterDateMode(mode)}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                          filterDateMode === mode
                            ? 'bg-orange-600 text-white shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        {mode === 'single' ? 'Single Day' : mode === 'period' ? 'Pay Period' : 'Date Range'}
                      </button>
                    ))}
                  </div>
                </div>

                {filterDateMode === 'single' && (
                  <input
                    type="date"
                    value={filterDate}
                    onChange={e => setFilterDate(e.target.value)}
                    className="bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 rounded-lg focus:outline-none font-mono focus:border-orange-500"
                    id="filter-shift-day"
                  />
                )}

                {filterDateMode === 'period' && (
                  <select
                    value={filterPeriodIdx}
                    onChange={e => setFilterPeriodIdx(Number(e.target.value))}
                    className="w-full bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 rounded-lg focus:outline-none focus:border-orange-500"
                  >
                    {payPeriods.map((p, i) => (
                      <option key={p.start} value={i}>{p.label}</option>
                    ))}
                  </select>
                )}

                {filterDateMode === 'range' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-gray-500 font-semibold shrink-0">From</label>
                      <input
                        type="date"
                        value={filterDateFrom}
                        onChange={e => setFilterDateFrom(e.target.value)}
                        className="bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 rounded-lg focus:outline-none font-mono focus:border-orange-500"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-gray-500 font-semibold shrink-0">To</label>
                      <input
                        type="date"
                        value={filterDateTo}
                        onChange={e => setFilterDateTo(e.target.value)}
                        className="bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 rounded-lg focus:outline-none font-mono focus:border-orange-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Clear all */}
              {(filterEmployee || filterJob || filterCostCode || filterDate || filterDateFrom || filterDateTo) && (
                <div className="flex justify-end border-t border-gray-200 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setFilterEmployee(''); setFilterJob(''); setFilterCostCode('');
                      setFilterDate(''); setFilterDateFrom(''); setFilterDateTo('');
                    }}
                    className="text-[10px] text-orange-600 hover:text-blue-800 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <XSquare className="w-3 h-3" /> Clear All Filters
                  </button>
                </div>
              )}
            </div>

            {/* Quick Summary Statistical Reports */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-gray-50 p-4 rounded-xl border border-gray-200">
              {/* Job breakdown */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-gray-200 pb-1 block">
                  Billable Hours per Job
                </span>
                <div className="space-y-1.5 text-xs max-h-36 overflow-y-auto pr-1">
                  {Object.keys(statsByJob).length === 0 ? (
                    <p className="text-[10px] text-gray-400">No logs.</p>
                  ) : (
                    Object.entries(statsByJob).map(([job, h]: any) => (
                      <div key={job} className="flex justify-between font-mono">
                        <span className="text-gray-500 truncate max-w-[130px]">{job}</span>
                        <span className="text-orange-600 font-bold">{h.toFixed(1)} hrs</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Code breakdown */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-gray-200 pb-1 block">
                  Billable per Cost Code
                </span>
                <div className="space-y-1.5 text-xs max-h-36 overflow-y-auto pr-1">
                  {Object.keys(statsByCode).length === 0 ? (
                    <p className="text-[10px] text-gray-400">No logs.</p>
                  ) : (
                    Object.entries(statsByCode).map(([code, h]: any) => (
                      <div key={code} className="flex justify-between font-mono">
                        <span className="text-gray-500 truncate max-w-[130px]">{code}</span>
                        <span className="text-orange-500 font-bold">{h.toFixed(1)} hrs</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Employee breakdown */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-gray-200 pb-1 block">
                  Billable per Employee
                </span>
                <div className="space-y-1.5 text-xs max-h-36 overflow-y-auto pr-1">
                  {Object.keys(statsByUser).length === 0 ? (
                    <p className="text-[10px] text-gray-400">No logs.</p>
                  ) : (
                    Object.entries(statsByUser).map(([user, h]: any) => (
                      <div key={user} className="flex justify-between font-mono">
                        <span className="text-gray-500 truncate max-w-[130px]">{user}</span>
                        <span className="text-green-600 font-bold">{h.toFixed(1)} hrs</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Records Log Table */}
            <div className="overflow-x-auto border border-gray-200 rounded-xl" id="time-entries-table">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-gray-50 font-semibold uppercase tracking-wider text-gray-500">
                  <tr>
                    <th scope="col" className="px-4 py-3.5 text-left font-semibold">Employee</th>
                    <th scope="col" className="px-4 py-3.5 text-left font-semibold">Date</th>
                    <th scope="col" className="px-4 py-3.5 text-left font-semibold">Job Site</th>
                    <th scope="col" className="px-4 py-3.5 text-left font-semibold">Cost Code</th>
                    <th scope="col" className="px-4 py-3.5 text-left font-semibold">Status</th>
                    <th scope="col" className="px-4 py-3.5 text-right font-semibold">Regular / Billable Hrs</th>
                    <th scope="col" className="px-4 py-3.5 text-left font-semibold">Description</th>
                    <th scope="col" className="px-4 py-3.5 text-center font-semibold">Locations</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {filteredEntries.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-gray-400 italic">
                        No completed timecard records match selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredEntries.map((e) => {
                      const stats = getTotals(e);
                      const isExpanded = expandedLocationId === e.id;
                      const hasCoords = e.clockInCoords || e.clockOutCoords;
                      return (
                        <React.Fragment key={e.id}>
                          <tr className={`hover:bg-gray-50 transition-colors ${isExpanded ? 'bg-orange-50/40' : ''}`}>
                            <td className="px-4 py-4 whitespace-nowrap font-bold text-gray-800">
                              {e.employeeName}
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap font-mono text-gray-500">
                              {e.date}
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap text-gray-700">
                              {e.jobName}
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap font-mono text-gray-500 truncate max-w-[120px]" title={e.costCode}>
                              {e.costCode.split(' ')[0]}
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap">
                              {e.status === 'active' ? (
                                <span className="inline-flex items-center gap-1 font-bold text-[10px] uppercase bg-orange-50 border border-orange-200 text-orange-700 px-2 py-0.5 rounded-full animate-pulse">
                                  ● Clocked In
                                </span>
                              ) : e.isApproved ? (
                                <span className="inline-flex items-center gap-1 font-bold text-[10px] uppercase bg-green-50 border border-green-200 text-green-700 px-2 py-0.5 rounded-full">
                                  ✓ Approved
                                </span>
                              ) : e.isManualEdit ? (
                                <span className="inline-flex items-center gap-1 font-bold text-[10px] uppercase bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 rounded-full">
                                  Pending Approval
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 font-bold text-[10px] uppercase bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 rounded-full">
                                  Pending Review
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap text-right font-mono font-bold text-gray-800">
                              {stats.worked.toFixed(2)}h / {stats.billable.toFixed(2)}h
                              <div className="text-[9.5px] text-gray-400 font-mono">
                                Travel: {stats.travel}m | Lunch: {stats.lunch}m
                              </div>
                            </td>
                            <td className="px-4 py-4 text-gray-500 max-w-xs truncate italic" title={e.description}>
                              "{e.description}"
                            </td>
                            <td className="px-4 py-4 text-center">
                              <button
                                type="button"
                                onClick={() => setExpandedLocationId(isExpanded ? null : e.id)}
                                disabled={!hasCoords}
                                title={hasCoords ? 'View location history' : 'No GPS data'}
                                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                                  isExpanded
                                    ? 'bg-orange-100 text-orange-700'
                                    : hasCoords
                                      ? 'text-gray-400 hover:bg-orange-50 hover:text-orange-600'
                                      : 'text-gray-200 cursor-not-allowed'
                                }`}
                              >
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={8} className="p-0">
                                {renderLocationPanel(e)}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

          </div>

        </div>

      </div>

      </> /* end overview tab */}
    </div>
  );
}
