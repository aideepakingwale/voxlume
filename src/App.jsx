import {
  BarChart3,
  BrainCircuit,
  Check,
  ChevronRight,
  CirclePlay,
  ClipboardList,
  Cloud,
  Download,
  FileSpreadsheet,
  FileText,
  Gauge,
  KeyRound,
  Link as LinkIcon,
  LockKeyhole,
  MessageSquareText,
  Pin,
  Plus,
  Presentation,
  QrCode,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Vote,
  X,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { io } from "socket.io-client";
import { APP_CONFIG } from "./config.js";

const DEFAULT_API_BASE = import.meta.env.DEV ? "http://localhost:4100" : window.location.origin;
const API_BASE = import.meta.env.VITE_API_URL || DEFAULT_API_BASE;

const pollTypeLabels = {
  multiple_choice: "Multiple choice",
  rating: "Rating",
  open_text: "Open text",
  word_cloud: "Word cloud",
  scale: "Scale",
  yes_no: "Yes / no",
};

const pollTypeIcons = {
  multiple_choice: ClipboardList,
  rating: Trophy,
  open_text: MessageSquareText,
  word_cloud: Cloud,
  scale: Gauge,
  yes_no: Vote,
};

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

function parseRoute() {
  const path = window.location.pathname;
  const [, route, code] = path.split("/");
  if (route === "join") return { view: "participant", code: code?.toUpperCase() || "" };
  if (route === "host") return { view: "host", code: code?.toUpperCase() || "" };
  return { view: "host", code: "" };
}

function useLiveEvent(code) {
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(Boolean(code));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!code) {
      setEvent(null);
      setLoading(false);
      return undefined;
    }

    let active = true;
    setLoading(true);
    setError("");
    api(`/api/events/${code}`)
      .then((payload) => {
        if (active) setEvent(payload);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const socket = io(API_BASE, { transports: ["websocket", "polling"] });
    socket.emit("join:event", code);
    socket.on("event:update", (payload) => {
      if (payload.code === code) setEvent(payload);
    });
    socket.on("connect_error", () => {
      setError("Live connection paused. Retrying...");
    });

    return () => {
      active = false;
      socket.disconnect();
    };
  }, [code]);

  return { event, loading, error };
}

function getParticipantId() {
  const key = `${APP_CONFIG.storagePrefix}-participant-id`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    localStorage.setItem(key, id);
  }
  return id;
}

function classNames(...items) {
  return items.filter(Boolean).join(" ");
}

function App() {
  const [route, setRoute] = useState(parseRoute);

  function navigate(nextRoute) {
    setRoute(nextRoute);
    const path = nextRoute.view === "participant" ? `/join/${nextRoute.code || ""}` : `/host/${nextRoute.code || ""}`;
    window.history.pushState(nextRoute, "", path);
  }

  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return route.view === "participant" ? (
    <ParticipantExperience initialCode={route.code} onHost={(code) => navigate({ view: "host", code })} />
  ) : (
    <HostConsole routeCode={route.code} onJoin={(code) => navigate({ view: "participant", code })} />
  );
}

