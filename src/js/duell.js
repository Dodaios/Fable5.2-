/* Selbsttest: the same task goes to Fable 5.2 and Opus 5.5 at once (Artifact "sample" capability),
   plus the spoken self-introduction (Artifact "tts" capability). Outside an Artifact viewer both
   capabilities resolve null: the duel then offers the tasks to copy, and the voice button stays hidden. */
(function () {
  "use strict";
  var W = window.Werkschau;
  var SIDES = { fable: { model: "claude-fable-5-2", name: "Fable 5.2" }, opus: { model: "claude-opus-5-5", name: "Opus 5.5" } };
  var FEHLER = {
    not_granted: "Du hast der Seite nicht erlaubt, Claude zu fragen. Ohne Erlaubnis bleibt nur das Kopieren der Aufgabe.",
    sampling_disabled: "Für dieses Konto ist das Fragen aus Artifacts nicht verfügbar.",
    rate_limited: "Gerade sind zu viele Anfragen unterwegs oder dein Kontingent ist erschöpft. Versuch es später noch einmal.",
    session_expired: "Deine Anmeldung ist abgelaufen. Melde dich neu an und versuch es noch einmal.",
    refused: "Das Modell hat diese Aufgabe abgelehnt. Formuliere sie anders.",
    empty_completion: "Es kam keine Antwort zurück. Versuch eine kürzere Aufgabe.",
    prompt_too_large: "Die Aufgabe ist zu lang. Kürze sie.",
    upstream_error: "Die Verbindung ist abgebrochen. Was bis dahin kam, steht noch da."
  };
  var sek = function (ms) { return (ms / 1000).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " s"; };

  function initDuell() {
    var root = document.getElementById("duell");
    if (!root) return;
    var tasksHost = document.getElementById("duell-tasks"), promptEl = document.getElementById("duell-prompt");
    var watch = document.getElementById("duell-watch"), hint = document.getElementById("duell-hint"), status = document.getElementById("duell-status");
    var go = document.getElementById("duell-go"), stop = document.getElementById("duell-stop"), copy = document.getElementById("duell-copy");
    var cols = document.getElementById("duell-cols"), effortHost = document.getElementById("duell-effort");
    var effort = "medium", sample = null, running = [], timer = null;

    function pick(task, btn) {
      promptEl.value = task.prompt;
      watch.innerHTML = "<b>Worauf achten:</b> " + task.achte;
      Array.prototype.forEach.call(tasksHost.children, function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
      if (!task.prompt) promptEl.focus();
    }
    W.aufgaben.forEach(function (t, i) {
      var b = W.el("button", { type: "button", "aria-pressed": "false", text: t.titel });
      b.addEventListener("click", function () { pick(t, b); });
      tasksHost.appendChild(b);
      if (i === 0) pick(t, b);
    });
    Array.prototype.forEach.call(effortHost.children, function (b) {
      b.addEventListener("click", function () {
        effort = b.getAttribute("data-effort");
        Array.prototype.forEach.call(effortHost.children, function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      });
    });

    copy.addEventListener("click", function () {
      var text = promptEl.value;
      var done = function () { status.textContent = "Aufgabe kopiert."; setTimeout(function () { status.textContent = ""; }, 2500); };
      var fallback = function () { promptEl.focus(); promptEl.select(); status.textContent = "Markiert. Jetzt mit Strg+C kopieren."; };
      try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
    });

    hint.textContent = "Das Live-Duell läuft, wenn du diese Seite als Artifact in Claude öffnest. Hier kopierst du die Aufgabe und stellst sie in zwei Chats: einmal mit Fable 5.2, einmal mit Opus 5.5.";

    W.capability("sample").then(function (fn) {
      if (!fn) return;
      sample = fn;
      go.hidden = false; cols.hidden = false; document.getElementById("duell-effort-wrap").hidden = false;
      hint.textContent = "Beide Anfragen laufen über dein eigenes Claude-Konto und verbrauchen dein Kontingent. Beim ersten Mal fragt Claude nach deiner Erlaubnis. Antworten auf hoher Denkstufe können eine Minute und länger dauern.";
    });

    function part(side, role) { return cols.querySelector('[data-side="' + side + '"] [data-role="' + role + '"]'); }

    function ask(side) {
      var cfg = SIDES[side], ctl = new AbortController(), t0 = performance.now(), first = null, ended = false;
      var text = part(side, "text"), badge = part(side, "badge"), time = part(side, "time"), len = part(side, "len");
      text.textContent = "Denkt nach …"; text.classList.add("is-wait");
      badge.textContent = "läuft"; len.textContent = "–";
      var entry = { ctl: ctl, tick: function () { if (!ended) time.textContent = sek(performance.now() - t0); } };
      running.push(entry);
      function finish() { ended = true; running = running.filter(function (r) { return r !== entry; }); if (!running.length) idle(); }

      sample(promptEl.value, {
        model: cfg.model, modelTier: "complex", effort: effort, signal: ctl.signal,
        onText: function (u) {
          if (first === null) { first = performance.now() - t0; text.classList.remove("is-wait"); }
          text.textContent = u.text;
          len.textContent = W.fmt(u.text.length) + " Zeichen";
        }
      }).then(function (res) {
        var total = performance.now() - t0;
        text.classList.remove("is-wait");
        text.textContent = res.text + (res.truncated ? "\n\n[Antwort wurde abgeschnitten]" : "");
        time.textContent = sek(total) + (first !== null ? " · erstes Wort nach " + sek(first) : "");
        len.textContent = W.fmt(res.text.length) + " Zeichen";
        badge.textContent = res.modelApplied ? "geantwortet hat " + res.modelApplied : "Ersatzmodell (Stufe " + res.modelTierApplied + ")";
        if (!res.modelApplied) status.textContent = cfg.name + " stand hier nicht zur Verfügung. Geantwortet hat ein Ersatzmodell, der Vergleich hinkt also.";
        finish();
      }, function (e) {
        var code = e && e.code;
        text.classList.remove("is-wait");
        text.textContent = code === "refused" ? "" : (e && e.text) || "";
        badge.textContent = code === "cancelled" ? "gestoppt" : "Fehler";
        if (code !== "cancelled") status.textContent = FEHLER[code] || FEHLER.upstream_error;
        if (code === "not_granted" || code === "sampling_disabled") { go.hidden = true; }
        finish();
      });
    }

    function idle() { clearInterval(timer); timer = null; go.disabled = false; stop.hidden = true; }

    go.addEventListener("click", function () {
      if (!sample || running.length) return;
      if (!promptEl.value.trim()) { status.textContent = "Schreib zuerst eine Aufgabe ins Feld."; promptEl.focus(); return; }
      status.textContent = "";
      go.disabled = true; stop.hidden = false;
      ask("fable"); ask("opus");
      timer = setInterval(function () { running.forEach(function (r) { r.tick(); }); }, 100);
    });
    stop.addEventListener("click", function () { running.slice().forEach(function (r) { r.ctl.abort(); }); });
  }

  function initStimme() {
    var box = document.getElementById("voice"), btn = document.getElementById("voice-btn"), note = document.getElementById("voice-note");
    if (!box) return;
    W.capability("tts").then(function (tts) {
      if (!tts) return;
      box.hidden = false;
      var active = false;
      var lines = Array.prototype.map.call(document.querySelectorAll("#intro-text > p"), function (p) { return { text: p.textContent.trim() }; });
      tts.onState(function (s) {
        active = s.state !== "idle";
        btn.textContent = active ? "Vorlesen stoppen" : "Vorstellung vorlesen";
        if (!active && s.reason === "not_granted") box.hidden = true;
      });
      btn.addEventListener("click", function () {
        if (active) { tts.stop().catch(function () {}); return; }
        note.textContent = "Eine Claude-Stimme liest diesen Text vor.";
        tts.speak(lines, { language: "de" }).catch(function (e) {
          var code = e && e.code;
          if (code === "not_granted" || code === "unavailable") box.hidden = true;
          else if (code === "rate_limited") note.textContent = "Gerade nicht möglich. Versuch es in ein paar Minuten noch einmal.";
          else if (code === "busy") note.textContent = "Erst wenn dein Diktat beendet ist.";
          else if (code !== "stopped") note.textContent = "Das Vorlesen ist abgebrochen. Der Text steht oben.";
        });
      });
    });
  }

  W.initDuell = function () { initDuell(); initStimme(); };
})();
