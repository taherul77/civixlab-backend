import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant } from "@/db/prisma";
import { appendAudit } from "@/lib/audit";
import { calibrationBlockReason } from "@/lib/calibration";
import { ACTION_PERMISSION, COMMENT_PERMISSIONS, REASON_REQUIRED, TRANSITIONS, canMove, isEditable, type WorkflowAction } from "@/lib/test-workflow";
import { userAgentOf, localPart } from "@/lib/req";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const DEFAULT_NOTE: Record<WorkflowAction, string> = {
  submit: "Submitted for review", review: "Marked as reviewed", approve: "Approved", return: "Returned for correction", sign: "Signed",
};

const TestStatus = z.enum(["draft", "submitted", "reviewed", "approved", "returned", "rejected", "signed"]);

const ListQuery = z.object({
  status: z.string().optional(),
  category: z.string().optional(),
  projectId: z.string().uuid().optional(),
  sampleId: z.string().uuid().optional(),
  testType: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const CreateBody = z.object({
  sampleId: z.string().uuid(),
  projectId: z.string().uuid(),
  testType: z.string().min(1).max(100),
  testCode: z.string().min(1).max(100),
  standardBody: z.string().max(50).optional(),
  standardNumber: z.string().max(50).optional(),
  testDate: z.string().datetime().optional(),
  inputData: z.record(z.unknown()),
  calculatedResults: z.record(z.unknown()).optional(),
  passFailStatus: z.enum(["pass", "fail", "pending", "warning"]).optional(),
  remarks: z.string().optional(),
  equipmentId: z.string().uuid().optional(),
  attachmentUrls: z.array(z.string().url()).optional(),
  weatherConditions: z.record(z.unknown()).optional(),
  calibrationVerified: z.boolean().optional(),
});

const UpdateBody = CreateBody.partial();

const WorkflowBody = z.object({ comment: z.string().optional() });

const SignBody = z.object({ certificateSerial: z.string().min(1) });

// ---------------------------------------------------------------------------
// Workflow guards (keep in sync with frontend's `submitTestForReview` etc.)
// ---------------------------------------------------------------------------

function conflict(message: string) {
  const err: Error & { statusCode?: number } = new Error(message);
  err.statusCode = 409;
  return err;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function testRoutes(app: FastifyInstance) {
  app.get("/v1/operations/tests", { onRequest: [app.requirePage("tests")] }, async (req) => {
    const q = ListQuery.parse(req.query);
    return withTenant(req.actor!.tenantId, async (tx) => {
      const where: Record<string, unknown> = {};
      if (q.status   && q.status   !== "all") where.status   = q.status;
      if (q.testType && q.testType !== "all") where.testType = q.testType;
      if (q.projectId) where.projectId = q.projectId;
      if (q.sampleId)  where.sampleId  = q.sampleId;
      if (q.q) {
        where.OR = [
          { testCode:       { contains: q.q, mode: "insensitive" } },
          { testType:       { contains: q.q, mode: "insensitive" } },
          { standardNumber: { contains: q.q, mode: "insensitive" } },
        ];
      }
      const [items, total] = await Promise.all([
        tx.test.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: q.limit ?? 100,
          skip: q.offset ?? 0,
        }),
        tx.test.count({ where }),
      ]);
      return { items, total };
    });
  });

  app.get("/v1/operations/tests/:id", { onRequest: [app.requirePage("tests")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return withTenant(req.actor!.tenantId, async (tx) => {
      const row = await tx.test.findUnique({ where: { id } });
      if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Test ${id}` } });
      return row;
    });
  });

  // ------------------------------------------------------------------ create
  app.post("/v1/operations/tests", { onRequest: [app.requirePage("tests", "create")] }, async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const { tenantId, sub: userId, email, role } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const sample = await tx.sample.findUnique({ where: { id: body.sampleId } });
      if (!sample) return reply.status(422).send({ error: { code: "VALIDATION", message: "Unknown sampleId" } });
      const project = await tx.project.findUnique({ where: { id: body.projectId } });
      if (!project) return reply.status(422).send({ error: { code: "VALIDATION", message: "Unknown projectId" } });

      const created = await tx.test.create({
        data: {
          tenantId,
          sampleId: body.sampleId,
          projectId: body.projectId,
          testType: body.testType,
          testCode: body.testCode,
          standardBody: body.standardBody,
          standardNumber: body.standardNumber,
          testDate: body.testDate ? new Date(body.testDate) : null,
          testedById: userId,
          status: "draft",
          inputData: body.inputData as never,
          calculatedResults: (body.calculatedResults ?? undefined) as never,
          passFailStatus: body.passFailStatus,
          remarks: body.remarks,
          equipmentId: body.equipmentId,
          attachmentUrls: body.attachmentUrls ?? [],
          weatherConditions: (body.weatherConditions ?? undefined) as never,
          calibrationVerified: body.calibrationVerified ?? false,
        },
      });

      await appendAudit(tx, tenantId, {
        ts: new Date().toISOString(),
        userEmail: email,
        userName: localPart(email),
        userRole: role,
        action: "create",
        entity: "test",
        entityId: created.id,
        diff: [
          { field: "code", from: "—", to: created.testCode },
          { field: "type", from: "—", to: created.testType },
        ],
        ip: req.ip,
        userAgent: userAgentOf(req),
      });

      reply.code(201);
      return created;
    });
  });

  // ------------------------------------------------------------------ update
  app.patch("/v1/operations/tests/:id", { onRequest: [app.requirePage("tests", "edit")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const patch = UpdateBody.parse(req.body);
    const { tenantId, email, role } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const before = await tx.test.findUnique({ where: { id } });
      if (!before) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Test ${id}` } });
      if (!isEditable(before.status)) {
        throw conflict(`Test ${id} cannot be edited in status "${before.status}"`);
      }
      const updated = await tx.test.update({
        where: { id },
        data: {
          ...patch,
          testDate: patch.testDate ? new Date(patch.testDate) : undefined,
          inputData:         (patch.inputData         ?? undefined) as never,
          calculatedResults: (patch.calculatedResults ?? undefined) as never,
          weatherConditions: (patch.weatherConditions ?? undefined) as never,
        },
      });
      await appendAudit(tx, tenantId, {
        ts: new Date().toISOString(),
        userEmail: email,
        userName: localPart(email),
        userRole: role,
        action: "update",
        entity: "test",
        entityId: id,
        diff: Object.keys(patch).map((k) => ({ field: k, from: "(prev)", to: "(updated)" })),
        ip: req.ip,
        userAgent: userAgentOf(req),
      });
      return updated;
    });
  });

  // ---------------------------------------------------------------- workflow
  // "reject" is the legacy route name of "return" (kept for older clients).
  const ROUTES: [string, WorkflowAction][] = [
    ["submit", "submit"], ["review", "review"], ["approve", "approve"], ["return", "return"], ["reject", "return"],
  ];
  for (const [path, action] of ROUTES) {
    const move = TRANSITIONS[action];
    app.post(`/v1/operations/tests/:id/${path}`, { onRequest: [app.requirePerm(ACTION_PERMISSION[action])] }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = WorkflowBody.parse(req.body ?? {});
      const comment = body.comment?.trim() ?? "";
      if (REASON_REQUIRED.has(action) && comment.length < 3) {
        return reply.status(400).send({ error: { code: "REASON_REQUIRED", message: "Say what needs to be corrected (at least a few words)." } });
      }
      const { tenantId, sub: userId, email, role } = req.actor!;
      return withTenant(tenantId, async (tx) => {
        const t = await tx.test.findUnique({ where: { id } });
        if (!t) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Test ${id}` } });
        if (!canMove(action, t.status)) {
          throw conflict(`Test ${id} cannot ${action} from status "${t.status}"`);
        }
        const now = new Date();

        // Approval gate (spec section 8): the linked instrument must have been in calibration.
        // Tests with no linked equipment (manual / field tests) are allowed; calibrationVerified stays false.
        let calibrationVerified: boolean | undefined;
        if (action === "approve" && t.equipmentId) {
          const eq = await tx.equipment.findUnique({ where: { id: t.equipmentId } });
          if (!eq) {
            return reply.status(409).send({ error: { code: "CALIBRATION_BLOCK", message: "Linked equipment was not found, so its calibration cannot be verified." } });
          }
          const reason = calibrationBlockReason(eq, t.testDate ?? t.createdAt);
          if (reason) {
            return reply.status(409).send({ error: { code: "CALIBRATION_BLOCK", message: reason } });
          }
          calibrationVerified = true;
        }

        // A returned test starts a new review cycle: earlier review/approval marks must not carry over.
        const resetCycle = action === "return" || (action === "submit" && t.status !== "draft");
        // Guarded by the current status so two reviewers acting at once cannot both succeed.
        const moved = await tx.test.updateMany({
          where: { id, status: { in: move.from } },
          data: {
            ...(calibrationVerified ? { calibrationVerified } : {}),
            status: move.to,
            ...(action === "review"  ? { reviewedById: userId, reviewedAt: now } : {}),
            ...(action === "approve" ? { approvedById: userId, approvedAt: now } : {}),
            ...(action === "submit"  ? { completedAt: now } : {}),
            ...(resetCycle ? { reviewedById: null, reviewedAt: null, approvedById: null, approvedAt: null, calibrationVerified: false } : {}),
          },
        });
        if (moved.count === 0) throw conflict(`Test ${id} was changed by someone else; reload and try again.`);
        const updated = await tx.test.findUnique({ where: { id } });
        // Every decision shows in the thread (with the note when there is one).
        await tx.testComment.create({
          data: {
            tenantId, testId: id, authorEmail: email, authorName: localPart(email), kind: action,
            body: comment || DEFAULT_NOTE[action],
          },
        });
        await appendAudit(tx, tenantId, {
          userEmail: email,
          userName: localPart(email),
          userRole: role,
          action,
          entity: "test",
          entityId: id,
          diff: [
            { field: "status", from: t.status, to: move.to },
            ...(comment ? [{ field: "comment", from: "—", to: comment }] : []),
          ],
          ip: req.ip,
          userAgent: userAgentOf(req),
        });
        return updated;
      });
    });
  }

  // ---------------------------------------------------------------- comments
  const CommentBody = z.object({ body: z.string().trim().min(1).max(2000) });
  const canComment = (req: { actor: { permissions: string[]; isSuperAdmin: boolean } | null }) =>
    !!req.actor && (req.actor.isSuperAdmin || COMMENT_PERMISSIONS.some((p) => req.actor!.permissions.includes(p)));

  app.get("/v1/operations/tests/:id/comments", { onRequest: [app.requirePage("tests")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return withTenant(req.actor!.tenantId, async (tx) => {
      const t = await tx.test.findUnique({ where: { id }, select: { id: true } });
      if (!t) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Test ${id}` } });
      const rows = await tx.testComment.findMany({ where: { testId: id }, orderBy: { createdAt: "asc" } });
      return {
        items: rows.map((c) => ({
          id: c.id, kind: c.kind, body: c.body, authorEmail: c.authorEmail,
          authorName: c.authorName, createdAt: c.createdAt.toISOString(),
        })),
      };
    });
  });

  app.post("/v1/operations/tests/:id/comments", { onRequest: [app.requirePage("tests")] }, async (req, reply) => {
    if (!canComment(req)) return reply.status(403).send({ error: { code: "FORBIDDEN", message: "You cannot comment on tests." } });
    const { id } = req.params as { id: string };
    const { body } = CommentBody.parse(req.body);
    const { tenantId, email, role } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const t = await tx.test.findUnique({ where: { id }, select: { id: true } });
      if (!t) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Test ${id}` } });
      const c = await tx.testComment.create({
        data: { tenantId, testId: id, authorEmail: email, authorName: localPart(email), kind: "comment", body },
      });
      await appendAudit(tx, tenantId, {
        userEmail: email, userName: localPart(email), userRole: role,
        action: "comment", entity: "test", entityId: id,
        diff: [{ field: "comment", from: "—", to: body.length > 200 ? `${body.slice(0, 200)}...` : body }],
        ip: req.ip, userAgent: userAgentOf(req),
      });
      reply.code(201);
      return { id: c.id, kind: c.kind, body: c.body, authorEmail: c.authorEmail, authorName: c.authorName, createdAt: c.createdAt.toISOString() };
    });
  });

  // -------------------------------------------------------------------- sign
  app.post("/v1/operations/tests/:id/sign", { onRequest: [app.requirePerm("test:sign")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = SignBody.parse(req.body);
    const { tenantId, email, role } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const t = await tx.test.findUnique({ where: { id } });
      if (!t) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Test ${id}` } });
      const signMove = TRANSITIONS.sign;
      if (!signMove.from.includes(t.status)) {
        throw conflict(`Test ${id} cannot be signed from status "${t.status}"`);
      }
      const now = new Date();
      const updated = await tx.test.update({
        where: { id },
        data: { status: "signed" },
      });
      await appendAudit(tx, tenantId, {
        ts: now.toISOString(),
        userEmail: email,
        userName: localPart(email),
        userRole: role,
        action: "sign",
        entity: "test",
        entityId: id,
        diff: [
          { field: "status",    from: t.status, to: "signed" },
          { field: "signature", from: "—",      to: body.certificateSerial },
        ],
        ip: req.ip,
        userAgent: userAgentOf(req),
      });
      return updated;
    });
  });
}
