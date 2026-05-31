import { useRef, useState, type KeyboardEvent, type ClipboardEvent } from 'react';

interface OtpInputProps {
  length?: number;
  value: string;
  onChange(value: string): void;
  onComplete(value: string): void;
  disabled?: boolean;
}

export function OtpInput({ length = 6, value, onChange, onComplete, disabled = false }: OtpInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const digits = value.padEnd(length, '').split('').slice(0, length);

  function setValueAtIndex(index: number, digit: string) {
    const newDigits = digits.slice();
    newDigits[index] = digit;
    const newValue = newDigits.join('');
    onChange(newValue);
    if (newValue.length === length && !newValue.includes('')) {
      onComplete(newValue);
    }
  }

  function handleChange(index: number, raw: string) {
    const digit = raw.replace(/\D/g, '')[0] || '';
    setValueAtIndex(index, digit);
    if (digit && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
      setFocusedIndex(index + 1);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (digits[index]) {
        setValueAtIndex(index, '');
      } else if (index > 0) {
        setValueAtIndex(index - 1, '');
        inputRefs.current[index - 1]?.focus();
        setFocusedIndex(index - 1);
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
      setFocusedIndex(index - 1);
    } else if (event.key === 'ArrowRight' && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
      setFocusedIndex(index + 1);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;

    const newDigits = digits.slice();
    for (let i = 0; i < pasted.length; i++) {
      newDigits[i] = pasted[i];
    }
    const newValue = newDigits.join('');
    onChange(newValue);

    const focusIndex = Math.min(pasted.length, length - 1);
    inputRefs.current[focusIndex]?.focus();
    setFocusedIndex(focusIndex);

    if (newValue.length === length && !newValue.includes('')) {
      onComplete(newValue);
    }
  }

  function handleClick(index: number) {
    setFocusedIndex(index);
  }

  return (
    <div className="otp-input-group" onPaste={handlePaste}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => { inputRefs.current[index] = el; }}
          className={`otp-digit ${focusedIndex === index ? 'is-focused' : ''} ${digit ? 'is-filled' : ''}`}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          onClick={() => handleClick(index)}
          onFocus={() => setFocusedIndex(index)}
          onBlur={() => setFocusedIndex(-1)}
          disabled={disabled}
          aria-label={`Digit ${index + 1}`}
        />
      ))}
    </div>
  );
}
