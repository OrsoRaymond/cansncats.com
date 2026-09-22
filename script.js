const form = document.querySelector("#topicForm");
const statusEl = document.querySelector("#formStatus");
const promptRotator = document.querySelector("#promptRotator");
const submitButton = form?.querySelector('button[type="submit"]');
const TOPIC_ENDPOINT = "/api/topic-request";
const TOPIC_COOLDOWN_MS = 60 * 1000;
const TOPIC_LAST_SENT_KEY = "cansncats:lastTopicRequest";

const queuedPrompts = [
  "AI tools that are changing school",
  "What data leaks actually expose",
  "Smart homes and privacy tradeoffs",
  "Tech habits that change people",
];

let promptIndex = 0;

if (promptRotator && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  window.setInterval(() => {
    promptIndex = (promptIndex + 1) % queuedPrompts.length;
    promptRotator.textContent = queuedPrompts[promptIndex];
  }, 2600);
}

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

  const lastSent = Number(window.localStorage.getItem(TOPIC_LAST_SENT_KEY) || 0);
  const cooldownLeft = TOPIC_COOLDOWN_MS - (Date.now() - lastSent);

  if (cooldownLeft > 0) {
    statusEl.textContent = "Give it a moment before sending another topic.";
    return;
  }

  statusEl.textContent = "Sending your topic to Discord...";
  if (submitButton) {
    submitButton.disabled = true;
  }

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

    window.localStorage.setItem(TOPIC_LAST_SENT_KEY, String(Date.now()));
    form.reset();
    statusEl.textContent = "Sent to Discord. We will dig into it.";
  } catch (error) {
    statusEl.textContent = error instanceof Error
      ? error.message
      : "The topic could not be sent. Please try again.";
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
});
