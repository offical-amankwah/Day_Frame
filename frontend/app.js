"use strict";

// FastAPI serves the UI and API from one origin, so relative URLs work both
// at http://localhost:8000 locally and in a proxied preview.
const API_BASE = "";
const DEFAULT_TASK_CATEGORY = "General";
const DEFAULT_ESTIMATED_MINUTES = 30;
const WORKDAY_START_HOUR = 8;
const WORKDAY_END_HOUR = 20;

const taskInput = document.getElementById("quick-task");
const quickCategoryInput = document.getElementById("quick-category");
const quickMinutesInput = document.getElementById("quick-minutes");
const addTaskButton = document.getElementById("add-task");
const aiAssistButton = document.getElementById("ai-assist");
const inboxList = document.getElementById("inbox-list");
const inboxCount = document.getElementById("inbox-count");
const appStatus = document.getElementById("app-status");
const agentResponse = document.getElementById("agent-response");
const dayGrid = document.getElementById("day-grid");
const dayLabel = document.getElementById("day-label");
const scheduleDateLabel = document.getElementById("schedule-date");
const scheduleEyebrow = document.getElementById("schedule-eyebrow");
const dayView = document.getElementById("day-view");
const monthView = document.getElementById("month-view");
const monthGrid = document.getElementById("month-grid");
const dayViewToggle = document.getElementById("day-view-toggle");
const monthViewToggle = document.getElementById("month-view-toggle");
const previousCalendarButton = document.getElementById("previous-day");
const nextCalendarButton = document.getElementById("next-day");
const appShell = document.querySelector(".app-shell");
const focusToggleButton = document.getElementById("focus-toggle");
const focusLabel = document.getElementById("focus-label");
const dropIndicator = document.getElementById("drop-indicator");
const dropTimeLabel = document.getElementById("drop-time-label");
const taskEditor = document.getElementById("task-editor");
const taskEditForm = document.getElementById("task-edit-form");
const editTitleInput = document.getElementById("edit-title");
const editCategoryInput = document.getElementById("edit-category");
const editMinutesInput = document.getElementById("edit-minutes");
const editError = document.getElementById("edit-error");
const saveEditButton = document.getElementById("save-edit");
const contextBackdrop = document.getElementById("context-backdrop");
const contextDrawer = document.getElementById("context-drawer");
const contextCloseButton = document.getElementById("context-close");
const contextTaskTitle = document.getElementById("context-task-title");
const contextTaskMeta = document.getElementById("context-task-meta");
const contextNoteCount = document.getElementById("context-note-count");
const contextNoteList = document.getElementById("context-note-list");
const contextNoteForm = document.getElementById("context-note-form");
const contextNoteContent = document.getElementById("context-note-content");
const contextNoteTags = document.getElementById("context-note-tags");
const contextNoteStatus = document.getElementById("context-note-status");
const contextSaveButton = document.getElementById("context-save-note");
const chatWidget = document.getElementById("ai-chat-widget");
const chatPanel = document.getElementById("ai-chat-panel");
const chatToggleButton = document.getElementById("chat-toggle");
const chatCloseButton = document.getElementById("chat-close");
const chatMessages = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatSendButton = document.getElementById("chat-send");
const timetableDropzone = document.getElementById("timetable-dropzone");

