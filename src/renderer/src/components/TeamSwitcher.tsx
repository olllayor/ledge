import { useState, useRef, useEffect, useCallback } from 'react';
import { useTeams } from '../providers/TeamsProvider';

export function TeamSwitcher() {
  const { myTeams, activeTeamId, setActiveTeamId } = useTeams();
  const [isOpen, setIsOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const activeTeam = myTeams.find((t) => t._id === activeTeamId);
  const label = activeTeam ? activeTeam.name : 'Personal';

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (
        popupRef.current?.contains(e.target as Node) ||
        buttonRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = useCallback(
    async (teamId: string | null) => {
      setIsOpen(false);
      await setActiveTeamId(teamId);
    },
    [setActiveTeamId],
  );

  if (myTeams.length === 0) return null;

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        className="team-switcher"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={label}
      >
        <span className="team-switcher-switch">
          <svg className="team-switcher-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span className="team-switcher-name">{label}</span>
        </span>
        <svg className="team-switcher-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div ref={popupRef} className="team-switcher-popup" role="listbox" aria-label="Select team">
          <button
            className={`team-switcher-option${activeTeamId === null ? ' is-active' : ''}`}
            type="button"
            role="option"
            aria-selected={activeTeamId === null}
            onClick={() => void handleSelect(null)}
          >
            Personal
          </button>
          {myTeams.length > 0 && <div className="team-switcher-divider" />}
          {myTeams.map((t) => (
            <button
              key={t._id}
              className={`team-switcher-option${t._id === activeTeamId ? ' is-active' : ''}`}
              type="button"
              role="option"
              aria-selected={t._id === activeTeamId}
              onClick={() => void handleSelect(t._id)}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
