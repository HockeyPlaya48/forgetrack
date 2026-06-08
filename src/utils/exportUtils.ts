/**
 * ForgeTrack Export Utilities
 * Payroll CSV, Excel (.xlsx), and Invoice PDF generation.
 */

import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { TimeEntry } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: any): string {
  if (!ts) return '—';
  const ms = ts.seconds ? ts.seconds * 1000 : Number(ts);
  const d = new Date(ms);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function fmtTime(ts: any): string {
  if (!ts) return '—';
  const ms = ts.seconds ? ts.seconds * 1000 : Number(ts);
  const d = new Date(ms);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function fmtDateTime(ts: any): string {
  if (!ts) return '—';
  return `${fmtDate(ts)} ${fmtTime(ts)}`;
}

export interface EmployeeRateMap {
  [name: string]: number; // name → hourly rate
}

interface EntryMetrics {
  workedHrs: number;
  billableHrs: number;
  regularHrs: number;
  overtimeHrs: number;
  travelMin: number;
  lunchMin: number;
  regularPay: number;
  overtimePay: number;
  totalPay: number;
}

function calcMetrics(entry: TimeEntry, rateMap: EmployeeRateMap): EntryMetrics {
  const rawIn  = entry.clockInTime?.seconds  ? entry.clockInTime.seconds * 1000  : Date.now();
  const rawOut = entry.clockOutTime?.seconds ? entry.clockOutTime.seconds * 1000 : Date.now();

  const diffMs       = Math.max(0, rawOut - rawIn);
  const totalMinutes = Math.max(0, Math.floor(diffMs / (1050 * 60)));
  const lunchMin     = entry.lunchDuration || 0;
  const workMinutes  = Math.max(0, totalMinutes - lunchMin);
  const travelMin    = (Number(entry.travelTimeIn || 0) + Number(entry.travelTimeOut || 0));
  const billableMin  = workMinutes + travelMin;

  const workedHrs   = workMinutes  / 60;
  const billableHrs = billableMin / 60;
  const regularHrs  = Math.min(billableHrs, 8);
  const overtimeHrs = Math.max(0, billableHrs - 8);

  const rate        = rateMap[entry.employeeName] || 0;
  const regularPay  = regularHrs  * rate;
  const overtimePay = overtimeHrs * rate * 1.5;
  const totalPay    = regularPay + overtimePay;

  return { workedHrs, billableHrs, regularHrs, overtimeHrs, travelMin, lunchMin, regularPay, overtimePay, totalPay };
}

/** Derive a human-readable date label from the entries in the export */
export function getDateLabel(entries: TimeEntry[]): string {
  if (!entries.length) return new Date().toISOString().split('T')[0];
  const dates = entries.map(e => e.date).sort();
  const first = dates[0];
  const last  = dates[dates.length - 1];
  return first === last ? first : `${first}_to_${last}`;
}

// ─── 1. Clean Payroll CSV ─────────────────────────────────────────────────────

export function exportCleanPayrollCSV(entries: TimeEntry[], rateMap: EmployeeRateMap): void {
  if (!entries.length) { alert('No records to export.'); return; }

  const headers = [
    'Employee', 'Date', 'Job Site', 'Cost Code',
    'Clock In', 'Clock Out',
    'Regular Hrs', 'Overtime Hrs', 'Billable Hrs',
    'Travel (min)', 'Lunch (min)',
    'Hourly Rate', 'Regular Pay', 'Overtime Pay', 'Total Pay',
    'Status', 'Notes'
  ];

  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

  const dataRows = entries.map(e => {
    const m = calcMetrics(e, rateMap);
    const status = e.isApproved ? 'Approved' : (e.status === 'active' ? 'Active' : 'Pending Review');
    const clockOut = e.clockOutTime ? fmtDateTime(e.clockOutTime) : 'Still Active';
    const rate = rateMap[e.employeeName] || 0;
    return [
      q(e.employeeName),
      q(e.date),
      q(e.jobName),
      q(e.costCode),
      q(fmtDateTime(e.clockInTime)),
      q(clockOut),
      q(m.regularHrs.toFixed(2)),
      q(m.overtimeHrs.toFixed(2)),
      q(m.billableHrs.toFixed(2)),
      q(m.travelMin),
      q(m.lunchMin),
      q(rate > 0 ? `$${rate.toFixed(2)}` : '—'),
      q(rate > 0 ? `$${m.regularPay.toFixed(2)}` : '—'),
      q(rate > 0 ? `$${m.overtimePay.toFixed(2)}` : '—'),
      q(rate > 0 ? `$${m.totalPay.toFixed(2)}` : '—'),
      q(status),
      q(e.description),
    ].join(',');
  });

  // Summary section
  const summaryByEmployee: Record<string, { reg: number; ot: number; bill: number; pay: number }> = {};
  entries.forEach(e => {
    const m = calcMetrics(e, rateMap);
    if (!summaryByEmployee[e.employeeName]) summaryByEmployee[e.employeeName] = { reg: 0, ot: 0, bill: 0, pay: 0 };
    summaryByEmployee[e.employeeName].reg  += m.regularHrs;
    summaryByEmployee[e.employeeName].ot   += m.overtimeHrs;
    summaryByEmployee[e.employeeName].bill += m.billableHrs;
    summaryByEmployee[e.employeeName].pay  += m.totalPay;
  });

  const summaryRows = [
    '',
    q('--- TOTALS BY EMPLOYEE ---'),
    `"Employee","Regular Hrs","Overtime Hrs","Billable Hrs","Total Pay"`,
    ...Object.entries(summaryByEmployee).map(([name, t]) =>
      `${q(name)},${q(t.reg.toFixed(2))},${q(t.ot.toFixed(2))},${q(t.bill.toFixed(2))},${q(t.pay > 0 ? `$${t.pay.toFixed(2)}` : '—')}`
    ),
    '',
    // Grand total
    `${q('GRAND TOTAL')},${q(Object.values(summaryByEmployee).reduce((s, t) => s + t.reg, 0).toFixed(2))},${q(Object.values(summaryByEmployee).reduce((s, t) => s + t.ot, 0).toFixed(2))},${q(Object.values(summaryByEmployee).reduce((s, t) => s + t.bill, 0).toFixed(2))},${q('$' + Object.values(summaryByEmployee).reduce((s, t) => s + t.pay, 0).toFixed(2))}`,
  ];

  const csv = [headers.join(','), ...dataRows, ...summaryRows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ForgeTrack_Payroll_${getDateLabel(entries)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ─── 2. Excel (.xlsx) multi-sheet ────────────────────────────────────────────

export function exportPayrollExcel(entries: TimeEntry[], rateMap: EmployeeRateMap): void {
  if (!entries.length) { alert('No records to export.'); return; }

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Payroll Data ──
  const payrollHeaders = [
    'Employee', 'Date', 'Job Site', 'Cost Code',
    'Clock In', 'Clock Out',
    'Regular Hrs', 'Overtime Hrs', 'Billable Hrs',
    'Travel (min)', 'Lunch (min)',
    'Hourly Rate', 'Regular Pay', 'Overtime Pay', 'Total Pay',
    'Status', 'Notes'
  ];

  const payrollRows = entries.map(e => {
    const m = calcMetrics(e, rateMap);
    const status = e.isApproved ? 'Approved' : (e.status === 'active' ? 'Active' : 'Pending Review');
    const rate = rateMap[e.employeeName] || 0;
    return [
      e.employeeName,
      e.date,
      e.jobName,
      e.costCode,
      fmtDateTime(e.clockInTime),
      e.clockOutTime ? fmtDateTime(e.clockOutTime) : 'Still Active',
      parseFloat(m.regularHrs.toFixed(2)),
      parseFloat(m.overtimeHrs.toFixed(2)),
      parseFloat(m.billableHrs.toFixed(2)),
      m.travelMin,
      m.lunchMin,
      rate || '',
      rate ? parseFloat(m.regularPay.toFixed(2)) : '',
      rate ? parseFloat(m.overtimePay.toFixed(2)) : '',
      rate ? parseFloat(m.totalPay.toFixed(2)) : '',
      status,
      e.description,
    ];
  });

  const ws1 = XLSX.utils.aoa_to_sheet([payrollHeaders, ...payrollRows]);

  // Column widths
  ws1['!cols'] = [
    { wch: 20 }, { wch: 12 }, { wch: 18 }, { wch: 24 },
    { wch: 18 }, { wch: 18 },
    { wch: 12 }, { wch: 14 }, { wch: 13 },
    { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 13 }, { wch: 14 }, { wch: 11 },
    { wch: 16 }, { wch: 30 }
  ];

  XLSX.utils.book_append_sheet(wb, ws1, 'Payroll Data');

  // ── Sheet 2: Summary by Employee ──
  const empSummary: Record<string, { reg: number; ot: number; bill: number; travel: number; pay: number; entries: number }> = {};
  entries.forEach(e => {
    const m = calcMetrics(e, rateMap);
    if (!empSummary[e.employeeName]) empSummary[e.employeeName] = { reg: 0, ot: 0, bill: 0, travel: 0, pay: 0, entries: 0 };
    empSummary[e.employeeName].reg    += m.regularHrs;
    empSummary[e.employeeName].ot     += m.overtimeHrs;
    empSummary[e.employeeName].bill   += m.billableHrs;
    empSummary[e.employeeName].travel += m.travelMin;
    empSummary[e.employeeName].pay    += m.totalPay;
    empSummary[e.employeeName].entries++;
  });

  const empHeaders = ['Employee', 'Entries', 'Regular Hrs', 'Overtime Hrs', 'Billable Hrs', 'Travel (min)', 'Total Pay'];
  const empRows = Object.entries(empSummary).map(([name, t]) => [
    name, t.entries,
    parseFloat(t.reg.toFixed(2)),
    parseFloat(t.ot.toFixed(2)),
    parseFloat(t.bill.toFixed(2)),
    t.travel,
    t.pay > 0 ? parseFloat(t.pay.toFixed(2)) : 'Rate not set',
  ]);

  // Grand total row
  const gt = Object.values(empSummary).reduce((acc, t) => ({
    reg: acc.reg + t.reg, ot: acc.ot + t.ot, bill: acc.bill + t.bill,
    travel: acc.travel + t.travel, pay: acc.pay + t.pay, entries: acc.entries + t.entries
  }), { reg: 0, ot: 0, bill: 0, travel: 0, pay: 0, entries: 0 });

  empRows.push(['TOTAL', gt.entries, parseFloat(gt.reg.toFixed(2)), parseFloat(gt.ot.toFixed(2)), parseFloat(gt.bill.toFixed(2)), gt.travel, gt.pay > 0 ? parseFloat(gt.pay.toFixed(2)) : '—']);

  const ws2 = XLSX.utils.aoa_to_sheet([empHeaders, ...empRows]);
  ws2['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 13 }, { wch: 14 }, { wch: 13 }, { wch: 13 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Summary by Employee');

  // ── Sheet 3: Summary by Job Site ──
  const jobSummary: Record<string, { reg: number; ot: number; bill: number; pay: number }> = {};
  entries.forEach(e => {
    const m = calcMetrics(e, rateMap);
    if (!jobSummary[e.jobName]) jobSummary[e.jobName] = { reg: 0, ot: 0, bill: 0, pay: 0 };
    jobSummary[e.jobName].reg  += m.regularHrs;
    jobSummary[e.jobName].ot   += m.overtimeHrs;
    jobSummary[e.jobName].bill += m.billableHrs;
    jobSummary[e.jobName].pay  += m.totalPay;
  });

  const jobHeaders = ['Job Site', 'Regular Hrs', 'Overtime Hrs', 'Billable Hrs', 'Total Pay'];
  const jobRows = Object.entries(jobSummary).map(([name, t]) => [
    name,
    parseFloat(t.reg.toFixed(2)),
    parseFloat(t.ot.toFixed(2)),
    parseFloat(t.bill.toFixed(2)),
    t.pay > 0 ? parseFloat(t.pay.toFixed(2)) : 'Rate not set',
  ]);
  const ws3 = XLSX.utils.aoa_to_sheet([jobHeaders, ...jobRows]);
  ws3['!cols'] = [{ wch: 22 }, { wch: 13 }, { wch: 14 }, { wch: 13 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Summary by Job');

  XLSX.writeFile(wb, `ForgeTrack_Payroll_${getDateLabel(entries)}.xlsx`);
}

// ─── 3. Invoice PDF ───────────────────────────────────────────────────────────

const COMPANY_NAME    = 'Kenney Construction';
const COMPANY_ADDRESS = '123 Main St, City, ST 00000';
const COMPANY_PHONE   = '(555) 000-0000';
const PAYMENT_TERMS   = 'Payment due within 30 days of invoice date.';

export function exportInvoicePDF(entries: TimeEntry[], rateMap: EmployeeRateMap): void {
  if (!entries.length) { alert('No records to export.'); return; }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = margin;

  // ── Header ──
  doc.setFillColor(28, 10, 0); // dark brown (ForgeTrack brand)
  doc.rect(0, 0, pageW, 28, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text('FORGETRACK', margin, 12);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(220, 180, 140);
  doc.text('Field Operations & Payroll Summary', margin, 19);

  // Invoice date top-right
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  const invoiceDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  doc.text(`Invoice Date: ${invoiceDate}`, pageW - margin, 12, { align: 'right' });
  doc.text(`Report Period: ${getDateLabel(entries).replace('_to_', ' → ').replace(/_/g, '-')}`, pageW - margin, 19, { align: 'right' });

  y = 36;

  // ── Company info block ──
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(COMPANY_NAME, margin, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text(COMPANY_ADDRESS, margin, y + 5);
  doc.text(COMPANY_PHONE, margin, y + 10);

  y += 20;

  // ── Summary stats row ──
  const totalBill  = entries.reduce((s, e) => s + calcMetrics(e, rateMap).billableHrs, 0);
  const totalReg   = entries.reduce((s, e) => s + calcMetrics(e, rateMap).regularHrs, 0);
  const totalOT    = entries.reduce((s, e) => s + calcMetrics(e, rateMap).overtimeHrs, 0);
  const totalPay   = entries.reduce((s, e) => s + calcMetrics(e, rateMap).totalPay, 0);
  const rateSet    = Object.values(rateMap).some(r => r > 0);

  const stats = [
    ['Total Entries', String(entries.length)],
    ['Billable Hours', `${totalBill.toFixed(1)} hrs`],
    ['Regular / OT', `${totalReg.toFixed(1)} / ${totalOT.toFixed(1)} hrs`],
    ['Total Pay', rateSet ? `$${totalPay.toFixed(2)}` : 'Rates not set'],
  ];

  const boxW = (pageW - margin * 2) / 4;
  stats.forEach(([label, val], i) => {
    const bx = margin + i * boxW;
    doc.setFillColor(245, 245, 243);
    doc.roundedRect(bx, y, boxW - 2, 16, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(30, 30, 30);
    doc.text(val, bx + (boxW - 2) / 2, y + 9, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(label.toUpperCase(), bx + (boxW - 2) / 2, y + 14, { align: 'center' });
  });

  y += 24;

  // ── Detailed table ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text('TIMESHEET DETAIL', margin, y);
  y += 4;

  const tableRows = entries.map(e => {
    const m   = calcMetrics(e, rateMap);
    const rate = rateMap[e.employeeName] || 0;
    const status = e.isApproved ? 'Approved' : 'Pending';
    return [
      e.employeeName,
      e.date,
      e.jobName,
      e.costCode.split(' ')[0],
      fmtTime(e.clockInTime),
      e.clockOutTime ? fmtTime(e.clockOutTime) : '—',
      m.regularHrs.toFixed(2),
      m.overtimeHrs.toFixed(2),
      m.billableHrs.toFixed(2),
      rate > 0 ? `$${m.totalPay.toFixed(2)}` : '—',
      status,
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [['Employee', 'Date', 'Job Site', 'Code', 'In', 'Out', 'Reg Hrs', 'OT Hrs', 'Bill Hrs', 'Pay', 'Status']],
    body: tableRows,
    styles: { fontSize: 7.5, cellPadding: 2.5 },
    headStyles: { fillColor: [28, 10, 0], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: [250, 249, 247] },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 20 },
      2: { cellWidth: 24 },
      3: { cellWidth: 14 },
      4: { cellWidth: 16 },
      5: { cellWidth: 16 },
      6: { cellWidth: 14 },
      7: { cellWidth: 12 },
      8: { cellWidth: 14 },
      9: { cellWidth: 16 },
      10: { cellWidth: 16 },
    },
    margin: { left: margin, right: margin },
    theme: 'grid',
  });

  y = (doc as any).lastAutoTable.finalY + 8;

  // ── Summary by employee ──
  const empSummary: Record<string, { reg: number; ot: number; bill: number; pay: number }> = {};
  entries.forEach(e => {
    const m = calcMetrics(e, rateMap);
    if (!empSummary[e.employeeName]) empSummary[e.employeeName] = { reg: 0, ot: 0, bill: 0, pay: 0 };
    empSummary[e.employeeName].reg  += m.regularHrs;
    empSummary[e.employeeName].ot   += m.overtimeHrs;
    empSummary[e.employeeName].bill += m.billableHrs;
    empSummary[e.employeeName].pay  += m.totalPay;
  });

  const summaryRows = Object.entries(empSummary).map(([name, t]) => [
    name,
    t.reg.toFixed(2),
    t.ot.toFixed(2),
    t.bill.toFixed(2),
    t.pay > 0 ? `$${t.pay.toFixed(2)}` : '—',
  ]);
  summaryRows.push(['TOTAL', totalReg.toFixed(2), totalOT.toFixed(2), totalBill.toFixed(2), rateSet ? `$${totalPay.toFixed(2)}` : '—']);

  if (y > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = margin; }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text('SUMMARY BY EMPLOYEE', margin, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [['Employee', 'Regular Hrs', 'Overtime Hrs', 'Billable Hrs', 'Total Pay']],
    body: summaryRows,
    styles: { fontSize: 8.5, cellPadding: 3 },
    headStyles: { fillColor: [234, 88, 12], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 249, 247] },
    margin: { left: margin, right: margin },
    theme: 'grid',
    willDrawCell: (data) => {
      // Bold the TOTAL row
      if (data.row.index === summaryRows.length - 1) {
        doc.setFont('helvetica', 'bold');
      }
    },
  });

  // ── Footer ──
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const fY = doc.internal.pageSize.getHeight() - 10;
    doc.setDrawColor(220, 220, 215);
    doc.line(margin, fY - 3, pageW - margin, fY - 3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(150, 150, 150);
    doc.text(PAYMENT_TERMS, margin, fY);
    doc.text(`Page ${i} of ${pageCount} — Generated by ForgeTrack`, pageW - margin, fY, { align: 'right' });
  }

  doc.save(`ForgeTrack_Invoice_${getDateLabel(entries)}.pdf`);
}
