import { Pool } from "pg";
import {
  defaultIntegrations,
  defaultQuizQuestions,
  defaultSecurity,
  DEFAULT_SUPERADMIN_EMAIL,
  DEFAULT_SUPERADMIN_PASSWORD,
  EMAIL_VERIFICATION_TTL_MS,
  getPlan,
  makeCode,
  makeId,
  makeVerificationToken,
  normalizeOptions,
  normalizePlanKey,
  hashSuperadminPassword,
  hashVerificationToken,
  normalizePollType,
  now,
  SAAS_PLANS,
  serializeEvent,
} from "./domain.js";

function asBool(value) {
  return Boolean(value);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function slugify(value) {
  return (
    String(value || "workspace")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 42) || "workspace"
  );
}

function hashPassword(value) {
  return Buffer.from(String(value || "demo-password")).toString("base64");
}

function createPool(databaseUrl) {
  const url = new URL(databaseUrl);
  const sslMode = url.searchParams.get("sslmode") || process.env.PGSSLMODE || "";
  return new Pool({
    connectionString: databaseUrl,
    ssl: sslMode && sslMode !== "disable" ? { rejectUnauthorized: false } : false,
  });
}

export class PostgresEventRepository {
  static async create(databaseUrl) {
    const repository = new PostgresEventRepository(createPool(databaseUrl));
    await repository.runMigrations();
    return repository;
  }

  constructor(pool) {
    this.pool = pool;
  }

  async query(sql, params = [], client = this.pool) {
    return client.query(sql, params);
  }

