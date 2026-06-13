import { useRef, useState, type KeyboardEvent, type ClipboardEvent } from 'react';
import { applyOtpPaste, otpGroupLabel, sanitizeOtpDigit, sanitizeOtpPaste } from './otpUtils';

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

  // padEnd with an empty fill string is a no-op per the spec, so we
  // pad with a placeholder and then convert back. We always render
  // exactly `length` digit boxes, padding with empty strings when the
  // current value is shorter than `length`.
  const digits: string[] = [];
  for (let i = 0; i < length; i += 1) {
    digits.push(value[i] ?? '');
  }

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
    const digit = sanitizeOtpDigit(raw);
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
    const pasted = sanitizeOtpPaste(event.clipboardData.getData('text'), length);
    if (!pasted) return;

    const { digits: newDigits, focusIndex, isComplete } = applyOtpPaste(digits, pasted, length);
    const newValue = newDigits.join('');
    onChange(newValue);

    inputRefs.current[focusIndex]?.focus();
    setFocusedIndex(focusIndex);

    if (isComplete) {
      onComplete(newValue);
    }
  }

  function handleClick(index: number) {
    setFocusedIndex(index);
  }

  const filledCount = digits.filter((d) => d.length > 0).length;
  const groupLabel = otpGroupLabel(filledCount, length);
  return (
    <div className="otp-input-group" onPaste={handlePaste} role="group" aria-label={groupLabel}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => { inputRefs.current[index] = el; }}
          className={`otp-digit ${focusedIndex === index ? 'is-focused' : ''} ${digit ? 'is-filled' : ''}`}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          onClick={() => handleClick(index)}
          onFocus={() => setFocusedIndex(index)}
          onBlur={() => setFocusedIndex(-1)}
          disabled={disabled}
          aria-label={`Digit ${index + 1} of ${length}`}
        />
      ))}
    </div>
  );
}
