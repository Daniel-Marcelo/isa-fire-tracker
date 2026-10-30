// Web Worker: runs the Monte Carlo and historical stress tests off the main
// thread so typing in the FIRE inputs never blocks. The calculation lives in
// fireCalc.ts (a pure function) so the main-thread fallback in useStressTest.ts
// runs the identical logic.
import { runFireCalc, type FireCalcRequest, type FireCalcResult } from './fireCalc';

// Cast around the DOM/webworker lib overlap: postMessage in a dedicated worker
// takes just the message, but the DOM-lib `self` types it as Window's variant.
const post = (msg: FireCalcResult) =>
  (self as unknown as { postMessage(m: FireCalcResult): void }).postMessage(msg);

self.onmessage = (e: MessageEvent<FireCalcRequest>) => post(runFireCalc(e.data));
