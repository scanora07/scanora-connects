(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const views = { loading: $("v-loading"), login: $("v-login"), app: $("v-app") };

  let settings = { maxBatch: 1000, baseUrl: "", exampleUrl: "", giftDays: 7, cleanupUrl: null };
  let busy = false;

  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

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

  function setStatus(text, kind) {
    const el = $("gen-status");
    el.hidden = !text;
    el.textContent = text || "";
    el.className = "status" + (kind ? " " + kind : "");
  }

  // ---------------- Count ----------------
  function countValue() {
    const raw = $("count").value.trim();
    return /^\d+$/.test(raw) ? Number(raw) : NaN;
  }

  function validate() {
    const n = countValue();
    const good = Number.isInteger(n) && n >= 1 && n <= settings.maxBatch;
    $("count-hint").textContent = good
      ? n + " card" + (n === 1 ? "" : "s") + " = " + n + " QR code image" + (n === 1 ? "" : "s") + " in the ZIP."
      : "Enter a whole number from 1 to " + settings.maxBatch + ".";
    $("generate").disabled = busy || !good;
  }

  function renderChips() {
    const box = $("chips");
    box.textContent = "";
    for (const n of [10, 50, 100, 250, 500, 1000]) {
      if (n > settings.maxBatch) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = n;
      b.addEventListener("click", () => { $("count").value = n; validate(); });
      box.appendChild(b);
    }
  }

  // ---------------- Downloading ----------------
  function saveBlob(blob, fileName) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  function fileNameFrom(res, fallback) {
    const m = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
    return m ? m[1] : fallback;
  }

  async function generate() {
    const count = countValue();
    $("gen-error").hidden = true;
    setStatus("");
    if (!Number.isInteger(count)) return;

    busy = true;
    validate();
    $("generate").textContent = "Creating…";
    setStatus("Creating " + count + " card" + (count === 1 ? "" : "s") + " and building the ZIP. This can take a little while for big batches.");

    let batchId = "";
    try {
      const res = await request("/batches", {
        method: "POST",
        body: JSON.stringify({ count, label: $("label").value.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.error) || "Could not create the cards.");
      }
      batchId = res.headers.get("X-Batch-Id") || "";
      const blob = await res.blob();
      saveBlob(blob, fileNameFrom(res, "qr-batch-" + batchId + ".zip"));
      setStatus("Done. " + count + " cards were created (batch #" + batchId + ") and the ZIP has been downloaded. You can download it again from the list below.", "good");
    } catch (err) {
      if (err instanceof SignedOut) return;
      if (batchId) {
        setStatus("The cards were created (batch #" + batchId + ") but the download was interrupted. Download the ZIP again from the list below.", "bad");
      } else {
        setStatus("");
        $("gen-error").textContent = err.message + " If you are not sure whether the cards were made, check the list below before trying again.";
        $("gen-error").hidden = false;
      }
    } finally {
      busy = false;
      $("generate").textContent = "Create and download ZIP";
      validate();
      loadBatches().catch(() => {});
    }
  }

  async function downloadBatch(id, button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Preparing…";
    try {
      const res = await request("/batches/" + id + "/zip");
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.error) || "Could not download.");
      }
      saveBlob(await res.blob(), fileNameFrom(res, "qr-batch-" + id + ".zip"));
    } catch (err) {
      if (!(err instanceof SignedOut)) alert(err.message);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  // ---------------- Batches ----------------
  async function loadBatches() {
    const list = await getJson("/batches");
    const box = $("batches");
    box.textContent = "";
    if (!list.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "No batches yet. Your first one will appear here.";
      box.appendChild(p);
      return;
    }
    const head = document.createElement("div");
    head.className = "batch head";
    for (const h of ["Batch", "Created", "Cards", ""]) {
      const s = document.createElement("span");
      s.textContent = h;
      head.appendChild(s);
    }
    box.appendChild(head);

    for (const b of list) {
      const row = document.createElement("div");
      row.className = "batch";

      const num = document.createElement("span");
      num.className = "num";
      num.textContent = "#" + b.id;

      const created = document.createElement("span");
      created.className = "when";
      created.textContent = when.format(new Date(b.createdAt));
      if (b.label) {
        const lab = document.createElement("div");
        lab.className = "label";
        lab.textContent = b.label; // plain text, never HTML
        created.appendChild(lab);
      }

      const cnt = document.createElement("span");
      cnt.className = "cnt";
      cnt.textContent = b.count;

      const act = document.createElement("span");
      act.className = "act";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dl";
      btn.textContent = "Download ZIP";
      btn.addEventListener("click", () => downloadBatch(b.id, btn));
      act.appendChild(btn);

      row.append(num, created, cnt, act);
      box.appendChild(row);
    }
  }

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
    $("qr-example").textContent = settings.exampleUrl;
    renderChips();
    renderCleanup();
    validate();
    show("app");
    await loadBatches();
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

  $("count").addEventListener("input", validate);
  $("generate").addEventListener("click", generate);

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
