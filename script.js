const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// --- Hero "Now queuing" rotator -------------------------------------------
const promptRotator = document.querySelector("#promptRotator");
const queuedPrompts = [
  "AI tools that are changing school",
  "What data leaks actually expose",
  "Smart homes and privacy tradeoffs",
  "Tech habits that change people",
];
let promptIndex = 0;

if (promptRotator && !prefersReducedMotion) {
  window.setInterval(() => {
    promptIndex = (promptIndex + 1) % queuedPrompts.length;
    promptRotator.textContent = queuedPrompts[promptIndex];
  }, 2600);
}

// --- Podcast topic tuner ---------------------------------------------------
// Six "stations" on the dial. Click a label or the knob, or use the arrow
// keys, to tune. Until someone touches it, it slowly scans on its own.
const STATIONS = [
  { lane: "ai", topic: "AI + School" },
  { lane: "cyber", topic: "Scams + Passwords" },
  { lane: "privacy", topic: "AI + Privacy" },
  { lane: "tech", topic: "Phones + Attention" },
  { lane: "culture", topic: "Games + Social" },
  { lane: "future", topic: "Robots + Smart Homes" },
];
const SCAN_INTERVAL_MS = 5200;

const tuner = document.querySelector(".radio-card");

if (tuner) {
  const stationButtons = [...tuner.querySelectorAll(".station")];
  const needle = tuner.querySelector(".dial-needle");
  const knob = tuner.querySelector("#tunerKnob");
  const topicEl = tuner.querySelector("#tunerTopic");
  const currentEl = tuner.querySelector("#tunerCurrent");
  let stationIndex = stationButtons.findIndex((button) => button.getAttribute("aria-pressed") === "true");
  if (stationIndex < 0) stationIndex = 2;
  let scanTimer = 0;

  const placeNeedle = () => {
    const target = stationButtons[stationIndex];
    if (!target || !needle) return;
    const scaleRect = target.parentElement.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    needle.style.setProperty("--needle", `${rect.left - scaleRect.left + rect.width / 2}px`);
  };

  const tune = (next, { byUser = false } = {}) => {
    stationIndex = ((next % STATIONS.length) + STATIONS.length) % STATIONS.length;
    const station = STATIONS[stationIndex];

    stationButtons.forEach((button, i) => button.setAttribute("aria-pressed", String(i === stationIndex)));
    placeNeedle();
    if (knob) knob.style.setProperty("--knob", `${-75 + stationIndex * 30}deg`);
    if (topicEl) topicEl.textContent = `Topic ${String(stationIndex + 1).padStart(2, "0")}`;
    if (currentEl) currentEl.textContent = station.topic;
    tuner.dataset.lane = station.lane;

    if (byUser) {
      // Only announce changes the visitor made; the idle scan stays quiet for screen readers.
      topicEl?.parentElement?.setAttribute("aria-live", "polite");
      if (scanTimer) {
        window.clearInterval(scanTimer);
        scanTimer = 0;
      }
    }
  };

  stationButtons.forEach((button, i) => {
    button.addEventListener("click", () => tune(i, { byUser: true }));
  });

  knob?.addEventListener("click", () => tune(stationIndex + 1, { byUser: true }));

  tuner.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      tune(stationIndex + 1, { byUser: true });
      stationButtons[stationIndex]?.focus();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      tune(stationIndex - 1, { byUser: true });
      stationButtons[stationIndex]?.focus();
    }
  });

  window.addEventListener("resize", placeNeedle);
  document.fonts?.ready.then(placeNeedle);
  tune(stationIndex);

  if (!prefersReducedMotion) {
    scanTimer = window.setInterval(() => tune(stationIndex + 1), SCAN_INTERVAL_MS);
  }
}

// --- Live Discord community count -----------------------------------------
const communityCount = document.querySelector("#communityCount");

if (communityCount) {
  fetch("/api/community", { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : null))
    .then((stats) => {
      if (!stats || !stats.members) return;
      const members = `${stats.members.toLocaleString()} members`;
      const online = stats.online ? ` · ${stats.online.toLocaleString()} online now` : "";
      communityCount.textContent = `${members}${online}`;
      communityCount.hidden = false;
    })
    .catch(() => {});
}

// --- Topic request form ----------------------------------------------------
const form = document.querySelector("#topicForm");
const statusEl = document.querySelector("#formStatus");
const submitButton = form?.querySelector('button[type="submit"]');
const TOPIC_ENDPOINT = "/api/topic-request";
const TOPIC_COOLDOWN_MS = 60 * 1000;
const TOPIC_LAST_SENT_KEY = "cansncats:lastTopicRequest";

const readLastSent = () => {
  try {
    return Number(window.localStorage.getItem(TOPIC_LAST_SENT_KEY) || 0);
  } catch {
    return 0;
  }
};

const writeLastSent = () => {
  try {
    window.localStorage.setItem(TOPIC_LAST_SENT_KEY, String(Date.now()));
  } catch {}
};

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const topic = String(formData.get("topic") || "").trim();
  const name = String(formData.get("name") || "Cyber Cat").trim();
  const contact = String(formData.get("contact") || "").trim();
  const website = String(formData.get("website") || "").trim();

  if (!topic) {
    statusEl.textContent = "Add a topic first and we will get it queued up.";
    return;
  }

  const cooldownLeft = TOPIC_COOLDOWN_MS - (Date.now() - readLastSent());

  if (cooldownLeft > 0) {
    statusEl.textContent = "Give it a moment before sending another topic.";
    return;
  }

  statusEl.textContent = "Sending your topic...";
  if (submitButton) submitButton.disabled = true;

  try {
    const response = await fetch(TOPIC_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, contact, topic, website }),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || "The topic could not be sent.");
    }

    writeLastSent();
    form.reset();
    statusEl.textContent = result.message || "Got it. We will dig into it.";
  } catch (error) {
    statusEl.textContent = error instanceof Error
      ? error.message
      : "The topic could not be sent. Please try again.";
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

// --- Footer year -----------------------------------------------------------
const yearEl = document.querySelector("#year");
if (yearEl) yearEl.textContent = String(new Date().getFullYear());
