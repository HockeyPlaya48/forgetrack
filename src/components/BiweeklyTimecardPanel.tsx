import React, { useState, useEffect } from 'react';
import { doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { TimeEntry, UserProfile } from '../types';
import {
  Calendar,
  CheckCircle2,
  AlertCircle,
  Clock,
  PenLine,
  Users,
  Shield,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  Lock,
  Hourglass,
  Plane
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BiweeklyTimecardDoc {
  id: string;
  employeeId: string;
  employeeName: string;
  periodStart: string;
  periodEnd: string;
  employeeSigned: boolean;
  employeeSignatureName: string | null;
  employeeSignedAt: any | null;
  adminSigned: boolean;
  adminSignatureName: string | null;
  adminSignedAt: any | null;
  adminSignedById: string | null;
  createdAt: any;
  updatedAt: any;
}

interface Period {
  index: number;
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

interface Props {
  mode: 'employee' | 'admin';
  currentUser: UserProfile;
  allEntries: TimeEntry[];
  registeredEmployees?: { uid: string; name: string; email: string }[];
}

// ─── Period helpers ───────────────────────────────────────────────────────────

const EPOCH = new Date('2024-01-01T00:00:00');
const PERIODS_SHOWN = 8;

function buildPeriods(): Period[] {
  const today = new Date();
  const diffDays = Math.floor((today.getTime() - EPOCH.getTime()) / 86400000);
  const currentIdx = Math.floor(diffDays / 14);
  return Array.from({ length: PERIODS_SHOWN }, (_, i) => {
    const idx = currentIdx - i;
    const start = new Date(EPOCH);
    start.setDate(EPOCH.getDate() + idx * 14);
    const end = new Date(start);
    end.setDate(start.getDate() + 13);
    return {
      index: idx,
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
    };
  });
}

function fmtDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function fmtDay(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function fmtTs(ts: any): string {
  if (!ts) return '';
  const ms = ts?.seconds ? ts.seconds * 1000 : Number(ts);
  return new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fmtTime(ts: any): string {
  if (!ts) return '—';
  const ms = ts?.seconds ? ts.seconds * 1000 : Number(ts);
  return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function getEntryTotals(entry: TimeEntry) {
  const rawIn = entry.clockInTime?.seconds
    ? entry.clockInTime.seconds * 1000
    : (entry.clockInTime || Date.now());
  const rawOut = entry.clockOutTime?.seconds
    ? entry.clockOutTime.seconds * 1000
    : (entry.clockOutTime || Date.now());
  const diffMins = Math.max(0, Math.floor((rawOut - rawIn) / 60000));
  const lunch = entry.lunchDuration || 0;
  const workMins = Math.max(0, diffMins - lunch);
  const travelMins = (entry.travelTimeIn || 0) + (entry.travelTimeOut || 0);
  const totalHours = workMins / 60;
  const toff = entry.jobId === 'time_off_pto' || entry.jobId === 'time_off_unpaid';
  // Daily OT: work entries >8h/day; time-off entries never generate OT
  const worked = toff ? totalHours : Math.min(totalHours, 8);
  const ot     = toff ? 0 : Math.max(0, totalHours - 8);
  return { worked, ot, travel: travelMins, lunch };
}

function isTimeOffEntry(entry: TimeEntry) {
  return entry.jobId === 'time_off_pto' || entry.jobId === 'time_off_unpaid';
}

// ─── Holiday helpers ──────────────────────────────────────────────────────────

interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

function getNthWeekday(year: number, month: number, n: number, weekday: number): Date {
  // month: 1-12, weekday: 0=Sun…6=Sat, n: 1-based
  const d = new Date(year, month - 1, 1);
  const dayOffset = (weekday - d.getDay() + 7) % 7;
  d.setDate(1 + dayOffset + (n - 1) * 7);
  return d;
}

function getLastWeekday(year: number, month: number, weekday: number): Date {
  const d = new Date(year, month, 0); // last day of month
  const diff = (d.getDay() - weekday + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

function observedDate(d: Date): Date {
  const day = d.getDay();
  const obs = new Date(d);
  if (day === 6) obs.setDate(d.getDate() - 1); // Sat → Fri
  else if (day === 0) obs.setDate(d.getDate() + 1); // Sun → Mon
  return obs;
}

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getHolidaysForYear(year: number): Holiday[] {
  const add = (d: Date, name: string): Holiday => ({ date: toYMD(observedDate(d)), name });
  return [
    add(new Date(year, 0, 1),                        "New Year's Day"),
    add(getNthWeekday(year, 1, 3, 1),                "Martin Luther King Jr. Day"),
    add(getNthWeekday(year, 2, 3, 1),                "Presidents' Day"),
    add(getLastWeekday(year, 5, 1),                  "Memorial Day"),
    add(new Date(year, 5, 19),                       "Juneteenth"),
    add(new Date(year, 6, 4),                        "Independence Day"),
    add(getNthWeekday(year, 9, 1, 1),                "Labor Day"),
    add(getNthWeekday(year, 10, 2, 1),               "Columbus Day"),
    add(new Date(year, 10, 11),                      "Veterans Day"),
    add(getNthWeekday(year, 11, 4, 4),               "Thanksgiving Day"),
    add(new Date(year, 11, 25),                      "Christmas Day"),
  ];
}

function getHolidaysInPeriod(start: string, end: string): Holiday[] {
  const startYear = parseInt(start.slice(0, 4));
  const endYear = parseInt(end.slice(0, 4));
  const all: Holiday[] = [];
  for (let y = startYear; y <= endYear; y++) all.push(...getHolidaysForYear(y));
  return all.filter(h => h.date >= start && h.date <= end);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BiweeklyTimecardPanel({
  mode,
  currentUser,
  allEntries,
  registeredEmployees,
}: Props) {
  const periods = buildPeriods();
  const [periodIdx, setPeriodIdx] = useState(0);
  const [selectedEmpId, setSelectedEmpId] = useState('');
  const [timecardDoc, setTimecardDoc] = useState<BiweeklyTimecardDoc | null>(null);
  const [signName, setSignName] = useState('');
  const [signing, setSigning] = useState(false);

  const period = periods[periodIdx];

  // Admin: default to first registered employee
  useEffect(() => {
    if (mode === 'admin' && registeredEmployees?.length && !selectedEmpId) {
      setSelectedEmpId(registeredEmployees[0].uid);
    }
  }, [registeredEmployees, mode]);

  const targetId = mode === 'employee' ? currentUser.uid : selectedEmpId;
  const targetName =
    mode === 'employee'
      ? currentUser.name
      : (registeredEmployees?.find(e => e.uid === selectedEmpId)?.name ?? '—');

  // Live-subscribe to this employee's timecard doc for the selected period
  useEffect(() => {
    if (!targetId) return;
    const docId = `${targetId}_${period.start}`;
    const unsub = onSnapshot(
      doc(db, 'timecards', docId),
      snap => setTimecardDoc(snap.exists() ? ({ id: snap.id, ...snap.data() } as BiweeklyTimecardDoc) : null),
      () => setTimecardDoc(null),
    );
    return () => unsub();
  }, [targetId, period.start]);

  // Filter + sort entries for this period & employee
  const periodEntries = allEntries
    .filter(
      e =>
        e.userId === targetId &&
        e.date >= period.start &&
        e.date <= period.end &&
        e.status !== 'active',
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const totals = periodEntries.reduce(
    (acc, e) => {
      const t = getEntryTotals(e);
      const toff = isTimeOffEntry(e);
      return {
        worked:  acc.worked  + (toff ? 0 : t.worked),
        ot:      acc.ot      + (toff ? 0 : t.ot),
        travel:  acc.travel  + (toff ? 0 : t.travel),
        pto:     acc.pto     + (e.jobId === 'time_off_pto'    ? t.worked : 0),
        unpaid:  acc.unpaid  + (e.jobId === 'time_off_unpaid' ? t.worked : 0),
      };
    },
    { worked: 0, ot: 0, travel: 0, pto: 0, unpaid: 0 },
  );

  const holidaysInPeriod = getHolidaysInPeriod(period.start, period.end);
  const holidayHours = holidaysInPeriod.length * 8;
  const grandTotal = totals.worked + totals.ot + (totals.travel / 60) + totals.pto;

  type TableRow = { type: 'entry'; entry: typeof periodEntries[0] } | { type: 'holiday'; date: string; name: string };
  const tableRows: TableRow[] = [
    ...periodEntries.map(e => ({ type: 'entry' as const, entry: e })),
    ...holidaysInPeriod.map(h => ({ type: 'holiday' as const, date: h.date, name: h.name })),
  ].sort((a, b) => {
    const da = a.type === 'entry' ? a.entry.date : a.date;
    const db = b.type === 'entry' ? b.entry.date : b.date;
    return da.localeCompare(db);
  });

  const today = new Date().toISOString().split('T')[0];
  const canSign = today >= period.end;

  // ── Employee signs their timecard ──────────────────────────────────────────
  const handleEmployeeSign = async () => {
    if (!signName.trim()) return;
    setSigning(true);
    try {
      const docId = `${currentUser.uid}_${period.start}`;
      await setDoc(doc(db, 'timecards', docId), {
        id: docId,
        employeeId: currentUser.uid,
        employeeName: currentUser.name,
        periodStart: period.start,
        periodEnd: period.end,
        employeeSigned: true,
        employeeSignatureName: signName.trim(),
        employeeSignedAt: new Date(),
        adminSigned: false,
        adminSignatureName: null,
        adminSignedAt: null,
        adminSignedById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      setSignName('');
    } catch {
      alert('Signature failed. Please try again.');
    }
    setSigning(false);
  };

  // ── Admin countersigns ─────────────────────────────────────────────────────
  const handleAdminSign = async () => {
    if (!signName.trim() || !timecardDoc) return;
    setSigning(true);
    try {
      await updateDoc(doc(db, 'timecards', timecardDoc.id), {
        adminSigned: true,
        adminSignatureName: signName.trim(),
        adminSignedAt: new Date(),
        adminSignedById: currentUser.uid,
        updatedAt: new Date(),
      });
      setSignName('');
    } catch {
      alert('Admin signature failed. Please try again.');
    }
    setSigning(false);
  };

  // ── Signature section renderer ─────────────────────────────────────────────
  const renderSignatureSection = () => {
    // Fully approved
    if (timecardDoc?.employeeSigned && timecardDoc?.adminSigned) {
      return (
        <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-green-600" />
            <h3 className="text-sm font-black text-green-700 uppercase tracking-wide">Timecard Fully Approved</h3>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-3 bg-white border border-green-200 rounded-xl px-4 py-2.5 text-xs">
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
              <div>
                <span className="font-bold text-gray-700">Employee: </span>
                <span className="font-mono text-gray-600 italic">{timecardDoc.employeeSignatureName}</span>
                <span className="text-gray-400 ml-2">{fmtTs(timecardDoc.employeeSignedAt)}</span>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-white border border-green-200 rounded-xl px-4 py-2.5 text-xs">
              <Shield className="w-4 h-4 text-green-600 shrink-0" />
              <div>
                <span className="font-bold text-gray-700">Manager: </span>
                <span className="font-mono text-gray-600 italic">{timecardDoc.adminSignatureName}</span>
                <span className="text-gray-400 ml-2">{fmtTs(timecardDoc.adminSignedAt)}</span>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Employee mode
    if (mode === 'employee') {
      if (timecardDoc?.employeeSigned) {
        return (
          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-orange-600" />
              <h3 className="text-sm font-bold text-orange-700">Your Signature Submitted</h3>
            </div>
            <p className="text-xs text-orange-600">
              Signed as <span className="font-mono font-bold">{timecardDoc.employeeSignatureName}</span> on {fmtTs(timecardDoc.employeeSignedAt)}.
            </p>
            <p className="text-xs text-gray-500 flex items-center gap-1.5 mt-1">
              <Hourglass className="w-3.5 h-3.5 text-amber-500" />
              Awaiting manager countersignature...
            </p>
          </div>
        );
      }

      if (!canSign) {
        return (
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 flex items-start gap-3">
            <Lock className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-gray-600">Signing opens at end of period</p>
              <p className="text-xs text-gray-400 mt-0.5">
                This pay period ends <span className="font-semibold text-gray-600">{fmtDate(period.end)}</span>. You can sign off on or after that date.
              </p>
            </div>
          </div>
        );
      }

      if (periodEntries.length === 0) {
        return (
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
            <p className="text-sm text-gray-500">No completed time entries exist for this period — nothing to sign off on.</p>
          </div>
        );
      }

      // Ready to sign
      return (
        <div className="bg-white border-2 border-orange-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <PenLine className="w-5 h-5 text-orange-600" />
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-wide">Employee Sign-off</h3>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            By typing your full name below, you certify that the hours recorded in this pay period
            ({fmtDate(period.start)} – {fmtDate(period.end)}) are accurate and complete to the best of your knowledge.
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1.5">
                Full Name (as signature)
              </label>
              <input
                type="text"
                value={signName}
                onChange={e => setSignName(e.target.value)}
                placeholder="Type your full legal name..."
                className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-orange-500 font-medium placeholder-gray-400"
                style={{ fontFamily: 'Georgia, serif' }}
              />
            </div>
            <button
              type="button"
              onClick={handleEmployeeSign}
              disabled={!signName.trim() || signing}
              className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2 cursor-pointer active:translate-y-px transition-all shadow-sm"
            >
              <PenLine className="w-4 h-4" />
              {signing ? 'Submitting...' : 'Sign & Confirm Timecard'}
            </button>
          </div>
        </div>
      );
    }

    // Admin mode
    if (mode === 'admin') {
      if (!selectedEmpId) {
        return (
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 text-center text-gray-400 text-sm">
            Select an employee above to view their timecard.
          </div>
        );
      }

      if (!timecardDoc?.employeeSigned) {
        return (
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 flex items-start gap-3">
            <Hourglass className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-gray-600">Awaiting Employee Signature</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {targetName} has not yet signed off on this pay period.
                {!canSign && ` Signing opens ${fmtDate(period.end)}.`}
              </p>
            </div>
          </div>
        );
      }

      // Employee signed — admin can countersign
      return (
        <div className="bg-white border-2 border-green-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-green-600" />
            <h3 className="text-sm font-black text-gray-800 uppercase tracking-wide">Manager Countersignature</h3>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
            <span>
              <span className="font-bold text-gray-700">{targetName}</span> signed as{' '}
              <span className="font-mono italic text-gray-600">{timecardDoc.employeeSignatureName}</span>{' '}
              on {fmtTs(timecardDoc.employeeSignedAt)}.
            </span>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            Add your manager signature to finalize and approve this timecard for payroll processing.
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1.5">
                Manager Full Name (as signature)
              </label>
              <input
                type="text"
                value={signName}
                onChange={e => setSignName(e.target.value)}
                placeholder="Type your full name..."
                className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-green-500 font-medium placeholder-gray-400"
                style={{ fontFamily: 'Georgia, serif' }}
              />
            </div>
            <button
              type="button"
              onClick={handleAdminSign}
              disabled={!signName.trim() || signing}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2 cursor-pointer active:translate-y-px transition-all shadow-sm"
            >
              <ClipboardCheck className="w-4 h-4" />
              {signing ? 'Submitting...' : 'Approve & Sign Timecard'}
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Controls row: period nav + admin employee selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">

        {/* Admin employee picker */}
        {mode === 'admin' && registeredEmployees && (
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-4 h-4 text-gray-400 shrink-0" />
            <select
              value={selectedEmpId}
              onChange={e => setSelectedEmpId(e.target.value)}
              className="bg-white border border-gray-300 text-sm px-3 py-2 rounded-xl text-gray-900 focus:outline-none focus:border-orange-500 font-medium min-w-[200px]"
            >
              {registeredEmployees.map(emp => (
                <option key={emp.uid} value={emp.uid}>{emp.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Period navigator */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            onClick={() => setPeriodIdx(i => Math.min(i + 1, PERIODS_SHOWN - 1))}
            disabled={periodIdx >= PERIODS_SHOWN - 1}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-30 cursor-pointer transition-all"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2 shadow-sm">
            <Calendar className="w-4 h-4 text-orange-500 shrink-0" />
            <span className="text-sm font-bold text-gray-800 whitespace-nowrap">
              {fmtDate(period.start)} – {fmtDate(period.end)}
            </span>
            {periodIdx === 0 && (
              <span className="text-[10px] bg-orange-100 text-orange-700 font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                Current
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setPeriodIdx(i => Math.max(i - 1, 0))}
            disabled={periodIdx === 0}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-30 cursor-pointer transition-all"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Payroll summary row — admin mode (Name | Regular | OT | Holiday | PTO | Unpaid) */}
      {mode === 'admin' && targetName !== '—' && periodEntries.length > 0 && (
        <div className="bg-slate-800 rounded-2xl px-5 py-4 shadow-sm">
          <div className="text-[9px] uppercase font-bold tracking-widest text-slate-400 mb-3">Payroll Summary — {fmtDate(period.start)} – {fmtDate(period.end)}</div>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-center">
            <div>
              <div className="text-[9px] uppercase text-slate-400 font-bold tracking-wide mb-0.5">Employee</div>
              <div className="text-sm font-black text-white truncate">{targetName}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase text-orange-400 font-bold tracking-wide mb-0.5">Regular</div>
              <div className="text-xl font-black text-orange-300 font-mono">{totals.worked.toFixed(2)}<span className="text-xs ml-0.5">h</span></div>
            </div>
            <div>
              <div className="text-[9px] uppercase text-orange-400 font-bold tracking-wide mb-0.5">Overtime</div>
              <div className={`text-xl font-black font-mono ${totals.ot > 0 ? 'text-orange-300' : 'text-slate-600'}`}>{totals.ot.toFixed(2)}<span className="text-xs ml-0.5">h</span></div>
            </div>
            <div>
              <div className="text-[9px] uppercase text-amber-400 font-bold tracking-wide mb-0.5">Holiday</div>
              <div className={`text-xl font-black font-mono ${holidayHours > 0 ? 'text-amber-300' : 'text-slate-600'}`}>{holidayHours.toFixed(2)}<span className="text-xs ml-0.5">h</span></div>
            </div>
            <div>
              <div className="text-[9px] uppercase text-green-400 font-bold tracking-wide mb-0.5">PTO</div>
              <div className={`text-xl font-black font-mono ${totals.pto > 0 ? 'text-green-300' : 'text-slate-600'}`}>{totals.pto.toFixed(2)}<span className="text-xs ml-0.5">h</span></div>
            </div>
            <div>
              <div className="text-[9px] uppercase text-slate-400 font-bold tracking-wide mb-0.5">Unpaid</div>
              <div className={`text-xl font-black font-mono ${totals.unpaid > 0 ? 'text-slate-300' : 'text-slate-600'}`}>{totals.unpaid.toFixed(2)}<span className="text-xs ml-0.5">h</span></div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-700 text-[10px] text-slate-500 font-mono">
            Reg + OT = {(totals.worked + totals.ot).toFixed(2)}h &nbsp;|&nbsp; Travel = {totals.travel}m ({(totals.travel/60).toFixed(2)}h) &nbsp;|&nbsp; On-site = {Math.max(0, totals.worked + totals.ot - totals.travel/60).toFixed(2)}h
          </div>
        </div>
      )}

      {/* Summary stat bar — Regular, OT, Travel, PTO, Non-paid, Total */}
      {periodEntries.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          <div className="bg-white border border-gray-200 rounded-xl p-3 text-center shadow-sm">
            <div className="text-[9px] uppercase font-bold tracking-wider text-gray-400 mb-1">Regular</div>
            <div className="text-xl font-black text-orange-600 font-mono">{totals.worked.toFixed(2)}</div>
            <div className="text-[9px] text-gray-400 mt-0.5">hrs</div>
          </div>
          <div className={`rounded-xl p-3 text-center shadow-sm border ${totals.ot > 0 ? 'bg-orange-50 border-orange-200' : 'bg-white border-gray-200'}`}>
            <div className={`text-[9px] uppercase font-bold tracking-wider mb-1 ${totals.ot > 0 ? 'text-orange-500' : 'text-gray-400'}`}>OT</div>
            <div className={`text-xl font-black font-mono ${totals.ot > 0 ? 'text-orange-600' : 'text-gray-300'}`}>{totals.ot.toFixed(2)}</div>
            <div className="text-[9px] text-gray-400 mt-0.5">hrs</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-3 text-center shadow-sm">
            <div className="text-[9px] uppercase font-bold tracking-wider text-gray-400 mb-1">Travel</div>
            <div className="text-xl font-black text-gray-700 font-mono">{totals.travel}</div>
            <div className="text-[9px] text-gray-400 mt-0.5">mins</div>
          </div>
          <div className={`rounded-xl p-3 text-center shadow-sm border ${totals.pto > 0 ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
            <div className={`text-[9px] uppercase font-bold tracking-wider mb-1 flex items-center justify-center gap-0.5 ${totals.pto > 0 ? 'text-green-500' : 'text-gray-400'}`}>
              <Plane className="w-2.5 h-2.5" />PTO
            </div>
            <div className={`text-xl font-black font-mono ${totals.pto > 0 ? 'text-green-600' : 'text-gray-300'}`}>{totals.pto.toFixed(2)}</div>
            <div className="text-[9px] text-gray-400 mt-0.5">hrs</div>
          </div>
          <div className={`rounded-xl p-3 text-center shadow-sm border ${totals.unpaid > 0 ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200'}`}>
            <div className="text-[9px] uppercase font-bold tracking-wider text-gray-400 mb-1">Unpaid</div>
            <div className={`text-xl font-black font-mono ${totals.unpaid > 0 ? 'text-gray-600' : 'text-gray-300'}`}>{totals.unpaid.toFixed(2)}</div>
            <div className="text-[9px] text-gray-400 mt-0.5">hrs</div>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-center shadow-sm">
            <div className="text-[9px] uppercase font-bold tracking-wider text-orange-500 mb-1">Total</div>
            <div className="text-xl font-black text-orange-700 font-mono">{grandTotal.toFixed(2)}</div>
            <div className="text-[9px] text-orange-400 mt-0.5">hrs</div>
          </div>
        </div>
      )}

      {/* Timecard table */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-4 h-4 text-orange-500" />
            {mode === 'admin' ? `${targetName} — ` : ''}Pay Period Entries
          </h3>
          <span className="text-[11px] bg-gray-100 text-gray-500 font-bold px-2.5 py-1 rounded-full">
            {periodEntries.length} {periodEntries.length === 1 ? 'entry' : 'entries'}
            {holidaysInPeriod.length > 0 && ` · ${holidaysInPeriod.length} holiday${holidaysInPeriod.length > 1 ? 's' : ''}`}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-xs">
            <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider font-semibold">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Job Site</th>
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-center">In</th>
                <th className="px-4 py-3 text-center">Out</th>
                <th className="px-4 py-3 text-right">Regular</th>
                <th className="px-4 py-3 text-right">OT</th>
                <th className="px-4 py-3 text-right">Travel</th>
                <th className="px-4 py-3 text-right">PTO</th>
                <th className="px-4 py-3 text-right">Non-paid</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {tableRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-gray-400 italic">
                    No completed entries recorded for this pay period.
                  </td>
                </tr>
              ) : (
                tableRows.map((row, idx) => {
                  // ── Holiday row ──────────────────────────────────────────
                  if (row.type === 'holiday') {
                    return (
                      <tr key={`holiday-${row.date}`} className="bg-amber-50/60 hover:bg-amber-50 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap font-medium text-amber-800">
                          {fmtDay(row.date)}
                        </td>
                        <td className="px-4 py-3 text-amber-700 font-medium" colSpan={4}>
                          <span className="flex items-center gap-1.5">
                            <span className="text-lg leading-none">🎉</span>
                            {row.name}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono">—</td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono">—</td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono">—</td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono">—</td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono">—</td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono">—</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-amber-100 border border-amber-300 text-amber-800 px-2 py-0.5 rounded-full">
                            Holiday
                          </span>
                        </td>
                      </tr>
                    );
                  }

                  // ── Time entry row ────────────────────────────────────────
                  const entry = row.entry;
                  const t = getEntryTotals(entry);
                  const toff = isTimeOffEntry(entry);
                  const isPTO = entry.jobId === 'time_off_pto';
                  const rowTotal = toff
                    ? t.worked
                    : t.worked + (t.travel / 60);
                  return (
                    <tr key={entry.id} className={`hover:bg-gray-50 transition-colors ${toff ? (isPTO ? 'bg-green-50/40' : 'bg-gray-50/60') : ''}`}>
                      <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-700">
                        {fmtDay(entry.date)}
                      </td>
                      <td className="px-4 py-3 text-gray-700 max-w-[160px] truncate" title={entry.jobName}>
                        {toff ? (
                          <span className="flex items-center gap-1.5">
                            <Plane className="w-3.5 h-3.5 shrink-0 text-orange-500" />
                            {entry.jobName}
                          </span>
                        ) : entry.jobName}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-500 whitespace-nowrap">
                        {toff ? '—' : entry.costCode.split(' ')[0]}
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-gray-500 whitespace-nowrap">
                        {toff ? '—' : fmtTime(entry.clockInTime)}
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-gray-500 whitespace-nowrap">
                        {toff ? '—' : fmtTime(entry.clockOutTime)}
                      </td>
                      {/* Regular */}
                      <td className="px-4 py-3 text-right font-mono font-bold whitespace-nowrap">
                        {toff ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          <span className="text-orange-600">{t.worked.toFixed(2)}h</span>
                        )}
                      </td>
                      {/* OT */}
                      <td className="px-4 py-3 text-right font-mono font-bold whitespace-nowrap">
                        {toff || t.ot === 0 ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          <span className="text-orange-600">{t.ot.toFixed(2)}h</span>
                        )}
                      </td>
                      {/* Travel */}
                      <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                        {toff || t.travel === 0 ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          <span className="text-gray-600">{t.travel}m</span>
                        )}
                      </td>
                      {/* PTO */}
                      <td className="px-4 py-3 text-right font-mono font-bold whitespace-nowrap">
                        {isPTO ? (
                          <span className="text-green-600">{t.worked.toFixed(2)}h</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      {/* Non-paid */}
                      <td className="px-4 py-3 text-right font-mono font-bold whitespace-nowrap">
                        {entry.jobId === 'time_off_unpaid' ? (
                          <span className="text-gray-500">{t.worked.toFixed(2)}h</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      {/* Total */}
                      <td className="px-4 py-3 text-right font-mono font-bold whitespace-nowrap">
                        {entry.jobId === 'time_off_unpaid' ? (
                          <span className="text-gray-400">{t.worked.toFixed(2)}h</span>
                        ) : (
                          <span className="text-gray-800">{rowTotal.toFixed(2)}h</span>
                        )}
                      </td>
                      {/* Status */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {toff ? (
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                            isPTO
                              ? 'bg-green-100 border-green-200 text-green-700'
                              : 'bg-gray-100 border-gray-200 text-gray-600'
                          }`}>
                            <Plane className="w-2.5 h-2.5" />
                            {isPTO ? 'PTO' : 'Unpaid'}
                          </span>
                        ) : entry.isApproved ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-green-50 border border-green-200 text-green-700 px-2 py-0.5 rounded-full">
                            ✓ Approved
                          </span>
                        ) : entry.isManualEdit ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 rounded-full">
                            Pending
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 rounded-full">
                            Review
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {periodEntries.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-200 text-xs">
                  <td className="px-4 py-3 font-black text-gray-700 uppercase tracking-wide text-[10px]" colSpan={5}>
                    Period Totals
                  </td>
                  <td className="px-4 py-3 text-right font-black text-orange-700 font-mono whitespace-nowrap">
                    {totals.worked.toFixed(2)}h
                  </td>
                  <td className={`px-4 py-3 text-right font-black font-mono whitespace-nowrap ${totals.ot > 0 ? 'text-orange-600' : 'text-gray-300'}`}>
                    {totals.ot > 0 ? `${totals.ot.toFixed(2)}h` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-black text-gray-600 font-mono whitespace-nowrap">
                    {totals.travel > 0 ? `${totals.travel}m` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-black text-green-700 font-mono whitespace-nowrap">
                    {totals.pto > 0 ? `${totals.pto.toFixed(2)}h` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-black text-gray-500 font-mono whitespace-nowrap">
                    {totals.unpaid > 0 ? `${totals.unpaid.toFixed(2)}h` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-black text-gray-800 font-mono whitespace-nowrap">
                    {grandTotal.toFixed(2)}h
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Signature section */}
      {renderSignatureSection()}

    </div>
  );
}
