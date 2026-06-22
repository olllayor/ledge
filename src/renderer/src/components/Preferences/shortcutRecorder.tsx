import { useEffect, useRef, useState } from 'react';

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Tab']);
const ARROW_MAP: Record<string, string> = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };

export function ShortcutRecorder({
  value,
  onChange,
  disabled = false,
  defaultValue,
}: {
  value: string;
  onChange(shortcut: string): void;
  disabled?: boolean;
  defaultValue?: string;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isRecording) return;

    function handleKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setIsRecording(false);
        return;
      }

      const modifiers: string[] = [];
      if (e.metaKey) modifiers.push('Command');
      if (e.ctrlKey) modifiers.push('Control');
      if (e.altKey) modifiers.push('Option');
      if (e.shiftKey) modifiers.push('Shift');

      let key = ARROW_MAP[e.key] ?? e.key;
      if (key === ' ') key = 'Space';

      // Ignore lone modifier presses
      if (MODIFIER_KEYS.has(e.key) && modifiers.length === 0) {
        return;
      }
      if (MODIFIER_KEYS.has(e.key)) {
        key = ARROW_MAP[e.key] ?? e.key;
      }

      // Don't record just a modifier
      if (['Command', 'Control', 'Option', 'Shift'].includes(key)) {
        return;
      }

      const shortcut = [...modifiers, key].join('+');
      setIsRecording(false);
      onChange(shortcut);
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isRecording, onChange]);

  const keys = value ? value.split('+') : [];
  const isModified = defaultValue !== undefined && value !== defaultValue;

  return (
    <div ref={containerRef} className="shortcut-recorder">
      {isRecording ? (
        <div className="shortcut-recorder-recording">
          <span className="shortcut-recorder-hint">Press a shortcut…</span>
          <button
            className="settings-cta-small"
            type="button"
            onClick={() => setIsRecording(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="shortcut-recorder-display">
          {keys.length > 0 ? (
            <div className="shortcut-keys">
              {keys.map((k) => (
                <kbd key={k} className="shortcut-key">{displayKey(k)}</kbd>
              ))}
            </div>
          ) : (
            <span className="shortcut-recorder-placeholder">No shortcut set</span>
          )}
          <button
            className="settings-cta-small"
            type="button"
            onClick={() => setIsRecording(true)}
            disabled={disabled}
          >
            {keys.length > 0 ? 'Change' : 'Record'}
          </button>
          {isModified ? (
            <button
              className="settings-cta-small"
              type="button"
              onClick={() => onChange(defaultValue as string)}
              disabled={disabled}
              aria-label="Reset to default"
            >
              Reset
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function displayKey(key: string): string {
  const map: Record<string, string> = {
    Command: '⌘',
    Control: '⌃',
    Option: '⌥',
    Shift: '⇧',
    Return: '↩',
    Enter: '↩',
    Backspace: '⌫',
    Delete: '⌦',
    Escape: 'Esc',
    Tab: '⇥',
    Space: 'Space',
    Up: '↑',
    Down: '↓',
    Left: '←',
    Right: '→',
    PageUp: 'PgUp',
    PageDown: 'PgDn',
    Home: 'Home',
    End: 'End',
  };
  return map[key] ?? key;
}
