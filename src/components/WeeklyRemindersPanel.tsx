import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { TimeOffRequest } from '../types';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  Calendar,
  Bell,
  Star,
  Clock,
  FileText,
  Plane
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Reminder {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  type: 'holiday' | 'appointment' | 'note';
  createdAt: any;
}

interface Props {
  timeOffRequests: TimeOffRequest[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWeekMonday(from: Date): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const TYPE_CONFIG = {
  holiday: {
    label: 'Holiday',
    chip: 'bg-red-50 text-red-700 border-red-200',
    dot: 'bg-red-400',
    Icon: Star,
  },
  appointment: {
    label: 'Appointment',
    chip: 'bg-blue-50 text-blue-700 border-blue-200',
    dot: 'bg-blue-400',
    Icon: Clock,
  },
  note: {
    label: 'Note',
    chip: 'bg-amber-50 text-amber-700 border-amber-200',
    dot: 'bg-amber-400',
    Icon: FileText,
  },
} as const;

// ─── Component ────────────────────────────────────────────────────────────────

export default function WeeklyRemindersPanel({ timeOffRequests }: Props) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState(toDateStr(new Date()));
  const [newType, setNewType] = useState<'holiday' | 'appointment' | 'note'>('appointment');
  const [adding, setAdding] = useState(false);

  const today = toDateStr(new Date());

  // Compute this week's Monday, offset by weekOffset
  const monday = (() => {
    const base = getWeekMonday(new Date());
    const d = new Date(base);
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  })();

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return toDateStr(d);
  });

  // Subscribe to reminders collection
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'reminders'),
      (snap) => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Reminder));
        data.sort((a, b) => a.date.localeCompare(b.date));
        setReminders(data);
      },
      () => {},
    );
    return () => unsub();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDate) return;
    setAdding(true);
    try {
      await addDoc(collection(db, 'reminders'), {
        title: newTitle.trim(),
        date: newDate,
        type: newType,
        createdAt: new Date(),
      });
      setNewTitle('');
      setShowForm(false);
    } catch {
      alert('Failed to add reminder.');
    }
    setAdding(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'reminders', id));
    } catch {
      alert('Failed to delete reminder.');
    }
  };

  const approvedTimeOff = timeOffRequests.filter(r => r.status === 'approved');

  const getTimeOffForDate = (dateStr: string) =>
    approvedTimeOff.filter(r => dateStr >= r.startDate && dateStr <= r.endDate);

  const getRemindersForDate = (dateStr: string) =>
    reminders.filter(r => r.date === dateStr);

  const fmtWeekLabel = () => {
    const s = new Date(weekDates[0] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const e = new Date(weekDates[6] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${s} – ${e}`;
  };

  // Total items across the week for the empty state
  const weekTotal = weekDates.reduce(
    (sum, d) => sum + getTimeOffForDate(d).length + getRemindersForDate(d).length,
    0,
  );

  return (
    <div className="space-y-5">

      {/* Controls row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">

        {/* Week navigator */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekOffset(o => o - 1)}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 cursor-pointer transition-all"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2 shadow-sm">
            <Calendar className="w-4 h-4 text-blue-500 shrink-0" />
            <span className="text-sm font-bold text-gray-800 whitespace-nowrap">{fmtWeekLabel()}</span>
            {weekOffset === 0 && (
              <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                This Week
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setWeekOffset(o => o + 1)}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 cursor-pointer transition-all"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {weekOffset !== 0 && (
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className="text-xs text-blue-600 hover:text-blue-700 font-semibold cursor-pointer underline-offset-2 hover:underline"
            >
              Today
            </button>
          )}
        </div>

        {/* Add reminder button */}
        <button
          type="button"
          onClick={() => {
            setShowForm(v => !v);
            if (!showForm) setNewDate(today);
          }}
          className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-sm active:translate-y-px transition-all cursor-pointer"
        >
          {showForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showForm ? 'Cancel' : 'Add Reminder'}
        </button>
      </div>

      {/* Add reminder form */}
      {showForm && (
        <form
          onSubmit={handleAdd}
          className="bg-white border-2 border-slate-200 rounded-2xl p-5 shadow-sm space-y-4"
        >
          <h3 className="text-sm font-black text-gray-800 uppercase tracking-wide flex items-center gap-2">
            <Bell className="w-4 h-4 text-slate-600" />
            New Reminder
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1.5">
                Title / Description
              </label>
              <input
                type="text"
                required
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="e.g. Memorial Day, Safety meeting at 9am..."
                className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-slate-500 placeholder-gray-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1.5">
                Date
              </label>
              <input
                type="date"
                required
                value={newDate}
                onChange={e => setNewDate(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-slate-500 font-mono"
              />
            </div>
          </div>

          {/* Type selector + submit */}
          <div className="flex flex-wrap items-center gap-2">
            {(['holiday', 'appointment', 'note'] as const).map(t => {
              const cfg = TYPE_CONFIG[t];
              const Icon = cfg.Icon;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setNewType(t)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                    newType === t ? cfg.chip + ' shadow-sm' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {cfg.label}
                </button>
              );
            })}

            <button
              type="submit"
              disabled={!newTitle.trim() || !newDate || adding}
              className="ml-auto bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white font-bold px-5 py-1.5 rounded-lg text-xs cursor-pointer active:translate-y-px transition-all"
            >
              {adding ? 'Adding...' : 'Add'}
            </button>
          </div>
        </form>
      )}

      {/* Week grid */}
      <div className="overflow-x-auto">
        <div className="grid grid-cols-7 gap-2 min-w-[700px]">
          {weekDates.map((dateStr, i) => {
            const dayNum = new Date(dateStr + 'T12:00:00').getDate();
            const monthShort = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' });
            const timeOffs = getTimeOffForDate(dateStr);
            const dayReminders = getRemindersForDate(dateStr);
            const isToday = dateStr === today;
            const isWeekend = i >= 5;

            return (
              <div
                key={dateStr}
                className={`rounded-xl border p-3 min-h-[160px] flex flex-col transition-colors ${
                  isToday
                    ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
                    : isWeekend
                      ? 'bg-gray-50 border-gray-200'
                      : 'bg-white border-gray-200'
                }`}
              >
                {/* Day header */}
                <div className="mb-2.5 pb-2 border-b border-gray-100">
                  <div className={`text-[10px] font-bold uppercase tracking-wider ${isToday ? 'text-blue-600' : 'text-gray-400'}`}>
                    {DAY_SHORT[i]}
                  </div>
                  <div className={`text-xl font-black leading-none mt-0.5 ${isToday ? 'text-blue-700' : isWeekend ? 'text-gray-400' : 'text-gray-800'}`}>
                    {dayNum}
                    {i === 0 || dayNum === 1 ? (
                      <span className={`text-[10px] font-medium ml-1 ${isWeekend ? 'text-gray-400' : 'text-gray-400'}`}>{monthShort}</span>
                    ) : null}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 space-y-1 min-w-0">
                  {/* Time off entries */}
                  {timeOffs.map(r => (
                    <div
                      key={r.id}
                      className="flex items-center gap-1 bg-green-100 border border-green-200 text-green-700 rounded-md px-1.5 py-1 min-w-0"
                      title={`${r.employeeName} — ${r.type === 'pto' ? 'Paid Time Off' : 'Unpaid'}`}
                    >
                      <Plane className="w-2.5 h-2.5 shrink-0" />
                      <span className="text-[10px] font-bold truncate">{r.employeeName.split(' ')[0]}</span>
                      <span className={`text-[9px] ml-auto shrink-0 font-bold ${r.type === 'pto' ? 'text-green-600' : 'text-gray-500'}`}>
                        {r.type === 'pto' ? 'PTO' : 'UPT'}
                      </span>
                    </div>
                  ))}

                  {/* Admin reminders */}
                  {dayReminders.map(r => {
                    const cfg = TYPE_CONFIG[r.type];
                    const Icon = cfg.Icon;
                    return (
                      <div
                        key={r.id}
                        className={`flex items-start justify-between gap-1 rounded-md px-1.5 py-1 border group min-w-0 ${cfg.chip}`}
                        title={r.title}
                      >
                        <div className="flex items-start gap-1 min-w-0 flex-1">
                          <Icon className="w-2.5 h-2.5 shrink-0 mt-0.5" />
                          <span className="text-[10px] font-semibold truncate leading-tight">{r.title}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDelete(r.id)}
                          className="opacity-0 group-hover:opacity-100 text-current hover:text-red-500 cursor-pointer shrink-0 transition-opacity"
                          title="Delete reminder"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    );
                  })}

                  {/* Empty state */}
                  {timeOffs.length === 0 && dayReminders.length === 0 && (
                    <div className="text-[9px] text-gray-300 text-center pt-3 select-none">—</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap text-[10px] text-gray-400 border-t border-gray-100 pt-3">
        <span className="font-bold text-gray-500 uppercase tracking-wide text-[10px]">Legend:</span>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-green-200 border border-green-300" />
          Employee Time Off
        </div>
        {(Object.entries(TYPE_CONFIG) as [string, typeof TYPE_CONFIG[keyof typeof TYPE_CONFIG]][]).map(([key, cfg]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm border ${cfg.chip}`} />
            {cfg.label}
          </div>
        ))}
        <span className="text-[9px] text-gray-300 ml-auto italic">Hover reminders to delete</span>
      </div>

      {/* Upcoming reminders list (next 30 days beyond the displayed week) */}
      {(() => {
        const futureReminders = reminders.filter(r => r.date > weekDates[6]).slice(0, 5);
        if (futureReminders.length === 0) return null;
        return (
          <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-2 shadow-sm">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-3">Upcoming Reminders</h3>
            {futureReminders.map(r => {
              const cfg = TYPE_CONFIG[r.type];
              const Icon = cfg.Icon;
              const fmtDate = new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
              });
              return (
                <div key={r.id} className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 border text-xs ${cfg.chip}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-semibold truncate">{r.title}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-[10px]">{fmtDate}</span>
                    <button
                      type="button"
                      onClick={() => handleDelete(r.id)}
                      className="text-current hover:text-red-500 cursor-pointer transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

    </div>
  );
}
