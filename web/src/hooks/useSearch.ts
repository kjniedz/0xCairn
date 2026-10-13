import { useEffect, useState } from 'preact/hooks';
import { SearchController } from '../engine/search';
import type { SearchSnapshot } from '../engine/types';

let controller: SearchController | null = null;
let initStarted = false;

export function getController(): SearchController {
  if (!controller) controller = new SearchController();
  return controller;
}

export function useSearch(): { snap: SearchSnapshot; controller: SearchController } {
  const c = getController();
  const [snap, setSnap] = useState<SearchSnapshot>(() => c.snapshot());
  useEffect(() => {
    const unsub = c.subscribe(setSnap);
    if (!initStarted) {
      initStarted = true;
      void c.init();
    }
    return unsub;
  }, [c]);
  return { snap, controller: c };
}

/** Re-renders every `ms` while `active`, for elapsed-time displays. */
export function useTicker(active: boolean, ms = 500): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((t) => t + 1), ms);
    return () => window.clearInterval(id);
  }, [active, ms]);
  return tick;
}
