"use strict";

// The UI is served from the FastAPI app, so same-origin relative URLs resolve
// to http://localhost:8000 locally and also work in a proxied live preview.
const API_BASE = "";

// The API requires category and estimated_minutes when creating a task. Rapid
// capture uses these defaults; change them here if your workflow differs.
const DEFAULT_TASK_CATEGORY = "General";
const DEFAULT_ESTIMATED_MINUTES = 30;
const WORKDAY_START_HOUR = 8;
const WORKDAY_END_HOUR = 20;

const taskInput = document.getElementById("quick-task");
const addTaskButton = document.getElementById("add-task");
const aiAssistButton = document.getElementById("ai-assist");
const inboxList = document.getElementById("inbox-list");
const inboxCount = document.getElementById("inbox-count");
const appStatus = document.getElementById("app-status");
const agentResponse = document.getElementById("agent-response");
const dayGrid = document.getElementById("day-grid");
const dayLabel = document.getElementById("day-label");
const scheduleDateLabel = document.getElementById("schedule-date");

let selectedDate = startOfDay(new Date());
let actionInProgress = false;

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setAppStatus(message, isError = false) {
  appStatus.textContent = message;
  appStatus.classList.toggle("is-error", isError);
}

function setBusy(isBusy) {
  actionInProgress = isBusy;
  taskInput.disabled = isBusy;
  addTaskButton.disabled = isBusy;
  aiAssistButton.disabled = isBusy;
}

function describeApiError(detail, statusCode) {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg || JSON.stringify(item)).join("; ");
  }
  if (detail && typeof detail === "object") return JSON.stringify(detail);
  return `Request failed with HTTP ${statusCode}.`;
}

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch (error) {
    throw new Error(
      "Could not reach the local API. Start FastAPI and open this UI from its root URL.",
      { cause: error },
    );
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Keep null for responses without a JSON body.
  }

  if (!response.ok) {
    throw new Error(describeApiError(payload?.detail, response.status));
  }
  return payload;
}

function categoryTone(category, index = 0) {
  const normalized = String(category || "").toLowerCase();
  if (normalized.includes("personal") || normalized.includes("home")) return "mint";
  if (normalized.includes("team") || normalized.includes("client")) return "blue";
  if (normalized.includes("finance") || normalized.includes("admin")) return "amber";
  return ["", "mint", "blue", "amber"][index % 4];
}

function makeOptionsButton(title) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "task-options";
  button.setAttribute("aria-label", `More options for ${title}`);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  for (const cx of [3, 8, 13]) {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", "8");
    circle.setAttribute("r", "1");
    svg.append(circle);
  }
  button.append(svg);
  return button;
}

function makeInboxTask(task, index) {
  const item = document.createElement("li");
  item.className = "inbox-task";
  if (task.id !== undefined && task.id !== null) item.dataset.taskId = String(task.id);

  const check = document.createElement("span");
  check.className = "task-check";
  check.setAttribute("aria-hidden", "true");

  const copy = document.createElement("div");
  copy.className = "task-copy";

  const title = document.createElement("h3");
  title.textContent = String(task.title || "Untitled task");

  const meta = document.createElement("div");
  meta.className = "task-meta";

  const category = document.createElement("span");
  category.className = "category-label";
  const dot = document.createElement("span");
  dot.className = "category-dot";
  const tone = categoryTone(task.category, index);
  if (tone) dot.classList.add(tone);
  const categoryName = document.createElement("span");
  categoryName.textContent = String(task.category || "General");
  category.append(dot, categoryName);

  const separator = document.createElement("span");
  separator.className = "separator";
  separator.textContent = "·";

  const estimate = document.createElement("span");
  const minutes = Number(task.estimated_minutes);
  estimate.textContent = Number.isFinite(minutes) ? `${minutes} min` : "—";

  meta.append(category, separator, estimate);
  copy.append(title, meta);
  item.append(check, copy, makeOptionsButton(String(task.title || "task")));
  return item;
}

