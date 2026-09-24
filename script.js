document.documentElement.classList.add("js");

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

// --- Header state + scroll progress -----------------------------------------
const header = document.querySelector(".site-header");
const progressBar = document.querySelector("#scrollProgress");
let scrollTicking = false;

const onScroll = () => {
  scrollTicking = false;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  progressBar?.style.setProperty("--progress", String(max > 0 ? window.scrollY / max : 0));
  header?.classList.toggle("is-scrolled", window.scrollY > 24);
};
window.addEventListener("scroll", () => {
  if (!scrollTicking) {
    scrollTicking = true;
    window.requestAnimationFrame(onScroll);
  }
}, { passive: true });
onScroll();

// --- Hero "Now queuing" rotator -------------------------------------------
const promptRotator = document.querySelector("#promptRotator");
const queuedPrompts = [
  "AI tools that are changing school",
  "What data leaks actually expose",
  "Smart homes and privacy tradeoffs",
  "Deepfakes and how to spot them",
  "Tech habits that change people",
];
let promptIndex = 0;

if (promptRotator && !prefersReducedMotion) {
  window.setInterval(() => {
    promptIndex = (promptIndex + 1) % queuedPrompts.length;
    promptRotator.textContent = queuedPrompts[promptIndex];
    promptRotator.classList.remove("swap");
    void promptRotator.offsetWidth; // restart the fade-in animation
    promptRotator.classList.add("swap");
  }, 2800);
}

// --- Scroll reveal ----------------------------------------------------------
const revealEls = [...document.querySelectorAll(".reveal")];

// Stagger siblings that sit in the same grid so cards cascade in.
revealEls.forEach((el) => {
  const siblings = [...el.parentElement.children].filter((child) => child.classList.contains("reveal"));
  if (siblings.length > 1) el.style.setProperty("--delay", `${siblings.indexOf(el) * 90}ms`);
});

if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("in");
      revealObserver.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
  revealEls.forEach((el) => revealObserver.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add("in"));
}

// --- 3D tilt + cursor spotlight on cards -------------------------------------
if (finePointer && !prefersReducedMotion) {
  document.querySelectorAll("[data-tilt]").forEach((card) => {
    const max = card.classList.contains("community-art") ? 14 : 9;
    card.addEventListener("pointermove", (event) => {
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      card.style.setProperty("--mx", `${x * 100}%`);
      card.style.setProperty("--my", `${y * 100}%`);
      card.style.transform =
        `perspective(900px) rotateX(${(0.5 - y) * max}deg) rotateY(${(x - 0.5) * max}deg) translateZ(0)`;
    });
    card.addEventListener("pointerleave", () => {
      card.style.transform = "";
    });
  });
}

// --- Episode card waveforms ---------------------------------------------------
document.querySelectorAll(".wave").forEach((wave, w) => {
  const bars = 36;
  for (let i = 0; i < bars; i++) {
    const bar = document.createElement("i");
    const h = 0.25 + 0.75 * Math.abs(Math.sin(i * 0.7 + w * 1.9) * Math.cos(i * 0.23 + w));
    bar.style.setProperty("--h", h.toFixed(2));
    bar.style.setProperty("--i", String(i));
    wave.appendChild(bar);
  }
});

// --- Live Discord community count -----------------------------------------
const communityCount = document.querySelector("#communityCount");

if (communityCount) {
  fetch("/api/community", { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : null))
    .then((stats) => {
      if (!stats || !stats.members) return;
      const members = `${stats.members.toLocaleString()} members`;
      communityCount.insertAdjacentHTML("afterbegin", '<span class="live-dot" aria-hidden="true"></span>');
      const online = stats.online ? ` · ${stats.online.toLocaleString()} online now` : "";
      communityCount.append(`${members}${online}`);
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
