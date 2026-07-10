import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut, updatePassword, User } from 'firebase/auth';
import { doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile } from './types';
import AuthScreen from './components/AuthScreen';
import EmployeeDashboard from './components/EmployeeDashboard';
import AdminDashboard from './components/AdminDashboard';
import { Clock, ShieldAlert, Shield, HardHat, Lock } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [errorBoundary, setErrorBoundary] = useState<string | null>(null);
  const [adminViewMode, setAdminViewMode] = useState<'employee' | 'admin'>('employee');

  // Force password change modal
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [newPasswordValue, setNewPasswordValue] = useState('');
  const [confirmPasswordValue, setConfirmPasswordValue] = useState('');
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);
  const [passwordChangeError, setPasswordChangeError] = useState<string | null>(null);

  // Auth State Listener
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);

      if (firebaseUser) {
        // Fetch User profile from Firestore
        setProfileLoading(true);
        setErrorBoundary(null);

        // Standard Firestore real-time listener for the logged-in user profile
        const userDocRef = doc(db, 'users', firebaseUser.uid);

        const unsubscribeProfile = onSnapshot(userDocRef, (docSnapshot) => {
          if (docSnapshot.exists()) {
            const rawData = docSnapshot.data() as UserProfile;
            // Always use Firebase Auth UID — never depend on the Firestore doc having it
            const data: UserProfile = {
              ...rawData,
              uid: firebaseUser.uid,
              ...(rawData.email?.toLowerCase() === import.meta.env.VITE_ADMIN_EMAIL
                ? { role: 'admin' as const }
                : {}),
            };
            setProfile(data);
          } else {
            console.warn("User profile does not exist in Firestore users collection yet. Initializing default.");
            // Fallback for immediate preview if the profile writing was slow
            const fallbackProfile: UserProfile = {
              uid: firebaseUser.uid,
              name: firebaseUser.displayName || 'Sandbox Worker',
              email: firebaseUser.email || '',
              role: firebaseUser.email?.toLowerCase() === import.meta.env.VITE_ADMIN_EMAIL ? 'admin' : 'employee',
              createdAt: new Date()
            };
            setProfile(fallbackProfile);
          }
          setProfileLoading(false);
        }, (error) => {
          console.error("Error reading profile document from Firestore: ", error);
          setErrorBoundary("Permission Error: Firestore collection users needs provisioning, or user has insufficient rights. Showing Fallback Mode.");

          // Setup a temporary client-side mockup profile so the developer can review UI dashboard layouts
          const clientMockProfile: UserProfile = {
            uid: firebaseUser.uid,
            name: firebaseUser.displayName || 'Local Field Demo User',
            email: firebaseUser.email || 'developer_guest@hourglass.com',
            role: firebaseUser.email?.toLowerCase() === import.meta.env.VITE_ADMIN_EMAIL ? 'admin' : 'employee',
            createdAt: new Date()
          };
          setProfile(clientMockProfile);
          setProfileLoading(false);
        });

        return () => unsubscribeProfile();
      } else {
        setProfile(null);
        setProfileLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (profile?.mustChangePassword) setShowPasswordChange(true);
  }, [profile?.mustChangePassword]);

  const handleForcePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPasswordValue !== confirmPasswordValue) {
      setPasswordChangeError('Passwords do not match.');
      return;
    }
    if (newPasswordValue.length < 6) {
      setPasswordChangeError('Password must be at least 6 characters.');
      return;
    }
    setPasswordChangeLoading(true);
    setPasswordChangeError(null);
    try {
      await updatePassword(user!, newPasswordValue);
      await updateDoc(doc(db, 'users', user!.uid), {
        currentPassword: newPasswordValue,
        mustChangePassword: false,
      });
      setShowPasswordChange(false);
      setNewPasswordValue('');
      setConfirmPasswordValue('');
    } catch (err: any) {
      if (err.code === 'auth/requires-recent-login') {
        setPasswordChangeError('Session expired. Please sign out and sign back in, then change your password.');
      } else {
        setPasswordChangeError(err.message || 'Failed to update password.');
      }
    }
    setPasswordChangeLoading(false);
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Sign Out failed', err);
    }
  };

  const handleAuthSuccess = (uid: string) => {
    // Auth success listener can immediately trigger profile lookups if needed
  };

  // Loading Screen
  if (authLoading || (user && profileLoading && !profile)) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 bg-orange-600 rounded-2xl flex items-center justify-center animate-spin shadow-lg">
            <Clock className="w-8 h-8 text-white" />
          </div>
          <div className="text-center space-y-1">
            <h3 className="text-base font-bold tracking-wide text-gray-800">Syncing Security Credentials...</h3>
            <p className="text-xs text-gray-500">Contacting ForgeTrack Authentication Servers</p>
          </div>
        </div>
      </div>
    );
  }

  // Not Authenticated flow
  if (!user || !profile) {
    return <AuthScreen onSuccess={handleAuthSuccess} />;
  }

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900 flex flex-col font-sans selection:bg-orange-200 selection:text-blue-900">

      {/* Dev warning Banner if Firestore lookup fails */}
      {errorBoundary && (
        <div className="bg-orange-50 border-b border-orange-200 px-4 py-2.5 flex items-center justify-between gap-4 text-xs font-medium text-blue-800" id="error-boundary-banner">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-orange-600 shrink-0" />
            <span>{errorBoundary}</span>
          </div>
          <span className="text-[10px] font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded uppercase">
            Preview Active
          </span>
        </div>
      )}

      {/* Admin view toggle — only visible to admin accounts */}
      {profile.role === 'admin' && (
        <div className="bg-[#1c0a00] border-b border-[#3d1f00] px-4 py-2 flex items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => setAdminViewMode('employee')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              adminViewMode === 'employee'
                ? 'bg-orange-600 text-white shadow'
                : 'text-orange-200 hover:text-white hover:bg-[#3d1f00]'
            }`}
          >
            <HardHat className="w-3.5 h-3.5" />
            My Timesheet
          </button>
          <button
            type="button"
            onClick={() => setAdminViewMode('admin')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              adminViewMode === 'admin'
                ? 'bg-orange-700 text-white shadow'
                : 'text-orange-200 hover:text-white hover:bg-[#3d1f00]'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            Admin Panel
          </button>
        </div>
      )}

      {/* Main Workspace router depending on User role + admin view mode */}
      <main className="flex-grow">
        {profile.role === 'admin' && adminViewMode === 'admin' ? (
          <AdminDashboard onSignOut={handleSignOut} user={profile} />
        ) : (
          <EmployeeDashboard user={profile} onSignOut={handleSignOut} />
        )}
      </main>

      {/* Force Password Change Modal */}
      {showPasswordChange && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-5">
            <div className="text-center space-y-1">
              <div className="mx-auto w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mb-3">
                <Lock className="w-6 h-6 text-orange-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900">Set Your New Password</h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                Your account was created by your admin with a temporary password. Please set a personal password to continue.
              </p>
            </div>
            <form onSubmit={handleForcePasswordChange} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">New Password</label>
                <input
                  type="password"
                  value={newPasswordValue}
                  onChange={e => setNewPasswordValue(e.target.value)}
                  required
                  minLength={6}
                  placeholder="Enter new password (min 6 chars)"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-orange-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPasswordValue}
                  onChange={e => setConfirmPasswordValue(e.target.value)}
                  required
                  minLength={6}
                  placeholder="Re-enter new password"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-orange-500"
                />
              </div>
              {passwordChangeError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{passwordChangeError}</p>
              )}
              <button
                type="submit"
                disabled={passwordChangeLoading}
                className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-2.5 rounded-xl text-sm transition-all disabled:opacity-50 cursor-pointer active:translate-y-px"
              >
                {passwordChangeLoading ? 'Saving...' : 'Set Password & Continue'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white py-5 text-center text-[11px] text-gray-400 tracking-wider uppercase font-mono">
        <p>© 2026 ForgeTrack — Secure, Offline-First Field Operations Workspace.</p>
      </footer>
    </div>
  );
}