let selectedDate = startOfDay(new Date());
let currentCalendarView = "day";
let actionInProgress = false;
let taskBeingEdited = null;
let inboxTasksCache = [];
let allTasksCache = [];
let draggedTaskId = null;
let activeContextTask = null;
let contextReturnFocus = null;
let contextRequestId = 0;
let contextNoteSaving = false;
let chatRequestInProgress = false;
let fileDragDepth = 0;
const DROP_SNAP_MINUTES = 15;

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
  quickCategoryInput.disabled = isBusy;
  quickMinutesInput.disabled = isBusy;
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
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body && !isFormData && !headers.has("Content-Type")) {
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
    // DELETE returns an empty 204 response; keep payload null in that case.
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

function makeSvgIcon(name) {
  const paths = {
    check: "M3 8.2 6.2 11.3 13 4.7",
    edit: "m9.5 3.5 3 3M3 13l3-.7L13 5.3 10.7 3 3.7 10z",
    delete: "M3.5 4.5h9M6 4.5V3h4v1.5M5 5l.5 8h5l.5-8M6.8 7v4M9.2 7v4",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[name]);
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", name === "check" ? "1.8" : "1.35");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

function makeActionButton(icon, label, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `task-action ${className}`.trim();
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(makeSvgIcon(icon));
  return button;
}

function setContextNoteStatus(message, isError = false) {
  contextNoteStatus.textContent = message;
  contextNoteStatus.classList.toggle("is-error", isError);
}

function renderContextNotes(notes) {
  const safeNotes = Array.isArray(notes) ? notes : [];
  contextNoteCount.textContent = `${safeNotes.length} ${safeNotes.length === 1 ? "note" : "notes"}`;
  contextNoteList.replaceChildren();

  if (safeNotes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "context-empty";
    empty.textContent = "No notes linked yet. Capture one below to keep useful context close to this task.";
    contextNoteList.append(empty);
    return;
  }

  safeNotes.forEach((note) => {
    const card = document.createElement("article");
    card.className = "context-note-card";
    const content = document.createElement("p");
    content.textContent = String(note.content || "");
    card.append(content);

    const tags = String(note.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
    if (tags.length) {
      const tagList = document.createElement("div");
      tagList.className = "context-note-tags";
      tags.forEach((tag) => {
        const chip = document.createElement("span");
        chip.className = "context-note-tag";
        chip.textContent = tag.startsWith("#") ? tag : `#${tag}`;
        tagList.append(chip);
      });
      card.append(tagList);
    }
    contextNoteList.append(card);
  });
}

async function refreshContextNotes(task, showLoading = true) {
  const requestId = ++contextRequestId;
  if (showLoading) {
    contextNoteCount.textContent = "Loading";
    const loading = document.createElement("p");
    loading.className = "context-empty";
    loading.textContent = "Loading linked notes…";
    contextNoteList.replaceChildren(loading);
  }
  try {
    const context = await apiRequest(`/tasks/${task.id}/context`);
    if (requestId !== contextRequestId || String(activeContextTask?.id) !== String(task.id)) return;
    renderContextNotes(context?.notes || []);
  } catch (error) {
    if (requestId !== contextRequestId || String(activeContextTask?.id) !== String(task.id)) return;
    contextNoteCount.textContent = "Unavailable";
    const message = document.createElement("p");
    message.className = "context-empty";
    message.textContent = `Could not load linked notes: ${error.message}`;
    contextNoteList.replaceChildren(message);
  }
}

function openContextDrawer(task, opener = null) {
  activeContextTask = task;
  contextReturnFocus = opener || document.activeElement;
  contextTaskTitle.textContent = String(task.title || "Untitled task");
  const estimate = Number(task.estimated_minutes);
  const detail = [
    String(task.category || DEFAULT_TASK_CATEGORY),
    Number.isFinite(estimate) ? `${estimate} min` : "estimate not set",
    String(task.status || "inbox"),
  ];
  contextTaskMeta.textContent = detail.join(" · ");
  contextNoteContent.value = "";
  contextNoteTags.value = "";
  setContextNoteStatus("");
  contextDrawer.classList.add("is-open");
  contextDrawer.setAttribute("aria-hidden", "false");
  contextDrawer.inert = false;
  contextBackdrop.classList.add("is-open");
  if (chatPanel.classList.contains("is-open")) setChatPanelOpen(false, false);
  appShell.inert = true;
  chatWidget.inert = true;
  contextCloseButton.focus();
  void refreshContextNotes(task);
}

function closeContextDrawer() {
  if (!contextDrawer.classList.contains("is-open")) return;
  contextDrawer.classList.remove("is-open");
  contextDrawer.setAttribute("aria-hidden", "true");
  contextDrawer.inert = true;
  contextBackdrop.classList.remove("is-open");
  appShell.inert = false;
  chatWidget.inert = false;
  contextRequestId += 1;
  activeContextTask = null;
  const returnTarget = contextReturnFocus;
  contextReturnFocus = null;
  if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
}

function setChatPanelOpen(isOpen, moveFocus = true) {
  chatPanel.classList.toggle("is-open", isOpen);
  chatPanel.setAttribute("aria-hidden", String(!isOpen));
  chatToggleButton.setAttribute("aria-expanded", String(isOpen));
  chatToggleButton.setAttribute("aria-label", isOpen ? "Close AI chat" : "Open AI chat");
  if (isOpen) chatInput.focus();
  else if (moveFocus) chatToggleButton.focus();
}

function appendChatMessage(role, text, state = "") {
  const message = document.createElement("article");
  message.className = `chat-message chat-message--${role}`;
  if (state) message.classList.add(state);
  const roleLabel = document.createElement("span");
  roleLabel.className = "chat-message-role";
  roleLabel.textContent = role === "user" ? "YOU" : "DAYFRAME AI";
  const content = document.createElement("p");
  content.className = "chat-message-content";
  content.textContent = text;
  message.append(roleLabel, content);
  chatMessages.append(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return { message, content };
}

async function sendChatMessage(event) {
  event.preventDefault();
  if (chatRequestInProgress) return;
  const prompt = chatInput.value.trim();
  if (!prompt) return;

  appendChatMessage("user", prompt);
  chatInput.value = "";
  const pending = appendChatMessage("assistant", "Thinking…", "is-thinking");
  chatRequestInProgress = true;
  chatInput.disabled = true;
  chatSendButton.disabled = true;
  try {
    const result = await apiRequest("/api/agent", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
    const answer = result?.response || "The assistant completed your request.";
    pending.message.remove();
    appendChatMessage("assistant", answer);

    const refreshResults = await Promise.allSettled([fetchInbox(), fetchSchedule()]);
    const refreshErrors = refreshResults
      .filter((outcome) => outcome.status === "rejected")
      .map((outcome) => outcome.reason?.message || "A task view could not refresh.");
    if (refreshErrors.length) {
      setAppStatus(`AI replied, but task views could not refresh: ${refreshErrors.join(" ")}`, true);
    }
  } catch (error) {
    pending.message.remove();
    appendChatMessage("assistant", `I couldn't reach the assistant: ${error.message}`, "is-error");
  } finally { 

    chatRequestInProgress = false;
    chatInput.disabled = false;
    chatSendButton.disabled = false;
    chatMessages.scrollTop = chatMessages.scrollHeight;
    chatInput.focus();
  }
}

async function saveContextNote(event) {
  event.preventDefault();
  if (!activeContextTask || contextNoteSaving) return;
  const task = activeContextTask;
  const content = contextNoteContent.value;
  if (!content.trim()) {
    setContextNoteStatus("Write a note before saving.", true);
    contextNoteContent.focus();
    return;
  }
  const tags = contextNoteTags.value
    .split(",")
    .map((tag) => tag.trim().replace(/^#+/, ""))
    .filter(Boolean)
    .join(", ");

  contextNoteSaving = true;
  contextSaveButton.disabled = true;
  setContextNoteStatus("Saving and linking your note…");
  let createdNote = false;
  try {
    const note = await apiRequest("/notes", {
      method: "POST",
      body: JSON.stringify({ content, tags }),
    });
    createdNote = true;
    await apiRequest(`/tasks/${task.id}/notes/${note.id}`, { method: "PUT" });
    if (String(activeContextTask?.id) === String(task.id)) {
      contextNoteContent.value = "";
      contextNoteTags.value = "";
      setContextNoteStatus("Note saved and linked to this task.");
      await refreshContextNotes(task, false);
    }
  } catch (error) {
    if (String(activeContextTask?.id) === String(task.id)) {
      setContextNoteStatus(
        createdNote
          ? `The note was created, but could not be linked: ${error.message}`
          : `Could not save the note: ${error.message}`,
        true,
      );
    }
  } finally {
    contextNoteSaving = false;
    contextSaveButton.disabled = false;
  }
}

function makeInboxTask(task, index) {
  const item = document.createElement("li");
  item.className = "inbox-task";
  item.draggable = true;
  item.setAttribute("aria-grabbed", "false");
  if (task.id !== undefined && task.id !== null) item.dataset.taskId = String(task.id);
  item.addEventListener("dragstart", (event) => {
    if (actionInProgress) {
      event.preventDefault();
      return;
    }
    draggedTaskId = Number(task.id);
    item.classList.add("is-dragging");
    item.setAttribute("aria-grabbed", "true");
    if (event.dataTransfer) {
      event.dataTransfer.setData("text/plain", String(task.id));
      event.dataTransfer.effectAllowed = "move";
    }
  });
  item.addEventListener("dragend", () => {
    item.classList.remove("is-dragging");
    item.setAttribute("aria-grabbed", "false");
    draggedTaskId = null;
    clearDropIndicator();
  });

  const titleText = String(task.title || "Untitled task");
  const check = document.createElement("button");
  check.type = "button";
  check.className = "task-check";
  check.setAttribute("aria-label", `Mark ${titleText} complete`);
  check.title = "Mark complete";
  check.append(makeSvgIcon("check"));
  check.addEventListener("click", () => void completeTask(task));

  const copy = document.createElement("div");
  copy.className = "task-copy";
  const title = document.createElement("h3");
  const titleButton = document.createElement("button");
  titleButton.type = "button";
  titleButton.className = "task-title-open";
  titleButton.textContent = titleText;
  titleButton.setAttribute("aria-label", `Open notes and context for ${titleText}`);
  titleButton.title = "Open task notes and context";
  titleButton.addEventListener("click", () => openContextDrawer(task, titleButton));
  title.append(titleButton);
  item.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    openContextDrawer(task, titleButton);
  });

  const meta = document.createElement("div");
  meta.className = "task-meta";
  const category = document.createElement("span");
  category.className = "category-label";
  const dot = document.createElement("span");
  dot.className = "category-dot";
  const tone = categoryTone(task.category, index);
  if (tone) dot.classList.add(tone);
  const categoryName = document.createElement("span");
  categoryName.textContent = String(task.category || DEFAULT_TASK_CATEGORY);
  category.append(dot, categoryName);

  const separator = document.createElement("span");
  separator.className = "separator";
  separator.textContent = "·";
  const estimate = document.createElement("span");
  const minutes = Number(task.estimated_minutes);
  estimate.textContent = Number.isFinite(minutes) ? `${minutes} min` : "—";
  meta.append(category, separator, estimate);
  copy.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "task-actions";
  const edit = makeActionButton("edit", `Edit ${titleText}`);
  edit.addEventListener("click", () => openTaskEditor(task));
  const remove = makeActionButton("delete", `Delete ${titleText}`, "task-action--delete");
  remove.addEventListener("click", () => void deleteTask(task));
  actions.append(edit, remove);

  item.append(check, copy, actions);
  return item;
}

function renderInboxMessage(message, kind, retry) {
  const item = document.createElement("li");
  item.className = `empty-inbox is-${kind}`;
  if (kind === "loading") {
    const spinner = document.createElement("span");
    spinner.className = "state-spinner";
    spinner.setAttribute("aria-hidden", "true");
    item.append(spinner);
  }
  const text = document.createElement("span");
  text.textContent = message;
  item.append(text);
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "state-retry";
    button.textContent = "Try again";
    button.addEventListener("click", () => {
      void fetchInbox().catch((error) => setAppStatus(error.message, true));
    });
    item.append(button);
  }
  inboxList.replaceChildren(item);
}

function renderInbox(tasks) {
  inboxTasksCache = tasks;
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
  inboxList.setAttribute("aria-busy", "true");
  renderInboxMessage("Loading your inbox…", "loading");
  try {
    const tasks = await apiRequest("/tasks?status=inbox");
    if (!Array.isArray(tasks)) throw new Error("The API returned an invalid inbox response.");
    renderInbox(tasks);
    return tasks;
  } catch (error) {
    renderInboxMessage(`Could not load the inbox: ${error.message}`, "error", true);
    throw error;
  } finally {
    inboxList.setAttribute("aria-busy", "false");
  }
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
  const titleText = String(task.title || "Untitled task");
  const event = document.createElement("article");
  event.className = `calendar-event event-color-${index % 4}`;
  event.style.top = `${top}px`;
  event.style.height = `${height}px`;
  const completed = ["done", "completed"].includes(String(task.status || "").toLowerCase());
  if (completed) event.classList.add("is-done");
  event.setAttribute("aria-label", `${titleText}, ${formatTime(start)} to ${formatTime(end)}`);

  const timeLine = document.createElement("div");
  timeLine.className = "event-topline";
  const dot = document.createElement("span");
  dot.className = "event-dot";
  dot.setAttribute("aria-hidden", "true");
  const timeText = document.createElement("span");
  timeText.textContent = `${formatTime(start)} – ${formatTime(end)}`;
  timeLine.append(dot, timeText);

  const title = document.createElement("h2");
  const titleButton = document.createElement("button");
  titleButton.type = "button";
  titleButton.className = "task-title-open";
  titleButton.textContent = titleText;
  titleButton.setAttribute("aria-label", `Open notes and context for ${titleText}`);
  titleButton.title = "Open task notes and context";
  titleButton.addEventListener("click", () => openContextDrawer(task, titleButton));
  title.append(titleButton);
  event.addEventListener("click", (clickEvent) => {
    if (clickEvent.target.closest("button")) return;
    openContextDrawer(task, titleButton);
  });
  const detail = document.createElement("div");
  detail.className = "event-detail";
  const minutes = Number(task.estimated_minutes);
  detail.textContent = `${String(task.category || "Task")} · ${Number.isFinite(minutes) ? `${minutes} min` : "time not set"}`;

  const actions = document.createElement("div");
  actions.className = "event-actions";
  const complete = makeActionButton("check", completed ? `${titleText} is complete` : `Mark ${titleText} complete`);
  if (completed) {
    complete.disabled = true;
    complete.title = "Completed";
  } else {
    complete.addEventListener("click", () => void completeTask(task));
  }
  const edit = makeActionButton("edit", `Edit ${titleText}`);
  edit.addEventListener("click", () => openTaskEditor(task));
  const remove = makeActionButton("delete", `Delete ${titleText}`, "task-action--delete");
  remove.addEventListener("click", () => void deleteTask(task));
  actions.append(complete, edit, remove);

  event.append(timeLine, title, detail, actions);
  if (height < 58) event.classList.add("is-compact");
  return event;
}

function renderScheduleState(message, kind, retry) {
  dayGrid.querySelectorAll(".calendar-event, .schedule-empty").forEach((node) => node.remove());
  const empty = document.createElement("div");
  empty.className = `schedule-empty is-${kind}`;
  if (kind === "loading") {
    const spinner = document.createElement("span");
    spinner.className = "state-spinner";
    spinner.setAttribute("aria-hidden", "true");
    empty.append(spinner);
  }
  const text = document.createElement("span");
  text.textContent = message;
  empty.append(text);
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "state-retry";
    button.textContent = "Try again";
    button.addEventListener("click", () => {
      void fetchSchedule().catch((error) => setAppStatus(error.message, true));
    });
    empty.append(button);
  }
  dayGrid.append(empty);
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
      const status = String(task.status || "").toLowerCase();
      if (["cancelled", "canceled"].includes(status)) return null;
      const start = parseTaskDateTime(task.scheduled_start);
      const minutes = Number(task.estimated_minutes);
      const duration = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_ESTIMATED_MINUTES;
      return start
        ? { task, start, end: new Date(start.getTime() + duration * 60_000) }
        : null;
    })
    .filter((entry) => entry && entry.end > dayStart && entry.start < dayEnd)
    .sort((a, b) => a.start - b.start);

  if (scheduled.length === 0) {
    const empty = document.createElement("p");
    empty.className = "schedule-empty";
    empty.textContent = "Nothing scheduled on this day yet. Use AI Assist to find a free slot or add a task to your inbox.";
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

function renderMonthState(message, kind, retry) {
  const empty = document.createElement("div");
  empty.className = `month-empty is-${kind}`;
  const text = document.createElement("span");
  text.textContent = message;
  empty.append(text);
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "state-retry";
    button.textContent = "Try again";
    button.addEventListener("click", () => {
      void fetchSchedule().catch((error) => setAppStatus(error.message, true));
    });
    empty.append(button);
  }
  monthGrid.replaceChildren(empty);
}

function renderMonth(tasks) {
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - mondayOffset);
  gridStart.setHours(0, 0, 0, 0);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysToRender = Math.ceil((mondayOffset + daysInMonth) / 7) * 7;
  const eventsByDay = new Map();

  tasks.forEach((task) => {
    const status = String(task.status || "").toLowerCase();
    if (["cancelled", "canceled"].includes(status)) return;
    const start = parseTaskDateTime(task.scheduled_start);
    if (!start) return;
    const key = localDateKey(start);
    if (!eventsByDay.has(key)) eventsByDay.set(key, []);
    eventsByDay.get(key).push({ task, start });
  });
  eventsByDay.forEach((events) => events.sort((a, b) => a.start - b.start));

  monthGrid.replaceChildren();
  monthGrid.setAttribute(
    "aria-label",
    `Calendar dates for ${new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(selectedDate)}`,
  );
  const todayKey = localDateKey(startOfDay(new Date()));
  const selectedKey = localDateKey(selectedDate);
  const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  for (let index = 0; index < daysToRender; index += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const dateKey = localDateKey(date);
    const dayEvents = eventsByDay.get(dateKey) || [];
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "month-day";
    if (date.getMonth() !== month) cell.classList.add("is-outside");
    if (dateKey === todayKey) cell.classList.add("is-today");
    if (dateKey === selectedKey) cell.classList.add("is-selected");
    cell.dataset.date = dateKey;
    const taskSummary = dayEvents.length
      ? `, ${dayEvents.length} scheduled ${dayEvents.length === 1 ? "task" : "tasks"}`
      : "";
    cell.setAttribute("aria-label", `${fullDateFormatter.format(date)}${taskSummary}; open day view`);
    cell.title = `${fullDateFormatter.format(date)}${taskSummary}`;

    const number = document.createElement("span");
    number.className = "month-day-number";
    number.textContent = String(date.getDate());
    cell.append(number);

    if (dayEvents.length) {
      const events = document.createElement("span");
      events.className = "month-day-events";
      dayEvents.slice(0, 3).forEach((entry, eventIndex) => {
        const pill = document.createElement("span");
        pill.className = `month-event month-event-color-${eventIndex % 4}`;
        const status = String(entry.task.status || "").toLowerCase();
        if (["done", "completed"].includes(status)) pill.classList.add("is-done");
        pill.textContent = `${formatTime(entry.start)} ${String(entry.task.title || "Untitled task")}`;
        pill.title = `${formatTime(entry.start)} · ${String(entry.task.title || "Untitled task")}`;
        events.append(pill);
      });
      if (dayEvents.length > 3) {
        const more = document.createElement("span");
        more.className = "month-event-more";
        more.textContent = `+ ${dayEvents.length - 3} more`;
        events.append(more);
      }
      cell.append(events);
    }

    cell.addEventListener("click", () => {
      selectedDate = startOfDay(date);
      setCalendarView("day");
    });
    monthGrid.append(cell);
  }
}

function renderCalendar(tasks) {
  const monthMode = currentCalendarView === "month";
  dayView.hidden = monthMode;
  monthView.hidden = !monthMode;
  if (monthMode) renderMonth(tasks);
  else renderSchedule(tasks);
}

function renderCalendarState(message, kind, retry = false) {
  if (currentCalendarView === "month") renderMonthState(message, kind, retry);
  else renderScheduleState(message, kind, retry);
}

function setCalendarView(view) {
  if (!(view === "day" || view === "month")) return;
  currentCalendarView = view;
  dayViewToggle.setAttribute("aria-pressed", String(view === "day"));
  monthViewToggle.setAttribute("aria-pressed", String(view === "month"));
  updateScheduleHeading();
  renderCalendar(allTasksCache);
}

/** Read tasks and render them in the active day or month calendar. */
async function fetchSchedule() {
  dayGrid.setAttribute("aria-busy", "true");
  monthGrid.setAttribute("aria-busy", "true");
  renderCalendarState("Loading your calendar…", "loading");
  try {
    const tasks = await apiRequest("/tasks");
    if (!Array.isArray(tasks)) throw new Error("The API returned an invalid task list.");
    allTasksCache = tasks;
    renderCalendar(tasks);
    return tasks;
  } catch (error) {
    renderCalendarState(`Could not load your calendar: ${error.message}`, "error", true);
    throw error;
  } finally {
    dayGrid.setAttribute("aria-busy", "false");
    monthGrid.setAttribute("aria-busy", "false");
  }
}

function findTaskById(taskId) {
  const id = String(taskId);
  return allTasksCache.find((task) => String(task.id) === id)
    || inboxTasksCache.find((task) => String(task.id) === id)
    || null;
}

function calculateDropStart(clientY, task) {
  const rect = dayGrid.getBoundingClientRect();
  const dayMinutes = (WORKDAY_END_HOUR - WORKDAY_START_HOUR) * 60;
  if (!rect.height) return null;

  const offsetY = Math.min(Math.max(clientY - rect.top, 0), rect.height);
  const rawMinutes = (offsetY / rect.height) * dayMinutes;
  const roundedMinutes = Math.round(rawMinutes / DROP_SNAP_MINUTES) * DROP_SNAP_MINUTES;
  const estimate = Number(task.estimated_minutes);
  const duration = Number.isFinite(estimate) && estimate > 0 ? estimate : DEFAULT_ESTIMATED_MINUTES;
  const latestStart = Math.max(0, dayMinutes - duration);
  const latestSnappedStart = Math.floor(latestStart / DROP_SNAP_MINUTES) * DROP_SNAP_MINUTES;
  const minutesFromDayStart = Math.min(Math.max(0, roundedMinutes), latestSnappedStart);

  const startDate = new Date(selectedDate);
  startDate.setHours(WORKDAY_START_HOUR, 0, 0, 0);
  startDate.setMinutes(startDate.getMinutes() + minutesFromDayStart);
  return { startDate, minutesFromDayStart };
}

function showDropIndicator(clientY, task) {
  const timing = calculateDropStart(clientY, task);
  if (!timing) return;
  const hourHeight = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--hour-height"),
  ) || 72;
  dropIndicator.style.top = `${(timing.minutesFromDayStart / 60) * hourHeight}px`;
  dropTimeLabel.textContent = formatTime(timing.startDate);
  dropIndicator.hidden = false;
  dayGrid.classList.add("is-drop-target");
}

