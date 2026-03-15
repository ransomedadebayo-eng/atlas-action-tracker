import { useEffect } from 'react';

export function useKeyboard(shortcuts) {
  useEffect(() => {
    function handler(e) {
      for (const shortcut of shortcuts) {
        const { key, meta, ctrl, shift, action, preventDefault = true } = shortcut;
        const metaMatch = meta ? (e.metaKey || e.ctrlKey) : true;
        const ctrlMatch = ctrl ? e.ctrlKey : true;
        const shiftMatch = shift ? e.shiftKey : !e.shiftKey;

        if (
          e.key.toLowerCase() === key.toLowerCase() &&
          metaMatch && ctrlMatch && shiftMatch
        ) {
          if (preventDefault) e.preventDefault();
          action(e);
          return;
        }
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts]);
}

export function useVisibilityRefresh(refetchFns) {
  useEffect(() => {
    function handler() {
      if (document.visibilityState === 'visible') {
        for (const fn of refetchFns) {
          if (typeof fn === 'function') fn();
        }
      }
    }

    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [refetchFns]);
}
