import { describe, it, expect, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { attachRendererCrashRecovery } from './rendererCrashRecovery';

interface FakeWindow {
  window: BrowserWindow;
  on: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  webContentsIsDestroyed: ReturnType<typeof vi.fn>;
}

function makeFakeWindow(): FakeWindow {
  const on = vi.fn();
  const reload = vi.fn();
  const isDestroyed = vi.fn(() => false);
  const webContentsIsDestroyed = vi.fn(() => false);
  const window = {
    isDestroyed,
    webContents: {
      on,
      reload,
      isDestroyed: webContentsIsDestroyed,
    },
  } as unknown as BrowserWindow;
  return { window, on, reload, isDestroyed, webContentsIsDestroyed };
}

function getGoneHandler(on: FakeWindow['on']) {
  const call = on.mock.calls.find((c) => c[0] === 'render-process-gone');
  expect(call).toBeDefined();
  return call![1] as (event: unknown, details: { reason: string }) => void;
}

describe('attachRendererCrashRecovery', () => {
  it('registers a render-process-gone listener', () => {
    const { window, on } = makeFakeWindow();
    attachRendererCrashRecovery(window);
    expect(on).toHaveBeenCalledWith('render-process-gone', expect.any(Function));
  });

  it('reloads on crash', () => {
    const { window, on, reload } = makeFakeWindow();
    attachRendererCrashRecovery(window);
    getGoneHandler(on)({}, { reason: 'crashed' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads on oom', () => {
    const { window, on, reload } = makeFakeWindow();
    attachRendererCrashRecovery(window);
    getGoneHandler(on)({}, { reason: 'oom' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignores clean-exit', () => {
    const { window, on, reload } = makeFakeWindow();
    attachRendererCrashRecovery(window);
    getGoneHandler(on)({}, { reason: 'clean-exit' });
    expect(reload).not.toHaveBeenCalled();
  });

  it('skips reload when the window is already destroyed', () => {
    const { window, on, reload, isDestroyed } = makeFakeWindow();
    isDestroyed.mockReturnValue(true);
    attachRendererCrashRecovery(window);
    getGoneHandler(on)({}, { reason: 'crashed' });
    expect(reload).not.toHaveBeenCalled();
  });

  it('skips reload when webContents is already destroyed', () => {
    const { window, on, reload, webContentsIsDestroyed } = makeFakeWindow();
    webContentsIsDestroyed.mockReturnValue(true);
    attachRendererCrashRecovery(window);
    getGoneHandler(on)({}, { reason: 'crashed' });
    expect(reload).not.toHaveBeenCalled();
  });
});