  async transaction(action) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await action(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async runMigrations() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        organization_id TEXT,
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        stage TEXT NOT NULL,
        audience TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'live',
        active_poll_id TEXT,
        active_quiz_id TEXT,
        security_json JSONB NOT NULL,
        integrations_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        name TEXT NOT NULL,
        anonymous BOOLEAN NOT NULL DEFAULT TRUE,
        answered BOOLEAN NOT NULL DEFAULT FALSE,
        pinned BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS question_upvotes (
        question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (question_id, participant_id)
      );

      CREATE TABLE IF NOT EXISTS surveys (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS polls (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        survey_id TEXT REFERENCES surveys(id) ON DELETE SET NULL,
        survey_title TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS poll_options (
        id TEXT PRIMARY KEY,
        poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS poll_responses (
        id TEXT PRIMARY KEY,
        poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        UNIQUE (poll_id, participant_id)
      );

      CREATE TABLE IF NOT EXISTS quizzes (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        current_index INTEGER NOT NULL DEFAULT 0,
        started_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS quiz_questions (
        id TEXT PRIMARY KEY,
        quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        options_json JSONB NOT NULL,
        correct_index INTEGER NOT NULL DEFAULT 0,
        points INTEGER NOT NULL DEFAULT 100,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS quiz_answers (
        id TEXT PRIMARY KEY,
        quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        question_id TEXT NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        answer_index INTEGER NOT NULL,
        correct BOOLEAN NOT NULL DEFAULT FALSE,
        points INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL,
        UNIQUE (question_id, participant_id)
      );

      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        plan_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'admin',
        password_hash TEXT,
        verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plans (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        price TEXT NOT NULL,
        cadence TEXT NOT NULL,
        event_limit INTEGER NOT NULL,
        seat_limit INTEGER NOT NULL,
        participant_limit INTEGER NOT NULL,
        features_json JSONB NOT NULL,
        is_custom INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS platform_admins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'superadmin',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      ALTER TABLE events ADD COLUMN IF NOT EXISTS organization_id TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

      CREATE INDEX IF NOT EXISTS idx_events_code ON events(code);
      CREATE INDEX IF NOT EXISTS idx_events_organization ON events(organization_id);
      CREATE INDEX IF NOT EXISTS idx_users_organization ON users(organization_id);
      CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_hash ON email_verification_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_questions_event ON questions(event_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_polls_event ON polls(event_id, status);
      CREATE INDEX IF NOT EXISTS idx_poll_responses_poll ON poll_responses(poll_id);
      CREATE INDEX IF NOT EXISTS idx_quizzes_event ON quizzes(event_id, status);
      CREATE INDEX IF NOT EXISTS idx_quiz_answers_quiz ON quiz_answers(quiz_id);
      CREATE INDEX IF NOT EXISTS idx_plans_key ON plans(key);
    `);
  }

  async seedIfEmpty() {
    await this.seedPlatformAdminIfEmpty();
    await this.seedPlansIfEmpty();
    const { rows } = await this.query("SELECT COUNT(*)::int AS count FROM events");
    if (rows[0].count === 0) {
      const event = await this.createEvent({
        title: "Global Product Town Hall",
        stage: "Live meeting",
        audience: "Hybrid audience",
      });
      const stored = await this.getEventByCode(event.code);
      const firstPoll = stored.polls.find((poll) => poll.type === "multiple_choice") || stored.polls[0];
      await this.activatePoll(event.code, firstPoll.id);
      await this.addPollResponse(event.code, firstPoll.id, {
        participantId: "seed-a",
        name: "Sam",
        value: "Roadmap",
      });
      await this.addPollResponse(event.code, firstPoll.id, {
        participantId: "seed-b",
        name: "Priya",
        value: "Security",
      });
      await this.addPollResponse(event.code, firstPoll.id, {
        participantId: "seed-c",
        name: "Lee",
        value: "Roadmap",
      });
    }
    await this.ensureDemoEvent();
  }

  async seedPlatformAdminIfEmpty() {
    const { rows } = await this.query("SELECT COUNT(*)::int AS count FROM platform_admins");
    if (rows[0].count > 0) return;
    const createdAt = now();
    await this.query(
      `INSERT INTO platform_admins (id, name, email, password_hash, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        makeId(),
        "Platform Admin",
        DEFAULT_SUPERADMIN_EMAIL,
        hashSuperadminPassword(DEFAULT_SUPERADMIN_EMAIL, DEFAULT_SUPERADMIN_PASSWORD),
        "superadmin",
        createdAt,
        createdAt,
      ],
    );
  }

  async seedPlansIfEmpty() {
    const { rows } = await this.query("SELECT COUNT(*)::int AS count FROM plans");
    if (rows[0].count > 0) return;
    const createdAt = now();
    for (const plan of SAAS_PLANS) {
      await this.query(
        `INSERT INTO plans (
          key, name, price, cadence, event_limit, seat_limit, participant_limit, features_json, is_custom, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
        [
          plan.key,
          plan.name,
          plan.price,
          plan.cadence,
          plan.eventLimit,
          plan.seatLimit,
          plan.participantLimit,
          JSON.stringify(plan.features || []),
          0,
          createdAt,
          createdAt,
        ],
      );
    }
  }

  async ensureDemoEvent() {
    const existing = await this.query("SELECT code FROM events WHERE code = $1", ["DEMO01"]);
    if (existing.rows.length) return;
    await this.createEvent({
      code: "DEMO01",
      title: "Public product demo",
      stage: "Open demo",
      audience: "Guest participants",
    });
  }

  async getEvents() {
    const { rows } = await this.query("SELECT code FROM events ORDER BY created_at DESC");
    return Promise.all(rows.map((row) => this.getSerializedEventByCode(row.code)));
  }

  async getEventsByOrganization(organizationId) {
    const { rows } = await this.query("SELECT code FROM events WHERE organization_id = $1 ORDER BY created_at DESC", [
      organizationId,
    ]);
    return Promise.all(rows.map((row) => this.getSerializedEventByCode(row.code)));
  }

  async getTenantAdminByEmail(email) {
    const result = await this.query(
      `
        SELECT u.*, o.name AS organization_name, o.slug AS organization_slug, o.plan_key, o.status AS organization_status
        FROM users u
        JOIN organizations o ON o.id = u.organization_id
        WHERE lower(u.email) = lower($1)
      `,
      [String(email || "").trim()],
    );
    return result.rows[0] || null;
  }

  async createEmailVerificationToken(userId) {
    const token = makeVerificationToken();
    const createdAt = now();
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS).toISOString();
    await this.query(
      `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, consumed_at, created_at)
       VALUES ($1, $2, $3, $4, NULL, $5)`,
      [makeId(), userId, hashVerificationToken(token), expiresAt, createdAt],
    );
    return { token, expiresAt };
  }

  async verifyEmailToken(token) {
    const tokenHash = hashVerificationToken(token);
    const { rows } = await this.query("SELECT * FROM email_verification_tokens WHERE token_hash = $1", [tokenHash]);
    const tokenRow = rows[0];
    if (!tokenRow || tokenRow.consumed_at) return null;
    if (new Date(tokenRow.expires_at).getTime() < Date.now()) return null;
    const verifiedAt = now();
    await this.transaction(async (client) => {
      await client.query("UPDATE users SET verified_at = $1, updated_at = $1 WHERE id = $2", [verifiedAt, tokenRow.user_id]);
      await client.query("UPDATE email_verification_tokens SET consumed_at = $1 WHERE id = $2", [verifiedAt, tokenRow.id]);
    });
    const user = await this.query("SELECT * FROM users WHERE id = $1", [tokenRow.user_id]);
    return user.rows[0] || null;
  }

  async getTenantAdminByEmail(email) {
    const result = await this.query(
      `
        SELECT u.*, o.name AS organization_name, o.slug AS organization_slug, o.plan_key, o.status AS organization_status
        FROM users u
        JOIN organizations o ON o.id = u.organization_id
        WHERE lower(u.email) = lower($1)
      `,
      [String(email || "").trim()],
    );
    return result.rows[0] || null;
  }

  async authenticateTenantAdmin(email, password) {
    const admin = await this.getTenantAdminByEmail(email);
    if (!admin) return null;
    if (!admin.verified_at) {
      const error = new Error("Email verification required");
      error.statusCode = 403;
      throw error;
    }
    const candidateHashes = new Set([hashSuperadminPassword(email, password), Buffer.from(String(password || "")).toString("base64")]);
    if (!candidateHashes.has(admin.password_hash)) return null;
    return {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      verifiedAt: admin.verified_at,
      organization: {
        id: admin.organization_id,
        name: admin.organization_name,
        slug: admin.organization_slug,
        planKey: admin.plan_key,
        status: admin.organization_status,
      },
    };
  }

  async getPlatformAdminByEmail(email) {
    const result = await this.query("SELECT * FROM platform_admins WHERE lower(email) = lower($1)", [String(email || "").trim()]);
    return result.rows[0] || null;
  }

  async authenticatePlatformAdmin(email, password) {
    const admin = await this.getPlatformAdminByEmail(email);
    if (!admin) return null;
    if (admin.password_hash !== hashSuperadminPassword(email, password)) return null;
    return {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
    };
  }

  async getEventByCode(code) {
    const eventResult = await this.query("SELECT * FROM events WHERE code = $1", [String(code || "").toUpperCase()]);
    const eventRow = eventResult.rows[0];
    if (!eventRow) return null;

    const eventId = eventRow.id;
    const questionResult = await this.query("SELECT * FROM questions WHERE event_id = $1 ORDER BY created_at DESC", [eventId]);
    const questions = await Promise.all(
      questionResult.rows.map(async (question) => {
        const votes = await this.query("SELECT participant_id FROM question_upvotes WHERE question_id = $1", [question.id]);
        return {
          id: question.id,
          text: question.text,
          name: question.name,
          anonymous: asBool(question.anonymous),
          answered: asBool(question.answered),
          pinned: asBool(question.pinned),
          createdAt: question.created_at.toISOString(),
          upvotes: votes.rows.map((vote) => vote.participant_id),
        };
      }),
    );

    const pollResult = await this.query("SELECT * FROM polls WHERE event_id = $1 ORDER BY created_at DESC", [eventId]);
    const polls = await Promise.all(
      pollResult.rows.map(async (poll) => {
        const options = await this.query("SELECT label FROM poll_options WHERE poll_id = $1 ORDER BY sort_order ASC", [poll.id]);
        const responses = await this.query("SELECT * FROM poll_responses WHERE poll_id = $1 ORDER BY created_at ASC", [poll.id]);
        return {
          id: poll.id,
          type: poll.type,
          title: poll.title,
          surveyId: poll.survey_id,
          surveyTitle: poll.survey_title,
          status: poll.status,
          createdAt: poll.created_at.toISOString(),
          options: options.rows.map((option) => option.label),
          responses: responses.rows.map((response) => ({
            id: response.id,
            participantId: response.participant_id,
            name: response.name,
            value: response.value,
            createdAt: response.created_at.toISOString(),
          })),
        };
      }),
    );

    const surveyResult = await this.query("SELECT * FROM surveys WHERE event_id = $1 ORDER BY created_at DESC", [eventId]);
    const surveys = await Promise.all(
      surveyResult.rows.map(async (survey) => {
        const pollIds = await this.query("SELECT id FROM polls WHERE survey_id = $1 ORDER BY created_at ASC", [survey.id]);
        return {
          id: survey.id,
          title: survey.title,
          createdAt: survey.created_at.toISOString(),
          pollIds: pollIds.rows.map((poll) => poll.id),
        };
      }),
    );

    const quizResult = await this.query("SELECT * FROM quizzes WHERE event_id = $1 ORDER BY created_at DESC", [eventId]);
    const quizzes = await Promise.all(
      quizResult.rows.map(async (quiz) => {
        const questions = await this.query("SELECT * FROM quiz_questions WHERE quiz_id = $1 ORDER BY sort_order ASC", [quiz.id]);
        const answers = await this.query("SELECT * FROM quiz_answers WHERE quiz_id = $1 ORDER BY created_at ASC", [quiz.id]);
        return {
          id: quiz.id,
          title: quiz.title,
          status: quiz.status,
          currentIndex: quiz.current_index,
          createdAt: quiz.created_at.toISOString(),
          startedAt: quiz.started_at?.toISOString() || null,
          questions: questions.rows.map((question) => ({
            id: question.id,
            text: question.text,
            options: parseJson(question.options_json, []),
            correctIndex: question.correct_index,
            points: question.points,
          })),
          answers: answers.rows.map((answer) => ({
            id: answer.id,
            participantId: answer.participant_id,
            name: answer.name,
            questionId: answer.question_id,
            answerIndex: answer.answer_index,
            correct: asBool(answer.correct),
            points: answer.points,
            createdAt: answer.created_at.toISOString(),
          })),
        };
      }),
    );

    return {
      id: eventRow.id,
      organizationId: eventRow.organization_id,
      code: eventRow.code,
      title: eventRow.title,
      stage: eventRow.stage,
      audience: eventRow.audience,
      status: eventRow.status,
      createdAt: eventRow.created_at.toISOString(),
      hostLink: `/host/${eventRow.code}`,
      participantLink: `/join/${eventRow.code}`,
      uptimeTarget: "99.95%",
      questions,
      polls,
      surveys,
      quizzes,
      activePollId: eventRow.active_poll_id,
      activeQuizId: eventRow.active_quiz_id,
      integrations: parseJson(eventRow.integrations_json, defaultIntegrations()),
      security: parseJson(eventRow.security_json, defaultSecurity()),
    };
  }

  async getSerializedEventByCode(code) {
    const event = await this.getEventByCode(code);
    return event ? serializeEvent(event) : null;
  }

  async createEvent(payload = {}) {
    let code = String(payload.code || "").trim().toUpperCase() || makeCode();
    while (await this.getEventByCode(code)) code = makeCode();

    const createdAt = now();
    const event = {
      id: makeId(),
      organizationId: payload.organizationId || null,
      code,
      title: payload.title?.trim() || "Global Product Town Hall",
      stage: payload.stage?.trim() || "Live meeting",
      audience: payload.audience?.trim() || "Hybrid audience",
      status: "live",
      security: defaultSecurity(),
      integrations: defaultIntegrations(),
    };

    await this.transaction(async (client) => {
      await this.query(
        `INSERT INTO events (
          id, organization_id, code, title, stage, audience, status, security_json, integrations_json, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)`,
        [
          event.id,
          event.organizationId,
          event.code,
          event.title,
          event.stage,
          event.audience,
          event.status,
          JSON.stringify(event.security),
          JSON.stringify(event.integrations),
          createdAt,
          createdAt,
        ],
        client,
      );

      await this.insertQuestion(event.id, {
        text: "How are we measuring product adoption after launch?",
        name: "Maya",
        anonymous: false,
        pinned: true,
        upvotes: ["seed-a", "seed-b", "seed-c"],
      }, client);
      await this.insertQuestion(event.id, {
        text: "Can the hybrid audience get the same quiz timing as people in the room?",
        name: "Anonymous",
        anonymous: true,
        upvotes: ["seed-a"],
      }, client);
      await this.insertPoll(event.id, {
        type: "multiple_choice",
        title: "Which topic should lead the next segment?",
        options: ["Roadmap", "Customer stories", "Security", "Q&A"],
      }, client);
      await this.insertPoll(event.id, {
        type: "word_cloud",
        title: "One word for the current launch mood",
      }, client);
      await this.insertPoll(event.id, {
        type: "rating",
        title: "How clear was the opening keynote?",
      }, client);
      await this.insertQuiz(event.id, {
        title: "Product mastery quiz",
        questions: defaultQuizQuestions(),
      }, client);
    });

    return serializeEvent(await this.getEventByCode(event.code));
  }

  async insertQuestion(eventId, input, client = this.pool) {
    const id = makeId();
    const createdAt = now();
    await this.query(
      `INSERT INTO questions (
        id, event_id, text, name, anonymous, answered, pinned, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        eventId,
        String(input.text || "").trim(),
        input.anonymous ? "Anonymous" : String(input.name || "Guest").trim(),
        Boolean(input.anonymous),
        Boolean(input.answered),
        Boolean(input.pinned),
        createdAt,
        createdAt,
      ],
      client,
    );
    for (const participantId of input.upvotes || []) {
      await this.query(
        `INSERT INTO question_upvotes (question_id, participant_id, created_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (question_id, participant_id) DO NOTHING`,
        [id, participantId, createdAt],
        client,
      );
    }
    return id;
  }

  async addQuestion(code, input) {
    const event = await this.getEventByCode(code);
    if (!event) return null;
    const text = String(input.text || "").trim();
    if (!text) throw Object.assign(new Error("Question text is required"), { statusCode: 400 });
    await this.insertQuestion(event.id, { ...input, text });
    return this.getSerializedEventByCode(code);
  }

  async toggleQuestionUpvote(code, questionId, participantId) {
    const event = await this.getEventByCode(code);
    if (!event) return null;
    const existing = await this.query("SELECT 1 FROM question_upvotes WHERE question_id = $1 AND participant_id = $2", [
      questionId,
      participantId,
    ]);
    if (existing.rows[0]) {
      await this.query("DELETE FROM question_upvotes WHERE question_id = $1 AND participant_id = $2", [questionId, participantId]);
    } else {
      await this.query("INSERT INTO question_upvotes (question_id, participant_id, created_at) VALUES ($1, $2, $3)", [
        questionId,
        participantId,
        now(),
      ]);
    }
    return this.getSerializedEventByCode(code);
  }

  async patchQuestion(code, questionId, input) {
    const current = await this.query("SELECT * FROM questions WHERE id = $1", [questionId]);
    if (!current.rows[0]) return null;
    await this.query("UPDATE questions SET answered = $1, pinned = $2, updated_at = $3 WHERE id = $4", [
      typeof input.answered === "boolean" ? input.answered : current.rows[0].answered,
      typeof input.pinned === "boolean" ? input.pinned : current.rows[0].pinned,
      now(),
      questionId,
    ]);
    return this.getSerializedEventByCode(code);
  }

  async insertPoll(eventId, input, client = this.pool) {
    const id = makeId();
    const type = normalizePollType(input.type);
    const options = normalizeOptions(type, input.options);
    const createdAt = now();
    await this.query(
      `INSERT INTO polls (
        id, event_id, type, title, survey_id, survey_title, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        eventId,
        type,
        String(input.title || "Untitled poll").trim(),
        input.surveyId || null,
        input.surveyTitle || null,
        input.status || "draft",
        createdAt,
        createdAt,
      ],
      client,
    );
    for (const [index, option] of options.entries()) {
      await this.query("INSERT INTO poll_options (id, poll_id, label, sort_order) VALUES ($1, $2, $3, $4)", [
        makeId(),
        id,
        option,
        index,
      ], client);
    }
    return id;
  }

  async addPoll(code, input) {
    const event = await this.getEventByCode(code);
    if (!event) return null;
    await this.insertPoll(event.id, input);
    return this.getSerializedEventByCode(code);
  }

  async createSurvey(code, input) {
    const event = await this.getEventByCode(code);
    if (!event) return null;
    const surveyId = makeId();
    const title = input.title?.trim() || "Session pulse survey";
    const createdAt = now();

    await this.transaction(async (client) => {
      await this.query("INSERT INTO surveys (id, event_id, title, created_at) VALUES ($1, $2, $3, $4)", [
        surveyId,
        event.id,
        title,
        createdAt,
      ], client);
      await this.insertPoll(event.id, {
        type: "rating",
        title: "How valuable was this segment?",
        surveyId,
        surveyTitle: title,
      }, client);
      await this.insertPoll(event.id, {
        type: "word_cloud",
        title: "What theme stood out?",
        surveyId,
        surveyTitle: title,
      }, client);
      await this.insertPoll(event.id, {
        type: "open_text",
        title: "What should we improve next time?",
        surveyId,
        surveyTitle: title,
      }, client);
    });

    return this.getSerializedEventByCode(code);
  }

  async activatePoll(code, pollId) {
    const event = await this.getEventByCode(code);
    if (!event) return null;
    const updatedAt = now();
    await this.query("UPDATE polls SET status = 'closed', updated_at = $1 WHERE event_id = $2 AND status = 'active'", [
      updatedAt,
      event.id,
    ]);
    await this.query("UPDATE polls SET status = 'active', updated_at = $1 WHERE id = $2", [updatedAt, pollId]);
    await this.query("UPDATE events SET active_poll_id = $1, updated_at = $2 WHERE id = $3", [pollId, updatedAt, event.id]);
    return this.getSerializedEventByCode(code);
  }

  async closePoll(code, pollId) {
    const event = await this.getEventByCode(code);
    if (!event) return null;
    const updatedAt = now();
    await this.query("UPDATE polls SET status = 'closed', updated_at = $1 WHERE id = $2", [updatedAt, pollId]);
    if (event.activePollId === pollId) {
      await this.query("UPDATE events SET active_poll_id = NULL, updated_at = $1 WHERE id = $2", [updatedAt, event.id]);
    }
    return this.getSerializedEventByCode(code);
  }

  async addPollResponse(code, pollId, input) {
    const event = await this.getEventByCode(code);
    if (!event) return null;
    const participantId = String(input.participantId || makeId());
    await this.query(
      `INSERT INTO poll_responses (id, poll_id, participant_id, name, value, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (poll_id, participant_id) DO UPDATE SET
         name = EXCLUDED.name,
         value = EXCLUDED.value,
         created_at = EXCLUDED.created_at`,
      [makeId(), pollId, participantId, input.name || "Anonymous", String(input.value ?? ""), now()],
    );
    return this.getSerializedEventByCode(code);
  }

  async insertQuiz(eventId, input, client = this.pool) {
    const id = makeId();
    const createdAt = now();
    const questions = input.questions?.length ? input.questions : defaultQuizQuestions();
    await this.query(
      `INSERT INTO quizzes (
        id, event_id, title, status, current_index, started_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, eventId, input.title || "Product mastery quiz", input.status || "draft", 0, null, createdAt, createdAt],
      client,
    );
    for (const [index, question] of questions.entries()) {
      await this.query(
        `INSERT INTO quiz_questions (
          id, quiz_id, text, options_json, correct_index, points, sort_order
        ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          makeId(),
          id,
          question.text,
          JSON.stringify(question.options || []),
          Number(question.correctIndex || 0),
          Number(question.points || 100),
          index,
        ],
        client,
      );
    }
    return id;
  }

  async addQuiz(code, input) {
    const event = await this.getEventByCode(code);
    if (!event) return null;
    await this.insertQuiz(event.id, input);
    return this.getSerializedEventByCode(code);
  }

  async startQuiz(code, quizId) {
    const event = await this.getEventByCode(code);
    if (!event) return null;
    const updatedAt = now();
    await this.query("UPDATE quizzes SET status = 'finished', updated_at = $1 WHERE event_id = $2 AND status = 'active'", [
      updatedAt,
      event.id,
    ]);
    await this.query("UPDATE quizzes SET status = 'active', current_index = 0, started_at = $1, updated_at = $2 WHERE id = $3", [
      updatedAt,
      updatedAt,
      quizId,
    ]);
    await this.query("UPDATE events SET active_quiz_id = $1, updated_at = $2 WHERE id = $3", [quizId, updatedAt, event.id]);
    return this.getSerializedEventByCode(code);
  }

  async advanceQuiz(code, quizId) {
    const event = await this.getEventByCode(code);
    if (!event) return null;
    const quiz = event.quizzes.find((item) => item.id === quizId);
    if (!quiz) return null;
    const updatedAt = now();
    if (quiz.currentIndex < quiz.questions.length - 1) {
      await this.query("UPDATE quizzes SET current_index = $1, updated_at = $2 WHERE id = $3", [
        quiz.currentIndex + 1,
        updatedAt,
        quizId,
      ]);
    } else {
      await this.query("UPDATE quizzes SET status = 'finished', updated_at = $1 WHERE id = $2", [updatedAt, quizId]);
      await this.query("UPDATE events SET active_quiz_id = NULL, updated_at = $1 WHERE id = $2", [updatedAt, event.id]);
    }
    return this.getSerializedEventByCode(code);
  }

  async addQuizAnswer(code, quizId, input) {
    const event = await this.getEventByCode(code);
    if (!event) return null;
    const quiz = event.quizzes.find((item) => item.id === quizId);
    const question = quiz?.questions.find((item) => item.id === input.questionId);
    if (!quiz || !question) return null;
    const answerIndex = Number(input.answerIndex);
    const correct = answerIndex === question.correctIndex;
    await this.query(
      `INSERT INTO quiz_answers (
        id, quiz_id, question_id, participant_id, name, answer_index, correct, points, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (question_id, participant_id) DO UPDATE SET
        name = EXCLUDED.name,
        answer_index = EXCLUDED.answer_index,
        correct = EXCLUDED.correct,
        points = EXCLUDED.points,
        created_at = EXCLUDED.created_at`,
      [
        makeId(),
        quizId,
        question.id,
        String(input.participantId || makeId()),
        input.name || "Anonymous",
        answerIndex,
        correct,
        correct ? question.points : 0,
        now(),
      ],
    );
    return this.getSerializedEventByCode(code);
  }

  async updateSecurity(code, input) {
    const event = await this.getEventByCode(code);
    if (!event) return null;
    const security = { ...event.security, ...input };
    await this.query("UPDATE events SET security_json = $1::jsonb, updated_at = $2 WHERE id = $3", [
      JSON.stringify(security),
      now(),
      event.id,
    ]);
    return this.getSerializedEventByCode(code);
  }

  async findUserByEmail(email) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail) return null;
    const result = await this.query("SELECT id, email FROM users WHERE email = $1", [normalizedEmail]);
    return result.rows[0] || null;
  }

  async getPlans() {
    return this.getPlansWithOverrides();
  }

  async getPlansWithOverrides() {
    const { rows } = await this.query("SELECT * FROM plans ORDER BY created_at ASC");
    const overrides = new Map(rows.map((row) => [row.key, row]));
    return SAAS_PLANS.map((plan) => {
      const row = overrides.get(plan.key);
      if (!row) return plan;
      return {
        ...plan,
        name: row.name,
        price: row.price,
        cadence: row.cadence,
        eventLimit: row.event_limit,
        seatLimit: row.seat_limit,
        participantLimit: row.participant_limit,
        features: parseJson(row.features_json, plan.features),
      };
    });
  }

  async getPlanByKey(planKey) {
    return (await this.getPlansWithOverrides()).find((plan) => plan.key === normalizePlanKey(planKey));
  }

  async updatePlan(planKey, input = {}) {
    const key = normalizePlanKey(planKey);
    const existing = SAAS_PLANS.find((plan) => plan.key === key);
    if (!existing) return null;
    const updatedAt = now();
    const features = Array.isArray(input.features)
      ? input.features
      : String(input.features || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
    await this.query(
      `INSERT INTO plans (
        key, name, price, cadence, event_limit, seat_limit, participant_limit, features_json, is_custom, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 0, $9, $10)
      ON CONFLICT (key) DO UPDATE SET
        name = EXCLUDED.name,
        price = EXCLUDED.price,
        cadence = EXCLUDED.cadence,
        event_limit = EXCLUDED.event_limit,
        seat_limit = EXCLUDED.seat_limit,
        participant_limit = EXCLUDED.participant_limit,
        features_json = EXCLUDED.features_json,
        updated_at = EXCLUDED.updated_at`,
      [
        key,
        String(input.name || existing.name).trim(),
        String(input.price || existing.price).trim(),
        String(input.cadence || existing.cadence).trim(),
        Number.isFinite(Number(input.eventLimit)) ? Number(input.eventLimit) : existing.eventLimit,
        Number.isFinite(Number(input.seatLimit)) ? Number(input.seatLimit) : existing.seatLimit,
        Number.isFinite(Number(input.participantLimit)) ? Number(input.participantLimit) : existing.participantLimit,
        JSON.stringify(features.length ? features : existing.features),
        updatedAt,
        updatedAt,
      ],
    );
    return this.getPlanByKey(key);
  }

  async resetPlan(planKey) {
    const key = normalizePlanKey(planKey);
    await this.query("DELETE FROM plans WHERE key = $1", [key]);
    return this.getPlanByKey(key);
  }

  async updateOrganization(organizationId, input = {}) {
    const currentResult = await this.query("SELECT * FROM organizations WHERE id = $1", [organizationId]);
    const current = currentResult.rows[0];
    if (!current) return null;
    await this.query("UPDATE organizations SET name = $1, status = $2, plan_key = $3, updated_at = $4 WHERE id = $5", [
      String(input.name || current.name).trim(),
      String(input.status || current.status).trim(),
      normalizePlanKey(input.planKey || current.plan_key),
      now(),
      organizationId,
    ]);
    return this.getOrganizationAdmin(organizationId);
  }

  async createOrganizationUser(organizationId, input = {}) {
    const organizationResult = await this.query("SELECT id FROM organizations WHERE id = $1", [organizationId]);
    if (!organizationResult.rows[0]) return null;
    const email = String(input.email || "").trim().toLowerCase();
    if (email && (await this.findUserByEmail(email))) {
      const error = new Error("That email is already registered");
      error.code = "EMAIL_EXISTS";
      throw error;
    }
    const createdAt = now();
    await this.query(
      `INSERT INTO users (
        id, organization_id, name, email, role, password_hash, verified_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        makeId(),
        organizationId,
        String(input.name || "Team member").trim(),
        email,
        String(input.role || "admin").trim(),
        hashPassword(input.password || "VoxLume123!"),
        input.verifiedAt === false ? null : createdAt,
        createdAt,
        createdAt,
      ],
    );
    return this.getOrganizationAdmin(organizationId);
  }

  async updateOrganizationUser(userId, input = {}) {
    const currentResult = await this.query("SELECT * FROM users WHERE id = $1", [userId]);
    const current = currentResult.rows[0];
    if (!current) return null;
    await this.query(
      `UPDATE users SET
        name = $1,
        email = $2,
        role = $3,
        password_hash = COALESCE($4, password_hash),
        updated_at = $5
       WHERE id = $6`,
      [
        String(input.name || current.name).trim(),
        String(input.email || current.email).trim().toLowerCase(),
        String(input.role || current.role).trim(),
        input.password ? hashPassword(input.password) : null,
        now(),
        userId,
      ],
    );
    return this.getOrganizationAdmin(current.organization_id);
  }

  async deleteOrganizationUser(userId) {
    const currentResult = await this.query("SELECT organization_id FROM users WHERE id = $1", [userId]);
    const current = currentResult.rows[0];
    if (!current) return null;
    await this.query("DELETE FROM users WHERE id = $1", [userId]);
    return this.getOrganizationAdmin(current.organization_id);
  }

  async createOrganizationWithAdmin(input = {}) {
    const createdAt = now();
    const organizationId = makeId();
    const userId = makeId();
    const planKey = normalizePlanKey(input.planKey);
    const email = String(input.email || "").trim().toLowerCase();
    if (email && (await this.findUserByEmail(email))) {
      const error = new Error("That email is already registered");
      error.code = "EMAIL_EXISTS";
      throw error;
    }
    let slug = slugify(input.company || input.name || "workspace");
    let suffix = 1;
    while ((await this.query("SELECT 1 FROM organizations WHERE slug = $1", [slug])).rows[0]) {
      suffix += 1;
      slug = `${slugify(input.company || "workspace")}-${suffix}`;
    }

    await this.transaction(async (client) => {
      await this.query(
        `INSERT INTO organizations (
          id, name, slug, plan_key, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          organizationId,
          String(input.company || "New workspace").trim(),
          slug,
          planKey,
          "active",
          createdAt,
          createdAt,
        ],
        client,
      );
      await this.query(
        `INSERT INTO users (
          id, organization_id, name, email, role, password_hash, verified_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          userId,
          organizationId,
          String(input.name || "Workspace admin").trim(),
          email,
          "admin",
          hashPassword(input.password),
          createdAt,
          createdAt,
          createdAt,
        ],
        client,
      );
    });

    return this.getOrganizationAdmin(organizationId);
  }

  async getOrganizationAdmin(organizationId) {
    const organizationResult = await this.query("SELECT * FROM organizations WHERE id = $1", [organizationId]);
    const organization = organizationResult.rows[0];
    if (!organization) return null;
    const userResult = await this.query(
      "SELECT id, name, email, role, created_at FROM users WHERE organization_id = $1 ORDER BY created_at ASC",
      [organizationId],
    );
    const users = userResult.rows.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.created_at.toISOString(),
    }));
    const events = await this.getEventsByOrganization(organizationId);
    const plan = await this.getPlanByKey(organization.plan_key);
    return {
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        planKey: organization.plan_key,
        plan,
        status: organization.status,
        createdAt: organization.created_at.toISOString(),
      },
      users,
      events,
      usage: {
        events: events.length,
        seats: users.length,
        participants: events.reduce((total, event) => total + event.analytics.participants, 0),
      },
    };
  }

  async getPlatformOverview() {
    const organizationResult = await this.query("SELECT * FROM organizations ORDER BY created_at DESC");
    const organizations = await Promise.all(
      organizationResult.rows.map(async (organization) => {
        const userCount = await this.query("SELECT COUNT(*)::int AS count FROM users WHERE organization_id = $1", [
          organization.id,
        ]);
        const eventCount = await this.query("SELECT COUNT(*)::int AS count FROM events WHERE organization_id = $1", [
          organization.id,
        ]);
        return {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          planKey: organization.plan_key,
          plan: getPlan(organization.plan_key),
          status: organization.status,
          users: userCount.rows[0].count,
          events: eventCount.rows[0].count,
          createdAt: organization.created_at.toISOString(),
        };
      }),
    );
    const events = await this.getEvents();
    return {
      plans: await this.getPlansWithOverrides(),
      metrics: {
        organizations: organizations.length,
        users: organizations.reduce((total, organization) => total + organization.users, 0),
        events: events.length,
        participants: events.reduce((total, event) => total + event.analytics.participants, 0),
      },
      organizations,
      recentEvents: events.slice(0, 8),
    };
  }
}
