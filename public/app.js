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
    musicBtn.hidden = !(musicStarted && name === "letter");
    syncMusic();
    window.scrollTo(0, 0);
  }

  // ---- Where the gift comes from ----
  // The server (and the Neon database behind it) decides everything:
  //   getCard(slug)       -> { status: "empty" | "active" | "gone", gift?, days? }
  //   createCard(slug, d) -> { ok: true } | { ok: false, error }

  const liveApi = {
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

  const api = liveApi;

  // ---- Music ----
  // Plays only after the "Tap to open letter" tap (browsers block autoplay) and keeps
  // playing on the letter screen. It uses assets/music.mp3; if that file is missing or the
  // browser cannot play it, the built-in synthesized music-box loop takes over.
  const MUSIC_FILE = "/assets/music.mp3";
  const musicBtn = $("music-btn");
  const audioEl = $("bgm");
  let muted = false;
  let musicStarted = false;
  let useFile = true;
  let opening = false; // true while the envelope is opening, so the music begins with the tap
  let openTimer = 0;

  const synth = (() => {
    const BEAT = 60 / 66;
    const STEPS_PER_BAR = 6;
    const hz = (n) => 440 * 2 ** ((n - 69) / 12);
    // C - Am - F - G, twice (bass note + triad), with a melody line over each bar
    const bars = [
      { bass: 48, triad: [60, 64, 67], mel: [76, 0, 79, 0, 76, 0] },
      { bass: 45, triad: [57, 60, 64], mel: [81, 0, 79, 0, 76, 0] },
      { bass: 41, triad: [57, 60, 65], mel: [77, 0, 81, 0, 77, 0] },
      { bass: 43, triad: [55, 59, 62], mel: [79, 0, 74, 0, 71, 0] },
      { bass: 48, triad: [60, 64, 67], mel: [84, 0, 79, 0, 76, 0] },
      { bass: 45, triad: [57, 60, 64], mel: [81, 0, 76, 0, 72, 0] },
      { bass: 41, triad: [57, 60, 65], mel: [77, 0, 79, 0, 81, 0] },
      { bass: 43, triad: [55, 59, 62], mel: [74, 0, 71, 0, 67, 0] },
    ];
    const ARP = [null, 0, 1, 2, 1, 0]; // step 0 is the bass note
    const LEVEL = 0.6;

    let ctx = null, master = null, bus = null, timer = null, step = 0, nextTime = 0;

    function note(midi, when, len, vol, type) {
      const osc = ctx.createOscillator();
      const bell = ctx.createOscillator();
      const g = ctx.createGain();
      const gb = ctx.createGain();
      osc.type = type;
      bell.type = "sine";
      osc.frequency.value = hz(midi);
      bell.frequency.value = hz(midi) * 3;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(vol, when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, when + len);
      gb.gain.value = 0.18;
      osc.connect(g);
      bell.connect(gb).connect(g);
      g.connect(bus);
      osc.start(when);
      bell.start(when);
      osc.stop(when + len + 0.05);
      bell.stop(when + len + 0.05);
    }

    function schedule(i, when) {
      const bar = bars[Math.floor(i / STEPS_PER_BAR) % bars.length];
      const s = i % STEPS_PER_BAR;
      if (s === 0) note(bar.bass, when, 2.2, 0.16, "sine");
      else note(bar.triad[ARP[s]] + 12, when, 1.0, 0.07, "triangle");
      if (bar.mel[s]) note(bar.mel[s], when, 1.6, 0.13, "triangle");
    }

    function tick() {
      while (nextTime < ctx.currentTime + 0.3) {
        schedule(step, nextTime);
        step += 1;
        nextTime += BEAT / 2;
      }
    }

    function start() {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(ctx.destination);
      bus = ctx.createGain();
      bus.connect(master);
      // Soft echo
      const delay = ctx.createDelay(1);
      const fb = ctx.createGain();
      const wet = ctx.createGain();
      delay.delayTime.value = 0.34;
      fb.gain.value = 0.3;
      wet.gain.value = 0.35;
      bus.connect(delay);
      delay.connect(fb).connect(delay);
      delay.connect(wet).connect(master);
      nextTime = ctx.currentTime + 0.1;
      ctx.resume();
      tick();
      timer = setInterval(tick, 100);
      master.gain.setTargetAtTime(muted ? 0.0001 : LEVEL, ctx.currentTime, 1.2);
    }

    function setMuted(m, tau = 0.05) {
      if (master) master.gain.setTargetAtTime(m ? 0.0001 : LEVEL, ctx.currentTime, tau);
    }

    document.addEventListener("visibilitychange", () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend();
      else ctx.resume();
    });

    return { start, setMuted, get ready() { return !!ctx; } };
  })();

  function startMusic() {
    if (useFile) {
      if (!audioEl.src) audioEl.src = MUSIC_FILE;
      musicStarted = true;
      syncMusic();
      return;
    }
    synth.start();
    musicStarted = synth.ready;
    syncMusic();
  }

  // If the file cannot be loaded or played, switch to the built-in loop
  audioEl.addEventListener("error", () => {
    if (!useFile) return;
    useFile = false;
    audioEl.removeAttribute("src");
    if (musicStarted) {
      synth.start();
      syncMusic();
    }
  });

  // Music belongs to the letter screen only: it is silent on screen 1 and resumes on screen 2.
  // It starts at the tap (while the envelope opens) so phones treat it as user-initiated.
  function syncMusic() {
    if (!musicStarted) return;
    const wanted = document.body.dataset.view === "letter" || opening;
    if (useFile) {
      audioEl.muted = muted;
      if (wanted) audioEl.play().catch(() => {});
      else audioEl.pause();
    } else {
      synth.setMuted(muted || !wanted, wanted ? 0.4 : 0.15);
    }
  }

  musicBtn.addEventListener("click", () => {
    muted = !muted;
    musicBtn.classList.toggle("muted", muted);
    musicBtn.setAttribute("aria-label", muted ? "Unmute music" : "Mute music");
    syncMusic();
  });

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

  // Shown whenever the sender leaves the letter empty. It is written to suit every bond and every occasion.
  const DEFAULT_LETTER =
    "Some moments are too special for just a few words, so I wanted to give you something to remember this one by.\n\n" +
    "Thank you for being part of my life. For every memory we have made, every smile you have given me and every time you were simply there. You mean more to me than I can ever say.\n\n" +
    "Whatever today brings, I hope it is filled with happiness, warmth and the people who love you. May every wish you carry in your heart find its way to you.\n\n" +
    "With love and warm wishes, always.";

  $("open-btn").addEventListener("click", () => {
    const btn = $("open-btn");
    if (btn.classList.contains("opening")) return;
    opening = true;
    startMusic();
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
      opening = false;
      btn.classList.remove("opening");
    }, reduceMotion ? 0 : 1250);
  });

  function showGift(gift) {
    currentGift = gift;
    // Start fetching the music now, while the wish is being drawn, so it is ready at the tap
    if (useFile && !audioEl.src) {
      audioEl.preload = "auto";
      audioEl.src = MUSIC_FILE;
    }
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
  const WISH_MAX = 80;
  const LETTER_MAX = 800;

  [["f-wish", "c-wish", WISH_MAX], ["f-letter", "c-letter", LETTER_MAX]].forEach(([inputId, counterId, max]) => {
    const el = $(inputId);
    const update = () => { $(counterId).textContent = el.value.length + "/" + max; };
    el.addEventListener("input", update);
    update();
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
    opening = false;
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

    // The letter is optional: empty means null, and the gift page then shows the built-in letter
    const data = {
      wish: $("f-wish").value.trim(),
      letter: letterEl.value.trim() || null,
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

  // The handwriting fonts load while the card is being looked up. The first screen waits for them
  // (at most 2.5 s), so the text never shows in a plain font and then jumps to the real one.
  const fontsReady = (() => {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const loaded = Promise.all([document.fonts.load("700 1em Caveat"), document.fonts.load("500 1em Caveat")]).catch(() => {});
    return Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 2500))]);
  })();

  (async function init() {
    if (!cardId) {
      await fontsReady;
      showMessage("Scan your card", "Scan the QR code on your gift card to open your gift.");
      return;
    }
    try {
      const card = await api.getCard(cardId);
      if (card.status !== "empty" && card.status !== "active") {
        location.replace("/greet"); // expired, deleted or never issued: the link no longer works
        return;
      }
      await fontsReady;
      if (card.status === "empty") {
        if (card.days) setGiftDays(card.days);
        show("form");
      } else showGift(card.gift);
    } catch {
      await fontsReady;
      showMessage("Something went wrong", "Please try again in a moment.");
    }
  })();
})();
