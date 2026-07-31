import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { exportCleanPayrollCSV, exportPayrollExcel, exportInvoicePDF, EmployeeRateMap } from '../utils/exportUtils';
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
import { JobSite, TimeEntry, AppSettings, COST_CODES, TimeOffRequest, PendingEmployee, CostCode, CostCodeType, CostCodeUnit } from '../types';
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
  Bell,
  Download,
  FileText,
  Table2,
  Eye,
  EyeOff,
  Lock,
  Tag,
  Pencil,
  Upload,
  LogOut
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
  const [registeredEmployees, setRegisteredEmployees] = useState<{ uid: string; name: string; email: string; billableRate?: number; homeAddress?: string; homeLatitude?: number; homeLongitude?: number; currentPassword?: string; mustChangePassword?: boolean }[]>([]);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

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
  const [preRegPassword, setPreRegPassword] = useState('');
  const [showPreRegPassword, setShowPreRegPassword] = useState(false);
  const [preRegLoading, setPreRegLoading] = useState(false);
  const [pendingEmployees, setPendingEmployees] = useState<PendingEmployee[]>([]);

  // Address autocomplete
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const addressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Employee password reveal set
  const [revealedPasswords, setRevealedPasswords] = useState<Set<string>>(new Set());

  // Cost Codes
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [ccSearch, setCcSearch] = useState('');
  const [ccPage, setCcPage] = useState(1);
  const CC_PAGE_SIZE = 10;
  const [ccFormOpen, setCcFormOpen] = useState(false);
  const [ccEditId, setCcEditId] = useState<string | null>(null);
  const [ccCode, setCcCode] = useState('');
  const [ccDescription, setCcDescription] = useState('');
  const [ccDivision, setCcDivision] = useState('');
  const [ccCostType, setCcCostType] = useState<CostCodeType>('Labor');
  const [ccUnit, setCcUnit] = useState<CostCodeUnit>('HR');
  const [ccBillable, setCcBillable] = useState(true);
  const [ccActive, setCcActive] = useState(true);
  const [ccIsGlobal, setCcIsGlobal] = useState(true);
  const [ccJobId, setCcJobId] = useState('');
  const [ccNotes, setCcNotes] = useState('');

  // CSV/Excel import
  const [ccImportOpen, setCcImportOpen] = useState(false);
  const [ccImportRows, setCcImportRows] = useState<Partial<CostCode>[]>([]);
  const [ccImportLoading, setCcImportLoading] = useState(false);
  const ccFileRef = useRef<HTMLInputElement>(null);

  // Job site editing
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [jobAddressSuggestions, setJobAddressSuggestions] = useState<any[]>([]);
  const jobAddressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Map helpers
  const osmEmbedUrl = (lat: number, lng: number) =>
    `https://www.openstreetmap.org/export/embed.html?bbox=${(lng - 0.003).toFixed(6)},${(lat - 0.003).toFixed(6)},${(lng + 0.003).toFixed(6)},${(lat + 0.003).toFixed(6)}&layer=mapnik&marker=${lat},${lng}`;

  const gMapsUrl = (lat: number, lng: number) =>
    `https://www.google.com/maps?q=${lat},${lng}`;

  // Close export dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as JobSite));
      setJobs(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'jobs');
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
          billableRate: d.data().billableRate as number | undefined,
          homeAddress: d.data().homeAddress as string | undefined,
          homeLatitude: d.data().homeLatitude as number | undefined,
          homeLongitude: d.data().homeLongitude as number | undefined,
          currentPassword: d.data().currentPassword as string | undefined,
          mustChangePassword: d.data().mustChangePassword as boolean | undefined,
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

    const unsubscribeCostCodes = onSnapshot(collection(db, 'cost_codes'), (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as CostCode));
      data.sort((a, b) => a.code.localeCompare(b.code));
      setCostCodes(data);
    }, () => {
      setCostCodes([]);
    });

    return () => {
      unsubscribeEntries();
      unsubscribeJobs();
      unsubscribeSettings();
      unsubscribeUsers();
      unsubscribeTimeOff();
      unsubscribePending();
      unsubscribeCostCodes();
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

  const handleForceClockOut = async (entry: TimeEntry) => {
    if (!confirm(`Force clock-out ${entry.employeeName} at 6:00 PM on ${entry.date}?`)) return;
    try {
      const [y, m, d] = entry.date.split('-').map(Number);
      const clockOut = new Date(y, m - 1, d, 18, 0, 0, 0);
      await updateDoc(doc(db, 'time_entries', entry.id), {
        status: 'completed',
        clockOutTime: clockOut,
        clockOutCoords: entry.clockInCoords ?? null,
        travelTimeOut: entry.travelTimeOut ?? 0,
        updatedAt: new Date(),
      });
      triggerToast(`${entry.employeeName} clocked out at 6:00 PM on ${entry.date}.`);
    } catch (err) {
      console.error(err);
      alert('Force clock-out failed.');
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
      if (editJobId) {
        await updateDoc(doc(db, 'jobs', editJobId), {
          name: newJobName.trim(),
          address: newJobAddress.trim(),
          latitude: Number(newJobLat),
          longitude: Number(newJobLng),
          radius: Number(newJobRadius) || 100,
        });
        setEditJobId(null);
        triggerToast('Job site updated.');
      } else {
        const jobId = 'job_' + Date.now();
        await setDoc(doc(db, 'jobs', jobId), {
          id: jobId,
          name: newJobName.trim(),
          address: newJobAddress.trim(),
          latitude: Number(newJobLat) || 37.77,
          longitude: Number(newJobLng) || -122.41,
          radius: Number(newJobRadius) || 100,
          createdAt: new Date()
        });
        triggerToast('New Job Site added to network list!');
      }
      setNewJobName('');
      setNewJobAddress('');
      setNewJobLat(37.774929);
      setNewJobLng(-122.419416);
      setNewJobRadius(1609);
      setJobAddressSuggestions([]);
    } catch (err) {
      console.error(err);
      alert('Failed to save job site.');
    }
  };

  const startEditJob = (j: JobSite) => {
    setEditJobId(j.id);
    setNewJobName(j.name);
    setNewJobAddress(j.address);
    setNewJobLat(j.latitude);
    setNewJobLng(j.longitude);
    setNewJobRadius(j.radius);
    setJobAddressSuggestions([]);
    document.getElementById('jobs-creator-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleJobAddressInput = (value: string) => {
    setNewJobAddress(value);
    if (jobAddressTimeoutRef.current) clearTimeout(jobAddressTimeoutRef.current);
    if (value.length < 3) { setJobAddressSuggestions([]); return; }
    jobAddressTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(value)}&limit=5`);
        const json = await res.json();
        setJobAddressSuggestions(json.features || []);
      } catch { setJobAddressSuggestions([]); }
    }, 350);
  };

  const handleSelectJobAddress = (feature: any) => {
    const p = feature.properties;
    const parts = [p.name, p.street, p.city, p.state, p.country].filter(Boolean);
    setNewJobAddress(parts.join(', '));
    setNewJobLat(feature.geometry.coordinates[1]);
    setNewJobLng(feature.geometry.coordinates[0]);
    setJobAddressSuggestions([]);
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

  // Create a full employee account (Firebase Auth + Firestore users doc)
  const handlePreRegisterEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailKey = preRegEmail.trim().toLowerCase();
    if (!emailKey || !preRegFirstName.trim() || !preRegLastName.trim()) return;
    if (!preRegPassword.trim() || preRegPassword.trim().length < 6) {
      alert('Password must be at least 6 characters.');
      return;
    }
    setPreRegLoading(true);
    try {
      const name = `${preRegFirstName.trim()} ${preRegLastName.trim()}`;

      // Create Firebase Auth account via REST API — does not affect admin's current session
      const signUpRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${import.meta.env.VITE_FIREBASE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailKey, password: preRegPassword.trim(), returnSecureToken: false }),
        }
      );
      const signUpData = await signUpRes.json();
      if (!signUpRes.ok) {
        const msg: string = signUpData.error?.message || 'Unknown error';
        if (msg === 'EMAIL_EXISTS') throw new Error(`An account already exists for ${emailKey}.`);
        throw new Error(msg);
      }

      const uid: string = signUpData.localId;

      // Write full user profile to Firestore users/{uid}
      const payload: Record<string, any> = {
        uid,
        email: emailKey,
        name,
        role: preRegRole,
        createdAt: new Date(),
        mustChangePassword: true,
        currentPassword: preRegPassword.trim(),
      };
      if (preRegJobTitle.trim())  payload.jobTitle = preRegJobTitle.trim();
      if (preRegRate)             payload.billableRate = Number(preRegRate);
      if (preRegPhone.trim())     payload.phoneNumber = preRegPhone.trim();
      if (preRegAddress.trim())   payload.homeAddress = preRegAddress.trim();
      if (preRegLat)              payload.homeLatitude = Number(preRegLat);
      if (preRegLng)              payload.homeLongitude = Number(preRegLng);

      await setDoc(doc(db, 'users', uid), payload);

      setPreRegFirstName(''); setPreRegLastName(''); setPreRegEmail('');
      setPreRegPhone(''); setPreRegJobTitle(''); setPreRegRate('');
      setPreRegAddress(''); setPreRegLat(''); setPreRegLng('');
      setPreRegRole('employee'); setPreRegPassword('');
      setAddressSuggestions([]);
      triggerToast(`Account created for ${name}. Share ${emailKey} + the password with them — they sign in directly.`);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to create employee account.');
    }
    setPreRegLoading(false);
  };

  const handleAddressInput = (value: string) => {
    setPreRegAddress(value);
    if (addressTimeoutRef.current) clearTimeout(addressTimeoutRef.current);
    if (value.length < 3) { setAddressSuggestions([]); return; }
    addressTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(value)}&limit=5`);
        const data = await res.json();
        setAddressSuggestions(data.features || []);
      } catch { setAddressSuggestions([]); }
    }, 350);
  };

  const handleSelectAddress = (feature: any) => {
    const p = feature.properties;
    const parts = [
      p.housenumber && p.street ? `${p.housenumber} ${p.street}` : (p.street || p.name),
      p.city || p.county,
      p.state,
      p.postcode,
    ].filter(Boolean);
    setPreRegAddress(parts.join(', '));
    setPreRegLat(feature.geometry.coordinates[1].toFixed(6));
    setPreRegLng(feature.geometry.coordinates[0].toFixed(6));
    setAddressSuggestions([]);
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

  // Cost code helpers
  const resetCcForm = () => {
    setCcEditId(null);
    setCcCode('');
    setCcDescription('');
    setCcDivision('');
    setCcCostType('Labor');
    setCcUnit('HR');
    setCcBillable(true);
    setCcActive(true);
    setCcIsGlobal(true);
    setCcJobId('');
    setCcNotes('');
  };

  const startEditCc = (code: CostCode) => {
    setCcEditId(code.id);
    setCcCode(code.code);
    setCcDescription(code.description);
    setCcDivision(code.division || '');
    setCcCostType(code.costType);
    setCcUnit(code.unit);
    setCcBillable(code.billable);
    setCcActive(code.active);
    setCcIsGlobal(code.isGlobal);
    setCcJobId(code.jobId || '');
    setCcNotes(code.notes || '');
    setCcFormOpen(true);
    document.getElementById('cc-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleSaveCostCode = async () => {
    if (!ccCode.trim() || !ccDescription.trim()) {
      triggerToast('Code and description are required.');
      return;
    }
    if (!ccIsGlobal && !ccJobId) {
      triggerToast('Select a job for project-specific codes.');
      return;
    }
    const jobName = !ccIsGlobal ? (jobs.find(j => j.id === ccJobId)?.name || '') : undefined;
    const payload: Omit<CostCode, 'id' | 'createdAt'> & { createdAt?: any } = {
      code: ccCode.trim().toUpperCase(),
      description: ccDescription.trim(),
      ...(ccDivision.trim() && { division: ccDivision.trim() }),
      costType: ccCostType,
      unit: ccUnit,
      billable: ccBillable,
      active: ccActive,
      isGlobal: ccIsGlobal,
      ...((!ccIsGlobal && ccJobId) && { jobId: ccJobId, jobName }),
      ...(ccNotes.trim() && { notes: ccNotes.trim() }),
      updatedAt: new Date(),
    };
    try {
      if (ccEditId) {
        await updateDoc(doc(db, 'cost_codes', ccEditId), payload);
        triggerToast('Cost code updated.');
      } else {
        await addDoc(collection(db, 'cost_codes'), { ...payload, createdAt: new Date() });
        triggerToast('Cost code added!');
      }
      setCcFormOpen(false);
      resetCcForm();
    } catch (err) {
      console.error(err);
      triggerToast('Error saving cost code.');
    }
  };

  const handleDeleteCostCode = async (id: string) => {
    if (!confirm('Delete this cost code? This cannot be undone.')) return;
    try {
      await deleteDoc(doc(db, 'cost_codes', id));
      triggerToast('Cost code deleted.');
    } catch (err) {
      console.error(err);
      triggerToast('Error deleting cost code.');
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = ev.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as any[];

        const get = (row: any, keys: string[]) => {
          for (const k of keys) {
            const found = Object.keys(row).find(rk => rk.toLowerCase().replace(/[\s_-]/g, '') === k.toLowerCase().replace(/[\s_-]/g, ''));
            if (found !== undefined && row[found] !== '') return String(row[found]).trim();
          }
          return '';
        };
        const parseBool = (val: string, def: boolean) =>
          val === '' ? def : ['true', 'yes', '1', 'y'].includes(val.toLowerCase());
        const validTypes: CostCodeType[] = ['Labor', 'Materials', 'Equipment', 'Subcontractor', 'Other'];
        const validUnits: CostCodeUnit[] = ['HR', 'SQFT', 'CY', 'TON', 'LS', 'EA', 'LF', 'SF', 'DAY', 'GAL'];

        const parsed = raw.map(row => {
          const typeRaw = get(row, ['costtype', 'type', 'cost_type']);
          const unitRaw = get(row, ['unit']).toUpperCase();
          return {
            code: get(row, ['code', 'code_id', 'codeid']).toUpperCase(),
            description: get(row, ['description', 'desc', 'name']),
            division: get(row, ['division', 'category', 'div']) || undefined,
            costType: (validTypes.find(t => t.toLowerCase() === typeRaw.toLowerCase()) ?? 'Labor') as CostCodeType,
            unit: (validUnits.includes(unitRaw as CostCodeUnit) ? unitRaw : 'HR') as CostCodeUnit,
            billable: parseBool(get(row, ['billable']), true),
            active: parseBool(get(row, ['active']), true),
            isGlobal: parseBool(get(row, ['isglobal', 'global']), true),
            notes: get(row, ['notes', 'note', 'comment']) || undefined,
          } as Partial<CostCode>;
        }).filter(r => r.code && r.description);

        if (parsed.length === 0) {
          triggerToast('No valid rows found. Check that the file has "code" and "description" columns.');
          return;
        }
        setCcImportRows(parsed);
        setCcImportOpen(true);
      } catch (err) {
        console.error(err);
        triggerToast('Error reading file. Make sure it is a valid CSV or Excel file.');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const handleConfirmImport = async () => {
    setCcImportLoading(true);
    try {
      await Promise.all(ccImportRows.map(row =>
        addDoc(collection(db, 'cost_codes'), { ...row, createdAt: new Date(), updatedAt: new Date() })
      ));
      triggerToast(`${ccImportRows.length} cost codes imported!`);
      setCcImportOpen(false);
      setCcImportRows([]);
    } catch (err) {
      console.error(err);
      triggerToast('Import failed. Please try again.');
    }
    setCcImportLoading(false);
  };

  const ccTypeColor = (type: CostCodeType) => {
    switch (type) {
      case 'Labor':        return 'bg-blue-50 border-blue-100 text-blue-700';
      case 'Materials':    return 'bg-amber-50 border-amber-100 text-amber-700';
      case 'Equipment':    return 'bg-purple-50 border-purple-100 text-purple-700';
      case 'Subcontractor': return 'bg-red-50 border-red-100 text-red-700';
      default:             return 'bg-gray-50 border-gray-100 text-gray-600';
    }
  };

  // Build name → hourly rate map from registered employees
  const getRateMap = (): EmployeeRateMap => {
    const map: EmployeeRateMap = {};
    registeredEmployees.forEach(e => { if (e.billableRate) map[e.name] = e.billableRate; });
    return map;
  };

  const handleExportCSV     = () => { exportCleanPayrollCSV(filteredEntries, getRateMap()); setExportMenuOpen(false); };
  const handleExportExcel   = () => { exportPayrollExcel(filteredEntries, getRateMap()); setExportMenuOpen(false); };
  const handleExportInvoice = () => { exportInvoicePDF(filteredEntries, getRateMap()); setExportMenuOpen(false); };

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

  // Cost codes filtered + paginated
  const ccFiltered = costCodes
    .filter(c => {
      if (!ccSearch) return true;
      const q = ccSearch.toLowerCase();
      return (
        c.code.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        (c.division || '').toLowerCase().includes(q) ||
        (c.jobName || '').toLowerCase().includes(q)
      );
    });
  const ccTotalPages = Math.max(1, Math.ceil(ccFiltered.length / CC_PAGE_SIZE));
  const ccOffset = (ccPage - 1) * CC_PAGE_SIZE;
  const ccPageItems = ccFiltered.slice(ccOffset, ccOffset + CC_PAGE_SIZE);

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

      {/* Main Reporting Area — full width */}
      <div className="space-y-6">

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

              {/* Export dropdown */}
              <div className="relative" ref={exportMenuRef}>
                <button
                  type="button"
                  onClick={() => setExportMenuOpen(v => !v)}
                  className="bg-green-600 hover:bg-green-700 font-bold text-white px-4 py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm active:translate-y-px transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Export
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${exportMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {exportMenuOpen && (
                  <div className="absolute right-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg z-50 min-w-[210px] overflow-hidden">
                    <button
                      type="button"
                      onClick={handleExportCSV}
                      className="w-full flex items-center gap-2.5 px-4 py-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer border-b border-gray-100"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-green-600 shrink-0" />
                      <div className="text-left">
                        <div>Payroll CSV</div>
                        <div className="text-[10px] font-normal text-gray-400">Clean format with totals</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={handleExportExcel}
                      className="w-full flex items-center gap-2.5 px-4 py-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer border-b border-gray-100"
                    >
                      <Table2 className="w-4 h-4 text-blue-600 shrink-0" />
                      <div className="text-left">
                        <div>Payroll Excel (.xlsx)</div>
                        <div className="text-[10px] font-normal text-gray-400">3 sheets: data, employee & job summary</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={handleExportInvoice}
                      className="w-full flex items-center gap-2.5 px-4 py-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      <FileText className="w-4 h-4 text-orange-600 shrink-0" />
                      <div className="text-left">
                        <div>Invoice PDF</div>
                        <div className="text-[10px] font-normal text-gray-400">Formatted invoice with summaries</div>
                      </div>
                    </button>
                  </div>
                )}
              </div>
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
                              <div className="flex items-center justify-center gap-1">
                                {e.status === 'active' && (
                                  <button
                                    type="button"
                                    onClick={() => handleForceClockOut(e)}
                                    title={`Force clock-out ${e.employeeName} at 6:00 PM on ${e.date}`}
                                    className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-all cursor-pointer"
                                  >
                                    <LogOut className="w-4 h-4" />
                                  </button>
                                )}
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
                              </div>
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

      </div>{/* end main reporting area */}

      {/* Cost Codes Management */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4" id="cc-section">
        <div className="flex items-center justify-between pb-2 border-b border-gray-100 flex-wrap gap-2">
          <h3 className="text-xs uppercase font-bold tracking-wider text-gray-600 flex items-center gap-1.5">
            <Tag className="w-4 h-4 text-gray-400" />
            Cost Codes
            <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-500 normal-case font-normal tracking-normal ml-1">{costCodes.length} total</span>
          </h3>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => ccFileRef.current?.click()}
              className="flex items-center gap-1 text-gray-600 hover:text-orange-600 border border-gray-200 hover:border-orange-300 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg transition-all cursor-pointer bg-white"
              title="Import from CSV or Excel"
            >
              <Upload className="w-3 h-3" />
              Import
            </button>
            <input
              ref={ccFileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={handleImportFile}
            />
            <button
              type="button"
              onClick={() => { resetCcForm(); setCcFormOpen(v => !v); }}
              className="flex items-center gap-1 bg-orange-600 hover:bg-orange-700 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-all cursor-pointer active:translate-y-px"
            >
              <Plus className="w-3 h-3" />
              {ccFormOpen && !ccEditId ? 'Cancel' : 'Add Code'}
            </button>
          </div>
        </div>

        {/* Add / Edit Form */}
        {ccFormOpen && (
          <div className="bg-orange-50 border border-orange-100 rounded-xl p-4 space-y-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-orange-700 mb-1">
              {ccEditId ? 'Edit Cost Code' : 'New Cost Code'}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Code Identifier *</label>
                <input
                  value={ccCode}
                  onChange={e => setCcCode(e.target.value)}
                  placeholder="03-210-L"
                  className="w-full bg-white border border-gray-300 text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-orange-500"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Division / Category</label>
                <input
                  value={ccDivision}
                  onChange={e => setCcDivision(e.target.value)}
                  placeholder="03 - Concrete"
                  className="w-full bg-white border border-gray-300 text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-orange-500"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] text-gray-500 mb-1">Description *</label>
                <input
                  value={ccDescription}
                  onChange={e => setCcDescription(e.target.value)}
                  placeholder="Concrete - Cast-in-Place - Labor"
                  className="w-full bg-white border border-gray-300 text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-orange-500"
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Cost Type *</label>
                <select
                  value={ccCostType}
                  onChange={e => setCcCostType(e.target.value as CostCodeType)}
                  className="w-full bg-white border border-gray-300 text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-orange-500"
                >
                  {(['Labor', 'Materials', 'Equipment', 'Subcontractor', 'Other'] as CostCodeType[]).map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Unit *</label>
                <select
                  value={ccUnit}
                  onChange={e => setCcUnit(e.target.value as CostCodeUnit)}
                  className="w-full bg-white border border-gray-300 text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-orange-500"
                >
                  {(['HR', 'SQFT', 'CY', 'TON', 'LS', 'EA', 'LF', 'SF', 'DAY', 'GAL'] as CostCodeUnit[]).map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] text-gray-500 mb-1">Notes</label>
                <input
                  value={ccNotes}
                  onChange={e => setCcNotes(e.target.value)}
                  placeholder="Optional notes..."
                  className="w-full bg-white border border-gray-300 text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-orange-500"
                />
              </div>
              <div className="col-span-2 flex flex-wrap gap-5 pt-1">
                {[
                  { label: 'Billable', checked: ccBillable, set: setCcBillable },
                  { label: 'Active', checked: ccActive, set: setCcActive },
                  { label: 'Global (all jobs)', checked: ccIsGlobal, set: (v: boolean) => { setCcIsGlobal(v); if (v) setCcJobId(''); } },
                ].map(({ label, checked, set }) => (
                  <label key={label} className="flex items-center gap-1.5 cursor-pointer select-none">
                    <div
                      onClick={() => set(!checked)}
                      className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 transition-colors cursor-pointer ${checked ? 'bg-orange-600 border-orange-600' : 'bg-white border-gray-300'}`}
                    >
                      {checked && <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </div>
                    <span className="text-[10px] text-gray-600">{label}</span>
                  </label>
                ))}
              </div>
              {!ccIsGlobal && (
                <div className="col-span-2">
                  <label className="block text-[10px] text-gray-500 mb-1">Assign to Job *</label>
                  <select
                    value={ccJobId}
                    onChange={e => setCcJobId(e.target.value)}
                    className="w-full bg-white border border-gray-300 text-xs px-2 py-1.5 rounded-lg focus:outline-none focus:border-orange-500"
                  >
                    <option value="">Select job site...</option>
                    {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleSaveCostCode}
                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white text-[10px] font-bold py-2 px-3 rounded-lg transition-all cursor-pointer active:translate-y-px"
              >
                {ccEditId ? 'Save Changes' : 'Add Cost Code'}
              </button>
              <button
                type="button"
                onClick={() => { setCcFormOpen(false); resetCcForm(); }}
                className="px-4 py-2 text-[10px] text-gray-600 hover:bg-orange-100 rounded-lg cursor-pointer transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[140px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
            <input
              value={ccSearch}
              onChange={e => { setCcSearch(e.target.value); setCcPage(1); }}
              placeholder="Search codes, descriptions..."
              className="w-full pl-6 pr-2 py-1.5 bg-white border border-gray-200 text-xs rounded-lg focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>

        {/* List */}
        {ccFiltered.length === 0 ? (
          <div className="text-center py-8 text-xs text-gray-400 italic">
            {costCodes.length === 0
              ? 'No cost codes yet. Click "Add Code" to create your first.'
              : 'No codes match the current filters.'}
          </div>
        ) : (
          <div className="space-y-1">
            <div className="hidden md:grid md:grid-cols-[100px_1fr_100px_60px_70px_60px] gap-2 px-2 pb-1.5 border-b border-gray-100 text-[9px] uppercase tracking-wider text-gray-400 font-semibold">
              <span>Code</span>
              <span>Description</span>
              <span>Type</span>
              <span>Unit</span>
              <span>Status</span>
              <span></span>
            </div>
            {ccPageItems.map(code => (
              <div
                key={code.id}
                className={`grid grid-cols-[1fr_auto] md:grid-cols-[100px_1fr_100px_60px_70px_60px] gap-2 items-center px-2 py-2 rounded-xl hover:bg-gray-50 transition-colors ${!code.active ? 'opacity-50' : ''}`}
              >
                {/* Code + scope */}
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono font-bold text-[11px] text-gray-800">{code.code}</span>
                  {!code.isGlobal && (
                    <span className="text-[8px] bg-blue-50 border border-blue-100 text-blue-600 px-1 py-0.5 rounded w-fit">
                      {code.jobName || jobs.find(j => j.id === code.jobId)?.name || 'Project'}
                    </span>
                  )}
                  {code.isGlobal && (
                    <span className="text-[8px] bg-gray-50 border border-gray-100 text-gray-500 px-1 py-0.5 rounded w-fit">Global</span>
                  )}
                </div>
                {/* Description + division */}
                <div className="min-w-0 hidden md:block">
                  <div className="text-xs text-gray-700 truncate">{code.description}</div>
                  {code.division && <div className="text-[10px] text-gray-400 truncate">{code.division}</div>}
                  {code.notes && <div className="text-[9px] text-gray-400 truncate italic">{code.notes}</div>}
                </div>
                {/* Type badge */}
                <span className={`hidden md:inline-flex text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border w-fit ${ccTypeColor(code.costType)}`}>
                  {code.costType}
                </span>
                {/* Unit */}
                <span className="hidden md:block text-[10px] font-mono text-gray-500">{code.unit}</span>
                {/* Billable + active */}
                <div className="hidden md:flex items-center gap-1.5">
                  <span className={`text-[9px] font-bold ${code.billable ? 'text-green-600' : 'text-gray-400'}`}>{code.billable ? 'Billable' : 'Non-Bill'}</span>
                </div>
                {/* Edit / Delete */}
                <div className="flex items-center gap-1 justify-end">
                  <button
                    type="button"
                    onClick={() => startEditCc(code)}
                    className="text-gray-400 hover:text-orange-600 p-1 rounded cursor-pointer transition-colors"
                    title="Edit"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCostCode(code.id)}
                    className="text-gray-400 hover:text-red-500 p-1 rounded cursor-pointer transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {/* Mobile-only description row */}
                <div className="col-span-2 md:hidden text-[10px] text-gray-500 -mt-1 pb-1 border-b border-gray-50">
                  <div className="truncate">{code.description}</div>
                  <div className="flex gap-2 mt-0.5">
                    <span className={`text-[8px] font-bold uppercase px-1 py-0.5 rounded border ${ccTypeColor(code.costType)}`}>{code.costType}</span>
                    <span className="text-[8px] font-mono text-gray-400">{code.unit}</span>
                    {code.billable && <span className="text-[8px] text-green-600 font-bold">Billable</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {ccTotalPages > 1 && (
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <span className="text-[10px] text-gray-400">
              Showing {ccOffset + 1}–{Math.min(ccOffset + CC_PAGE_SIZE, ccFiltered.length)} of {ccFiltered.length}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={ccPage === 1}
                onClick={() => setCcPage(v => v - 1)}
                className="px-2.5 py-1 text-[10px] border border-gray-200 rounded-lg disabled:opacity-40 cursor-pointer hover:bg-gray-50 transition-colors"
              >
                Prev
              </button>
              <span className="px-2.5 py-1 text-[10px] text-gray-500">{ccPage} / {ccTotalPages}</span>
              <button
                type="button"
                disabled={ccPage >= ccTotalPages}
                onClick={() => setCcPage(v => v + 1)}
                className="px-2.5 py-1 text-[10px] border border-gray-200 rounded-lg disabled:opacity-40 cursor-pointer hover:bg-gray-50 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Admin Tools — Register Site, Add Employee, Pending Invites, Operational Parameters */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* 1. Register Site Location + Managed Locations */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4" id="jobs-creator-card">
          <div className="flex items-center justify-between pb-2 border-b border-gray-100">
            <h3 className="text-xs uppercase font-bold tracking-wider text-gray-600 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-gray-400" />
              {editJobId ? 'Edit Site Location' : 'Register Site Location'}
            </h3>
            {editJobId && (
              <button
                type="button"
                onClick={() => {
                  setEditJobId(null);
                  setNewJobName(''); setNewJobAddress('');
                  setNewJobLat(37.774929); setNewJobLng(-122.419416); setNewJobRadius(1609);
                  setJobAddressSuggestions([]);
                }}
                className="text-[10px] text-gray-500 hover:text-gray-700 px-2 py-1 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
              >
                Cancel Edit
              </button>
            )}
          </div>

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
              <div className="relative">
                <input
                  type="text"
                  required
                  placeholder="Start typing an address..."
                  value={newJobAddress}
                  onChange={(e) => handleJobAddressInput(e.target.value)}
                  onBlur={() => setTimeout(() => setJobAddressSuggestions([]), 150)}
                  className="w-full bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 placeholder-gray-400 rounded-lg focus:outline-none focus:border-orange-500"
                  id="new-job-address"
                />
                {jobAddressSuggestions.length > 0 && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                    {jobAddressSuggestions.map((f, i) => {
                      const p = f.properties;
                      const label = [p.name, p.street, p.city, p.state, p.country].filter(Boolean).join(', ');
                      return (
                        <button
                          key={i}
                          type="button"
                          onMouseDown={() => handleSelectJobAddress(f)}
                          className="w-full text-left px-3 py-2 text-[10.5px] text-gray-700 hover:bg-orange-50 hover:text-orange-700 border-b border-gray-50 last:border-0 cursor-pointer"
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <p className="text-[9px] text-gray-400 mt-0.5">Selecting a suggestion auto-fills the GPS coordinates below.</p>
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
              {editJobId ? <><Pencil className="w-3.5 h-3.5" /> Save Changes</> : <><Plus className="w-4 h-4" /> Register Site</>}
            </button>
          </form>

          {/* Managed Locations list */}
          <div className="border-t border-gray-100 pt-4 space-y-3" id="jobs-list-panel">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-600">Managed Locations</span>
              <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-500">{jobs.length} sites</span>
            </div>
            <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
              {jobs.map((j) => (
                <div key={j.id} className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex justify-between items-start gap-4 text-xs">
                  <div className="space-y-0.5 min-w-0">
                    <div className="font-bold text-gray-800 truncate" title={j.name}>{j.name}</div>
                    <div className="text-[10px] text-gray-500 truncate" title={j.address}>{j.address}</div>
                    <span className="text-[8.5px] font-mono text-gray-400 block">
                      Coords: {j.latitude?.toFixed(4)}, {j.longitude?.toFixed(4)} (±{j.radius}m)
                    </span>
                    {costCodes.filter(c => c.jobId === j.id).length > 0 && (
                      <button
                        type="button"
                        onClick={() => { setCcSearch(j.name); document.getElementById('cc-section')?.scrollIntoView({ behavior: 'smooth' }); }}
                        className="text-[8px] bg-blue-50 border border-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-bold cursor-pointer hover:bg-blue-100 transition-colors"
                      >
                        {costCodes.filter(c => c.jobId === j.id).length} project code{costCodes.filter(c => c.jobId === j.id).length !== 1 ? 's' : ''}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => startEditJob(j)}
                      className="text-gray-400 hover:text-orange-600 hover:bg-orange-50 p-1 rounded-lg transition-all cursor-pointer"
                      title="Edit Site"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteJob(j.id)}
                      className="text-red-500 hover:bg-red-50 p-1 rounded-lg transition-all cursor-pointer"
                      title="Remove Job"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 2. Add Employee */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
          <h3 className="text-xs uppercase font-bold tracking-wider text-gray-600 pb-2 border-b border-gray-100 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-gray-400" />
            Add Employee
          </h3>
          <p className="text-[10px] text-gray-400 leading-tight -mt-1">
            Creates the full account. Share the email + password with the employee — they sign in directly. No registration needed.
          </p>

          <form onSubmit={handlePreRegisterEmployee} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">First Name *</label>
                <input type="text" required placeholder="John" value={preRegFirstName} onChange={e => setPreRegFirstName(e.target.value)}
                  className="w-full bg-white border border-gray-300 text-xs px-2 py-1.5 text-gray-900 rounded-lg focus:outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Last Name *</label>
                <input type="text" required placeholder="Doe" value={preRegLastName} onChange={e => setPreRegLastName(e.target.value)}
                  className="w-full bg-white border border-gray-300 text-xs px-2 py-1.5 text-gray-900 rounded-lg focus:outline-none focus:border-orange-500" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Email Address *</label>
              <input type="email" required placeholder="worker@company.com" value={preRegEmail} onChange={e => setPreRegEmail(e.target.value)}
                className="w-full bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 rounded-lg focus:outline-none focus:border-orange-500" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Temporary Password *</label>
              <div className="relative">
                <input
                  type={showPreRegPassword ? 'text' : 'password'}
                  required
                  placeholder="Min 6 characters"
                  value={preRegPassword}
                  onChange={e => setPreRegPassword(e.target.value)}
                  className="w-full bg-white border border-gray-300 text-xs px-2.5 py-1.5 pr-8 text-gray-900 rounded-lg focus:outline-none focus:border-orange-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPreRegPassword(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPreRegPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-[9px] text-gray-400 mt-0.5">Employee is prompted to change this on first login.</p>
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Phone Number</label>
              <input type="tel" placeholder="(555) 000-0000" value={preRegPhone} onChange={e => setPreRegPhone(e.target.value)}
                className="w-full bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 rounded-lg focus:outline-none focus:border-orange-500" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Job Title</label>
              <input type="text" placeholder="e.g. Field Technician" value={preRegJobTitle} onChange={e => setPreRegJobTitle(e.target.value)}
                className="w-full bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 rounded-lg focus:outline-none focus:border-orange-500" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Billable Rate ($/hr)</label>
              <input type="number" min="0" step="0.01" placeholder="0.00" value={preRegRate} onChange={e => setPreRegRate(e.target.value)}
                className="w-full bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 rounded-lg font-mono focus:outline-none focus:border-orange-500" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Home Address</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Start typing address..."
                  value={preRegAddress}
                  onChange={e => handleAddressInput(e.target.value)}
                  onBlur={() => setTimeout(() => setAddressSuggestions([]), 200)}
                  className="w-full bg-white border border-gray-300 text-xs px-2.5 py-1.5 text-gray-900 rounded-lg focus:outline-none focus:border-orange-500"
                />
                {addressSuggestions.length > 0 && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {addressSuggestions.map((f, i) => {
                      const p = f.properties;
                      const label = [
                        p.housenumber && p.street ? `${p.housenumber} ${p.street}` : (p.street || p.name),
                        p.city || p.county,
                        p.state,
                        p.country,
                      ].filter(Boolean).join(', ');
                      return (
                        <button
                          key={i}
                          type="button"
                          onMouseDown={() => handleSelectAddress(f)}
                          className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-orange-50 transition-colors border-b border-gray-100 last:border-0"
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Latitude <span className="text-gray-300">(auto-filled)</span></label>
                <input type="number" step="0.000001" placeholder="37.7749" value={preRegLat} onChange={e => setPreRegLat(e.target.value)}
                  className="w-full bg-white border border-gray-300 text-xs px-2 py-1.5 text-gray-900 rounded-lg font-mono focus:outline-none" />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Longitude <span className="text-gray-300">(auto-filled)</span></label>
                <input type="number" step="0.000001" placeholder="-122.4194" value={preRegLng} onChange={e => setPreRegLng(e.target.value)}
                  className="w-full bg-white border border-gray-300 text-xs px-2 py-1.5 text-gray-900 rounded-lg font-mono focus:outline-none" />
              </div>
            </div>
            <p className="text-[9px] text-gray-400 leading-tight">
              GPS coordinates auto-fill when an address suggestion is selected. Used for travel-time calculation.
            </p>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">Access Level</label>
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" onClick={() => setPreRegRole('employee')}
                  className={`py-1.5 text-[10px] font-bold rounded-lg border transition-all cursor-pointer ${preRegRole === 'employee' ? 'bg-orange-50 text-orange-700 border-orange-300' : 'bg-white text-gray-400 border-gray-200 hover:text-gray-600'}`}>
                  Employee
                </button>
                <button type="button" onClick={() => setPreRegRole('admin')}
                  className={`py-1.5 text-[10px] font-bold rounded-lg border transition-all cursor-pointer ${preRegRole === 'admin' ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-white text-gray-400 border-gray-200 hover:text-gray-600'}`}>
                  Admin
                </button>
              </div>
            </div>
            <button type="submit" disabled={preRegLoading}
              className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-xs text-white font-bold py-2.5 px-3 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer active:translate-y-px shadow-sm">
              <Plus className="w-3.5 h-3.5" />
              {preRegLoading ? 'Creating...' : 'Create Employee Profile'}
            </button>
          </form>
        </div>

        {/* 3. Pending Invites */}
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
          {pendingEmployees.length === 0 ? (
            <p className="text-xs text-gray-400 italic text-center py-4">No pending invites yet.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {pendingEmployees.map(p => (
                <div key={p.email} className={`rounded-xl border px-3 py-2 text-xs flex items-start justify-between gap-2 ${p.claimed ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="min-w-0 space-y-0.5">
                    <div className="font-bold text-gray-800 truncate">{p.name}</div>
                    <div className="text-[10px] text-gray-500 truncate">{p.email}</div>
                    {p.jobTitle && <div className="text-[10px] text-gray-400">{p.jobTitle}</div>}
                    <span className={`inline-block text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${p.claimed ? 'bg-green-100 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                      {p.claimed ? 'Claimed' : 'Pending'}
                    </span>
                  </div>
                  {!p.claimed && (
                    <button type="button" onClick={() => handleDeletePendingEmployee(p.email)}
                      className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1 rounded-lg shrink-0 transition-all cursor-pointer" title="Remove invite">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 4. Operational Parameters */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4" id="settings-card">
          <h3 className="text-xs uppercase font-bold tracking-wider text-gray-600 pb-2 border-b border-gray-100 flex items-center gap-1.5">
            <Settings className="w-4 h-4 text-gray-400" />
            Operational Parameters
          </h3>
          <div>
            <label className="block text-[11px] text-gray-600 mb-1.5 font-semibold">Daily Company Auto-Clockout Hour</label>
            <input type="time" value={autoLogout} onChange={(e) => setAutoLogout(e.target.value)}
              className="w-full bg-white border border-gray-300 px-2 py-1.5 rounded-lg text-xs text-gray-900 focus:outline-none focus:border-orange-500" />
            <p className="text-[9.5px] text-gray-400 leading-tight mt-1">
              Workers left clocked in beyond this time will be clipped to this capping limit dynamically.
            </p>
          </div>
          <div>
            <label className="block text-[11px] text-gray-600 mb-1.5 font-semibold">Company Travel Coverage (Minutes)</label>
            <input type="number" min="0" max="240" value={companyTravelCoverage} onChange={(e) => setCompanyTravelCoverage(Number(e.target.value) || 0)}
              className="w-full bg-white border border-gray-300 px-2 py-1.5 rounded-lg text-xs text-gray-900 font-mono focus:outline-none focus:border-orange-500" />
            <p className="text-[9.5px] text-gray-400 leading-tight mt-1">
              Company pays this many travel minutes per shift. Travel beyond this is on the employee.
            </p>
          </div>
          <button type="button" onClick={handleSaveSettings}
            className="w-full bg-orange-600 hover:bg-orange-700 text-[10px] font-bold text-white uppercase px-3 py-2 rounded-lg active:translate-y-px cursor-pointer transition-all">
            Save Settings
          </button>
        </div>

      </div>{/* end bottom admin tools grid */}

      {/* Employee Account Passwords — visible to Randy only */}
      {user.email === 'randy@rhaus.me' && <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
        <h3 className="text-xs uppercase font-bold tracking-wider text-gray-600 pb-2 border-b border-gray-100 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Lock className="w-4 h-4 text-gray-400" />
            Employee Account Passwords
          </span>
          <span className="text-[9px] font-normal text-gray-400 normal-case tracking-normal">For account recovery only — keep confidential</span>
        </h3>
        {registeredEmployees.filter(e => e.currentPassword).length === 0 ? (
          <p className="text-xs text-gray-400 italic text-center py-4">
            No admin-created accounts yet. Passwords appear here after you create employee accounts above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-100">
                  <th className="text-left py-2 pr-6 font-semibold">Name</th>
                  <th className="text-left py-2 pr-6 font-semibold">Email</th>
                  <th className="text-left py-2 pr-6 font-semibold">Password</th>
                  <th className="text-left py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {registeredEmployees.filter(e => e.currentPassword).map(emp => (
                  <tr key={emp.uid} className="hover:bg-gray-50 transition-colors">
                    <td className="py-2.5 pr-6 font-semibold text-gray-800">{emp.name}</td>
                    <td className="py-2.5 pr-6 text-gray-500 font-mono text-[10px]">{emp.email}</td>
                    <td className="py-2.5 pr-6">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-gray-700">
                          {revealedPasswords.has(emp.uid) ? emp.currentPassword : '••••••••'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setRevealedPasswords(prev => {
                            const next = new Set(prev);
                            if (next.has(emp.uid)) next.delete(emp.uid); else next.add(emp.uid);
                            return next;
                          })}
                          className="text-gray-400 hover:text-gray-600 cursor-pointer"
                          title={revealedPasswords.has(emp.uid) ? 'Hide' : 'Reveal'}
                        >
                          {revealedPasswords.has(emp.uid) ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </td>
                    <td className="py-2.5">
                      {emp.mustChangePassword ? (
                        <span className="text-[9px] font-bold uppercase bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full">Temp — Must Change</span>
                      ) : (
                        <span className="text-[9px] font-bold uppercase bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">Employee Updated</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>}

      </> /* end overview tab */}

      {/* Cost Code Import Preview Modal */}
      {ccImportOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Import Preview</h2>
                <p className="text-[10px] text-gray-500 mt-0.5">{ccImportRows.length} valid cost codes found — review before importing</p>
              </div>
              <button type="button" onClick={() => { setCcImportOpen(false); setCcImportRows([]); }} className="text-gray-400 hover:text-gray-600 cursor-pointer">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-auto flex-1 px-6 py-3">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-[9px] uppercase tracking-wider text-gray-400 border-b border-gray-100">
                    <th className="text-left py-2 pr-4 font-semibold">Code</th>
                    <th className="text-left py-2 pr-4 font-semibold">Description</th>
                    <th className="text-left py-2 pr-4 font-semibold">Division</th>
                    <th className="text-left py-2 pr-4 font-semibold">Type</th>
                    <th className="text-left py-2 pr-4 font-semibold">Unit</th>
                    <th className="text-left py-2 font-semibold">Billable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {ccImportRows.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="py-1.5 pr-4 font-mono font-bold text-gray-800">{r.code}</td>
                      <td className="py-1.5 pr-4 text-gray-700 max-w-[200px] truncate">{r.description}</td>
                      <td className="py-1.5 pr-4 text-gray-500 text-[10px]">{r.division || '—'}</td>
                      <td className="py-1.5 pr-4">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${ccTypeColor(r.costType as CostCodeType)}`}>{r.costType}</span>
                      </td>
                      <td className="py-1.5 pr-4 font-mono text-gray-500">{r.unit}</td>
                      <td className="py-1.5">
                        <span className={`text-[9px] font-bold ${r.billable ? 'text-green-600' : 'text-gray-400'}`}>{r.billable ? 'Yes' : 'No'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={ccImportLoading}
                className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs py-2.5 rounded-xl transition-all cursor-pointer disabled:opacity-50"
              >
                {ccImportLoading ? 'Importing...' : `Import All ${ccImportRows.length} Codes`}
              </button>
              <button
                type="button"
                onClick={() => { setCcImportOpen(false); setCcImportRows([]); }}
                className="px-5 py-2.5 text-xs text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
