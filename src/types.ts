export type UserRole = 'employee' | 'admin';

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: any; // Firestore Timestamp
  // Home address — set by admin for auto travel-time calculation
  homeAddress?: string;
  homeLatitude?: number;
  homeLongitude?: number;
  // Extended profile fields — populated from pending_employees on claim
  jobTitle?: string;
  billableRate?: number;
  phoneNumber?: string;
  // Password management — set by admin, updated on first login
  mustChangePassword?: boolean;
  currentPassword?: string;
}

export interface PendingEmployee {
  email: string;       // lowercase; also the Firestore doc ID
  name: string;
  role: UserRole;
  jobTitle?: string;
  billableRate?: number;
  phoneNumber?: string;
  homeAddress?: string;
  homeLatitude?: number;
  homeLongitude?: number;
  createdAt: any;
  createdBy: string;   // admin uid
  claimed: boolean;
  claimedAt?: any;
}

export interface JobSite {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radius: number; // in meters (usually 100m)
  createdAt: any;
}

export interface TimeEntryCoords {
  latitude: number;
  longitude: number;
}

export interface TimeEntry {
  id: string;
  userId: string;
  employeeName: string;
  date: string; // YYYY-MM-DD
  jobId: string;
  jobName: string;
  costCode: string;
  description: string;
  status: 'active' | 'completed' | 'pending_approval' | 'declined';
  clockInTime: any; // Firestore Timestamp
  clockInCoords: TimeEntryCoords;
  clockOutTime: any | null;
  clockOutCoords: TimeEntryCoords | null;
  travelTimeIn: number; // in minutes
  travelTimeOut: number; // in minutes
  travelFromLabel?: string; // "Home" or name of previous job site this shift came from
  lunchStart: any | null; // break start timestamp
  lunchStartCoords: TimeEntryCoords | null;
  lunchEnd: any | null; // break end timestamp
  lunchEndCoords: TimeEntryCoords | null;
  lunchDuration: number; // cumulative or individual total in minutes
  isManualEdit: boolean;
  isApproved: boolean;
  editRequestedAt: any | null;
  wasAutoClockedOut?: boolean;
  adminIncludesTravel?: boolean; // admin override: false = exclude travel from billing (set when both clock-in and clock-out are off-site)
  declineReason?: string | null;
  createdAt: any;
  updatedAt: any;
}

export interface AppSettings {
  id: string;
  autoClockOutTime: string; // legacy — kept for backward compat
  autoClockOutHoursAfterClockIn: number; // default 12 — hours after clock-in before auto clock-out fires
  autoClockOutRevertHours: number; // default 7.5 — worked hours the entry reverts to on auto clock-out
  companyTravelCoverageMinutes: number; // default 30
  updatedAt: any;
}

export interface TimeOffRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  type: 'pto' | 'unpaid';
  reason: string;
  hoursPerDay: number;
  status: 'pending' | 'approved' | 'denied';
  adminNotes: string | null;
  reviewedById: string | null;
  reviewedByName: string | null;
  reviewedAt: any | null;
  createdAt: any;
  updatedAt: any;
}

export const COST_CODES = [
  "01-100 Concrete & Pours",
  "02-200 Framing & Lumber",
  "03-300 Plumbing Rough-in",
  "04-400 Electrical Systems",
  "05-500 Insulation & Gypsum",
  "06-600 Trim & Door Finishes",
  "07-700 Painting & Coating",
  "08-800 Clean Up & Disposal",
  "09-900 Project Supervision",
  "10-100 Travel & Logistical Services"
];