function HostConsole({ routeCode, onJoin }) {
  const [events, setEvents] = useState([]);
  const [selectedCode, setSelectedCode] = useState(routeCode);
  const [tab, setTab] = useState("qna");
  const [newEvent, setNewEvent] = useState({
    title: "",
    audience: "",
    stage: "",
  });
  const { event, loading, error } = useLiveEvent(selectedCode);

  useEffect(() => {
    api("/api/events").then((payload) => {
      setEvents(payload);
      if (!selectedCode && payload[0]) setSelectedCode(payload[0].code);
    });
  }, []);

  useEffect(() => {
    if (routeCode) setSelectedCode(routeCode);
  }, [routeCode]);

  useEffect(() => {
    if (!event) return;
    setEvents((current) => {
      const exists = current.some((item) => item.code === event.code);
      return exists ? current.map((item) => (item.code === event.code ? event : item)) : [event, ...current];
    });
  }, [event]);

  async function createEvent() {
    const created = await api("/api/events", {
      method: "POST",
      body: JSON.stringify(newEvent),
    });
    setNewEvent({ title: "", audience: "", stage: "" });
    setSelectedCode(created.code);
    window.history.pushState({}, "", `/host/${created.code}`);
  }

  const tabs = [
    { id: "qna", label: "Q&A", icon: MessageSquareText },
    { id: "polls", label: "Polls", icon: Vote },
    { id: "quiz", label: "Quiz", icon: Trophy },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "enterprise", label: "Enterprise", icon: ShieldCheck },
  ];
  const activePoll = event?.polls.find((poll) => poll.id === event.activePollId);
  const activeSummary = event?.analytics.pollSummaries.find((summary) => summary.id === event.activePollId);
  const topQuestion = event?.analytics.topQuestions[0];
  const previewCounts = activeSummary?.counts
    ? Object.entries(activeSummary.counts).slice(0, 4)
    : [["Responses", activeSummary?.responseCount || 0]];
  const previewMax = Math.max(1, ...previewCounts.map(([, count]) => count));
  const featureCards = event
    ? [
        {
          id: "qna",
          label: "Audience Q&A",
          helper: "Prioritized by live upvotes",
          value: event.questions.length,
          icon: MessageSquareText,
        },
        {
          id: "polls",
          label: "Live polls",
          helper: "Polls, surveys, and word clouds",
          value: event.polls.length,
          icon: Vote,
        },
        {
          id: "quiz",
          label: "Quiz games",
          helper: "Competition with leaderboards",
          value: event.analytics.quizAnswers,
          icon: Trophy,
        },
        {
          id: "analytics",
          label: "Insights",
          helper: "Engagement score in real time",
          value: event.analytics.engagementScore,
          icon: BarChart3,
        },
      ]
    : [];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">{APP_CONFIG.brandInitials}</div>
          <div>
            <strong>{APP_CONFIG.productName}</strong>
            <span>{APP_CONFIG.tagline}</span>
          </div>
        </div>

        <div className="event-list">
          <p className="section-label">Workspaces</p>
          {events.map((item) => (
            <button
              className={classNames("event-row", item.code === selectedCode && "active")}
              key={item.code}
              onClick={() => {
                setSelectedCode(item.code);
                window.history.pushState({}, "", `/host/${item.code}`);
              }}
            >
              <span>
                <strong>{item.title}</strong>
                <small>{item.code}</small>
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        {loading && <StateMessage title="Loading event" />}
        {error && <StateMessage title={error} tone="danger" />}
        {!loading && !event && <StateMessage title="No event selected" />}
        {event && (
          <>
            <section className="hero-stage">
              <div className="hero-content">
                <div className="eyebrow">{event.stage}</div>
                <h1>{event.title}</h1>
                <p className="hero-copy">
                  Crowdsource the room, launch live activities, and turn every answer into engagement insight.
                </p>
                <div className="hero-actions">
                  <button className="primary-button" onClick={() => onJoin(event.code)}>
                    <QrCode size={16} />
                    Participant view
                  </button>
                  <CopyLinkButton link={`${window.location.origin}/join/${event.code}`} />
                </div>
                <div className="meta-line">
                  <span>{event.audience}</span>
                  <span>Code {event.code}</span>
                  <span>{event.uptimeTarget} uptime target</span>
                </div>
              </div>

              <div className="hero-visual" aria-label="Live interaction preview">
                <div className="hero-visual-header">
                  <span className="preview-dot" />
                  <strong>Live room</strong>
                  <em>{event.code}</em>
                </div>
                <div className="preview-question">
                  <span className="preview-icon">
                    <MessageSquareText size={18} />
                  </span>
                  <div>
                    <small>Top audience question</small>
                    <p>{topQuestion?.text || "Questions will appear here as the audience joins."}</p>
                  </div>
                  <strong>{topQuestion?.upvotes.length || 0}</strong>
                </div>
                <div className="preview-bars">
                  <div className="preview-bars-heading">
                    <span>{activePoll?.title || "Active poll"}</span>
                    <strong>{activeSummary?.responseCount || 0} responses</strong>
                  </div>
                  {previewCounts.map(([label, count]) => (
                    <div className="preview-bar-row" key={label}>
                      <span>{label}</span>
                      <div>
                        <i style={{ width: `${Math.max(8, (count / previewMax) * 100)}%` }} />
                      </div>
                      <strong>{count}</strong>
                    </div>
                  ))}
                </div>
                <div className="preview-footer">
                  <div className="qr-tile" aria-label="Participant QR code">
                    <QRCodeSVG value={`${window.location.origin}/join/${event.code}`} size={74} />
                  </div>
                  <div>
                    <p className="section-label">Audience access</p>
                    <strong>{window.location.origin}/join/{event.code}</strong>
                    <span>Guests join instantly with no download or account.</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="feature-grid">
              {featureCards.map((card) => {
                const Icon = card.icon;
                return (
                  <button
                    className={classNames("feature-card", tab === card.id && "active")}
                    key={card.id}
                    onClick={() => setTab(card.id)}
                  >
                    <span className="feature-icon">
                      <Icon size={22} />
                    </span>
                    <span>
                      <strong>{card.label}</strong>
                      <small>{card.helper}</small>
                    </span>
                    <em>{card.value}</em>
                  </button>
                );
              })}
            </section>

            <section className="create-event quick-create">
              <div className="quick-create-copy">
                <p className="section-label">New event</p>
                <h2>Launch another audience room</h2>
              </div>
              <label>
                Event
                <input
                  value={newEvent.title}
                  onChange={(event) => setNewEvent((value) => ({ ...value, title: event.target.value }))}
                  placeholder="Leadership summit"
                />
              </label>
              <label>
                Audience
                <input
                  value={newEvent.audience}
                  onChange={(event) => setNewEvent((value) => ({ ...value, audience: event.target.value }))}
                  placeholder="Remote and in-room"
                />
              </label>
              <label>
                Format
                <input
                  value={newEvent.stage}
                  onChange={(event) => setNewEvent((value) => ({ ...value, stage: event.target.value }))}
                  placeholder="Webinar"
                />
              </label>
              <button className="primary-button" onClick={createEvent}>
                <Plus size={16} />
                Create event
              </button>
            </section>

            <nav className="tabs compact-tabs">
              {tabs.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    className={classNames("tab-button", tab === item.id && "active")}
                    key={item.id}
                    onClick={() => setTab(item.id)}
                  >
                    <Icon size={16} />
                    {item.label}
                  </button>
                );
              })}
            </nav>

            {tab === "qna" && <HostQandA event={event} />}
            {tab === "polls" && <PollStudio event={event} />}
            {tab === "quiz" && <QuizStudio event={event} />}
            {tab === "analytics" && <AnalyticsPanel event={event} />}
            {tab === "enterprise" && <EnterprisePanel event={event} />}
          </>
        )}
      </main>
    </div>
  );
}