function renderInbox(tasks) {
  const fragment = document.createDocumentFragment();
  if (tasks.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-inbox";
    empty.textContent = "Your inbox is clear. Add a task whenever something comes to mind.";
    fragment.append(empty);
  } else {
    tasks.forEach((task, index) => fragment.append(makeInboxTask(task, index)));
  }
  inboxList.replaceChildren(fragment);
  inboxCount.textContent = String(tasks.length).padStart(2, "0");
  inboxCount.setAttribute("aria-label", `${tasks.length} unassigned tasks`);
}

/** GET /tasks?status=inbox and render the returned records in the left pane. */
async function fetchInbox() {
  const tasks = await apiRequest("/tasks?status=inbox");
  if (!Array.isArray(tasks)) throw new Error("The API returned an invalid inbox response.");
  renderInbox(tasks);
  return tasks;
}

function parseTaskDateTime(value) {
  if (!value) return null;
  let normalized = String(value).trim();
  if (!normalized.includes("T") && normalized.includes(" ")) {
    normalized = normalized.replace(" ", "T");
  }
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function makeScheduleEvent(task, start, end, top, height, index) {
  const event = document.createElement("article");
  event.className = `calendar-event event-color-${index % 4}`;
  event.style.top = `${top}px`;
  event.style.height = `${height}px`;
  event.setAttribute(
    "aria-label",
    `${task.title || "Task"}, ${formatTime(start)} to ${formatTime(end)}`,
  );

  const timeLine = document.createElement("div");
  timeLine.className = "event-topline";
  const dot = document.createElement("span");
  dot.className = "event-dot";
  dot.setAttribute("aria-hidden", "true");
  const timeText = document.createElement("span");
  timeText.textContent = `${formatTime(start)} – ${formatTime(end)}`;
  timeLine.append(dot, timeText);

  const title = document.createElement("h2");
  title.textContent = String(task.title || "Untitled task");

  const detail = document.createElement("div");
  detail.className = "event-detail";
  const minutes = Number(task.estimated_minutes);
  detail.textContent = `${String(task.category || "Task")} · ${Number.isFinite(minutes) ? `${minutes} min` : "time not set"}`;

  event.append(timeLine, title, detail);
  if (height < 48) event.classList.add("is-compact");
  return event;
}

function renderSchedule(tasks) {
  dayGrid.querySelectorAll(".calendar-event, .schedule-empty").forEach((node) => node.remove());

  const hourHeight = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--hour-height"),
  ) || 72;
  const dayHeight = (WORKDAY_END_HOUR - WORKDAY_START_HOUR) * hourHeight;
  const dayStart = new Date(selectedDate);
  dayStart.setHours(WORKDAY_START_HOUR, 0, 0, 0);
  const dayEnd = new Date(selectedDate);
  dayEnd.setHours(WORKDAY_END_HOUR, 0, 0, 0);

  const scheduled = tasks
    .map((task) => {
      const start = parseTaskDateTime(task.scheduled_start);
      const minutes = Number(task.estimated_minutes);
      const duration = Number.isFinite(minutes) && minutes > 0
        ? minutes
        : DEFAULT_ESTIMATED_MINUTES;
      return start ? { task, start, end: new Date(start.getTime() + duration * 60_000), duration } : null;
    })
    .filter((entry) => entry && entry.end > dayStart && entry.start < dayEnd)
    .sort((a, b) => a.start - b.start);

  if (scheduled.length === 0) {
    const empty = document.createElement("p");
    empty.className = "schedule-empty";
    empty.textContent = "Nothing scheduled on this day yet. Ask AI Assist to find a free slot or add a task to your inbox.";
    dayGrid.append(empty);
    return;
  }

  scheduled.forEach((entry, index) => {
    const visibleStart = new Date(Math.max(entry.start.getTime(), dayStart.getTime()));
    const visibleEnd = new Date(Math.min(entry.end.getTime(), dayEnd.getTime()));
    const top = ((visibleStart.getTime() - dayStart.getTime()) / 3_600_000) * hourHeight;
    const rawHeight = ((visibleEnd.getTime() - visibleStart.getTime()) / 3_600_000) * hourHeight;
    const height = Math.min(dayHeight - top, Math.max(38, rawHeight));
    dayGrid.append(makeScheduleEvent(entry.task, visibleStart, visibleEnd, top, height, index));
  });
}

