/** Start of the current calendar month, UTC (the window the monthly test allowance is counted in). */
export function monthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** True when creating one more would exceed the allowance. A limit of 0 or less means "none allowed". */
export function monthlyLimitReached(usedThisMonth: number, max: number): boolean {
  return usedThisMonth >= Math.max(0, max);
}

export const monthlyLimitMessage = (max: number) =>
  `Monthly test limit reached (${max}). New tests can be created again next month, or contact your platform administrator.`;
