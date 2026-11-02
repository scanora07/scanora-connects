(() => {
  "use strict";

  // ---- Config ----
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // A card is only opened from its QR code: /g/<slug>
  const slugMatch = location.pathname.match(/^\/g\/([^/]+)\/?$/);
  const cardId = slugMatch ? slugMatch[1] : "";
  const setGiftDays = (n) => document.querySelectorAll(".gift-days").forEach((el) => { el.textContent = n; });

  // ---- Helpers ----
  const $ = (id) => document.getElementById(id);
  const views = ["loading", "form", "heart", "letter", "done", "expired"];

  function show(name) {
    views.forEach((v) => $("view-" + v).classList.toggle("active", v === name));
    document.body.dataset.view = name;
    window.scrollTo(0, 0);
  }

  // ---- Where the gift comes from ----
  // The server (and the Neon database behind it) decides everything:
  //   getCard(slug)       -> { status: "empty" | "active" | "gone", gift?, days? }
  //   createCard(slug, d) -> { ok: true } | { ok: false, error }

  const api = {
    async getCard(slug) {
      const res = await fetch("/api/gift/" + encodeURIComponent(slug), { cache: "no-store" });
      if (res.ok || res.status === 404) return res.json();
      throw new Error("server " + res.status);
    },

    async createCard(slug, data) {
      let res;
      try {
        res = await fetch("/api/gift/" + encodeURIComponent(slug), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      } catch {
        return { ok: false, error: "Could not reach the server. Check your connection and try again." };
      }
      const body = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true };
      return { ok: false, error: body.error || "Something went wrong. Please try again." };
    },
  };

  // ---- Pen writing ----
  // Draws the wish stroke by stroke, like a pen on paper, using the single-line font in
  // assets/pen-font.js. Returns the time (seconds) the drawing finishes, or null when the
  // text has characters the pen font lacks (the caller then uses the letter-by-letter fallback).
  const SVG_NS = "http://www.w3.org/2000/svg";
  const PEN = { wordGap: 12, lineHeight: 40, width: 170, maxDraw: 5, minSpeed: 270 };

  function normalizeForPen(text) {
    return text
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/\s+/g, " ")
      .trim();
  }

  function strokeLength(d) {
    let len = 0;
    let px = 0, py = 0;
    // Paths are "M x,y L x,y x,y ..." so every pair after M/L is a point
    const parts = d.split("M").filter(Boolean);
    parts.forEach((p) => {
      const pts = p.replace("L", " ").trim().split(/\s+/).map((s) => s.split(",").map(Number));
      pts.forEach(([x, y], i) => {
        if (i) len += Math.hypot(x - px, y - py);
        px = x; py = y;
      });
    });
    return len;
  }

  function drawWish(el, rawText, startAt) {
    const font = window.PEN_FONT;
    const text = normalizeForPen(rawText);
    if (!font || !text || [...text].some((c) => c !== " " && !font[c])) return null;
    const wrapWidth = PEN.width;

    // Lay words out into lines no wider than the wrap width
    const words = text.split(" ").map((w) => ({
      w,
      width: [...w].reduce((s, c) => s + font[c].w, 0),
    }));
    const lines = [];
    let cur = null;
    words.forEach((word) => {
      if (cur && cur.width + PEN.wordGap + word.width <= wrapWidth) {
        cur.words.push(word);
        cur.width += PEN.wordGap + word.width;
      } else {
        cur = { words: [word], width: word.width };
        lines.push(cur);
      }
    });
    const widest = Math.max(...lines.map((l) => l.width));
    const vbWidth = Math.max(wrapWidth, widest);

    // Collect every stroke with its position and length
    const strokes = [];
    lines.forEach((line, li) => {
      let x = (vbWidth - line.width) / 2;
      const y = li * PEN.lineHeight + 4;
      line.words.forEach((word, wi) => {
        if (wi) x += PEN.wordGap;
        for (const c of word.w) {
          const g = font[c];
          g.d.split("M").filter(Boolean).forEach((s) => {
            strokes.push({ d: "M" + s, x, y, len: strokeLength("M" + s) + 1 });
          });
          x += g.w;
        }
      });
    });

    const total = strokes.reduce((s, k) => s + k.len, 0);
    const speed = Math.max(PEN.minSpeed, total / PEN.maxDraw); // units per second
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "pen-svg");
    svg.setAttribute("viewBox", `-4 -2 ${vbWidth + 8} ${lines.length * PEN.lineHeight + 4}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", rawText);

    // When and for how long each stroke is drawn
    let t = startAt;
    const timing = strokes.map((k) => {
      const dur = k.len / speed;
      const at = t;
      t += dur;
      return { at, dur };
    });

    // Each stroke is drawn on its own, one after another
    strokes.forEach((k, i) => {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("class", "pen");
      path.setAttribute("d", k.d);
      path.setAttribute("transform", `translate(${k.x.toFixed(1)},${k.y})`);
      path.style.setProperty("--len", k.len.toFixed(1));
      path.style.setProperty("--dur", timing[i].dur.toFixed(3) + "s");
      path.style.setProperty("--delay", timing[i].at.toFixed(3) + "s");
      svg.appendChild(path);
    });

    el.textContent = "";
    el.classList.remove("fallback");
    el.appendChild(svg);
    return t;
  }

  // ---- Letter-by-letter fallback ----
  // Builds one span per letter; CSS wipes them in one after another.
  // Returns the time (seconds) at which the writing finishes.
  function writeText(el, text, startAt, perLetter) {
    el.textContent = "";
    el.classList.add("fallback");
    el.setAttribute("aria-label", text);
    const count = text.replace(/\s/g, "").length;
    const step = Math.min(perLetter, Math.max(0.04, 3 / Math.max(count, 1)));
    let i = 0;
    text.split(/\s+/).filter(Boolean).forEach((w, wi) => {
      if (wi) el.appendChild(document.createTextNode(" "));
      const word = document.createElement("span");
      word.className = "word";
      word.setAttribute("aria-hidden", "true");
      for (const c of w) {
        const ch = document.createElement("span");
        ch.className = "ch";
        ch.textContent = c;
        ch.style.setProperty("--d", (startAt + i * step).toFixed(2) + "s");
        word.appendChild(ch);
        i += 1;
      }
      el.appendChild(word);
    });
    return startAt + i * step + 0.4;
  }

  // ---- Screen 1: heart ----
  const heart = $("heart");
  const reveal = $("reveal");
  const level = document.querySelector(".level");
  let currentGift = null;

  // The heart fill, the pen-written wish and the name all start together;
  // only the "Tap to open letter" button waits until the writing is done.
  function playHeart() {
    show("heart");
    reveal.classList.remove("show");
    level.style.animation = "none";
    void level.getBoundingClientRect();
    level.style.animation = "";
    reveal.classList.add("show");
  }

  // The wish of the homepage gift, which has no sender. It is a real wish, addressed to whoever is
  // reading, and it suits any bond or occasion.
  const HOME_WISH = "Wishing you endless happiness";

  // Shown whenever the sender leaves the letter empty. It is written to suit every bond and every occasion.
  const DEFAULT_LETTER =
    "Some moments are too special for just a few words, so I wanted to give you something to remember this one by.\n\n" +
    "Thank you for being part of my life. For every memory we have made, every smile you have given me and every time you were simply there. You mean more to me than I can ever say.\n\n" +
    "Whatever today brings, I hope it is filled with happiness, warmth and the people who love you. May every wish you carry in your heart find its way to you.\n\n" +
    "With love and warm wishes, always.";

  let openTimer = 0; // the pending "show the letter" step while the envelope opens

  $("open-btn").addEventListener("click", () => {
    const btn = $("open-btn");
    if (btn.classList.contains("opening")) return;
    const letter = currentGift.letter || DEFAULT_LETTER;
    $("letter-dear").textContent = currentGift.wish;
    $("letter-body").textContent = letter;
    // Longer letters get a slightly tighter line grid so the paper stays a comfortable length
    const weight = letter.length + (letter.match(/\n/g) || []).length * 24;
    document.querySelector(".letter").dataset.size = weight > 520 ? "s" : weight > 260 ? "m" : "l";
    // Break the seal, open the flap, slide the letter out, then show it
    btn.classList.add("opening");
    openTimer = setTimeout(() => {
      show("letter");
      btn.classList.remove("opening");
    }, reduceMotion ? 0 : 1250);
  });

  function showGift(gift) {
    currentGift = gift;
    let wishEnd = drawWish($("wish-text"), gift.wish, 0.3);
    if (wishEnd === null) wishEnd = writeText($("wish-text"), gift.wish, 0.3, 0.12);

    // The envelope appears once the wish has been written
    reveal.style.setProperty("--btn-delay", (wishEnd + 0.3).toFixed(2) + "s");
    playHeart();
  }

  // ---- Form ----
  const form = $("gift-form");
  const errorEl = $("form-error");
  const letterEl = $("f-letter");
  const LETTER_MAX = 800;

  // The letter length only shows once the sender is close to the limit, so the form stays plain
  const countEl = $("c-letter");
  const updateCount = () => {
    const n = letterEl.value.length;
    countEl.hidden = n < LETTER_MAX - 150;
    countEl.textContent = n + "/" + LETTER_MAX;
  };
  letterEl.addEventListener("input", updateCount);

  // The letter box (and the idea lines) only appear when the sender chooses to write their own letter
  const letterFields = $("letter-fields");
  form.querySelectorAll('input[name="own-letter"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const own = form.elements["own-letter"].value === "yes";
      letterFields.hidden = !own;
      errorEl.hidden = true;
      if (own) letterEl.focus({ preventScroll: true });
    });
  });

  // Tapping an idea adds that line to the letter (after a blank line if there is already text)
  document.querySelector(".ideas-list").addEventListener("click", (e) => {
    const idea = e.target.closest(".idea");
    if (!idea) return;
    errorEl.hidden = true;
    const line = idea.textContent.trim();
    const current = letterEl.value.trimEnd();
    const next = current ? current + "\n\n" + line : line;
    if (next.length > LETTER_MAX) {
      errorEl.textContent = "That line would take the letter over " + LETTER_MAX + " characters.";
      errorEl.hidden = false;
      return;
    }
    letterEl.value = next;
    letterEl.dispatchEvent(new Event("input"));
    letterEl.scrollTop = letterEl.scrollHeight;
    idea.classList.add("added");
    setTimeout(() => idea.classList.remove("added"), 900);
  });

  // ---- Preview: the sender sees the real gift (heart, wish, envelope, letter) before it is final ----
  const previewBar = $("preview-bar");
  let previewGift = null;

  function enterPreview(gift) {
    previewGift = gift;
    document.body.classList.add("previewing");
    previewBar.hidden = false;
    showGift(gift);
  }

  function leavePreview() {
    clearTimeout(openTimer);
    $("open-btn").classList.remove("opening");
    document.body.classList.remove("previewing");
    previewBar.hidden = true;
  }

  $("pv-edit").addEventListener("click", () => {
    leavePreview();
    show("form"); // the form keeps everything that was typed
  });

  $("pv-confirm").addEventListener("click", async () => {
    const btn = $("pv-confirm");
    btn.disabled = true;
    try {
      const res = await api.createCard(cardId, previewGift);
      if (!res.ok) throw new Error(res.error || "Could not save");
      leavePreview();
      show("done");
    } catch (err) {
      leavePreview();
      show("form");
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  $("done-view").addEventListener("click", () => showGift(previewGift));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    // Only a letter the sender chose to write is sent. Otherwise (or if the box is left empty) it is
    // null, and the gift page then shows the built-in letter.
    const own = form.elements["own-letter"].value === "yes";
    const data = {
      wish: $("f-wish").value.trim(),
      letter: own ? letterEl.value.trim() || null : null,
    };

    let problem = "";
    if (!data.wish) problem = "Please write your wish.";
    else if (/https?:\/\/|www\./i.test(data.wish + " " + (data.letter || ""))) problem = "Links are not allowed.";

    if (problem) {
      errorEl.textContent = problem;
      errorEl.hidden = false;
      return;
    }
    enterPreview(data);
  });

  // ---- Boot ----
  function showMessage(title, text) {
    $("end-title").textContent = title;
    $("end-text").textContent = text;
    show("expired");
  }

  // The bold handwriting font starts downloading right away. Only the form needs it on screen at once
  // (the gift's heart screen is drawn with the pen), so the form waits for it, at most 2.5 s, and its
  // title never shows in a plain font and then jumps. The regular weight is only needed by the letter,
  // so it loads in the background once a gift is on screen.
  const loadFont = (spec) => (document.fonts && document.fonts.load ? document.fonts.load(spec).catch(() => {}) : Promise.resolve());
  const boldFont = loadFont("700 1em Caveat");
  const boldFontReady = () => Promise.race([boldFont, new Promise((resolve) => setTimeout(resolve, 2500))]);

  (async function init() {
    if (!cardId) {
      // Homepage: a real gift for whoever lands here, with a wish that suits anyone and the built-in letter
      showGift({ wish: HOME_WISH, letter: null });
      loadFont("500 1em Caveat");
      return;
    }
    try {
      const card = await api.getCard(cardId);
      if (card.status !== "empty" && card.status !== "active") {
        location.replace("/"); // expired, deleted or never issued: the link no longer works
        return;
      }
      if (card.status === "empty") {
        if (card.days) setGiftDays(card.days);
        await boldFontReady();
        show("form");
      } else {
        showGift(card.gift);
        loadFont("500 1em Caveat");
      }
    } catch {
      await boldFontReady();
      showMessage("Something went wrong", "Please try again in a moment.");
    }
  })();
})();
