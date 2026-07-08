import type { FireSettings } from '../types';

export interface ProjectionResult {
  points: { age: number; accessible: number; pension: number; combined: number }[];
  earlyFireAge: number | null;
  fullFireAge: number | null;
}

export const DEFAULT_SWR = 0.035;

export function realMonthlyRate(nominalPct: number, inflationPct: number): number {
  const realAnnual = (1 + nominalPct / 100) / (1 + inflationPct / 100) - 1;
  return Math.pow(1 + realAnnual, 1 / 12) - 1;
}

export function findFireAges(
  settings: FireSettings,
  accessibleStart: number,
  pensionStart: number,
): { earlyFireAge: number | null; fullFireAge: number | null } {
  const { currentAge, monthlyContribution, monthlyPensionContribution, pensionAccessAge, expectedAnnualReturn, inflationRate, annualExpensesInRetirement } = settings;
  const mRate = realMonthlyRate(expectedAnnualReturn, inflationRate);
  const totalMonthlyPension = monthlyPensionContribution ?? 0;
  const monthlySpend = annualExpensesInRetirement / 12;
  const swr = (settings.withdrawalRate ?? DEFAULT_SWR * 100) / 100;
  const pensionTarget = annualExpensesInRetirement / swr;

  let accessible = accessibleStart;
  let pension = pensionStart;
  let earlyFireAge: number | null = null;
  let fullFireAge: number | null = null;

  for (let m = 0; m <= 600; m++) {
    const age = currentAge + m / 12;

    if (m % 12 === 0) {
      if (earlyFireAge === null && age < pensionAccessAge) {
        const monthsUntilPension = Math.round((pensionAccessAge - age) * 12);
        let sim = accessible;
        let bridgeOk = true;
        for (let i = 0; i < monthsUntilPension; i++) {
          sim = sim * (1 + mRate) - monthlySpend;
          if (sim < 0) { bridgeOk = false; break; }
        }
        if (bridgeOk) {
          let simPension = pension;
          for (let i = 0; i < monthsUntilPension; i++) {
            simPension = simPension * (1 + mRate);
          }
          if (sim + simPension >= pensionTarget) earlyFireAge = age;
        }
      }

      if (fullFireAge === null && age >= pensionAccessAge) {
        if (Math.max(accessible, 0) + pension >= pensionTarget) fullFireAge = age;
      }

      if (earlyFireAge !== null && fullFireAge !== null) break;
    }

    const retiredYet = earlyFireAge !== null && age >= earlyFireAge;
    accessible = accessible * (1 + mRate) + (retiredYet ? 0 : monthlyContribution);
    pension = pension * (1 + mRate) + (retiredYet ? 0 : totalMonthlyPension);
  }

  return { earlyFireAge, fullFireAge };
}

export function project(
  settings: FireSettings,
  accessibleStart: number,
  pensionStart: number,
): ProjectionResult {
  const { currentAge, monthlyContribution, monthlyPensionContribution, pensionAccessAge, expectedAnnualReturn, inflationRate, annualExpensesInRetirement } = settings;

  const mRate = realMonthlyRate(expectedAnnualReturn, inflationRate);
  const totalMonthlyPension = monthlyPensionContribution ?? 0;
  const monthlySpend = annualExpensesInRetirement / 12;

  const { earlyFireAge, fullFireAge } = findFireAges(settings, accessibleStart, pensionStart);
  const retireAge = Math.min(earlyFireAge ?? Infinity, fullFireAge ?? Infinity);

  const points: ProjectionResult['points'] = [];
  let accessible = accessibleStart;
  let pension = pensionStart;

  for (let m = 0; m <= 600; m++) {
    const age = currentAge + m / 12;
    const retired = isFinite(retireAge) && age >= retireAge;
    const pensionUnlockedForDrawdown = age >= pensionAccessAge;

    if (m % 12 === 0) {
      points.push({
        age: Math.round(age),
        accessible: Math.round(Math.max(accessible, 0)),
        pension: Math.round(Math.max(pension, 0)),
        combined: Math.round(Math.max(accessible, 0) + Math.max(pension, 0)),
      });
    }

    if (retired) {
      if (!pensionUnlockedForDrawdown) {
        accessible = accessible * (1 + mRate) - monthlySpend;
        pension = pension * (1 + mRate);
      } else {
        const total = Math.max(accessible + pension, 0);
        const accRatio = total > 0 ? Math.max(accessible, 0) / total : 0;
        accessible = accessible * (1 + mRate) - monthlySpend * accRatio;
        pension = pension * (1 + mRate) - monthlySpend * (1 - accRatio);
      }
    } else {
      accessible = accessible * (1 + mRate) + monthlyContribution;
      pension = pension * (1 + mRate) + totalMonthlyPension;
    }
  }

  return { points, earlyFireAge, fullFireAge };
}
