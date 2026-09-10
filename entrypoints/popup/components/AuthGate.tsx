import React, { useState, useEffect } from 'react';
import { getSupabaseClient } from '../../../src/database/supabase';
import { useSupabaseAuth } from '../lib/SupabaseAuthContext';
import {
  checkRateLimit,
  recordAttempt,
  resetRateLimit,
  RATE_LIMIT_SIGN_IN,
  RATE_LIMIT_SIGN_UP,
} from '../../../src/security/rate-limiter';

interface AuthGateProps {
  children: React.ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const { session, isLoading } = useSupabaseAuth();
  const supabase = getSupabaseClient();

  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot_password'>('signin');
  const [step, setStep] = useState<'form' | 'verify_email'>('form');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otpCode, setOtpCode] = useState('');

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // Sync theme
  useEffect(() => {
    chrome.storage?.local?.get(['continu_theme'], (res) => {
      if (res && (res.continu_theme === 'light' || res.continu_theme === 'dark')) {
        setTheme(res.continu_theme);
        document.documentElement.setAttribute('data-theme', res.continu_theme);
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    });

    const handleStorage = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === 'local' && changes.continu_theme) {
        const next = changes.continu_theme.newValue;
        if (next === 'light' || next === 'dark') {
          setTheme(next);
          document.documentElement.setAttribute('data-theme', next);
        }
      }
    };

    chrome.storage?.onChanged?.addListener(handleStorage);
    return () => {
      chrome.storage?.onChanged?.removeListener(handleStorage);
    };
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      chrome.storage?.local?.set({ continu_theme: next });
    } catch {
      // ignore
    }
  };

  const switchMode = (newMode: 'signin' | 'signup' | 'forgot_password') => {
    setMode(newMode);
    setStep('form');
    setError(null);
    setInfoMessage(null);
  };

  // Google OAuth Flow: uses chrome.identity.launchWebAuthFlow + Supabase PKCE
  const handleGoogleSignIn = async () => {
    if (googleLoading || loading) return;

    setError(null);
    setGoogleLoading(true);

    try {
      // 1. Get the OAuth URL from Supabase (without browser redirect)
      const redirectUri =
        typeof chrome !== 'undefined' && chrome.identity?.getRedirectURL
          ? chrome.identity.getRedirectURL()
          : 'https://fgemdjianelmadaiodolkmbfgeobcjog.chromiumapp.org/';

      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          skipBrowserRedirect: true,
          redirectTo: redirectUri,
        },
      });

      if (oauthError || !data?.url) {
        throw new Error(oauthError?.message || 'Could not generate Google sign-in URL.');
      }

      // 2. Preflight check: verify Google provider is enabled on Supabase before opening modal
      try {
        const preflight = await fetch(data.url, { method: 'GET', redirect: 'manual' });
        if (preflight.status === 400) {
          const errBody = await preflight.json().catch(() => null);
          if (errBody?.msg?.includes('provider is not enabled') || errBody?.error_code === 'validation_failed') {
            setError(
              'Google sign-in is not enabled in your Supabase project yet. Please enable Google in your Supabase Dashboard (Authentication > Providers > Google), or sign in with Email & Password below.'
            );
            setGoogleLoading(false);
            return;
          }
        }
      } catch {
        // Preflight network error or CORS — continue to launchWebAuthFlow
      }

      // 3. Launch Google login via Chrome's native auth modal
      if (typeof chrome !== 'undefined' && chrome.identity?.launchWebAuthFlow) {
        chrome.identity.launchWebAuthFlow(
          {
            url: data.url,
            interactive: true,
          },
          async (callbackUrl) => {
            if (chrome.runtime.lastError) {
              const lastErr = chrome.runtime.lastError.message || '';
              if (lastErr.includes('could not be loaded') || lastErr.includes('Authorization page')) {
                setError(
                  `Authorization redirect failed (${lastErr}). Please verify that ${redirectUri} is added to Redirect URLs in your Supabase Dashboard (Authentication > URL Configuration), and Google provider is active.`
                );
              } else {
                setError(lastErr || 'Google sign-in was canceled.');
              }
              setGoogleLoading(false);
              return;
            }

            if (callbackUrl) {
              try {
                const url = new URL(callbackUrl);
                const searchParams = url.searchParams;
                const hashRaw = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
                const hashParams = new URLSearchParams(hashRaw);

                // 1. Check for provider error messages in query or hash
                const oauthErrorMsg =
                  searchParams.get('error_description') ||
                  hashParams.get('error_description') ||
                  searchParams.get('error') ||
                  hashParams.get('error');

                if (oauthErrorMsg) {
                  setError(`Google sign-in error: ${oauthErrorMsg}`);
                  setGoogleLoading(false);
                  return;
                }

                // 2. PKCE flow: authorization code in search or hash params
                const code = searchParams.get('code') || hashParams.get('code');
                if (code) {
                  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
                  if (exchangeError) {
                    setError(exchangeError.message || 'Failed to complete Google sign-in.');
                  } else {
                    await resetRateLimit('auth:signin');
                  }
                  setGoogleLoading(false);
                  return;
                }

                // 3. Implicit flow: access_token and refresh_token in hash or search params
                const accessToken = hashParams.get('access_token') || searchParams.get('access_token');
                const refreshToken = hashParams.get('refresh_token') || searchParams.get('refresh_token');

                if (accessToken) {
                  const { error: sessionError } = await supabase.auth.setSession({
                    access_token: accessToken,
                    refresh_token: refreshToken || '',
                  });
                  if (sessionError) {
                    setError(sessionError.message || 'Failed to initialize session from tokens.');
                  } else {
                    await resetRateLimit('auth:signin');
                  }
                  setGoogleLoading(false);
                  return;
                }

                // If none of the expected parameters were found
                setError('No authorization code or session tokens received from Google.');
              } catch (err: any) {
                setError(err.message || 'Failed to complete Google sign-in.');
              }
            }
            setGoogleLoading(false);
          }
        );
      } else {
        throw new Error('Chrome identity API is unavailable in this environment.');
      }
    } catch (err: any) {
      setError(err.message || 'Google sign-in failed.');
      setGoogleLoading(false);
    }
  };

  // Email / Password Form Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || googleLoading) return;
    setError(null);
    setInfoMessage(null);

    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }

    if (mode === 'forgot_password') {
      const limitCheck = await checkRateLimit('auth:reset', RATE_LIMIT_SIGN_IN);
      if (!limitCheck.allowed) {
        setError(limitCheck.error || `Too many reset attempts. Please wait ${limitCheck.retryAfterSeconds}s.`);
        return;
      }
      setLoading(true);
      try {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim());
        if (resetError) {
          await recordAttempt('auth:reset', RATE_LIMIT_SIGN_IN);
          setError(resetError.message || 'Failed to send reset email.');
        } else {
          setInfoMessage(`Password reset link sent to ${email.trim()}. Check your inbox.`);
        }
      } catch (err: any) {
        await recordAttempt('auth:reset', RATE_LIMIT_SIGN_IN);
        setError(err.message || 'Failed to send reset email.');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!password) {
      setError('Please enter your password.');
      return;
    }

    if (mode === 'signup' && password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setLoading(true);

    if (mode === 'signin') {
      // Check rate limit for sign-in attempts
      const limitCheck = await checkRateLimit('auth:signin', RATE_LIMIT_SIGN_IN);
      if (!limitCheck.allowed) {
        setError(limitCheck.error || `Too many attempts. Please wait ${limitCheck.retryAfterSeconds}s before trying again.`);
        setLoading(false);
        return;
      }

      try {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (signInError) {
          await recordAttempt('auth:signin', RATE_LIMIT_SIGN_IN);
          setError(signInError.message || 'Sign in failed.');
        } else {
          // Reset failed attempts counter on successful login
          await resetRateLimit('auth:signin');
        }
        // On success, onAuthStateChange will fire and update session
      } catch (err: any) {
        await recordAttempt('auth:signin', RATE_LIMIT_SIGN_IN);
        setError(err.message || 'Sign in failed.');
      } finally {
        setLoading(false);
      }
    } else {
      // Sign Up
      const limitCheck = await checkRateLimit('auth:signup', RATE_LIMIT_SIGN_UP);
      if (!limitCheck.allowed) {
        setError(limitCheck.error || `Too many sign-up attempts. Please wait ${limitCheck.retryAfterSeconds}s.`);
        setLoading(false);
        return;
      }

      try {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });

        if (signUpError) {
          await recordAttempt('auth:signup', RATE_LIMIT_SIGN_UP);
          setError(signUpError.message || 'Sign up failed.');
        } else if (signUpData?.user?.identities?.length === 0) {
          // User already exists
          setError('An account with this email already exists. Please sign in.');
        } else if (signUpData?.user && !signUpData.session) {
          // Email confirmation required
          setStep('verify_email');
          setInfoMessage(`We sent a confirmation link to ${email.trim()}. Check your email.`);
        }
        // If session is returned, user is auto-signed in
      } catch (err: any) {
        await recordAttempt('auth:signup', RATE_LIMIT_SIGN_UP);
        setError(err.message || 'Sign up failed.');
      } finally {
        setLoading(false);
      }
    }
  };

  // OTP Code Verification Submit
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);

    if (!otpCode.trim()) {
      setError('Please enter the 6-digit code.');
      return;
    }

    setLoading(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otpCode.trim(),
        type: 'signup',
      });

      if (verifyError) {
        setError(verifyError.message || 'Verification failed.');
      }
      // On success, onAuthStateChange will fire
    } catch (err: any) {
      setError(err.message || 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (loading) return;
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
      });
      if (resendError) {
        setError(resendError.message || 'Failed to resend verification code.');
      } else {
        setInfoMessage('New verification email sent.');
        setError(null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to resend verification code.');
    }
  };

  if (isLoading) {
    return (
      <div className="auth-loading-container">
        <div className="spinner" style={{ width: 24, height: 24, borderWidth: 2 }} />
        <p className="auth-loading-text">Loading authentication...</p>
      </div>
    );
  }

  if (session) {
    return <>{children}</>;
  }

  return (
    <div className={`auth-screen ${theme === 'light' ? 'theme-light' : ''}`} data-theme={theme}>
      {/* Header bar */}
      <div className="auth-header-bar">
        <div className="auth-brand-left">
          <span className="auth-brand-title">continu</span>
          <span className="auth-pill" title="End-to-End Client Encrypted (AES-256-GCM)">
            <span className="pill-dot" />
            E2EE
          </span>
        </div>
        <button
          type="button"
          className="btn-theme-toggle"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="auth-mode-switch">
        <button
          type="button"
          className={`auth-mode-btn ${mode === 'signin' && step === 'form' ? 'active' : ''}`}
          onClick={() => switchMode('signin')}
        >
          Sign In
        </button>
        <button
          type="button"
          className={`auth-mode-btn ${mode === 'signup' || step === 'verify_email' ? 'active' : ''}`}
          onClick={() => switchMode('signup')}
        >
          Sign Up
        </button>
      </div>

      {/* Error / Info Alerts */}
      {error && (
        <div className="native-auth-alert error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {infoMessage && (
        <div className="native-auth-alert info">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>{infoMessage}</span>
        </div>
      )}

      {step === 'form' ? (
        <>
          {mode !== 'forgot_password' ? (
            <>
              {/* Google OAuth Button */}
              <button
                type="button"
                className="native-auth-google-btn"
                onClick={handleGoogleSignIn}
                disabled={googleLoading || loading}
              >
                {googleLoading ? (
                  <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                )}
                <span>Continue with Google</span>
              </button>

              {/* Divider */}
              <div className="native-auth-divider">
                <span className="native-auth-divider-line" />
                <span className="native-auth-divider-text">or</span>
                <span className="native-auth-divider-line" />
              </div>
            </>
          ) : (
            <div style={{ marginBottom: '14px', textAlign: 'center' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 600, margin: '0 0 4px 0' }}>Reset Password</h3>
              <p style={{ fontSize: '11.5px', color: 'var(--text-secondary)', margin: 0 }}>
                Enter your email to receive password reset instructions.
              </p>
            </div>
          )}

          {/* Email / Password Form */}
          <form className="native-auth-form" onSubmit={handleSubmit}>
            <div className="native-auth-field">
              <label className="native-auth-label" htmlFor="auth-email">
                Email address
              </label>
              <input
                id="auth-email"
                type="email"
                className="native-auth-input"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                disabled={loading}
                required
              />
            </div>

            {mode !== 'forgot_password' && (
              <div className="native-auth-field">
                <label className="native-auth-label" htmlFor="auth-password">
                  Password
                </label>
                <div className="native-auth-password-wrapper">
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    className="native-auth-input"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    disabled={loading}
                    required
                  />
                  <button
                    type="button"
                    className="native-auth-eye-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    title={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                {mode === 'signin' && (
                  <div style={{ textAlign: 'right', marginTop: '6px' }}>
                    <button
                      type="button"
                      className="native-auth-link-btn"
                      onClick={() => switchMode('forgot_password')}
                      style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}
                    >
                      Forgot password?
                    </button>
                  </div>
                )}
              </div>
            )}

            <button type="submit" className="native-auth-submit-btn" disabled={loading}>
              {loading ? (
                <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
              ) : mode === 'signin' ? (
                'Sign In'
              ) : mode === 'signup' ? (
                'Create Account'
              ) : (
                'Send Reset Link'
              )}
            </button>
          </form>

          {/* Footer toggle text */}
          <div className="native-auth-footer-prompt">
            {mode === 'signin' ? (
              <>
                <span>Don't have an account?</span>
                <button type="button" className="native-auth-link-btn" onClick={() => switchMode('signup')}>
                  Sign up
                </button>
              </>
            ) : mode === 'signup' ? (
              <>
                <span>Already have an account?</span>
                <button type="button" className="native-auth-link-btn" onClick={() => switchMode('signin')}>
                  Sign in
                </button>
              </>
            ) : (
              <>
                <span>Remembered your password?</span>
                <button type="button" className="native-auth-link-btn" onClick={() => switchMode('signin')}>
                  Back to Sign In
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        /* OTP Verification Step */
        <form className="native-auth-form otp-step" onSubmit={handleVerifyOtp}>
          <div className="native-auth-step-header">
            <h3 className="native-auth-step-title">Verify your email</h3>
            <p className="native-auth-step-sub">
              Enter the 6-digit verification code sent to <strong>{email}</strong>
            </p>
          </div>

          <div className="native-auth-field">
            <input
              type="text"
              className="native-auth-input otp-input"
              placeholder="123456"
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
              disabled={loading}
              required
            />
          </div>

          <button type="submit" className="native-auth-submit-btn" disabled={loading}>
            {loading ? (
              <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
            ) : (
              'Verify & Complete'
            )}
          </button>

          <div className="native-auth-otp-actions">
            <button type="button" className="native-auth-link-btn" onClick={handleResendCode} disabled={loading}>
              Resend code
            </button>
            <span className="dot-sep">•</span>
            <button
              type="button"
              className="native-auth-link-btn text-muted"
              onClick={() => {
                setStep('form');
                setError(null);
              }}
            >
              Back
            </button>
          </div>
        </form>
      )}

      {/* Secured Badge */}
      <div className="native-auth-clerk-badge">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>Secured by Supabase</span>
      </div>
    </div>
  );
}
