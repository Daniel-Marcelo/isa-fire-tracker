// Web Worker: runs the heavy Monte Carlo suite off the main thread so typing in
// the FIRE inputs never blocks. A single recompute is ~40 full simulations
// (~4s on the main thread); here it runs in the background and posts results
// back. The actual calculation lives in fireCalc.ts (a pure function) so the
// main-thread fallback in FIRECalculator.tsx can call the identical logic.
import { runFireCalc, type FireCalcRequest, type FireCalcResult } from './fireCalc';

// Cast around the DOM/webworker lib overlap: postMessage in a dedicated worker
// takes just the message, but the DOM-lib `self` types it as Window's variant.
const post = (msg: FireCalcResult) =>
  (self as unknown as { postMessage(m: FireCalcResult): void }).postMessage(msg);

self.onmessage = (e: MessageEvent<FireCalcRequest>) => post(runFireCalc(e.data));
