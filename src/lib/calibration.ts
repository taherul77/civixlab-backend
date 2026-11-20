/**
 * Spec section 8: out-of-calibration equipment blocks test approval.
 *
 * Calibration is judged at the time the test was performed, not today: a test
 * run while the instrument was in calibration stays valid after the due date
 * passes. Equipment currently out of service / retired is blocked outright.
 */
export interface CalibrationSubject {
  equipmentCode: string;
  status: string;
  calibrationDueDate: Date | null;
}

export function calibrationBlockReason(eq: CalibrationSubject, performedAt: Date): string | null {
  if (eq.status === "out_of_service" || eq.status === "retired") {
    return `Equipment ${eq.equipmentCode} is ${eq.status.replace(/_/g, " ")}; results cannot be approved.`;
  }
  if (eq.calibrationDueDate && eq.calibrationDueDate.getTime() < performedAt.getTime()) {
    const due = eq.calibrationDueDate.toISOString().slice(0, 10);
    return `Equipment ${eq.equipmentCode} calibration expired on ${due}, before this test was performed.`;
  }
  return null;
}
