import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant } from "@/db/prisma";
import { appendAudit } from "@/lib/audit";
import { userAgentOf, localPart } from "@/lib/req";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const TestStatus = z.enum(["draft", "submitted", "reviewed", "approved", "rejected", "signed"]);

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

type Transition = { from: string[]; to: string };
const TRANSITIONS = {
  submit:  { from: ["draft"],                  to: "submitted" },
  review:  { from: ["submitted"],              to: "reviewed"  },
  approve: { from: ["submitted", "reviewed"],  to: "approved"  },
  reject:  { from: ["submitted", "reviewed"],  to: "rejected"  },
  sign:    { from: ["approved"],               to: "signed"    },
} satisfies Record<string, Transition>;

function conflict(message: string) {
  const err: Error & { statusCode?: number } = new Error(message);
  err.statusCode = 409;
  return err;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function testRoutes(app: FastifyInstance) {
  app.get("/v1/operations/tests", { onRequest: [app.requireAuth] }, async (req) => {
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

  app.get("/v1/operations/tests/:id", { onRequest: [app.requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return withTenant(req.actor!.tenantId, async (tx) => {
      const row = await tx.test.findUnique({ where: { id } });
      if (!row) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Test ${id}` } });
      return row;
    });
  });

  // ------------------------------------------------------------------ create
  app.post("/v1/operations/tests", { onRequest: [app.requirePerm("test:create")] }, async (req, reply) => {
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
  app.patch("/v1/operations/tests/:id", { onRequest: [app.requirePerm("test:update")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const patch = UpdateBody.parse(req.body);
    const { tenantId, email, role } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const before = await tx.test.findUnique({ where: { id } });
      if (!before) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Test ${id}` } });
      if (before.status !== "draft" && before.status !== "rejected") {
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
  for (const transition of ["submit", "review", "approve", "reject"] as const) {
    const perm =
      transition === "submit"  ? "test:submit"  :
      transition === "approve" ? "test:approve" :
                                 "test:review";
    const move: Transition = TRANSITIONS[transition];
    app.post(`/v1/operations/tests/:id/${transition}`, { onRequest: [app.requirePerm(perm)] }, async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = WorkflowBody.parse(req.body ?? {});
      const { tenantId, sub: userId, email, role } = req.actor!;
      return withTenant(tenantId, async (tx) => {
        const t = await tx.test.findUnique({ where: { id } });
        if (!t) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Test ${id}` } });
        if (!move.from.includes(t.status)) {
          throw conflict(`Test ${id} cannot ${transition} from status "${t.status}"`);
        }
        const now = new Date();
        const updated = await tx.test.update({
          where: { id },
          data: {
            status: move.to,
            ...(transition === "review"  ? { reviewedById: userId, reviewedAt: now } : {}),
            ...(transition === "approve" ? { approvedById: userId, approvedAt: now } : {}),
            ...(transition === "submit"  ? { completedAt: now } : {}),
          },
        });
        await appendAudit(tx, tenantId, {
          ts: now.toISOString(),
          userEmail: email,
          userName: localPart(email),
          userRole: role,
          action: transition,
          entity: "test",
          entityId: id,
          diff: [
            { field: "status", from: t.status, to: move.to },
            ...(body.comment ? [{ field: "comment", from: "—", to: body.comment }] : []),
          ],
          ip: req.ip,
          userAgent: userAgentOf(req),
        });
        return updated;
      });
    });
  }

  // -------------------------------------------------------------------- sign
  app.post("/v1/operations/tests/:id/sign", { onRequest: [app.requirePerm("test:sign")] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = SignBody.parse(req.body);
    const { tenantId, email, role } = req.actor!;
    return withTenant(tenantId, async (tx) => {
      const t = await tx.test.findUnique({ where: { id } });
      if (!t) return reply.status(404).send({ error: { code: "NOT_FOUND", message: `Test ${id}` } });
      const signMove: Transition = TRANSITIONS.sign;
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
