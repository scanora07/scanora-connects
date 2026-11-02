(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const views = { loading: $("v-loading"), login: $("v-login"), app: $("v-app") };

  let settings = { maxSheets: 25, perSheet: 40, silverUrl: "", giftDays: 7, cleanupUrl: null };
  let busy = false;

  function show(name) {
    for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
    $("signout").hidden = name !== "app";
  }

  class SignedOut extends Error {}

  // Calls the admin API; a 401 sends the user back to the sign-in screen
  async function request(path, options = {}) {
    const res = await fetch("/api/admin" + path, {
      credentials: "same-origin",
      ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}) },
    });
    if (res.status === 401 && path !== "/login") {
      show("login");
      throw new SignedOut("Please sign in again.");
    }
    return res;
  }

  async function getJson(path) {
    const res = await request(path);
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || "Something went wrong.");
    return data;
  }

  // Asks for a PDF and saves it; throws the server's own message when something goes wrong
  async function downloadPdf(path, options, fallbackName) {
    const res = await request(path, options);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error((data && data.error) || "Could not create the file.");
    }
    const blob = await res.blob();
    const m = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = m ? m[1] : fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return { name: a.download, size: blob.size };
  }

  const megabytes = (n) => (n / 1048576).toFixed(1) + " MB";

  // ---------------- Silver ----------------
  $("silver-dl").addEventListener("click", async () => {
    const btn = $("silver-dl");
    const original = btn.textContent;
    $("silver-error").hidden = true;
    btn.disabled = true;
    btn.textContent = "Preparing…";
    try {
      await downloadPdf("/sheets/silver", {}, "silver-sheet.pdf");
    } catch (err) {
      if (!(err instanceof SignedOut)) {
        $("silver-error").textContent = err.message;
        $("silver-error").hidden = false;
      }
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  // ---------------- Gold ----------------
  function sheetsValue() {
    const raw = $("sheets").value.trim();
    return /^\d+$/.test(raw) ? Number(raw) : NaN;
  }

  function validate() {
    const n = sheetsValue();
    const good = Number.isInteger(n) && n >= 1 && n <= settings.maxSheets;
    $("sheets-hint").textContent = good
      ? n + " sheet" + (n === 1 ? "" : "s") + " = " + (n * settings.perSheet).toLocaleString("en-IN") + " cards, each with its own QR code."
      : "Enter a whole number from 1 to " + settings.maxSheets + ".";
    $("gold-dl").disabled = busy || !good;
  }

  function renderChips() {
    const box = $("chips");
    box.textContent = "";
    for (const n of [1, 2, 5, 10, 25]) {
      if (n > settings.maxSheets) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = n;
      b.addEventListener("click", () => { $("sheets").value = n; validate(); });
      box.appendChild(b);
    }
  }

  function setStatus(text, kind) {
    const el = $("gold-status");
    el.hidden = !text;
    el.textContent = text || "";
    el.className = "status" + (kind ? " " + kind : "");
  }

  $("gold-dl").addEventListener("click", async () => {
    const sheets = sheetsValue();
    if (!Number.isInteger(sheets)) return;
    $("gold-error").hidden = true;
    busy = true;
    validate();
    const btn = $("gold-dl");
    const original = btn.textContent;
    btn.textContent = "Creating…";
    setStatus("Creating " + sheets + " sheet" + (sheets === 1 ? "" : "s") + " (" + (sheets * settings.perSheet) + " cards). Larger jobs take a little while.");
    try {
      const file = await downloadPdf("/sheets/gold", { method: "POST", body: JSON.stringify({ sheets }) }, "gold-sheets.pdf");
      setStatus("Done. " + file.name + " (" + megabytes(file.size) + ") has been downloaded. Keep it safe: it cannot be downloaded again.", "good");
    } catch (err) {
      setStatus("");
      if (!(err instanceof SignedOut)) {
        $("gold-error").textContent = err.message + " If the download did not arrive, press the button again. Any cards that were not handed over are removed.";
        $("gold-error").hidden = false;
      }
    } finally {
      busy = false;
      btn.textContent = original;
      validate();
    }
  });

  // ---------------- Cleanup link ----------------
  function renderCleanup() {
    $("gift-days").textContent = settings.giftDays;
    $("cleanup-box").hidden = !settings.cleanupUrl;
    $("cleanup-off").hidden = Boolean(settings.cleanupUrl);
    $("cleanup-url").textContent = settings.cleanupUrl || "";
  }

  $("copy-cleanup").addEventListener("click", async () => {
    const btn = $("copy-cleanup");
    try {
      await navigator.clipboard.writeText(settings.cleanupUrl);
      btn.textContent = "Copied";
    } catch {
      const range = document.createRange(); // no clipboard access: select it so it can be copied by hand
      range.selectNodeContents($("cleanup-url"));
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      btn.textContent = "Press Ctrl+C";
    }
    setTimeout(() => { btn.textContent = "Copy link"; }, 2000);
  });

  // ---------------- Start-up and sign-in ----------------
  async function openApp() {
    settings = await getJson("/config");
    $("silver-url").textContent = settings.silverUrl;
    document.querySelectorAll(".per-sheet").forEach((el) => { el.textContent = settings.perSheet; });
    // The card pictures need the sign-in, so they are only requested now (not when the page first loads)
    document.querySelectorAll("img[data-src]").forEach((img) => { img.src = img.dataset.src; });
    renderChips();
    renderCleanup();
    validate();
    show("app");
  }

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("login-error");
    err.hidden = true;
    const passkey = $("passkey").value;
    if (!passkey) { err.textContent = "Enter the passkey."; err.hidden = false; return; }
    const btn = $("login-btn");
    btn.disabled = true;
    try {
      const res = await request("/login", { method: "POST", body: JSON.stringify({ passkey }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.error) || "Could not sign in.");
      $("passkey").value = "";
      await openApp();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      $("passkey").select();
    } finally {
      btn.disabled = false;
    }
  });

  $("signout").addEventListener("click", async () => {
    try { await request("/logout", { method: "POST" }); } catch { /* signing out anyway */ }
    show("login");
    $("passkey").focus();
  });

  $("sheets").addEventListener("input", validate);

  (async function init() {
    try {
      const res = await fetch("/api/admin/me", { credentials: "same-origin" });
      if (res.ok) await openApp();
      else { show("login"); $("passkey").focus(); }
    } catch {
      show("login");
    }
  })();
})();
