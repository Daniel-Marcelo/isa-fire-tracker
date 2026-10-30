import { useEffect, useRef, useState } from 'react';
import type { FireSettings } from '../types';
import type { FirePots } from '../lib/fireEngine';
import { runFireCalc, type FireCalcRequest, type FireCalcResult } from '../lib/fireCalc';

export function useStressTest(settings: FireSettings, pots: FirePots, retireAge: number | null) {
  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(0);
  const [calc, setCalc] = useState<FireCalcResult | null>(null);
  const [isRecomputing, setIsRecomputing] = useState(true);
  const [calcError, setCalcError] = useState(false);
  useEffect(() => () => workerRef.current?.terminate(), []);
  useEffect(() => {
    setIsRecomputing(true);
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const t = setTimeout(() => {
      workerRef.current?.terminate();
      const id = ++reqIdRef.current;
      const req: FireCalcRequest = { id, settings, pots, retireAge };
      let settled = false;
      const fallback = () => setTimeout(() => {
        if (id !== reqIdRef.current) return;
        try { setCalc(runFireCalc(req)); setCalcError(true); }
        catch { setCalcError(true); }
        finally { setIsRecomputing(false); }
      }, 0);
      try {
        const w = new Worker(new URL('../lib/fireWorker.ts', import.meta.url), { type: 'module' });
        workerRef.current = w;
        w.onmessage = (e: MessageEvent<FireCalcResult>) => {
          if (e.data.id !== id || settled) return;
          settled = true; clearTimeout(watchdog); setCalc(e.data); setCalcError(false); setIsRecomputing(false);
        };
        w.onerror = () => { if (settled) return; settled = true; clearTimeout(watchdog); w.terminate(); fallback(); };
        watchdog = setTimeout(() => { if (settled) return; settled = true; w.terminate(); fallback(); }, 8000);
        w.postMessage(req);
      } catch { fallback(); }
    }, 300);
    return () => { clearTimeout(t); clearTimeout(watchdog); };
  }, [settings, pots, retireAge]);
  return { calc, isRecomputing, calcError, awaitingFirst: calc == null };
}
