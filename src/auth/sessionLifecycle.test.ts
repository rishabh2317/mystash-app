import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bindAuthAutoRefresh,
  isAuthAutoRefreshBound,
  unbindAuthAutoRefresh,
} from './sessionLifecycle';

describe('auth session lifecycle', () => {
  it('starts refresh when active and stops when backgrounded, once', () => {
    unbindAuthAutoRefresh();
    const calls: string[] = [];
    const listeners: ((state: string) => void)[] = [];
    const auth = {
      startAutoRefresh: () => calls.push('start'),
      stopAutoRefresh: () => calls.push('stop'),
    };
    const appState = {
      currentState: 'active',
      addEventListener: (_type: 'change', listener: (state: string) => void) => {
        listeners.push(listener);
        return { remove: () => listeners.splice(listeners.indexOf(listener), 1) };
      },
    };

    const first = bindAuthAutoRefresh(auth, appState);
    const second = bindAuthAutoRefresh(auth, appState);
    assert.equal(first.alreadyBound, false);
    assert.equal(second.alreadyBound, true);
    assert.equal(isAuthAutoRefreshBound(), true);
    assert.deepEqual(calls, ['start']);
    assert.equal(listeners.length, 1);

    listeners[0]('background');
    listeners[0]('inactive');
    listeners[0]('active');
    assert.deepEqual(calls, ['start', 'stop', 'stop', 'start']);

    unbindAuthAutoRefresh();
    assert.equal(isAuthAutoRefreshBound(), false);
    assert.equal(listeners.length, 0);
    listeners[0]?.('active');
    assert.deepEqual(calls, ['start', 'stop', 'stop', 'start']);
  });
});