/** Fetch scheduled records and redraw the selected day's timeline. */
async function fetchSchedule() {
  // The API has no date-specific endpoint, so read tasks and filter locally.
  const tasks = await apiRequest("/tasks");
  if (!Array.isArray(tasks)) throw new Error("The API returned an invalid task list.");
  renderSchedule(tasks);
  return tasks;
}

async function refreshViews() {
  const outcomes = await Promise.allSettled([fetchInbox(), fetchSchedule()]);
  const failures = outcomes
    .filter((outcome) => outcome.status === "rejected")
    .map((outcome) => outcome.reason?.message || "Could not refresh a view.");
  if (failures.length) throw new Error(failures.join(" "));
}

async function createInboxTask() {
  if (actionInProgress) return;
  const title = taskInput.value.trim();
  if (!title) {
    setAppStatus("Type a task first, then press Enter or use AI Assist.", true);
    taskInput.focus();
    return;
  }

  let saved = false;
  setBusy(true);
  setAppStatus("Adding task to your inbox…");
  try {
    await apiRequest("/tasks", {
      method: "POST",
      body: JSON.stringify({
        title,
        category: DEFAULT_TASK_CATEGORY,
        estimated_minutes: DEFAULT_ESTIMATED_MINUTES,
      }),
    });
    saved = true;
    taskInput.value = "";
    await fetchInbox();
    setAppStatus("Task added to your inbox.");
  } catch (error) {
    setAppStatus(
      saved
        ? `Task was saved, but the inbox could not refresh: ${error.message}`
        : `Could not add task: ${error.message}`,
      true,
    );
  } finally {
    setBusy(false);
    if (saved) taskInput.focus();
  }
}

async function runAIAssist() {
  if (actionInProgress) return;
  const prompt = taskInput.value.trim();
  if (!prompt) {
    setAppStatus("Enter a request for AI Assist first.", true);
    taskInput.focus();
    return;
  }

  let agentCompleted = false;
  setBusy(true);
  agentResponse.hidden = true;
  setAppStatus("AI Assist is working…");
  try {
    const result = await apiRequest("/api/agent", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
    agentCompleted = true;
    agentResponse.textContent = result?.response || "The agent completed the request.";
    agentResponse.hidden = false;
    taskInput.value = "";

    await refreshViews();
    setAppStatus("AI Assist finished. Inbox and schedule are up to date.");
  } catch (error) {
    setAppStatus(
      agentCompleted
        ? `AI responded, but a view could not refresh: ${error.message}`
        : `AI Assist failed: ${error.message}`,
      true,
    );
  } finally {
    setBusy(false);
    if (!agentCompleted) taskInput.focus();
  }
}

function updateScheduleHeading() {
  const today = startOfDay(new Date());
  const isToday = localDateKey(selectedDate) === localDateKey(today);
  dayLabel.textContent = isToday
    ? "Today"
    : new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(selectedDate);
  scheduleDateLabel.textContent = new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(selectedDate);
}

async function changeScheduleDate(date) {
  selectedDate = startOfDay(date);
  updateScheduleHeading();
  try {
    await fetchSchedule();
  } catch (error) {
    setAppStatus(`Could not load schedule: ${error.message}`, true);
  }
}

function initializeApp() {
  taskInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      void createInboxTask();
    }
  });
  addTaskButton.addEventListener("click", () => void createInboxTask());
  aiAssistButton.addEventListener("click", () => void runAIAssist());

  document.getElementById("previous-day").addEventListener("click", () => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() - 1);
    void changeScheduleDate(next);
  });
  document.getElementById("next-day").addEventListener("click", () => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    void changeScheduleDate(next);
  });
  document.getElementById("today-button").addEventListener("click", () => {
    void changeScheduleDate(new Date());
  });

  updateScheduleHeading();
  refreshViews()
    .then(() => setAppStatus("Connected to your local task manager."))
    .catch((error) => setAppStatus(error.message, true));
}

document.addEventListener("DOMContentLoaded", initializeApp, { once: true });