function CopyLinkButton({ link }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="secondary-button"
      onClick={async () => {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? <Check size={16} /> : <LinkIcon size={16} />}
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

function StateMessage({ title, tone = "neutral" }) {
  return (
    <div className={classNames("state-message", tone)}>
      <strong>{title}</strong>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, accent = "blue" }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${accent}`}>
        <Icon size={18} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HostQandA({ event }) {
  const [composer, setComposer] = useState("");

  async function askAsHost() {
    if (!composer.trim()) return;
    await api(`/api/events/${event.code}/questions`, {
      method: "POST",
      body: JSON.stringify({ text: composer, name: "Host", anonymous: false }),
    });
    setComposer("");
  }

  return (
    <section className="content-grid two">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="section-label">Question queue</p>
            <h2>Audience Q&A</h2>
          </div>
          <span className="badge">{event.questions.length} submitted</span>
        </div>

        <div className="inline-composer">
          <input
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
            placeholder="Seed a question for the room"
          />
          <button className="icon-button primary" onClick={askAsHost} aria-label="Add question">
            <Plus size={17} />
          </button>
        </div>

        <div className="question-list">
          {event.questions.map((question) => (
            <article className={classNames("question-card", question.answered && "answered")} key={question.id}>
              <div className="vote-count">
                <strong>{question.upvotes.length}</strong>
                <span>votes</span>
              </div>
              <div className="question-body">
                <div className="question-meta">
                  <span>{question.anonymous ? "Anonymous" : question.name}</span>
                  {question.pinned && <span className="mini-tag">Pinned</span>}
                  {question.answered && <span className="mini-tag done">Answered</span>}
                </div>
                <p>{question.text}</p>
                <div className="question-actions">
                  <button
                    className="ghost-button"
                    onClick={() =>
                      api(`/api/events/${event.code}/questions/${question.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ pinned: !question.pinned }),
                      })
                    }
                  >
                    <Pin size={14} />
                    {question.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() =>
                      api(`/api/events/${event.code}/questions/${question.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ answered: !question.answered }),
                      })
                    }
                  >
                    <Check size={14} />
                    {question.answered ? "Reopen" : "Mark answered"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="stack">
        <MetricCard icon={Users} label="Participants" value={event.analytics.participants} accent="green" />
        <MetricCard icon={MessageSquareText} label="Open questions" value={event.questions.filter((q) => !q.answered).length} />
        <MetricCard icon={Vote} label="Upvotes" value={event.analytics.questionVotes} accent="amber" />
        <div className="panel compact">
          <p className="section-label">Moderation</p>
          <h3>Queue controls</h3>
          <div className="switch-row">
            <span>Anonymous Q&A</span>
            <strong>{event.security.anonymousQuestions ? "On" : "Off"}</strong>
          </div>
          <div className="switch-row">
            <span>Host moderation</span>
            <strong>{event.security.moderation ? "On" : "Off"}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

function PollStudio({ event }) {
  const [draft, setDraft] = useState({
    type: "multiple_choice",
    title: "",
    options: "Launch plan\nCustomer proof\nSecurity\nPricing",
  });
  const [aiInput, setAiInput] = useState("hybrid product launch");
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [refineText, setRefineText] = useState("what do you think about our roadmap");
  const [refined, setRefined] = useState("");

  async function createPollFromDraft(source = draft) {
    const options = source.options
      ? String(source.options)
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
    await api(`/api/events/${event.code}/polls`, {
      method: "POST",
      body: JSON.stringify({
        type: source.type,
        title: source.title || "Untitled poll",
        options,
      }),
    });
    setDraft((value) => ({ ...value, title: "" }));
  }

  async function createSurvey() {
    await api(`/api/events/${event.code}/surveys`, {
      method: "POST",
      body: JSON.stringify({ title: "Session pulse survey" }),
    });
  }

  async function getSuggestions() {
    const payload = await api("/api/ai/suggest", {
      method: "POST",
      body: JSON.stringify({
        goal: aiInput,
        audience: event.audience,
        tone: "executive",
      }),
    });
    setAiSuggestions(payload.suggestions);
  }

  async function refineQuestion() {
    const payload = await api("/api/ai/refine", {
      method: "POST",
      body: JSON.stringify({ text: refineText }),
    });
    setRefined(payload.refined);
    setDraft((value) => ({ ...value, title: payload.refined }));
  }

  const activePoll = event.polls.find((poll) => poll.id === event.activePollId);

  return (
    <section className="content-grid two">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="section-label">Activity builder</p>
            <h2>Polls, surveys, and word clouds</h2>
          </div>
          <button className="secondary-button" onClick={createSurvey}>
            <ClipboardList size={16} />
            Bundle survey
          </button>
        </div>

        <div className="builder-grid">
          <label>
            Type
            <select value={draft.type} onChange={(event) => setDraft((value) => ({ ...value, type: event.target.value }))}>
              {Object.entries(pollTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="wide">
            Prompt
            <input
              value={draft.title}
              onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))}
              placeholder="Which roadmap theme should we prioritize?"
            />
          </label>
          {!["open_text", "word_cloud"].includes(draft.type) && (
            <label className="wide">
              Options
              <textarea
                value={draft.options}
                onChange={(event) => setDraft((value) => ({ ...value, options: event.target.value }))}
                rows={4}
              />
            </label>
          )}
          <button className="primary-button" onClick={() => createPollFromDraft()}>
            <Plus size={16} />
            Add poll
          </button>
        </div>

        <div className="ai-box">
          <div className="ai-heading">
            <Sparkles size={17} />
            <strong>{APP_CONFIG.productName} AI assistant</strong>
          </div>
          <div className="inline-composer">
            <input value={aiInput} onChange={(event) => setAiInput(event.target.value)} />
            <button className="secondary-button" onClick={getSuggestions}>
              <BrainCircuit size={15} />
              Suggest
            </button>
          </div>
          <div className="inline-composer">
            <input value={refineText} onChange={(event) => setRefineText(event.target.value)} />
            <button className="secondary-button" onClick={refineQuestion}>
              <Sparkles size={15} />
              Refine
            </button>
          </div>
          {refined && <p className="refined-line">{refined}</p>}
          <div className="suggestion-grid">
            {aiSuggestions.map((suggestion) => {
              const Icon = pollTypeIcons[suggestion.type] || Vote;
              return (
                <button
                  className="suggestion-card"
                  key={`${suggestion.type}-${suggestion.title}`}
                  onClick={() =>
                    createPollFromDraft({
                      ...suggestion,
                      options: suggestion.options?.join("\n") || "",
                    })
                  }
                >
                  <Icon size={16} />
                  <span>{suggestion.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="poll-list">
          {event.polls.map((poll) => (
            <PollHostCard event={event} poll={poll} key={poll.id} />
          ))}
        </div>
      </div>

      <div className="stack">
        <div className="panel compact">
          <p className="section-label">Now live</p>
          {activePoll ? (
            <>
              <h3>{activePoll.title}</h3>
              <span className="badge">{pollTypeLabels[activePoll.type]}</span>
              <PollResults event={event} poll={activePoll} />
            </>
          ) : (
            <StateMessage title="No active poll" />
          )}
        </div>
        <MetricCard icon={Vote} label="Poll responses" value={event.analytics.pollResponses} />
        <MetricCard icon={Cloud} label="Poll types" value={Object.keys(pollTypeLabels).length} accent="green" />
      </div>
    </section>
  );
}

function PollHostCard({ event, poll }) {
  const Icon = pollTypeIcons[poll.type] || Vote;
  return (
    <article className="activity-card">
      <div className="activity-title">
        <div className="activity-icon">
          <Icon size={17} />
        </div>
        <div>
          <strong>{poll.title}</strong>
          <span>
            {pollTypeLabels[poll.type]} {poll.surveyTitle ? `• ${poll.surveyTitle}` : ""}
          </span>
        </div>
      </div>
      <div className="activity-actions">
        <span className={classNames("status-pill", poll.status)}>{poll.status}</span>
        {poll.status === "active" ? (
          <button className="ghost-button" onClick={() => api(`/api/events/${event.code}/polls/${poll.id}/close`, { method: "POST" })}>
            <X size={14} />
            Close
          </button>
        ) : (
          <button
            className="secondary-button"
            onClick={() => api(`/api/events/${event.code}/polls/${poll.id}/activate`, { method: "POST" })}
          >
            <CirclePlay size={15} />
            Launch
          </button>
        )}
      </div>
      <PollResults event={event} poll={poll} compact />
    </article>
  );
}

function PollResults({ event, poll, compact = false }) {
  const summary = event.analytics.pollSummaries.find((item) => item.id === poll.id);
  if (!summary) return null;

  if (summary.counts) {
    const max = Math.max(1, ...Object.values(summary.counts));
    return (
      <div className={classNames("result-bars", compact && "compact")}>
        {Object.entries(summary.counts).map(([label, count]) => (
          <div className="result-row" key={label}>
            <span>{label}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(count / max) * 100}%` }} />
            </div>
            <strong>{count}</strong>
          </div>
        ))}
      </div>
    );
  }

  if (typeof summary.average === "number") {
    return (
      <div className="average-box">
        <strong>{summary.average || "0.0"}</strong>
        <span>{summary.responseCount} responses</span>
      </div>
    );
  }

  if (poll.type === "word_cloud") {
    return (
      <div className="word-cloud">
        {(summary.words || []).map((word) => (
          <span style={{ fontSize: `${13 + word.count * 3}px` }} key={word.text}>
            {word.text}
          </span>
        ))}
        {!summary.words?.length && <small>No words yet</small>}
      </div>
    );
  }

  return (
    <div className="text-responses">
      {(summary.responses || []).slice(-4).map((response, index) => (
        <span key={`${response}-${index}`}>{response}</span>
      ))}
      {!summary.responses?.length && <small>No responses yet</small>}
    </div>
  );
}

