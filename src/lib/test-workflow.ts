/**
 * Test review workflow (spec section 5).
 *
 *   draft -> submitted -> reviewed -> approved -> signed
 *                  \________\__ return (reason required) -> returned -> (edit) -> submitted
 *
 * "rejected" is the legacy name of "returned" (older rows); both behave the same.
 */
export type WorkflowAction = "submit" | "review" | "approve" | "return" | "sign";

export const TRANSITIONS: Record<WorkflowAction, { from: string[]; to: string }> = {
  submit:  { from: ["draft", "returned", "rejected"], to: "submitted" },
  review:  { from: ["submitted"],                     to: "reviewed" },
  approve: { from: ["submitted", "reviewed"],         to: "approved" },
  return:  { from: ["submitted", "reviewed"],         to: "returned" },
  sign:    { from: ["approved"],                      to: "signed" },
};

/** Only these statuses may be edited; approved/signed results are locked. */
export const EDITABLE_STATUSES = ["draft", "returned", "rejected"];

/** A reviewer must say what to correct. */
export const REASON_REQUIRED: ReadonlySet<WorkflowAction> = new Set(["return"]);

export const canMove = (action: WorkflowAction, status: string) => TRANSITIONS[action].from.includes(status);
export const isEditable = (status: string) => EDITABLE_STATUSES.includes(status);

/** Permission that gates each action (permission strings, not page grants). */
export const ACTION_PERMISSION: Record<WorkflowAction, string> = {
  submit: "test:submit",
  review: "test:review",
  approve: "test:approve",
  return: "test:review",
  sign: "test:sign",
};

/** Any of these lets a user take part in the comment thread of a test. */
export const COMMENT_PERMISSIONS = ["test:review", "test:approve", "test:update", "test:submit", "test:create"];
