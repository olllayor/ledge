// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { OtpInput } from './OtpInput';

afterEach(() => {
  cleanup();
});

describe('OtpInput', () => {
  it('renders six digit inputs and the initial group label', () => {
    const { container, getByLabelText } = render(
      <OtpInput value="" onChange={() => undefined} onComplete={() => undefined} />,
    );
    const inputs = container.querySelectorAll('input.otp-digit');
    expect(inputs).toHaveLength(6);
    expect(getByLabelText(/sign-in code/i).tagName).toBe('DIV');
  });

  it('updates the value when a digit is typed', () => {
    const onChange = vi.fn();
    const { container } = render(
      <OtpInput value="" onChange={onChange} onComplete={() => undefined} />,
    );
    const first = container.querySelectorAll('input.otp-digit')[0] as HTMLInputElement;
    fireEvent.change(first, { target: { value: '4' } });
    expect(onChange).toHaveBeenCalledWith('4');
  });

  it('strips non-digit input', () => {
    const onChange = vi.fn();
    const { container } = render(
      <OtpInput value="" onChange={onChange} onComplete={() => undefined} />,
    );
    const first = container.querySelectorAll('input.otp-digit')[0] as HTMLInputElement;
    fireEvent.change(first, { target: { value: 'abc' } });
    // Non-digit input should not trigger onChange with a non-empty value.
    expect(onChange).not.toHaveBeenCalledWith(expect.stringMatching(/[a-z]/));
  });

  it('fires onComplete when a full paste fills every slot', () => {
    // The paste handler overwrites the digits array starting at index 0
    // (see `applyOtpPaste` in otpUtils), so a full-length paste from a
    // fresh state is the cleanest way to drive `onComplete` from a test
    // without simulating browser focus movement.
    const onComplete = vi.fn();
    const onChange = vi.fn();
    const { container } = render(
      <OtpInput value="" onChange={onChange} onComplete={onComplete} />,
    );
    const group = container.querySelector('.otp-input-group') as HTMLElement;
    const clipboardData = {
      getData: () => '123456',
    } as unknown as DataTransfer;
    fireEvent.paste(group, { clipboardData });
    expect(onChange).toHaveBeenCalledWith('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('announces intermediate progress in the group label', () => {
    const { getByLabelText } = render(
      <OtpInput value="12" onChange={() => undefined} onComplete={() => undefined} />,
    );
    expect(getByLabelText(/Entered 2 of 6 digits/i).tagName).toBe('DIV');
  });

  it('handles a paste of 6 digits and fires onComplete', () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();
    const { container } = render(
      <OtpInput value="" onChange={onChange} onComplete={onComplete} />,
    );
    const group = container.querySelector('.otp-input-group') as HTMLElement;
    const pasteEvent = {
      clipboardData: { getData: () => '123456' },
      preventDefault: () => undefined,
    } as unknown as React.ClipboardEvent<HTMLInputElement>;
    fireEvent.paste(group, pasteEvent);
    // After paste, the component should have called onChange with the
    // full 6-digit string and onComplete with the same.
    expect(onChange).toHaveBeenCalledWith('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });
});
