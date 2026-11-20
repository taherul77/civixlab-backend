/**
 * Spec section 8: out-of-calibration equipment blocks test approval.
 *
 * Calibration DATES are judged at the time the test was performed, not today:
 * a test run while the instrument was in calibration stays valid after the due
 * date passes, and the due date itself is valid through the end of that day.
 *
 * STATUS is deliberately judged as of now (conservative): equipment currently
 * out of service / retired blocks approval, because that status usually means
 * the instrument was found faulty and earlier results are in doubt.
 */
const DAY_MS = 86_400_000;

export interface CalibrationSubject {
  equipmentCode: string;
  status: string;
  calibrationDueDate: Date | null;
}

export function calibrationBlockReason(eq: CalibrationSubject, performedAt: Date): string | null {
  if (eq.status === "out_of_service" || eq.status === "retired") {
    return `Equipment ${eq.equipmentCode} is ${eq.status.replace(/_/g, " ")}; results cannot be approved.`;
  }
  // Due dates are date-only (midnight UTC): the instrument is valid through that whole day.
  if (eq.calibrationDueDate && eq.calibrationDueDate.getTime() + DAY_MS <= performedAt.getTime()) {
    const due = eq.calibrationDueDate.toISOString().slice(0, 10);
    return `Equipment ${eq.equipmentCode} calibration expired on ${due}, before this test was performed.`;
  }
  return null;
}
