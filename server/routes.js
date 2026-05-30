import express from "express";
import { makeId, serializeEvent } from "./domain.js";
import { sendCsv, sendPdf, sendXlsx } from "./exporters.js";

export function createApiRouter({ repository, emitEvent }) {
  const router = express.Router();
  const paths = (path) => [path, path.endsWith("/") ? path.slice(0, -1) : `${path}/`];

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

  router.get(paths("/events"), async (req, res) => {
    res.json(await repository.getEvents());
  });

  router.post(paths("/events"), async (req, res) => {
    const event = await repository.createEvent(req.body);
    emitEvent(event);
    res.status(201).json(event);
  });

  router.get(paths("/events/:code"), async (req, res) => {
    const event = await requireEvent(req, res);
    if (event) res.json(serializeEvent(event));
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
