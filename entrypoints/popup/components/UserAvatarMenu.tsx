import React, { useState, useRef, useEffect } from 'react';
import { useSupabaseAuth } from '../lib/SupabaseAuthContext';

interface UserAvatarMenuProps {
  onOpenSettings?: () => void;
}

export function UserAvatarMenu({ onOpenSettings }: UserAvatarMenuProps = {}) {
  const { user, signOut } = useSupabaseAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
  const fullName = user?.user_metadata?.full_name || user?.user_metadata?.name;
  const email = user?.email || '';
  const initial = (email ? email[0] : (fullName ? fullName[0] : 'U')).toUpperCase();

  // Close dropdown on click outside or Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSignOut = async () => {
    setIsOpen(false);
    await signOut();
  };

  return (
    <div className="user-menu-container" ref={menuRef}>
      <button
        type="button"
        className={`btn-user-avatar ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(prev => !prev)}
        title={fullName ? `${fullName} (${email})` : email || 'Account'}
        aria-label="User account menu"
        aria-expanded={isOpen}
      >
        {avatarUrl && !imgError ? (
          <img
            src={avatarUrl}
            alt={fullName || email || 'Avatar'}
            className="user-avatar-img"
            onError={() => setImgError(true)}
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="user-avatar-initial">{initial}</span>
        )}
      </button>

      {isOpen && (
        <div className="user-dropdown-menu fade-in" role="menu">
          <div className="user-dropdown-header">
            <div className="user-dropdown-avatar">
              {avatarUrl && !imgError ? (
                <img
                  src={avatarUrl}
                  alt={fullName || email || 'Avatar'}
                  className="user-avatar-img"
                  onError={() => setImgError(true)}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="user-avatar-initial large">{initial}</span>
              )}
            </div>
            <div className="user-dropdown-info">
              {fullName && <div className="user-dropdown-name">{fullName}</div>}
              <div className="user-dropdown-email" title={email}>{email}</div>
            </div>
          </div>

          <div className="user-dropdown-divider" />

          {onOpenSettings && (
            <button
              type="button"
              className="user-dropdown-item"
              onClick={() => {
                setIsOpen(false);
                onOpenSettings();
              }}
              role="menuitem"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l-.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span>Settings</span>
            </button>
          )}

          <button
            type="button"
            className="user-dropdown-item signout"
            onClick={handleSignOut}
            role="menuitem"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
