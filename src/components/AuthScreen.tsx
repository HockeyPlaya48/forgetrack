import React, { useState } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Lock, Mail, User, Clock, ToggleLeft, AlertCircle, ShieldAlert } from 'lucide-react';

interface AuthScreenProps {
  onSuccess: (uid: string) => void;
}

export default function AuthScreen({ onSuccess }: AuthScreenProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'employee' | 'admin'>('employee');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isSignUp) {
        // Sign Up Flow
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        const uid = userCred.user.uid;
        const emailLower = email.toLowerCase().trim();

        // Check for admin pre-registered pending profile
        const pendingRef = doc(db, 'pending_employees', emailLower);
        const pendingSnap = await getDoc(pendingRef);
        const pending = pendingSnap.exists() ? pendingSnap.data() : null;

        const assignedRole = emailLower === 'kenneytyler14@gmail.com'
          ? 'admin'
          : (pending?.role ?? role);

        const userDoc: Record<string, any> = {
          uid,
          name: pending?.name || name || 'Anonymous Worker',
          email: emailLower,
          role: assignedRole,
          createdAt: new Date(),
          ...(pending?.jobTitle      && { jobTitle: pending.jobTitle }),
          ...(pending?.billableRate  && { billableRate: pending.billableRate }),
          ...(pending?.phoneNumber   && { phoneNumber: pending.phoneNumber }),
          ...(pending?.homeAddress   && { homeAddress: pending.homeAddress }),
          ...(pending?.homeLatitude  && { homeLatitude: pending.homeLatitude }),
          ...(pending?.homeLongitude && { homeLongitude: pending.homeLongitude }),
        };

        await setDoc(doc(db, 'users', uid), userDoc);

        // Mark pending profile as claimed
        if (pending) {
          await setDoc(pendingRef, { claimed: true, claimedAt: new Date() }, { merge: true });
        }

        onSuccess(uid);
      } else {
        // Sign In Flow
        const userCred = await signInWithEmailAndPassword(auth, email, password);
        // Bootstrap admin: patch Firestore role to 'admin' if it was ever mis-written as 'employee'
        if (email.toLowerCase().trim() === 'kenneytyler14@gmail.com') {
          await setDoc(doc(db, 'users', userCred.user.uid), { role: 'admin' }, { merge: true });
        }
        onSuccess(userCred.user.uid);
      }
    } catch (err: any) {
      console.error('Authentication Error: ', err);
      if (err.code === 'auth/user-not-found') {
        setError('No account exists for this email. Turn on "Sign Up" above to register.');
      } else if (err.code === 'auth/wrong-password') {
        setError('Incorrect password. Please verify your credentials.');
      } else if (err.code === 'auth/email-already-in-use') {
        setError('This email address is already in use by another worker.');
      } else {
        setError(err.message || 'An unexpected authentication error occurred.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      const userCred = await signInWithPopup(auth, provider);
      const user = userCred.user;

      const userEmail = user.email?.toLowerCase() || '';
      const assignedRole = userEmail === 'kenneytyler14@gmail.com' ? 'admin' : 'employee';

      // Check for admin pre-registered pending profile
      const pendingRef = doc(db, 'pending_employees', userEmail);
      const pendingSnap = await getDoc(pendingRef);
      const pending = pendingSnap.exists() ? pendingSnap.data() : null;

      const mergePayload: Record<string, any> = {
        uid: user.uid,
        name: user.displayName || pending?.name || 'Google Employee',
        email: userEmail,
        // Bootstrapped admin always wins regardless of pending doc
        role: userEmail === 'kenneytyler14@gmail.com' ? 'admin' : (pending?.role ?? assignedRole),
        ...(pending?.jobTitle      && { jobTitle: pending.jobTitle }),
        ...(pending?.billableRate  && { billableRate: pending.billableRate }),
        ...(pending?.phoneNumber   && { phoneNumber: pending.phoneNumber }),
        ...(pending?.homeAddress   && { homeAddress: pending.homeAddress }),
        ...(pending?.homeLatitude  && { homeLatitude: pending.homeLatitude }),
        ...(pending?.homeLongitude && { homeLongitude: pending.homeLongitude }),
      };

      // Only set createdAt on first sign-in (merge won't overwrite existing fields for
      // the keys not present here, but we guard createdAt explicitly)
      const existingUserSnap = await getDoc(doc(db, 'users', user.uid));
      if (!existingUserSnap.exists()) mergePayload.createdAt = new Date();

      await setDoc(doc(db, 'users', user.uid), mergePayload, { merge: true });

      // Mark pending profile as claimed
      if (pending && !pending.claimed) {
        await setDoc(pendingRef, { claimed: true, claimedAt: new Date() }, { merge: true });
      }

      onSuccess(user.uid);
    } catch (err: any) {
      console.error('Google Sign In Error:', err);
      setError('Google Sign-In failed or was closed. Please try again or use standard Email + Password signup.');
    } finally {
      setLoading(false);
    }
  };

  // Demo account quick setups
  const quickFill = (type: 'employee' | 'admin') => {
    if (type === 'admin') {
      setEmail('kenneytyler14@gmail.com');
      setPassword('admin123');
      setName('Kenney Tyler');
      setRole('admin');
    } else {
      setEmail('worker@fieldworks.com');
      setPassword('worker123');
      setName('John Doe');
      setRole('employee');
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8" id="auth-screen">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Brand Icon */}
        <div className="mx-auto h-16 w-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
          <Clock className="w-9 h-9 text-white" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold tracking-tight text-gray-900 font-sans">
          HourGlass
        </h2>
        <p className="mt-1.5 text-center text-sm text-gray-500">
          Field Operations Time & GPS Tracking Portal
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white border border-gray-200 py-8 px-4 shadow-sm rounded-2xl sm:px-10">

          {/* Sign In vs Sign Up Toggle Tab */}
          <div className="flex bg-gray-100 p-1 rounded-lg mb-6 border border-gray-200">
            <button
              onClick={() => { setIsSignUp(false); setError(null); }}
              className={`flex-1 py-2 text-xs font-semibold rounded-md transition-all ${
                !isSignUp
                  ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              id="toggle-signin"
            >
              Sign In
            </button>
            <button
              onClick={() => { setIsSignUp(true); setError(null); }}
              className={`flex-1 py-2 text-xs font-semibold rounded-md transition-all ${
                isSignUp
                  ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              id="toggle-signup"
            >
              Register & Sign Up
            </button>
          </div>

          <form className="space-y-4" onSubmit={handleAuth}>
            {isSignUp && (
              <div>
                <label className="block text-xs font-medium text-gray-600 uppercase tracking-wider mb-1.5">
                  Full Name
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <User className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="e.g. John Doe"
                    className="block w-full pl-10 pr-3 py-2.5 bg-white border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    id="signup-name-input"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 uppercase tracking-wider mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-4 w-4 text-gray-400" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="worker@agency.com"
                  className="block w-full pl-10 pr-3 py-2.5 bg-white border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  id="auth-email-input"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-gray-400" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="block w-full pl-10 pr-3 py-2.5 bg-white border border-gray-300 rounded-xl text-gray-900 placeholder-gray-400 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  id="auth-password-input"
                />
              </div>
            </div>

            {isSignUp && (
              <div>
                <label className="block text-xs font-medium text-gray-600 uppercase tracking-wider mb-1.5">
                  Select Field Role
                </label>
                <div className="grid grid-cols-2 gap-2" id="role-selector-container">
                  <button
                    type="button"
                    onClick={() => setRole('employee')}
                    className={`py-2 px-3 text-xs font-medium border rounded-xl transition-all ${
                      role === 'employee'
                        ? 'bg-blue-50 text-blue-700 border-blue-300 shadow-sm'
                        : 'bg-white text-gray-500 border-gray-200 hover:text-gray-700'
                    }`}
                    id="select-role-employee"
                  >
                    Employee / Worker
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole('admin')}
                    className={`py-2 px-3 text-xs font-medium border rounded-xl transition-all ${
                      role === 'admin'
                        ? 'bg-blue-50 text-blue-700 border-blue-300 shadow-sm'
                        : 'bg-white text-gray-500 border-gray-200 hover:text-gray-700'
                    }`}
                    id="select-role-admin"
                  >
                    Admin / Manager
                  </button>
                </div>
                {role === 'admin' && (
                  <p className="mt-2 text-[10.5px] text-amber-700 leading-tight flex items-start gap-1">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    Admins can manage job site locations, review employee timecards, adjust settings, and authorize manual approvals. Only select this if you are a manager.
                  </p>
                )}
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2 text-red-700" id="auth-error-banner">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-xs font-medium leading-normal">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 active:translate-y-px text-white py-2.5 px-4 rounded-xl text-sm font-semibold transition-all shadow-sm flex items-center justify-center gap-1 cursor-pointer disabled:opacity-55"
              id="auth-submit-btn"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />
              ) : null}
              {isSignUp ? 'Create Work Account' : 'Sign In to Dashboard'}
            </button>
          </form>

          {/* Separator line */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="px-2 bg-white text-gray-400">Or Continue With</span>
            </div>
          </div>

          <div className="space-y-4">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 py-2.5 px-4 rounded-xl text-xs font-semibold transition-all active:translate-y-px shadow-sm"
              id="google-signin-btn"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              Sign In with Google
            </button>

            {/* Quick sandbox triggers */}
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200" id="quick-simulators-panel">
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block mb-2">
                Sandbox Demo Logins (No Sign Up Needed)
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => quickFill('employee')}
                  className="flex-1 bg-white hover:bg-blue-50 text-[11px] font-semibold text-blue-600 py-1.5 px-2 rounded-lg border border-gray-200 hover:border-blue-200 flex items-center justify-center gap-1 transition-all"
                  id="fill-demo-employee"
                >
                  Demo Employee
                </button>
                <button
                  type="button"
                  onClick={() => quickFill('admin')}
                  className="flex-1 bg-white hover:bg-green-50 text-[11px] font-semibold text-green-600 py-1.5 px-2 rounded-lg border border-gray-200 hover:border-green-200 flex items-center justify-center gap-1 transition-all"
                  id="fill-demo-admin"
                >
                  Demo Admin
                </button>
              </div>
              <p className="text-[9.5px] text-gray-400 text-center mt-2">
                Click a button to autofill. Use passwords <code className="text-gray-600">worker123</code> / <code className="text-gray-600">admin123</code> and click Submit.
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
