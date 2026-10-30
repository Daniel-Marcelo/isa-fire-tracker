import { useCallback, useDeferredValue, useMemo } from 'react';
import type { AppData, FireSettings } from '../types';
import { chosenRetirementAgeOf, planToAgeOf, potsFromProviders } from '../lib/fireEngine';
import { project, requiredSavingFor } from '../lib/fireProjection';
import { fireNumberOf } from '../lib/fireNumber';

export function usePlan(data: AppData, rawData: AppData, onChange: (data: AppData) => void) {
  const s = data.fireSettings;
  const update = useCallback(
    (patch: Partial<FireSettings>) => onChange({ ...rawData, fireSettings: { ...rawData.fireSettings, ...patch } }),
    [onChange, rawData],
  );
  const pots = useMemo(() => potsFromProviders(data.providers), [data.providers]);
  const mode = s.fireMode ?? 'earliest';
  const planTo = planToAgeOf(s);
  const ds = useDeferredValue(s);
  const result = useMemo(
    () => project(ds, pots, (ds.fireMode ?? 'earliest') === 'fixedAge' ? chosenRetirementAgeOf(ds) : undefined),
    [ds, pots],
  );
  const requiredSaving = useMemo(
    () => (ds.fireMode ?? 'earliest') === 'fixedAge' ? requiredSavingFor(ds, pots, chosenRetirementAgeOf(ds)) : null,
    [ds, pots],
  );
  const fireNumber = useMemo(() => fireNumberOf(s, pots), [s, pots]);
  return {
    s,
    ds,
    update,
    pots,
    mode,
    planTo,
    chosenAge: chosenRetirementAgeOf(s),
    degenerateHorizon: planTo <= s.currentAge + 1,
    result,
    retireAge: result.retireAge,
    requiredSaving,
    fireNumber,
    currentTotalContribution: s.monthlyContribution + (s.monthlyPensionContribution ?? 0),
    statePensionOn: s.statePensionEnabled ?? true,
    statePensionAge: s.statePensionAge ?? 67,
    pensionAccessAge: s.pensionAccessAge ?? 57,
  };
}
