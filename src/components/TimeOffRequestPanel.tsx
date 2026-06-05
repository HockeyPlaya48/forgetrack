import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, TimeOffRequest } from '../types';
import {
  Calendar,
  CheckCircle2,
  XCircle,
  Hourglass,
  Plus,
  ChevronDown,
  ChevronUp,
  Plane,
  AlertCircle,
  Clock
} from 'lucide-react';

interface Props {
  user: UserProfile;
}

function fmtDateRange(start: string, end: string) {
  const s = new Date(start + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const e = new Date(end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return start === end ? e : `${s} – ${e}`;
}

function countDays(start: string, end: string) {
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
}

function fmtTs(ts: any): string {
  if (!ts) return '';
  const ms = ts?.seconds ? ts.seconds * 1000 : Number(ts);
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TimeOffRequestPanel({ user }: Props) {
  const [requests, setRequests] = useState<TimeOffRequest[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [type, setType] = useState<'pto' | 'unpaid'>('pto');
  const [reason, setReason] = useState('');
  const [hoursPerDay, setHoursPerDay] = useState(8);
  const [submitting, setSubmitting] = useState(false);

  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    const q = query(collection(db, 'time_off_requests'), where('employeeId', '==', user.uid));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as TimeOffRequest));
      data.sort((a, b) => {
        const tA = a.createdAt?.seconds ?? 0;
        const tB = b.createdAt?.seconds ?? 0;
        return tB - tA;
      });
      setRequests(data);
    }, () => {});
    return () => unsub();
  }, [user.uid]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate || !reason.trim()) return;
    if (endDate < startDate) {
      alert('End date must be on or after start date.');
      return;
    }
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'time_off_requests'), {
        employeeId: user.uid,
        employeeName: user.name,
        startDate,
        endDate,
        type,
        reason: reason.trim(),
        hoursPerDay,
        status: 'pending',
        adminNotes: null,
        reviewedById: null,
        reviewedByName: null,
        reviewedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      setShowForm(false);
      setStartDate('');
      setEndDate('');
      setReason('');
      setHoursPerDay(8);
    } catch {
      alert('Failed to submit request. Please try again.');
    }
    setSubmitting(false);
  };

  const pending = requests.filter(r => r.status === 'pending');
  const resolved = requests.filter(r => r.status !== 'pending');

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Plane className="w-5 h-5 text-orange-500" />
          <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wider">Time Off Requests</h2>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow-sm active:translate-y-px transition-all cursor-pointer"
        >
          {showForm ? <ChevronUp className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showForm ? 'Cancel' : 'Request Time Off'}
        </button>
      </div>

      {/* Request form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border-2 border-orange-200 rounded-2xl p-5 space-y-4 shadow-sm"
        >
          <h3 className="text-sm font-black text-gray-800 uppercase tracking-wide flex items-center gap-2">
            <Calendar className="w-4 h-4 text-orange-500" />
            New Time Off Request
          </h3>

          {/* Date range */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1.5">
                Start Date
              </label>
              <input
                type="date"
                required
                min={today}
                value={startDate}
                onChange={e => {
                  setStartDate(e.target.value);
                  if (endDate && e.target.value > endDate) setEndDate(e.target.value);
                }}
                className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-orange-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1.5">
                End Date
              </label>
              <input
                type="date"
                required
                min={startDate || today}
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-orange-500 font-mono"
              />
            </div>
          </div>

          {startDate && endDate && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-2.5 text-xs text-orange-700 font-semibold flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              {countDays(startDate, endDate)} day{countDays(startDate, endDate) !== 1 ? 's' : ''} &nbsp;·&nbsp;
              {countDays(startDate, endDate) * hoursPerDay} hours total
            </div>
          )}

          {/* Type + hours */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1.5">
                Leave Type
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setType('pto')}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    type === 'pto'
                      ? 'bg-green-600 text-white border-green-600 shadow-sm'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'
                  }`}
                >
                  Paid (PTO)
                </button>
                <button
                  type="button"
                  onClick={() => setType('unpaid')}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    type === 'unpaid'
                      ? 'bg-gray-700 text-white border-gray-700 shadow-sm'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'
                  }`}
                >
                  Unpaid
                </button>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1.5">
                Hours Per Day
              </label>
              <input
                type="number"
                min="1"
                max="12"
                step="0.5"
                value={hoursPerDay}
                onChange={e => setHoursPerDay(Number(e.target.value) || 8)}
                className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-orange-500 font-mono"
              />
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1.5">
              Reason / Notes
            </label>
            <textarea
              rows={3}
              required
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Describe the reason for your time off request..."
              className="w-full bg-white border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-orange-500 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={!startDate || !endDate || !reason.trim() || submitting}
            className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm flex items-center justify-center gap-2 cursor-pointer active:translate-y-px transition-all shadow-sm"
          >
            <Plane className="w-4 h-4" />
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </form>
      )}

      {/* Pending requests */}
      {pending.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-1.5">
            <Hourglass className="w-3.5 h-3.5 text-amber-500" />
            Pending ({pending.length})
          </h3>
          {pending.map(r => (
            <RequestCard key={r.id} request={r} />
          ))}
        </div>
      )}

      {/* Resolved requests */}
      {resolved.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">
            History ({resolved.length})
          </h3>
          {resolved.map(r => (
            <RequestCard key={r.id} request={r} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {requests.length === 0 && !showForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-8 text-center space-y-2">
          <Plane className="w-8 h-8 text-gray-300 mx-auto" />
          <p className="text-sm font-bold text-gray-500">No time off requests yet</p>
          <p className="text-xs text-gray-400">
            Use the button above to submit a request. Your manager will be notified for approval.
          </p>
        </div>
      )}
    </div>
  );
}

function RequestCard({ request }: { request: TimeOffRequest }) {
  const [expanded, setExpanded] = useState(false);

  const days = countDays(request.startDate, request.endDate);
  const totalHours = days * request.hoursPerDay;

  const statusConfig = {
    pending: {
      label: 'Pending Review',
      bg: 'bg-amber-50 border-amber-200',
      badge: 'bg-amber-100 text-amber-700 border-amber-200',
      icon: <Hourglass className="w-3.5 h-3.5 text-amber-500" />,
    },
    approved: {
      label: 'Approved',
      bg: 'bg-green-50 border-green-200',
      badge: 'bg-green-100 text-green-700 border-green-200',
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />,
    },
    denied: {
      label: 'Denied',
      bg: 'bg-red-50 border-red-200',
      badge: 'bg-red-100 text-red-700 border-red-200',
      icon: <XCircle className="w-3.5 h-3.5 text-red-500" />,
    },
  }[request.status];

  return (
    <div className={`border rounded-2xl overflow-hidden ${statusConfig.bg}`}>
      <div className="px-4 py-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${statusConfig.badge}`}>
            {statusConfig.icon}
            {statusConfig.label}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-800">
              {fmtDateRange(request.startDate, request.endDate)}
            </p>
            <p className="text-[11px] text-gray-500 font-mono">
              {days} day{days !== 1 ? 's' : ''} · {totalHours}h ·{' '}
              <span className={request.type === 'pto' ? 'text-green-600 font-bold' : 'text-gray-600 font-bold'}>
                {request.type === 'pto' ? 'Paid (PTO)' : 'Unpaid'}
              </span>
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="text-gray-400 hover:text-gray-600 cursor-pointer p-1 rounded-lg transition-colors shrink-0"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-gray-200 px-4 py-3 bg-white/60 space-y-2 text-xs">
          <div>
            <span className="font-bold text-gray-600 uppercase tracking-wide text-[10px]">Reason: </span>
            <span className="text-gray-700 italic">"{request.reason}"</span>
          </div>
          {request.status === 'approved' && (
            <div className="flex items-center gap-1.5 text-green-700">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>
                Approved by <strong>{request.reviewedByName}</strong> on {fmtTs(request.reviewedAt)}.
                These days have been added to your timecard.
              </span>
            </div>
          )}
          {request.status === 'denied' && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-red-600">
                <XCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Denied by <strong>{request.reviewedByName}</strong> on {fmtTs(request.reviewedAt)}.</span>
              </div>
              {request.adminNotes && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-700">
                  <span className="font-bold">Manager note: </span>
                  <span className="italic">"{request.adminNotes}"</span>
                </div>
              )}
            </div>
          )}
          {request.status === 'pending' && (
            <div className="flex items-center gap-1.5 text-amber-600">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Awaiting manager review. You'll see it on your timecard once approved.</span>
            </div>
          )}
          <div className="text-[10px] text-gray-400 font-mono">
            Submitted {fmtTs(request.createdAt)}
          </div>
        </div>
      )}
    </div>
  );
}
