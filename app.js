const POSTMASTER_BASE_URL = "http://164.92.247.14:8000";
const APPLICATION_ID = "servus";
const POLL_INTERVAL_MS = 2000;
const LAST_MESSAGES_COUNT = 5;

/**
 * @typedef {{ username: string, message: string, timestamp: string }} ChatMessage
 * @typedef {{ application_id: string, session_id: string, created_at: string, messages: ChatMessage[] }} SessionResponse
 */

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

class PostmasterClient {
  constructor(baseUrl, applicationId) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.applicationId = applicationId;
  }

  setApplicationId(applicationId) {
    this.applicationId = applicationId;
  }

  async request(path, options = {}, attempt = 1) {
    const maxAttempts = 3;
    const retryBaseDelayMs = 300;
    let response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch (error) {
      if (attempt < maxAttempts) {
        await this.delay(retryBaseDelayMs * 2 ** (attempt - 1));
        return this.request(path, options, attempt + 1);
      }
      throw new ApiError("Network error while contacting server", 0, "NETWORK");
    }

    if (!response.ok) {
      if (response.status >= 500 && attempt < maxAttempts) {
        await this.delay(retryBaseDelayMs * 2 ** (attempt - 1));
        return this.request(path, options, attempt + 1);
      }

      throw this.mapError(response.status);
    }

    return response.json();
  }

  mapError(status) {
    if (status === 400) {
      return new ApiError("Invalid request data", 400, "BAD_REQUEST");
    }
    if (status === 401) {
      return new ApiError("Unauthorized request", 401, "UNAUTHORIZED");
    }
    if (status === 404) {
      return new ApiError("Application or session was not found", 404, "NOT_FOUND");
    }
    if (status === 409) {
      return new ApiError("Resource already exists", 409, "CONFLICT");
    }
    if (status === 500) {
      return new ApiError("Server error", 500, "SERVER_ERROR");
    }
    return new ApiError(`Unexpected API error (${status})`, status, "UNKNOWN");
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async initSession() {
    return this.request(`/applications/${this.applicationId}/sessions/init`, {
      method: "POST"
    });
  }

  async createSessionWithFirstMessage(username, message) {
    return this.request(`/applications/${this.applicationId}/sessions`, {
      method: "POST",
      body: { username, message }
    });
  }

  /**
   * @param {string} sessionId
   * @returns {Promise<SessionResponse>}
   */
  async getSession(sessionId) {
    return this.request(`/applications/${this.applicationId}/sessions/${sessionId}`);
  }

  async postMessage(sessionId, username, message) {
    return this.request(`/applications/${this.applicationId}/sessions/${sessionId}/messages`, {
      method: "POST",
      body: { username, message }
    });
  }
}

const ui = {
  usernameInput: document.getElementById("usernameInput"),
  createSessionBtn: document.getElementById("createSessionBtn"),
  joinSessionInput: document.getElementById("joinSessionInput"),
  joinSessionBtn: document.getElementById("joinSessionBtn"),
  statusText: document.getElementById("statusText"),
  chatCard: document.getElementById("chatCard"),
  sessionIdText: document.getElementById("sessionIdText"),
  copySessionBtn: document.getElementById("copySessionBtn"),
  leaveSessionBtn: document.getElementById("leaveSessionBtn"),
  messagesList: document.getElementById("messagesList"),
  messageForm: document.getElementById("messageForm"),
  messageInput: document.getElementById("messageInput")
};

const state = {
  sessionId: "",
  pollTimer: null,
  latestMessageFingerprint: "",
  client: new PostmasterClient(POSTMASTER_BASE_URL, APPLICATION_ID)
};

init();

function init() {
  const savedUsername = localStorage.getItem("servus_username");

  if (savedUsername) {
    ui.usernameInput.value = savedUsername;
  }

  ui.createSessionBtn.addEventListener("click", onCreateSession);
  ui.joinSessionBtn.addEventListener("click", onJoinSession);
  ui.copySessionBtn.addEventListener("click", onCopySession);
  ui.leaveSessionBtn.addEventListener("click", onLeaveSession);
  ui.messageForm.addEventListener("submit", onSendMessage);
}