function QuizStudio({ event }) {
  const [quizTitle, setQuizTitle] = useState("Hybrid meeting mastery");
  const activeQuiz = event.quizzes.find((quiz) => quiz.id === event.activeQuizId);

  async function createQuiz() {
    await api(`/api/events/${event.code}/quizzes`, {
      method: "POST",
      body: JSON.stringify({ title: quizTitle }),
    });
    setQuizTitle("");
  }

  return (
    <section className="content-grid two">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="section-label">Competitive learning</p>
            <h2>Live quizzes</h2>
          </div>
          <div className="inline-composer small">
            <input value={quizTitle} onChange={(event) => setQuizTitle(event.target.value)} />
            <button className="primary-button" onClick={createQuiz}>
              <Plus size={16} />
              Add quiz
            </button>
          </div>
        </div>

        <div className="quiz-list">
          {event.quizzes.map((quiz) => {
            const current = quiz.questions[quiz.currentIndex];
            return (
              <article className="activity-card quiz-card" key={quiz.id}>
                <div className="activity-title">
                  <div className="activity-icon amber">
                    <Trophy size={17} />
                  </div>
                  <div>
                    <strong>{quiz.title}</strong>
                    <span>
                      {quiz.questions.length} questions • {quiz.answers.length} answers
                    </span>
                  </div>
                </div>
                <div className="activity-actions">
                  <span className={classNames("status-pill", quiz.status)}>{quiz.status}</span>
                  {quiz.status !== "active" ? (
                    <button
                      className="secondary-button"
                      onClick={() => api(`/api/events/${event.code}/quizzes/${quiz.id}/start`, { method: "POST" })}
                    >
                      <CirclePlay size={15} />
                      Start
                    </button>
                  ) : (
                    <button
                      className="primary-button"
                      onClick={() => api(`/api/events/${event.code}/quizzes/${quiz.id}/advance`, { method: "POST" })}
                    >
                      <ChevronRight size={15} />
                      {quiz.currentIndex < quiz.questions.length - 1 ? "Next" : "Finish"}
                    </button>
                  )}
                </div>
                {current && (
                  <div className="quiz-question">
                    <p>{current.text}</p>
                    <div className="answer-grid">
                      {current.options.map((option, index) => (
                        <span className={index === current.correctIndex ? "correct-option" : ""} key={option}>
                          {option}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>

      <div className="stack">
        <div className="panel compact">
          <p className="section-label">Live leaderboard</p>
          {activeQuiz ? (
            <>
              <h3>{activeQuiz.title}</h3>
              <Leaderboard quiz={activeQuiz} />
            </>
          ) : (
            <Leaderboard quiz={event.quizzes[0]} />
          )}
        </div>
        <MetricCard icon={Trophy} label="Quiz answers" value={event.analytics.quizAnswers} accent="amber" />
      </div>
    </section>
  );
}

function Leaderboard({ quiz }) {
  const rows = quiz?.leaderboard || [];
  if (!rows.length) return <StateMessage title="No scores yet" />;
  return (
    <div className="leaderboard">
      {rows.slice(0, 6).map((row) => (
        <div className="leaderboard-row" key={row.participantId}>
          <span>{row.rank}</span>
          <strong>{row.name}</strong>
          <em>{row.score}</em>
        </div>
      ))}
    </div>
  );
}

function AnalyticsPanel({ event }) {
  const analytics = event.analytics;
  const exports = [
    { label: "XLSX", format: "xlsx", icon: FileSpreadsheet },
    { label: "CSV", format: "csv", icon: Download },
    { label: "PDF", format: "pdf", icon: FileText },
  ];

  return (
    <section className="analytics-layout">
      <div className="metric-grid">
        <MetricCard icon={Users} label="Participants" value={analytics.participants} accent="green" />
        <MetricCard icon={MessageSquareText} label="Questions" value={analytics.questions} />
        <MetricCard icon={Vote} label="Poll responses" value={analytics.pollResponses} accent="amber" />
        <MetricCard icon={Trophy} label="Quiz answers" value={analytics.quizAnswers} accent="rose" />
      </div>

      <div className="content-grid two">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Engagement intelligence</p>
              <h2>Live insights</h2>
            </div>
            <div className="score-ring">{analytics.engagementScore}</div>
          </div>
          <div className="insight-list">
            {analytics.topQuestions.map((question) => (
              <div className="insight-row" key={question.id}>
                <MessageSquareText size={16} />
                <span>{question.text}</span>
                <strong>{question.upvotes.length}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Post-event reporting</p>
              <h2>Exports</h2>
            </div>
          </div>
          <div className="export-grid">
            {exports.map((item) => {
              const Icon = item.icon;
              return (
                <a
                  className="export-card"
                  href={`${API_BASE}/api/events/${event.code}/export/${item.format}`}
                  key={item.format}
                >
                  <Icon size={20} />
                  <strong>{item.label}</strong>
                </a>
              );
            })}
          </div>
          <div className="timeline">
            {analytics.pollSummaries.slice(0, 5).map((poll) => (
              <div className="timeline-row" key={poll.id}>
                <span />
                <p>{poll.title}</p>
                <strong>{poll.responseCount}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function EnterprisePanel({ event }) {
  const [security, setSecurity] = useState(event.security);

  useEffect(() => {
    setSecurity(event.security);
  }, [event.security]);

  async function saveSecurity(next) {
    setSecurity(next);
    await api(`/api/events/${event.code}/security`, {
      method: "PATCH",
      body: JSON.stringify(next),
    });
  }

  return (
    <section className="content-grid two">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="section-label">Presentation and meeting apps</p>
            <h2>Integrations</h2>
          </div>
          <Presentation size={20} />
        </div>
        <div className="integration-grid">
          {event.integrations.map((integration) => (
            <div className="integration-card" key={integration.name}>
              <div className="integration-icon">
                <Presentation size={18} />
              </div>
              <strong>{integration.name}</strong>
              <span>{integration.status}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="section-label">Enterprise controls</p>
            <h2>Security posture</h2>
          </div>
          <LockKeyhole size={20} />
        </div>
        <div className="settings-list">
          <label>
            SSO provider
            <select
              value={security.ssoProvider}
              onChange={(event) => saveSecurity({ ...security, ssoProvider: event.target.value })}
            >
              <option>Okta</option>
              <option>Microsoft Azure</option>
              <option>Auth0</option>
            </select>
          </label>
          <ToggleRow
            label="HIPAA readiness controls"
            checked={security.hipaaReady}
            onChange={(checked) => saveSecurity({ ...security, hipaaReady: checked })}
          />
          <ToggleRow
            label="Anonymous questions"
            checked={security.anonymousQuestions}
            onChange={(checked) => saveSecurity({ ...security, anonymousQuestions: checked })}
          />
          <ToggleRow
            label="Moderation workflow"
            checked={security.moderation}
            onChange={(checked) => saveSecurity({ ...security, moderation: checked })}
          />
        </div>
        <div className="control-map">
          {security.controlMappings.map((mapping) => (
            <span key={mapping}>
              <ShieldCheck size={14} />
              {mapping}
            </span>
          ))}
          <span>
            <KeyRound size={14} />
            SSO
          </span>
        </div>
      </div>
    </section>
  );
}

function ToggleRow({ label, checked, onChange }) {
  return (
    <button className="toggle-row" onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <span className={classNames("toggle", checked && "checked")}>
        <span />
      </span>
    </button>
  );
}

function ParticipantExperience({ initialCode, onHost }) {
  const [code, setCode] = useState(initialCode || "");
  const [joinedCode, setJoinedCode] = useState(initialCode || "");
  const nameStorageKey = `${APP_CONFIG.storagePrefix}-name`;
  const [name, setName] = useState(localStorage.getItem(nameStorageKey) || "");
  const [anonymous, setAnonymous] = useState(!localStorage.getItem(nameStorageKey));
  const participantId = useMemo(getParticipantId, []);
  const { event, loading, error } = useLiveEvent(joinedCode);

  function joinEvent() {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    setJoinedCode(normalized);
    window.history.pushState({}, "", `/join/${normalized}`);
  }

  useEffect(() => {
    if (name) localStorage.setItem(nameStorageKey, name);
  }, [name, nameStorageKey]);

  return (
    <div className="participant-shell">
      <header className="participant-topbar">
        <div className="brand compact-brand">
          <div className="brand-mark">{APP_CONFIG.brandInitials}</div>
          <strong>{APP_CONFIG.productName}</strong>
        </div>
        {joinedCode && (
          <button className="ghost-button" onClick={() => onHost(joinedCode)}>
            Host console
          </button>
        )}
      </header>

      {!joinedCode && (
        <section className="join-card">
          <p className="section-label">Join event</p>
          <h1>Enter event code</h1>
          <div className="inline-composer">
            <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="ALPHA9" />
            <button className="primary-button" onClick={joinEvent}>
              Join
            </button>
          </div>
        </section>
      )}

      {loading && <StateMessage title="Joining event" />}
      {error && <StateMessage title={error} tone="danger" />}

      {event && (
        <main className="participant-main">
          <section className="participant-hero">
            <div>
              <p className="section-label">Event code {event.code}</p>
              <h1>{event.title}</h1>
              <span>{event.stage}</span>
            </div>
            <div className="identity-card">
              <label>
                Display name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={anonymous}
                  placeholder="Your name"
                />
              </label>
              <ToggleRow label="Ask anonymously" checked={anonymous} onChange={setAnonymous} />
            </div>
          </section>

          <section className="participant-grid">
            <ParticipantQandA
              event={event}
              participantId={participantId}
              name={anonymous ? "Anonymous" : name || "Guest"}
              anonymous={anonymous}
            />
            <ParticipantLiveActivity event={event} participantId={participantId} name={anonymous ? "Anonymous" : name || "Guest"} />
          </section>
        </main>
      )}
    </div>
  );
}

function ParticipantQandA({ event, participantId, name, anonymous }) {
  const [text, setText] = useState("");

  async function submitQuestion() {
    if (!text.trim()) return;
    await api(`/api/events/${event.code}/questions`, {
      method: "POST",
      body: JSON.stringify({ text, name, anonymous }),
    });
    setText("");
  }

  return (
    <div className="panel participant-panel">
      <div className="panel-heading">
        <div>
          <p className="section-label">Audience Q&A</p>
          <h2>Questions</h2>
        </div>
      </div>
      <div className="question-input">
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Ask a question" rows={3} />
        <button className="primary-button" onClick={submitQuestion}>
          <MessageSquareText size={16} />
          Submit
        </button>
      </div>
      <div className="participant-questions">
        {event.questions.map((question) => {
          const upvoted = question.upvotes.includes(participantId);
          return (
            <article className={classNames("participant-question", question.answered && "answered")} key={question.id}>
              <button
                className={classNames("upvote-button", upvoted && "active")}
                onClick={() =>
                  api(`/api/events/${event.code}/questions/${question.id}/upvote`, {
                    method: "POST",
                    body: JSON.stringify({ participantId }),
                  })
                }
                aria-label="Upvote question"
              >
                <Vote size={16} />
                {question.upvotes.length}
              </button>
              <div>
                <p>{question.text}</p>
                <span>{question.anonymous ? "Anonymous" : question.name}</span>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ParticipantLiveActivity({ event, participantId, name }) {
  const activePoll = event.polls.find((poll) => poll.id === event.activePollId);
  const activeQuiz = event.quizzes.find((quiz) => quiz.id === event.activeQuizId);

  return (
    <div className="stack">
      <div className="panel participant-panel">
        <div className="panel-heading">
          <div>
            <p className="section-label">Live poll</p>
            <h2>{activePoll ? activePoll.title : "Waiting for host"}</h2>
          </div>
        </div>
        {activePoll ? (
          <PollAnswerForm event={event} poll={activePoll} participantId={participantId} name={name} />
        ) : (
          <StateMessage title="No poll is active" />
        )}
      </div>

      <div className="panel participant-panel">
        <div className="panel-heading">
          <div>
            <p className="section-label">Live quiz</p>
            <h2>{activeQuiz ? activeQuiz.title : "Leaderboard"}</h2>
          </div>
        </div>
        {activeQuiz ? (
          <QuizAnswerForm event={event} quiz={activeQuiz} participantId={participantId} name={name} />
        ) : (
          <Leaderboard quiz={event.quizzes[0]} />
        )}
      </div>
    </div>
  );
}

function PollAnswerForm({ event, poll, participantId, name }) {
  const existing = poll.responses.find((response) => response.participantId === participantId);
  const [value, setValue] = useState(existing?.value || "");

  useEffect(() => {
    setValue(existing?.value || "");
  }, [existing?.value, poll.id]);

  async function submit(valueToSend = value) {
    if (valueToSend === "" || valueToSend == null) return;
    await api(`/api/events/${event.code}/polls/${poll.id}/responses`, {
      method: "POST",
      body: JSON.stringify({ participantId, name, value: valueToSend }),
    });
  }

  if (["multiple_choice", "yes_no"].includes(poll.type)) {
    return (
      <div className="choice-list">
        {poll.options.map((option) => (
          <button
            className={classNames("choice-button", existing?.value === option && "selected")}
            key={option}
            onClick={() => {
              setValue(option);
              submit(option);
            }}
          >
            {option}
          </button>
        ))}
      </div>
    );
  }

  if (poll.type === "rating") {
    return (
      <div className="rating-row">
        {poll.options.map((option) => (
          <button
            className={classNames("rating-button", String(existing?.value) === String(option) && "selected")}
            key={option}
            onClick={() => {
              setValue(option);
              submit(option);
            }}
          >
            {option}
          </button>
        ))}
      </div>
    );
  }

  if (poll.type === "scale") {
    return (
      <div className="scale-box">
        <input
          type="range"
          min="0"
          max="10"
          value={value || 5}
          onChange={(event) => setValue(event.target.value)}
          onMouseUp={(event) => submit(event.currentTarget.value)}
          onTouchEnd={(event) => submit(event.currentTarget.value)}
        />
        <strong>{value || 5}</strong>
      </div>
    );
  }

  return (
    <div className="question-input">
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={poll.type === "word_cloud" ? "One word or phrase" : "Your response"}
        rows={3}
      />
      <button className="primary-button" onClick={() => submit()}>
        <Check size={16} />
        Send
      </button>
      {existing && <span className="submitted-label">Response captured</span>}
    </div>
  );
}

function QuizAnswerForm({ event, quiz, participantId, name }) {
  const current = quiz.questions[quiz.currentIndex];
  const existing = quiz.answers.find(
    (answer) => answer.participantId === participantId && answer.questionId === current?.id,
  );

  if (!current) return <Leaderboard quiz={quiz} />;

  return (
    <div className="quiz-answer">
      <p>{current.text}</p>
      <div className="choice-list">
        {current.options.map((option, index) => (
          <button
            className={classNames("choice-button", existing?.answerIndex === index && "selected")}
            key={option}
            disabled={Boolean(existing)}
            onClick={() =>
              api(`/api/events/${event.code}/quizzes/${quiz.id}/answers`, {
                method: "POST",
                body: JSON.stringify({
                  participantId,
                  name,
                  questionId: current.id,
                  answerIndex: index,
                }),
              })
            }
          >
            {option}
          </button>
        ))}
      </div>
      {existing && (
        <div className={classNames("answer-state", existing.correct ? "correct" : "incorrect")}>
          {existing.correct ? "Correct" : "Answer submitted"}
        </div>
      )}
      <Leaderboard quiz={quiz} />
    </div>
  );
}

export default App;
