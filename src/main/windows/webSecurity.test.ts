import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Handler {
  setWindowOpenHandler: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  session: { setPermissionRequestHandler: ReturnType<typeof vi.fn> };
}

const handlers: Handler[] = [];

vi.mock('electron', () => {
  return {
    shell: {
      openExternal: vi.fn(),
    },
  };
});

import { lockDownWebContents } from './webSecurity';

function makeFakeWindow(): { window: Parameters<typeof lockDownWebContents>[0]; handlers: Handler } {
  const setWindowOpenHandler = vi.fn();
  const on = vi.fn();
  const setPermissionRequestHandler = vi.fn();
  const session = { setPermissionRequestHandler };
  const window = {
    webContents: {
      setWindowOpenHandler,
      on,
      session,
    },
  } as unknown as Parameters<typeof lockDownWebContents>[0];
  const handlers: Handler = { setWindowOpenHandler, on, session };
  return { window, handlers };
}

describe('lockDownWebContents', () => {
  beforeEach(() => {
    handlers.length = 0;
  });

  it('registers a window-open handler that denies', () => {
    const { window, handlers: h } = makeFakeWindow();
    lockDownWebContents(window);
    expect(h.setWindowOpenHandler).toHaveBeenCalledTimes(1);
    const handler = h.setWindowOpenHandler.mock.calls[0]![0];
    expect(handler({ url: 'https://evil.example/' })).toEqual({ action: 'deny' });
  });

  it('listens for will-navigate and blocks external URLs', () => {
    const { window, handlers: h } = makeFakeWindow();
    lockDownWebContents(window);
    const navigateCall = h.on.mock.calls.find((c) => c[0] === 'will-navigate');
    expect(navigateCall).toBeDefined();
    const navigateHandler = navigateCall![1] as (event: { preventDefault: () => void }, url: string) => void;
    const evt = { preventDefault: vi.fn() };
    navigateHandler(evt, 'https://evil.example/');
    expect(evt.preventDefault).toHaveBeenCalled();
  });

  it('allows local file:// and http://localhost initial loads', () => {
    const { window, handlers: h } = makeFakeWindow();
    lockDownWebContents(window);
    const navigateCall = h.on.mock.calls.find((c) => c[0] === 'will-navigate');
    const navigateHandler = navigateCall![1] as (event: { preventDefault: () => void }, url: string) => void;
    const evt = { preventDefault: vi.fn() };
    navigateHandler(evt, 'file:///path/to/renderer/index.html');
    navigateHandler(evt, 'http://localhost:5173/?view=shelf');
    navigateHandler(evt, 'http://127.0.0.1:5173/?view=shelf');
    expect(evt.preventDefault).not.toHaveBeenCalled();
  });

  it('blocks http://localhost.evil.example/ as a prefix-confusion attempt', () => {
    const { window, handlers: h } = makeFakeWindow();
    lockDownWebContents(window);
    const navigateCall = h.on.mock.calls.find((c) => c[0] === 'will-navigate');
    const navigateHandler = navigateCall![1] as (event: { preventDefault: () => void }, url: string) => void;
    const evt = { preventDefault: vi.fn() };
    navigateHandler(evt, 'http://localhost.evil.example/');
    expect(evt.preventDefault).toHaveBeenCalled();
  });

  it('blocks unparseable URLs', () => {
    const { window, handlers: h } = makeFakeWindow();
    lockDownWebContents(window);
    const navigateCall = h.on.mock.calls.find((c) => c[0] === 'will-navigate');
    const navigateHandler = navigateCall![1] as (event: { preventDefault: () => void }, url: string) => void;
    const evt = { preventDefault: vi.fn() };
    navigateHandler(evt, 'not-a-url');
    expect(evt.preventDefault).toHaveBeenCalled();
  });

  it('denies all permission requests by default', () => {
    const { window, handlers: h } = makeFakeWindow();
    lockDownWebContents(window);
    expect(h.session.setPermissionRequestHandler).toHaveBeenCalledTimes(1);
    const permHandler = h.session.setPermissionRequestHandler.mock.calls[0]![0] as (
      _wc: unknown,
      _permission: string,
      callback: (granted: boolean) => void,
    ) => void;
    const callback = vi.fn();
    permHandler(null, 'notifications', callback);
    expect(callback).toHaveBeenCalledWith(false);
  });
});
