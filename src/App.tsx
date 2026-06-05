import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile } from './types';
import AuthScreen from './components/AuthScreen';
import EmployeeDashboard from './components/EmployeeDashboard';
import AdminDashboard from './components/AdminDashboard';
import { Clock, ShieldAlert, Shield, HardHat } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [errorBoundary, setErrorBoundary] = useState<string | null>(null);
  const [adminViewMode, setAdminViewMode] = useState<'employee' | 'admin'>('employee');

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
            const data = docSnapshot.data() as UserProfile;
            // Bootstrapped admin email always gets admin role regardless of stored value
            if (data.email?.toLowerCase() === 'kenneytyler14@gmail.com') data.role = 'admin';
            setProfile(data);
          } else {
            console.warn("User profile does not exist in Firestore users collection yet. Initializing default.");
            // Fallback for immediate preview if the profile writing was slow
            const fallbackProfile: UserProfile = {
              uid: firebaseUser.uid,
              name: firebaseUser.displayName || 'Sandbox Worker',
              email: firebaseUser.email || '',
              role: firebaseUser.email?.toLowerCase() === 'kenneytyler14@gmail.com' ? 'admin' : 'employee',
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
            role: firebaseUser.email?.toLowerCase() === 'kenneytyler14@gmail.com' ? 'admin' : 'employee',
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
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center animate-spin shadow-lg">
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
    <div className="min-h-screen bg-gray-100 text-gray-900 flex flex-col font-sans selection:bg-blue-200 selection:text-blue-900">

      {/* Dev warning Banner if Firestore lookup fails */}
      {errorBoundary && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2.5 flex items-center justify-between gap-4 text-xs font-medium text-blue-800" id="error-boundary-banner">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-blue-600 shrink-0" />
            <span>{errorBoundary}</span>
          </div>
          <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded uppercase">
            Preview Active
          </span>
        </div>
      )}

      {/* Admin view toggle — only visible to admin accounts */}
      {profile.role === 'admin' && (
        <div className="bg-slate-900 border-b border-slate-700 px-4 py-2 flex items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => setAdminViewMode('employee')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              adminViewMode === 'employee'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
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
                ? 'bg-slate-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
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

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white py-5 text-center text-[11px] text-gray-400 tracking-wider uppercase font-mono">
        <p>© 2026 ForgeTrack — Secure, Offline-First Field Operations Workspace.</p>
      </footer>
    </div>
  );
}