function clearDropIndicator() {
  dropIndicator.hidden = true;
  dayGrid.classList.remove("is-drop-target");
}

function handleScheduleDragOver(event) {
  if (!draggedTaskId) return;
  const task = findTaskById(draggedTaskId);
  if (!task) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  showDropIndicator(event.clientY, task);
}

function localDateTimeString(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

async function scheduleDroppedTask(task, startDate) {
  if (actionInProgress) return;
  const scheduledStart = localDateTimeString(startDate);
  const previousTasks = allTasksCache.slice();
  const updatedTask = { ...task, status: "scheduled", scheduled_start: scheduledStart };
  allTasksCache = [
    ...allTasksCache.filter((item) => String(item.id) !== String(task.id)),
    updatedTask,
  ];
  renderCalendar(allTasksCache);
  setBusy(true);
  setAppStatus(`Scheduling “${task.title}” for ${formatTime(startDate)}…`);

  let saved = false;
  try {
    await apiRequest(`/api/tasks/${task.id}`, {
      method: "PUT",
      body: JSON.stringify({ status: "scheduled", scheduled_start: scheduledStart }),
    });
    saved = true;
    await refreshViews();
    setAppStatus(`Scheduled “${task.title}” for ${formatTime(startDate)}.`);
  } catch (error) {
    if (!saved) {
      allTasksCache = previousTasks;
      renderCalendar(allTasksCache);
    }
    setAppStatus(
      saved
        ? `Task was scheduled, but a view could not refresh: ${error.message}`
        : `Could not schedule task: ${error.message}`,
      true,
    );
  } finally {
    setBusy(false);
  }
}

function handleScheduleDrop(event) {
  event.preventDefault();
  const dataId = event.dataTransfer?.getData("text/plain");
  const taskId = Number(dataId) || draggedTaskId;
  const task = taskId ? findTaskById(taskId) : null;
  const timing = task ? calculateDropStart(event.clientY, task) : null;
  clearDropIndicator();
  if (!task || !timing) {
    setAppStatus("Drop an inbox task onto the schedule to assign a time.", true);
    return;
  }
  void scheduleDroppedTask(task, timing.startDate);
}

async function refreshViews() {
  const outcomes = await Promise.allSettled([fetchInbox(), fetchSchedule()]);
  const failures = outcomes
    .filter((outcome) => outcome.status === "rejected")
    .map((outcome) => outcome.reason?.message || "Could not refresh a view.");
  if (failures.length) throw new Error(failures.join(" "));
}

function setTimetableDropzoneVisible(isVisible) {
  timetableDropzone.hidden = !isVisible;
  timetableDropzone.setAttribute("aria-hidden", String(!isVisible));
}

function dragHasFiles(event) {
  const transfer = event.dataTransfer;
  if (!transfer) return false;
  const types = Array.from(transfer.types || []);
  return types.includes("Files") || Boolean(transfer.files?.length);
}

function handleWindowDragEnter(event) {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  fileDragDepth += 1;
  setTimetableDropzoneVisible(true);
}

function handleWindowDragOver(event) {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  setTimetableDropzoneVisible(true);
}

function handleWindowDragLeave(event) {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (fileDragDepth === 0) setTimetableDropzoneVisible(false);
}

function handleWindowDrop(event) {
  if (!dragHasFiles(event)) return;
  event.preventDefault();
  fileDragDepth = 0;
  setTimetableDropzoneVisible(false);

  const file = event.dataTransfer?.files?.[0];
  if (!file) {
    setAppStatus("No file was received. Drop a timetable image to import it.", true);
    return;
  }
  if (!String(file.type || "").toLowerCase().startsWith("image/")) {
    setAppStatus("Please drop an image file to extract a timetable.", true);
    return;
  }
  void extractTimetableImage(file);
}

async function extractTimetableImage(file) {
  if (actionInProgress) {
    setAppStatus("Finish the current action before importing a timetable.", true);
    return;
  }

  const formData = new FormData();
  formData.append("file", file, file.name || "timetable-image");
  let extracted = false;
  setBusy(true);
  setAppStatus("Reading timetable...");
  try {
    const createdTasks = await apiRequest("/api/extract-timetable", {
      method: "POST",
      body: formData,
    });
    if (!Array.isArray(createdTasks)) {
      throw new Error("The API returned an invalid timetable response.");
    }
    extracted = true;

    const firstEventStart = createdTasks
      .map((task) => parseTaskDateTime(task?.scheduled_start))
      .filter(Boolean)
      .sort((left, right) => left - right)[0];
    if (firstEventStart) {
      selectedDate = startOfDay(firstEventStart);
      setCalendarView("day");
    }

    await fetchSchedule();
    setAppStatus(
      createdTasks.length
        ? `Added ${createdTasks.length} timetable ${createdTasks.length === 1 ? "event" : "events"} to your schedule.`
        : "No scheduled events were found in that timetable.",
    );
  } catch (error) {
    setAppStatus(
      extracted
        ? `Timetable extracted, but the schedule could not refresh: ${error.message}`
        : `Could not extract timetable: ${error.message}`,
      true,
    );
  } finally {
    setBusy(false);
  }
}

async function createInboxTask() {
  if (actionInProgress) return;
  const title = taskInput.value.trim();
  const category = quickCategoryInput.value.trim() || DEFAULT_TASK_CATEGORY;
  const estimate = Number(quickMinutesInput.value);
  if (!title) {
    setAppStatus("Type a task first, then press Enter or use AI Assist.", true);
    taskInput.focus();
    return;
  }
  if (!Number.isInteger(estimate) || estimate < 1 || estimate > 1440) {
    setAppStatus("Estimate must be a whole number from 1 to 1,440 minutes.", true);
    quickMinutesInput.focus();
    return;
  }

  let saved = false;
  setBusy(true);
  setAppStatus("Adding task to your inbox…");
  try {
    await apiRequest("/tasks", {
      method: "POST",
      body: JSON.stringify({ title, category, estimated_minutes: estimate }),
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

async function completeTask(task) {
  if (actionInProgress) return;
  setBusy(true);
  setAppStatus("Marking task complete…");
  try {
    await apiRequest(`/tasks/${task.id}`, {
      method: "PUT",
      body: JSON.stringify({ status: "done", scheduled_start: task.scheduled_start ?? null }),
    });
    await refreshViews();
    setAppStatus(`Completed: ${task.title}`);
  } catch (error) {
    setAppStatus(`Could not complete task: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

async function deleteTask(task) {
  if (actionInProgress) return;
  if (!window.confirm(`Delete “${task.title}”? This cannot be undone.`)) return;
  let deleted = false;
  setBusy(true);
  setAppStatus("Deleting task…");
  try {
    await apiRequest(`/tasks/${task.id}`, { method: "DELETE" });
    deleted = true;
    await refreshViews();
    setAppStatus("Task deleted.");
  } catch (error) {
    setAppStatus(
      deleted ? `Task deleted, but a view could not refresh: ${error.message}` : `Could not delete task: ${error.message}`,
      true,
    );
  } finally {
    setBusy(false);
  }
}

function openTaskEditor(task) {
  taskBeingEdited = task;
  editTitleInput.value = String(task.title || "");
  editCategoryInput.value = String(task.category || DEFAULT_TASK_CATEGORY);
  editMinutesInput.value = String(task.estimated_minutes || DEFAULT_ESTIMATED_MINUTES);
  editError.textContent = "";
  editError.hidden = true;
  taskEditor.showModal();
  editTitleInput.focus();
}

async function saveTaskEdit(event) {
  event.preventDefault();
  if (!taskBeingEdited || actionInProgress) return;
  const updates = {
    title: editTitleInput.value.trim(),
    category: editCategoryInput.value.trim(),
    estimated_minutes: Number(editMinutesInput.value),
  };
  if (!updates.title || !updates.category) {
    editError.textContent = "Title and category cannot be blank.";
    editError.hidden = false;
    return;
  }
  if (!Number.isInteger(updates.estimated_minutes) || updates.estimated_minutes < 1 || updates.estimated_minutes > 1440) {
    editError.textContent = "Estimate must be a whole number from 1 to 1,440 minutes.";
    editError.hidden = false;
    return;
  }

  saveEditButton.disabled = true;
  setBusy(true);
  editError.hidden = true;
  let saved = false;
  try {
    await apiRequest(`/tasks/${taskBeingEdited.id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
    saved = true;
    taskEditor.close();
    await refreshViews();
    setAppStatus("Task details updated.");
  } catch (error) {
    if (saved) {
      setAppStatus(`Task was updated, but a view could not refresh: ${error.message}`, true);
    } else {
      editError.textContent = `Could not save changes: ${error.message}`;
      editError.hidden = false;
    }
  } finally {
    setBusy(false);
    saveEditButton.disabled = false;
  }
}

function updateScheduleHeading() {
  const today = startOfDay(new Date());
  const isToday = localDateKey(selectedDate) === localDateKey(today);
  if (currentCalendarView === "month") {
    scheduleEyebrow.textContent = "Calendar";
    dayLabel.textContent = new Intl.DateTimeFormat(undefined, { month: "long" }).format(selectedDate);
    scheduleDateLabel.textContent = String(selectedDate.getFullYear());
    previousCalendarButton.setAttribute("aria-label", "Previous month");
    nextCalendarButton.setAttribute("aria-label", "Next month");
  } else {
    scheduleEyebrow.textContent = "My day";
    dayLabel.textContent = isToday
      ? "Today"
      : new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(selectedDate);
    scheduleDateLabel.textContent = new Intl.DateTimeFormat(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(selectedDate);
    previousCalendarButton.setAttribute("aria-label", "Previous day");
    nextCalendarButton.setAttribute("aria-label", "Next day");
  }
}

function navigateCalendar(direction) {
  const next = new Date(selectedDate);
  if (currentCalendarView === "month") {
    next.setDate(1);
    next.setMonth(next.getMonth() + direction);
  } else {
    next.setDate(next.getDate() + direction);
  }
  void changeScheduleDate(next);
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
  taskEditForm.addEventListener("submit", (event) => void saveTaskEdit(event));
  contextCloseButton.addEventListener("click", closeContextDrawer);
  contextBackdrop.addEventListener("click", closeContextDrawer);
  contextNoteForm.addEventListener("submit", (event) => void saveContextNote(event));
  chatToggleButton.addEventListener("click", () => {
    const shouldOpen = !chatPanel.classList.contains("is-open");
    if (shouldOpen && contextDrawer.classList.contains("is-open")) closeContextDrawer();
    setChatPanelOpen(shouldOpen);
  });
  chatCloseButton.addEventListener("click", () => setChatPanelOpen(false));
  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      chatForm.requestSubmit();
    }
  });
  chatForm.addEventListener("submit", (event) => void sendChatMessage(event));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (contextDrawer.classList.contains("is-open")) {
        event.preventDefault();
        closeContextDrawer();
        return;
      }
      if (chatPanel.classList.contains("is-open")) {
        event.preventDefault();
        setChatPanelOpen(false);
        return;
      }
    }
    if (event.key !== "Tab" || !contextDrawer.classList.contains("is-open")) return;
    const focusable = Array.from(contextDrawer.querySelectorAll(
      "button:not(:disabled), input:not(:disabled), textarea:not(:disabled)",
    ));
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  focusToggleButton.addEventListener("click", () => {
    const enabled = appShell.classList.toggle("focus-mode");
    focusToggleButton.setAttribute("aria-pressed", String(enabled));
    focusLabel.textContent = enabled ? "Exit focus" : "Focus";
  });
  dayGrid.addEventListener("dragover", handleScheduleDragOver);
  dayGrid.addEventListener("drop", handleScheduleDrop);
  dayGrid.addEventListener("dragleave", (event) => {
    if (!dayGrid.contains(event.relatedTarget)) clearDropIndicator();
  });
  window.addEventListener("dragenter", handleWindowDragEnter);
  window.addEventListener("dragover", handleWindowDragOver);
  window.addEventListener("dragleave", handleWindowDragLeave);
  window.addEventListener("drop", handleWindowDrop);
  document.getElementById("close-editor").addEventListener("click", () => taskEditor.close());
  document.getElementById("cancel-edit").addEventListener("click", () => taskEditor.close());

  dayViewToggle.addEventListener("click", () => setCalendarView("day"));
  monthViewToggle.addEventListener("click", () => setCalendarView("month"));
  previousCalendarButton.addEventListener("click", () => navigateCalendar(-1));
  nextCalendarButton.addEventListener("click", () => navigateCalendar(1));
  document.getElementById("today-button").addEventListener("click", () => {
    void changeScheduleDate(new Date());
  });

  updateScheduleHeading();
  renderInboxMessage("Loading your inbox…", "loading");
  renderScheduleState("Loading your schedule…", "loading");
  refreshViews()
    .then(() => setAppStatus("Connected to your local task manager."))
    .catch((error) => setAppStatus(error.message, true));
}

document.addEventListener("DOMContentLoaded", initializeApp, { once: true });