async function onCreateSession() {
  clearStatus();
  if (!prepareIdentity()) return;

  try {
    toggleBusy(true);
    const created = await state.client.initSession();
    await openSession(created.session_id);
    setStatus(`Session created: ${created.session_id}`, "ok");
  } catch (error) {
    setStatus(humanizeError(error), "error");
  } finally {
    toggleBusy(false);
  }
}

async function onJoinSession() {
  clearStatus();
  if (!prepareIdentity()) return;

  const sessionId = ui.joinSessionInput.value.trim();
  if (!sessionId) {
    setStatus("Enter a session key to join.", "error");
    return;
  }

  try {
    toggleBusy(true);
    await openSession(sessionId);
    setStatus(`Joined session ${sessionId}`, "ok");
  } catch (error) {
    setStatus(humanizeError(error), "error");
  } finally {
    toggleBusy(false);
  }
}

async function openSession(sessionId) {
  state.sessionId = sessionId;
  ui.sessionIdText.textContent = sessionId;
  ui.chatCard.classList.remove("hidden");
  ui.joinSessionInput.value = sessionId;

  await refreshMessages({ forceRender: true });
  startPolling();
}

function onLeaveSession() {
  stopPolling();
  state.sessionId = "";
  state.latestMessageFingerprint = "";
  ui.chatCard.classList.add("hidden");
  ui.messagesList.innerHTML = "";
  ui.sessionIdText.textContent = "";
  setStatus("Left the session.", "ok");
}

async function onSendMessage(event) {
  event.preventDefault();
  if (!state.sessionId) {
    setStatus("Join or create a session first.", "error");
    return;
  }

  const username = ui.usernameInput.value.trim();
  const message = ui.messageInput.value.trim();

  if (!username || !message) {
    setStatus("Username and message are required.", "error");
    return;
  }

  try {
    toggleBusy(true);
    await state.client.postMessage(state.sessionId, username, message);
    ui.messageInput.value = "";
    await refreshMessages({ forceRender: true });
  } catch (error) {
    setStatus(humanizeError(error), "error");
  } finally {
    toggleBusy(false);
  }
}

async function refreshMessages({ forceRender = false } = {}) {
  if (!state.sessionId) return;

  const session = await state.client.getSession(state.sessionId);
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const latest = messages[messages.length - 1];
  const fingerprint = latest
    ? `${latest.timestamp}|${latest.username}|${latest.message}`
    : "empty";

  if (!forceRender && fingerprint === state.latestMessageFingerprint) {
    return;
  }

  state.latestMessageFingerprint = fingerprint;
  renderMessages(messages.slice(-LAST_MESSAGES_COUNT));
}

function renderMessages(messages) {
  ui.messagesList.innerHTML = "";
  const currentUser = ui.usernameInput.value.trim();

  if (!messages.length) {
    const li = document.createElement("li");
    li.textContent = "No messages yet.";
    ui.messagesList.appendChild(li);
    return;
  }

  for (const item of messages) {
    const li = document.createElement("li");
    if (item.username === currentUser) {
      li.classList.add("own-message");
    }

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = `${item.username} - ${formatTimestamp(item.timestamp)}`;

    const text = document.createElement("div");
    text.textContent = item.message;

    li.appendChild(meta);
    li.appendChild(text);
    ui.messagesList.appendChild(li);
  }

  ui.messagesList.scrollTop = ui.messagesList.scrollHeight;
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp || "Unknown time";
  return date.toLocaleString();
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(async () => {
    try {
      await refreshMessages();
    } catch (error) {
      setStatus(humanizeError(error), "error");
    }
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function prepareIdentity() {
  const username = ui.usernameInput.value.trim();

  if (!username) {
    setStatus("Username is required.", "error");
    return false;
  }

  localStorage.setItem("servus_username", username);
  return true;
}

function setStatus(text, type = "") {
  ui.statusText.textContent = text;
  ui.statusText.className = `status ${type}`.trim();
}

function clearStatus() {
  setStatus("");
}

function humanizeError(error) {
  if (error instanceof ApiError) {
    return error.message;
  }
  return "Unexpected error";
}

async function onCopySession() {
  if (!state.sessionId) return;
  try {
    await navigator.clipboard.writeText(state.sessionId);
    setStatus("Session key copied.", "ok");
  } catch (_) {
    setStatus("Could not copy session key.", "error");
  }
}

function toggleBusy(isBusy) {
  ui.createSessionBtn.disabled = isBusy;
  ui.joinSessionBtn.disabled = isBusy;
}
