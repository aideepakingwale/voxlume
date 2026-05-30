import express from "express";
import { makeId, serializeEvent, signSuperadminToken, signTenantToken, verifySuperadminToken, verifyTenantToken } from "./domain.js";
import { sendCsv, sendPdf, sendXlsx } from "./exporters.js";

export function createApiRouter({ repository, emitEvent }) {
  const router = express.Router();
  const paths = (path) => [path, path.endsWith("/") ? path.slice(0, -1) : `${path}/`];

  function getBearerToken(req) {
    const value = String(req.headers.authorization || "");
    return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
  }

  function requireTenantAuth(req, res) {
    const payload = verifyTenantToken(getBearerToken(req));
    if (!payload) {
      res.status(401).json({ error: "Tenant authentication required" });
      return null;
    }
    return payload;
  }

  function requireSuperadminAuth(req, res) {
    const payload = verifySuperadminToken(getBearerToken(req));
    if (!payload) {
      res.status(401).json({ error: "Superadmin authentication required" });
      return null;
    }
    return payload;
  }

  async function sendVerificationEmail({ to, name, link }) {
    const resendKey = process.env.RESEND_API_KEY || "";
    const from = process.env.RESEND_FROM_EMAIL || `VoxLume <no-reply@${String(process.env.EMAIL_DOMAIN || "voxlume.local").replace(/^https?:\/\//, "")}>`;
    if (!resendKey) return false;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: "Verify your VoxLume workspace",
        html: `<p>Hello ${name || "there"},</p><p>Please verify your workspace by opening this link:</p><p><a href="${link}">${link}</a></p><p>This link expires soon.</p>`,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || "Failed to send verification email");
    }
    return true;
  }

  async function requireEvent(req, res) {
    const event = await repository.getEventByCode(req.params.code);
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return null;
    }
    return event;
  }

  async function saveAndEmit(res, code, action) {
    try {
      const event = await action();
      if (!event) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }
      emitEvent(event);
      res.json(event);
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message || "Request failed" });
    }
  }

  router.get(paths("/health"), async (req, res) => {
    const events = await repository.getEvents();
    res.json({ ok: true, events: events.length, timestamp: new Date().toISOString() });
  });

  router.post(paths("/login"), async (req, res) => {
    const payload = req.body || {};
    if (!payload.email || !payload.password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }
    try {
      const user = await repository.authenticateTenantAdmin(payload.email, payload.password);
      if (!user) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      const token = signTenantToken({
        orgId: user.organization.id,
        userId: user.id,
        email: user.email,
        role: user.role,
      });
      res.json({ ...user, token });
    } catch (error) {
      res.status(error.statusCode || 500).json({ error: error.message || "Login failed" });
    }
  });

  router.post(paths("/superadmin/login"), async (req, res) => {
    const payload = req.body || {};
    if (!payload.email || !payload.password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }
    const admin = await repository.authenticatePlatformAdmin(payload.email, payload.password);
    if (!admin) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    res.json({ ...admin, token: signSuperadminToken(admin.email) });
  });

  router.get(paths("/verify-email/:token"), async (req, res) => {
    const verified = await repository.verifyEmailToken(req.params.token);
    if (!verified) {
      res.status(400).json({ error: "Verification link is invalid or expired" });
      return;
    }
    res.json({
      ok: true,
      email: verified.email,
      organizationId: verified.organization_id,
      verifiedAt: verified.verified_at || new Date().toISOString(),
    });
  });

  router.get(paths("/public/events/:code"), async (req, res) => {
    const event = await repository.getSerializedEventByCode(req.params.code);
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    res.json(event);
  });

  router.get(paths("/events"), async (req, res) => {
    const auth = requireTenantAuth(req, res);
    if (!auth) return;
    res.json(await repository.getEventsByOrganization(auth.orgId));
  });

  router.post(paths("/events"), async (req, res) => {
    const auth = requireTenantAuth(req, res);
    if (!auth) return;
    const event = await repository.createEvent({ ...req.body, organizationId: auth.orgId });
    emitEvent(event);
    res.status(201).json(event);
  });

  router.get(paths("/plans"), async (req, res) => {
    res.json(await repository.getPlans());
  });

  router.post(paths("/register"), async (req, res) => {
    try {
      const payload = req.body || {};
      if (!payload.email || !payload.company || !payload.name) {
        res.status(400).json({ error: "Name, email, and company are required" });
        return;
      }
      const existingUser = await repository.findUserByEmail(payload.email);
      if (existingUser) {
        res.status(409).json({ error: "That email is already registered" });
        return;
      }
      const account = await repository.createOrganizationWithAdmin(payload);
      const { token: verificationToken, expiresAt } = await repository.createEmailVerificationToken(account.user.id);
      const verificationLink = `${new URL(req.originalUrl, `${req.protocol}://${req.get("host")}`).origin}/verify/${encodeURIComponent(verificationToken)}`;
      const sent = await sendVerificationEmail({
        to: account.user.email,
        name: account.user.name,
        link: verificationLink,
      }).catch(() => false);
      res.status(201).json({
        ...account,
        verification: {
          sent,
          link: verificationLink,
          expiresAt,
        },
      });
    } catch (error) {
      const isDuplicate = error?.code === "EMAIL_EXISTS" || String(error.message || "").includes("UNIQUE");
      res.status(isDuplicate ? 409 : 500).json({ error: isDuplicate ? "That email is already registered" : error.message });
    }
  });

  router.get(paths("/admin/organizations/:organizationId"), async (req, res) => {
    const token = getBearerToken(req);
    const superadminAuth = verifySuperadminToken(token);
    const tenantAuth = verifyTenantToken(token);
    if (!superadminAuth && !tenantAuth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!superadminAuth && tenantAuth.orgId !== req.params.organizationId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const account = await repository.getOrganizationAdmin(req.params.organizationId);
    if (!account) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    res.json(account);
  });

  router.get(paths("/superadmin/overview"), async (req, res) => {
    const auth = requireSuperadminAuth(req, res);
    if (!auth) return;
    res.json(await repository.getPlatformOverview());
  });

  router.get(paths("/superadmin/organizations/:organizationId"), async (req, res) => {
    const auth = requireSuperadminAuth(req, res);
    if (!auth) return;
    const organization = await repository.getOrganizationAdmin(req.params.organizationId);
    if (!organization) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    res.json(organization);
  });

  router.patch(paths("/superadmin/organizations/:organizationId"), async (req, res) => {
    const auth = requireSuperadminAuth(req, res);
    if (!auth) return;
    const organization = await repository.updateOrganization(req.params.organizationId, req.body || {});
    if (!organization) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    res.json(organization);
  });

  router.post(paths("/superadmin/organizations/:organizationId/users"), async (req, res) => {
    const auth = requireSuperadminAuth(req, res);
    if (!auth) return;
    const payload = req.body || {};
    if (payload.email) {
      const existingUser = await repository.findUserByEmail(payload.email);
      if (existingUser) {
        res.status(409).json({ error: "That email is already registered" });
        return;
      }
    }
    const updated = await repository.createOrganizationUser(req.params.organizationId, payload);
    if (!updated) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    res.status(201).json(updated);
  });

  router.patch(paths("/superadmin/users/:userId"), async (req, res) => {
    const auth = requireSuperadminAuth(req, res);
    if (!auth) return;
    const updated = await repository.updateOrganizationUser(req.params.userId, req.body || {});
    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(updated);
  });

  router.delete(paths("/superadmin/users/:userId"), async (req, res) => {
    const auth = requireSuperadminAuth(req, res);
    if (!auth) return;
    const updated = await repository.deleteOrganizationUser(req.params.userId);
    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(updated);
  });

  router.put(paths("/superadmin/plans/:planKey"), async (req, res) => {
    const auth = requireSuperadminAuth(req, res);
    if (!auth) return;
    const plan = await repository.updatePlan(req.params.planKey, req.body || {});
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }
    res.json(plan);
  });

  router.delete(paths("/superadmin/plans/:planKey"), async (req, res) => {
    const auth = requireSuperadminAuth(req, res);
    if (!auth) return;
    const plan = await repository.resetPlan(req.params.planKey);
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }
    res.json(plan);
  });

  router.get(paths("/events/:code"), async (req, res) => {
    const auth = requireTenantAuth(req, res);
    if (!auth) return;
    const event = await requireEvent(req, res);
    if (!event) return;
    if (event.organizationId && event.organizationId !== auth.orgId && auth.role !== "superadmin") {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    res.json(serializeEvent(event));
  });

  router.patch(paths("/events/:code/security"), async (req, res) => {
    await saveAndEmit(res, req.params.code, () => repository.updateSecurity(req.params.code, req.body));
  });

  router.post(paths("/events/:code/questions"), async (req, res) => {
    await saveAndEmit(res, req.params.code, () => repository.addQuestion(req.params.code, req.body));
  });

  router.post(paths("/events/:code/questions/:questionId/upvote"), async (req, res) => {
    const participantId = String(req.body.participantId || makeId());
    await saveAndEmit(res, req.params.code, () =>
      repository.toggleQuestionUpvote(req.params.code, req.params.questionId, participantId),
    );
  });

  router.patch(paths("/events/:code/questions/:questionId"), async (req, res) => {
    await saveAndEmit(res, req.params.code, () => repository.patchQuestion(req.params.code, req.params.questionId, req.body));
  });

  router.post(paths("/events/:code/polls"), async (req, res) => {
    await saveAndEmit(res, req.params.code, () => repository.addPoll(req.params.code, req.body));
  });

  router.post(paths("/events/:code/surveys"), async (req, res) => {
    await saveAndEmit(res, req.params.code, () => repository.createSurvey(req.params.code, req.body));
  });

  router.post(paths("/events/:code/polls/:pollId/activate"), async (req, res) => {
    await saveAndEmit(res, req.params.code, () => repository.activatePoll(req.params.code, req.params.pollId));
  });

  router.post(paths("/events/:code/polls/:pollId/close"), async (req, res) => {
    await saveAndEmit(res, req.params.code, () => repository.closePoll(req.params.code, req.params.pollId));
  });

  router.post(paths("/events/:code/polls/:pollId/responses"), async (req, res) => {
    await saveAndEmit(res, req.params.code, () => repository.addPollResponse(req.params.code, req.params.pollId, req.body));
  });

  router.post(paths("/events/:code/quizzes"), async (req, res) => {
    await saveAndEmit(res, req.params.code, () => repository.addQuiz(req.params.code, req.body));
  });

  router.post(paths("/events/:code/quizzes/:quizId/start"), async (req, res) => {
    await saveAndEmit(res, req.params.code, () => repository.startQuiz(req.params.code, req.params.quizId));
  });

  router.post(paths("/events/:code/quizzes/:quizId/advance"), async (req, res) => {
    await saveAndEmit(res, req.params.code, () => repository.advanceQuiz(req.params.code, req.params.quizId));
  });

  router.post(paths("/events/:code/quizzes/:quizId/answers"), async (req, res) => {
    await saveAndEmit(res, req.params.code, () => repository.addQuizAnswer(req.params.code, req.params.quizId, req.body));
  });

  router.get(paths("/events/:code/analytics"), async (req, res) => {
    const event = await requireEvent(req, res);
    if (event) res.json(serializeEvent(event).analytics);
  });

  router.get(paths("/events/:code/export/:format"), async (req, res) => {
    const event = await requireEvent(req, res);
    if (!event) return;
    const serialized = serializeEvent(event);
    const format = req.params.format.toLowerCase();
    if (format === "csv") return sendCsv(res, serialized);
    if (format === "xlsx") return sendXlsx(res, serialized);
    if (format === "pdf") return sendPdf(res, serialized);
    res.status(400).json({ error: "Unsupported export format" });
  });

  router.post(paths("/ai/suggest"), (req, res) => {
    const goal = String(req.body.goal || "increase audience engagement").trim();
    const audience = String(req.body.audience || "a mixed live and remote audience").trim();
    const tone = String(req.body.tone || "clear").trim();

    res.json({
      suggestions: [
        {
          type: "multiple_choice",
          title: `Which part of ${goal} matters most to you today?`,
          options: ["Strategy", "Execution", "Risks", "Next steps"],
        },
        {
          type: "word_cloud",
          title: `In one word, how does ${audience} feel about this topic?`,
          options: [],
        },
        {
          type: "rating",
          title: `How confident are you in the plan for ${goal}?`,
          options: ["1", "2", "3", "4", "5"],
        },
        {
          type: "open_text",
          title: `What would make this session more useful for ${audience}?`,
          options: [],
        },
      ],
      quiz: {
        title: `${goal} knowledge check`,
        questions: [
          {
            text: `What is the strongest next step for ${goal}?`,
            options: ["Align owners", "Wait for feedback", "Skip measurement", "Hide blockers"],
            correctIndex: 0,
          },
        ],
      },
      refinement: `A ${tone} version: What is the most valuable thing we should address before this session ends?`,
    });
  });

  router.post(paths("/ai/refine"), (req, res) => {
    const text = String(req.body.text || "").trim();
    if (!text) {
      res.status(400).json({ error: "Text is required" });
      return;
    }
    res.json({
      refined: text
        .replace(/\s+/g, " ")
        .replace(/^what do you think about/i, "What should we prioritize about")
        .replace(/\?*$/, "?"),
    });
  });

  return router;
}
