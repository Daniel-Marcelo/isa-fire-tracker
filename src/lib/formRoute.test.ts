import { describe, it, expect } from 'vitest';
import { isFormRoute } from './formRoute';

describe('isFormRoute', () => {
  it('hides the app chrome on edit screens only', () => {
    expect(isFormRoute('/holdings/new')).toBe(true);
    expect(isFormRoute('/holdings/abc/edit')).toBe(true);
    expect(isFormRoute('/holdings/abc/holdings/new')).toBe(true);
    expect(isFormRoute('/holdings/abc/holdings/h1')).toBe(true);
    expect(isFormRoute('/fire/adjust')).toBe(true);
    expect(isFormRoute('/fire/assumptions')).toBe(true);
    expect(isFormRoute('/allowance')).toBe(true);

    expect(isFormRoute('/')).toBe(false);
    expect(isFormRoute('/holdings')).toBe(false);
    expect(isFormRoute('/holdings/abc')).toBe(false);
    expect(isFormRoute('/fire')).toBe(false);
    expect(isFormRoute('/lookthrough')).toBe(false);
    expect(isFormRoute('/funds')).toBe(false);
  });
});
