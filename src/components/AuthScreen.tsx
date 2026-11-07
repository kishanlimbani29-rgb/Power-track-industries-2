import React, { useState } from 'react';
import {
  Boxes,
  Lock,
  Mail,
  User,
  AlertCircle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  ArrowRight,
  RefreshCw,
  LogOut,
  Send,
  Eye,
  EyeOff,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const AuthScreen: React.FC = () => {
  const {
    currentUser,
    profile,
    profileError,
    isEmailVerified,
    isPendingApproval,
    isSuspended,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    sendPasswordReset,
    resendVerificationEmail,
    reloadCurrentUser,
    signOut,
    retryLoadProfile,
  } = useAuth();

  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [isVerifiedInScreen, setIsVerifiedInScreen] = useState(false);

  // Clear messages on mode change
  const switchMode = (newMode: 'signin' | 'signup' | 'forgot') => {
    setMode(newMode);
    setAuthError(null);
    setInfoMessage(null);
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setInfoMessage(null);
    setSubmitting(true);

    try {
      if (mode === 'signin') {
        if (!email.trim() || !password) {
          throw new Error('Please enter both email and password.');
        }
        await signInWithEmail(email, password);
      } else if (mode === 'signup') {
        if (!email.trim() || !password) {
          throw new Error('Please enter both email and password.');
        }
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters.');
        }
        await signUpWithEmail(email, password, displayName);
        setInfoMessage('Account created! A verification link has been sent to your email.');
      } else if (mode === 'forgot') {
        if (!email.trim()) {
          throw new Error('Please enter your account email address.');
        }
        await sendPasswordReset(email);
        setInfoMessage('Password reset instructions have been sent to your email.');
      }
    } catch (err: any) {
      let msg = err?.message || 'Authentication failed. Please verify your details.';
      if (msg.includes('auth/invalid-credential') || msg.includes('auth/wrong-password') || msg.includes('auth/user-not-found')) {
        msg = 'Invalid email or password. Please check your credentials and try again.';
      } else if (msg.includes('auth/email-already-in-use')) {
        msg = 'An account with this email address already exists. Please sign in instead.';
      } else if (msg.includes('auth/weak-password')) {
        msg = 'Password is too weak. Please choose at least 6 characters.';
      } else if (msg.includes('auth/invalid-email')) {
        msg = 'Please enter a valid email address.';
      } else if (msg.includes('auth/popup-closed-by-user')) {
        msg = 'Google sign-in popup was closed before completing.';
      }
      setAuthError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setInfoMessage(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      let msg = err?.message || 'Google sign-in failed.';
      if (msg.includes('auth/popup-closed-by-user')) {
        msg = 'Sign-in window closed before completing.';
      }
      setAuthError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    setSubmitting(true);
    setAuthError(null);
    try {
      await resendVerificationEmail();
      setInfoMessage('A fresh verification link has been sent to your inbox.');
    } catch (err: any) {
      setAuthError(err?.message || 'Failed to resend verification email.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckStatus = async () => {
    setSubmitting(true);
    setAuthError(null);
    setInfoMessage(null);
    try {
      if (currentUser) {
        await currentUser.reload();
        if (currentUser.emailVerified) {
          setIsVerifiedInScreen(true);
        } else {
          setAuthError('Email is not verified yet. Please click the confirmation link in the email sent to you, then tap this button again.');
        }
      }
      await reloadCurrentUser();
      if (currentUser?.emailVerified) {
        setIsVerifiedInScreen(true);
      }
    } catch (err: any) {
      setAuthError(err?.message || 'Failed to refresh account status.');
    } finally {
      setSubmitting(false);
    }
  };

  const emailIsVerified = isEmailVerified || isVerifiedInScreen;

  // State 1: Profile Loading Error
  if (currentUser && profileError) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-800 rounded-3xl p-6 sm:p-8 border border-red-500/30 text-white shadow-2xl space-y-6">
          <div className="w-14 h-14 rounded-2xl bg-red-500/20 text-red-400 border border-red-500/30 flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8" />
          </div>

          <div className="text-center space-y-2">
            <h2 className="text-xl font-bold">Profile Synchronization Failed</h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              We could not securely load your user permissions from the database. Please verify your connection and try again.
            </p>

            <div className="p-3 bg-red-950/60 rounded-xl border border-red-500/30 text-red-200 text-xs font-mono text-left break-words">
              {profileError}
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <button
              onClick={handleGoogleSignIn}
              disabled={submitting}
              className="w-full py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer bg-emerald-600 hover:bg-emerald-500 text-white shadow-md disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${submitting ? 'animate-spin' : ''}`} />
              <span>Sign In with Google to Reconnect</span>
            </button>

            <button
              onClick={retryLoadProfile}
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Retry Database Connection</span>
            </button>

            <button
              onClick={signOut}
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs flex items-center justify-center gap-2 transition cursor-pointer border border-slate-700"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // State 2: Suspended Account
  if (currentUser && isSuspended) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-800 rounded-3xl p-6 sm:p-8 border border-amber-500/30 text-white shadow-2xl space-y-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white">Account Access Suspended</h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Your account ({currentUser.email}) has been placed on hold by an administrator. You cannot view or modify factory inventory data while suspended.
            </p>
            <p className="text-[11px] text-slate-400">
              Please contact your organization&apos;s lead administrator to reinstate your access privileges.
            </p>
          </div>
          <button
            onClick={signOut}
            className="w-full py-3 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    );
  }

  // State 3: Email Not Verified
  if (currentUser && !emailIsVerified) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-800 rounded-3xl p-6 sm:p-8 border border-sky-500/30 text-white shadow-2xl space-y-6">
          <div className="w-14 h-14 rounded-2xl bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center justify-center mx-auto">
            <Mail className="w-8 h-8" />
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-xl font-bold">Please Verify Your Email</h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              We sent a verification link to <strong className="text-sky-300 font-mono">{currentUser.email}</strong>.
            </p>
            <p className="text-[11px] text-slate-400">
              Verified email is required for secure manufacturing governance and automatic administrator matching.
            </p>
          </div>

          {infoMessage && (
            <div className="p-3 bg-emerald-950/60 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{infoMessage}</span>
            </div>
          )}

          {authError && (
            <div className="p-3 bg-red-950/60 border border-red-500/30 rounded-xl text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <div className="space-y-2 pt-2">
            <button
              onClick={handleCheckStatus}
              disabled={submitting}
              className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${submitting ? 'animate-spin' : ''}`} />
              <span>I Have Verified My Email</span>
            </button>
            <button
              onClick={handleResendVerification}
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium text-xs flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Resend Verification Email</span>
            </button>
            <button
              onClick={signOut}
              className="w-full py-2 px-4 rounded-xl text-slate-400 hover:text-white font-medium text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // State 4: Pending Admin Approval
  if (currentUser && isPendingApproval) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-800 rounded-3xl p-6 sm:p-8 border border-amber-500/30 text-white shadow-2xl space-y-6">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center mx-auto">
            <Clock className="w-8 h-8 animate-pulse" />
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-xl font-bold">Waiting for Admin Approval</h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              Welcome, <strong className="text-white">{currentUser.displayName || currentUser.email}</strong>! Your account has been registered in the system.
            </p>
            <div className="p-3.5 bg-slate-900/80 rounded-2xl border border-slate-700/80 text-left space-y-2 text-xs">
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span>Registered Email:</span>
                <span className="font-mono text-slate-200">{currentUser.email}</span>
              </div>
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span>Current Status:</span>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30 text-[10px]">
                  Pending Activation
                </span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 pt-1">
              An administrator will review your account, assign your operational role (Admin, Manager, Staff, or Viewer), and activate your access.
            </p>
          </div>

          <div className="space-y-2 pt-2">
            <button
              onClick={handleCheckStatus}
              disabled={submitting}
              className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${submitting ? 'animate-spin' : ''}`} />
              <span>Check Approval Status</span>
            </button>
            <button
              onClick={signOut}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium text-xs flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // State 5: Sign In / Create Account Screen (Pre-Auth)
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 sm:p-6 text-slate-100">
      <div className="max-w-md w-full space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-3">
          <div className="w-20 h-20 rounded-2xl bg-white p-2.5 flex items-center justify-center mx-auto shadow-xl shadow-slate-900/50 border border-slate-700/50 overflow-hidden">
            <img
              src="/pti-logo.png"
              alt="Power Track PTI Logo"
              className="w-full h-full object-contain"
            />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">Power Track</h1>
            <p className="text-xs text-slate-400 mt-1">
              Industrial Manufacturing, Inventory & Lead Battery BOM
            </p>
          </div>
        </div>

        {/* Card Form */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl space-y-5">
          {/* Mode Switcher Tabs */}
          <div className="grid grid-cols-3 p-1 rounded-2xl bg-slate-950 border border-slate-800 text-xs font-semibold">
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className={`py-2 rounded-xl transition cursor-pointer ${
                mode === 'signin' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className={`py-2 rounded-xl transition cursor-pointer ${
                mode === 'signup' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign Up
            </button>
            <button
              type="button"
              onClick={() => switchMode('forgot')}
              className={`py-2 rounded-xl transition cursor-pointer ${
                mode === 'forgot' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
              }`}
            >
              Reset
            </button>
          </div>

          {/* Feedback messages */}
          {authError && (
            <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-500/40 text-rose-300 text-xs flex items-start gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              <span className="leading-snug">{authError}</span>
            </div>
          )}

          {infoMessage && (
            <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs flex items-start gap-2.5 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
              <span className="leading-snug">{infoMessage}</span>
            </div>
          )}

          {/* Google Sign In for Web */}
          {mode !== 'forgot' && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-800 font-bold text-xs flex items-center justify-center gap-2.5 transition shadow-xs cursor-pointer active:scale-[0.99] disabled:opacity-50"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.36 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.16 0 9.97 0 12s.45 3.84 1.25 5.42l4.03-3.15z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                  />
                </svg>
                <span>Continue with Google</span>
              </button>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-slate-800" />
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
                  Or use Email & Password
                </span>
                <div className="flex-1 h-px bg-slate-800" />
              </div>
            </div>
          )}

          {/* Email + Password Form */}
          <form onSubmit={handleEmailAuth} className="space-y-3.5">
            {mode === 'signup' && (
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Full Name / Operator Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Kishan Limbani"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>
            </div>

            {mode !== 'forgot' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-slate-300">
                    Password
                  </label>
                  {mode === 'signin' && (
                    <button
                      type="button"
                      onClick={() => switchMode('forgot')}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-10 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-bold text-xs flex items-center justify-center gap-2 transition shadow-md shadow-indigo-600/30 cursor-pointer active:scale-[0.99] disabled:opacity-50 mt-2"
            >
              {submitting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : mode === 'signin' ? (
                <>
                  <span>Sign In to Factory System</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              ) : mode === 'signup' ? (
                <>
                  <span>Create Account</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  <span>Send Reset Link</span>
                  <Send className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer info note */}
        <div className="text-center text-[11px] text-slate-500 space-y-1">
          <p>Lead-Acid & Tubular Battery Manufacturing Enterprise System</p>
          <p className="text-[10px] text-slate-600 font-mono">
            Optimized for Web & Android APK WebViews
          </p>
        </div>
      </div>
    </div>
  );
};
