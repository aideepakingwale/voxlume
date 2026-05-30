import { nanoid } from "nanoid";

export const POLL_PRESETS = {
  multiple_choice: {
    label: "Multiple choice",
    options: ["Strongly agree", "Agree", "Neutral", "Disagree"],
  },
  rating: {
    label: "Rating",
    options: ["1", "2", "3", "4", "5"],
  },
  open_text: {
    label: "Open text",
    options: [],
  },
  word_cloud: {
    label: "Word cloud",
    options: [],
  },
  scale: {
    label: "Scale",
    options: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
  },
  yes_no: {
    label: "Yes / no",
    options: ["Yes", "No", "Not sure"],
  },
};

export const SAAS_PLANS = [
  {
    key: "starter",
    name: "Starter",
    price: "$0",
    cadence: "free",
    eventLimit: 3,
    seatLimit: 2,
    participantLimit: 100,
    features: ["Live Q&A", "Core polls", "CSV exports", "Basic analytics"],
  },
  {
    key: "growth",
    name: "Growth",
    price: "$19",
    cadence: "per month",
    eventLimit: 25,
    seatLimit: 10,
    participantLimit: 1000,
    features: ["Surveys", "Word clouds", "Quizzes", "PDF/XLSX exports", "AI assistance"],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    price: "Custom",
    cadence: "annual",
    eventLimit: 250,
    seatLimit: 100,
    participantLimit: 10000,
    features: ["SSO posture", "Compliance controls", "Dedicated success", "Advanced analytics"],
  },
];

export function normalizePlanKey(planKey) {
  return SAAS_PLANS.some((plan) => plan.key === planKey) ? planKey : "starter";
}

export function getPlan(planKey) {
  return SAAS_PLANS.find((plan) => plan.key === normalizePlanKey(planKey));
}

export function now() {
  return new Date().toISOString();
}

export function makeId() {
  return nanoid();
}

export function makeCode() {
  return nanoid(6).replace(/[-_]/g, "X").toUpperCase();
}

export function normalizeOptions(type, options) {
  if (Array.isArray(options) && options.length) {
    return options.map((option) => String(option).trim()).filter(Boolean);
  }
  return POLL_PRESETS[type]?.options || [];
}

export function normalizePollType(type) {
  return POLL_PRESETS[type] ? type : "multiple_choice";
}

export function defaultSecurity() {
  return {
    ssoProvider: "Okta",
    auth0Enabled: true,
    azureEnabled: true,
    hipaaReady: true,
    moderation: true,
    anonymousQuestions: true,
    controlMappings: ["ISO 27001", "ISO 9001", "SOC 2"],
  };
}

export function defaultIntegrations() {
  return [
    { name: "PowerPoint", status: "ready" },
    { name: "Google Slides", status: "ready" },
    { name: "Zoom", status: "ready" },
    { name: "Webex", status: "ready" },
    { name: "Microsoft Teams", status: "ready" },
  ];
}

export function defaultQuizQuestions() {
  return [
    {
      text: "Which format drives the fastest audience signal?",
      options: ["Open text", "Multiple choice", "PDF export", "Static notes"],
      correctIndex: 1,
    },
    {
      text: "What makes a Q&A queue easier to prioritize live?",
      options: ["Upvotes", "Long names", "Hidden questions", "Manual screenshots"],
      correctIndex: 0,
    },
    {
      text: "Which activity turns feedback into a visual cluster?",
      options: ["Leaderboard", "Word cloud", "SSO", "CSV export"],
      correctIndex: 1,
    },
  ];
}

export function buildLeaderboard(quiz) {
  const rows = new Map();
  quiz.answers.forEach((answer) => {
    const row =
      rows.get(answer.participantId) ||
      {
        participantId: answer.participantId,
        name: answer.name || "Anonymous",
        score: 0,
        correct: 0,
        answers: 0,
        lastAnswerAt: answer.createdAt,
      };
    row.answers += 1;
    row.score += answer.correct ? answer.points : 0;
    row.correct += answer.correct ? 1 : 0;
    row.lastAnswerAt = answer.createdAt;
    rows.set(answer.participantId, row);
  });

  return [...rows.values()]
    .sort((a, b) => b.score - a.score || new Date(a.lastAnswerAt) - new Date(b.lastAnswerAt))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function summarizePoll(poll) {
  const base = {
    id: poll.id,
    title: poll.title,
    type: poll.type,
    responseCount: poll.responses.length,
  };

  if (["multiple_choice", "yes_no"].includes(poll.type)) {
    const counts = Object.fromEntries(poll.options.map((option) => [option, 0]));
    poll.responses.forEach((response) => {
      counts[response.value] = (counts[response.value] || 0) + 1;
    });
    return { ...base, counts };
  }

  if (["rating", "scale"].includes(poll.type)) {
    const values = poll.responses.map((response) => Number(response.value)).filter(Number.isFinite);
    const average = values.length
      ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
      : 0;
    return { ...base, average, values };
  }

  const words = {};
  poll.responses.forEach((response) => {
    String(response.value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .split(/\s+/)
      .filter((word) => word.length > 2)
      .forEach((word) => {
        words[word] = (words[word] || 0) + 1;
      });
  });

  return {
    ...base,
    responses: poll.responses.map((response) => response.value),
    words: Object.entries(words)
      .map(([text, count]) => ({ text, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 24),
  };
}

export function buildAnalytics(event) {
  const participantIds = new Set();
  event.questions.forEach((question) => question.upvotes.forEach((id) => participantIds.add(id)));
  event.polls.forEach((poll) =>
    poll.responses.forEach((response) => participantIds.add(response.participantId)),
  );
  event.quizzes.forEach((quiz) =>
    quiz.answers.forEach((answer) => participantIds.add(answer.participantId)),
  );

  const pollResponses = event.polls.reduce((total, poll) => total + poll.responses.length, 0);
  const quizAnswers = event.quizzes.reduce((total, quiz) => total + quiz.answers.length, 0);
  const questionVotes = event.questions.reduce((total, question) => total + question.upvotes.length, 0);

  return {
    participants: participantIds.size,
    questions: event.questions.length,
    answeredQuestions: event.questions.filter((question) => question.answered).length,
    questionVotes,
    pollResponses,
    quizAnswers,
    engagementScore: Math.min(100, event.questions.length * 8 + pollResponses * 4 + quizAnswers * 3),
    topQuestions: [...event.questions]
      .sort((a, b) => b.upvotes.length - a.upvotes.length)
      .slice(0, 5),
    pollSummaries: event.polls.map(summarizePoll),
    leaderboards: event.quizzes.map((quiz) => ({
      quizId: quiz.id,
      title: quiz.title,
      leaderboard: buildLeaderboard(quiz),
    })),
  };
}

export function serializeEvent(event) {
  return {
    ...event,
    questions: [...event.questions].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.answered !== b.answered) return a.answered ? 1 : -1;
      if (b.upvotes.length !== a.upvotes.length) return b.upvotes.length - a.upvotes.length;
      return new Date(b.createdAt) - new Date(a.createdAt);
    }),
    polls: [...event.polls],
    quizzes: event.quizzes.map((quiz) => ({
      ...quiz,
      leaderboard: buildLeaderboard(quiz),
    })),
    analytics: buildAnalytics(event),
  };
}
