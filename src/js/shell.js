/* Page shell: chapter navigation, the live figure in the cover band, the demo stage, the Werkstatt log. */
(function () {
  "use strict";
  var W = window.Werkschau, el = W.el;
  var GALLERY = ["orbit", "sprache", "pfad", "daten", "musik", "shader"];

  function initNav() {
    var links = Array.prototype.slice.call(document.querySelectorAll(".nav-links a"));
    if (!window.IntersectionObserver || !links.length) return;
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) { a.removeAttribute("aria-current"); });
        if (byId[e.target.id]) byId[e.target.id].setAttribute("aria-current", "true");
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    document.querySelectorAll("main .chapter").forEach(function (s) { io.observe(s); });
  }

  function initHero() {
    var orb = document.getElementById("hero-orb"), canvas = document.getElementById("hero-canvas"), cap = document.getElementById("hero-caption");
    if (!orb || !canvas) return;
    var view = null;
    try {
      if (W.shader && W.shader.create) view = W.shader.create(canvas, { transparent: true, interactive: true });
    } catch (e) { console.error(e); view = null; }
    if (!view || !view.ok) {
      orb.classList.add("is-fallback");
      cap.textContent = "Dein Browser stellt hier kein WebGL bereit, deshalb siehst du ein Standbild statt der bewegten Gestalt.";
    }
  }

  function initGallery() {
    var tabsHost = document.getElementById("demo-tabs"), stage = document.getElementById("demo-stage");
    if (!tabsHost || !stage) return;
    var ids = GALLERY.filter(function (id) { return W.demos[id]; });
    W.order.forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });
    if (!ids.length) { stage.textContent = "Die Arbeitsproben konnten nicht geladen werden."; return; }
    var title = document.getElementById("demo-title"), kind = document.getElementById("demo-kind"), lead = document.getElementById("demo-lead");
    var facts = document.getElementById("demo-facts"), moral = document.getElementById("demo-moral"), moralWrap = document.getElementById("demo-moral-wrap");
    var panel = document.getElementById("demo-panel"), current = null, currentId = null, buttons = {};

    function show(id, focusTab) {
      if (id === currentId) return;
      if (current && current.destroy) { try { current.destroy(); } catch (e) { console.error(e); } }
      current = null; currentId = id;
      var def = W.demos[id];
      ids.forEach(function (k) {
        buttons[k].setAttribute("aria-selected", String(k === id));
        buttons[k].tabIndex = k === id ? 0 : -1;
      });
      if (focusTab) buttons[id].focus();
      panel.setAttribute("aria-labelledby", "tab-" + id);
      title.textContent = def.title; kind.textContent = def.kind || ""; lead.textContent = def.lead || "";
      facts.textContent = "";
      (def.facts || []).forEach(function (f) { facts.appendChild(el("span", { class: "chip", text: f })); });
      moral.textContent = def.moral || ""; moralWrap.hidden = !def.moral;
      stage.textContent = "";
      var root = el("div", { class: "stage-root" });
      stage.appendChild(root);
      try { current = def.mount(root) || null; }
      catch (e) {
        console.error(e);
        stage.textContent = "";
        stage.appendChild(el("p", { class: "note", text: "Diese Arbeitsprobe ist beim Start gestolpert: " + (e && e.message ? e.message : e) }));
      }
      try { localStorage.setItem("werkschau-demo", id); } catch (e) { /* storage is optional */ }
    }

    ids.forEach(function (id, i) {
      var def = W.demos[id];
      var b = el("button", { class: "gallery-tab", type: "button", role: "tab", id: "tab-" + id, "aria-controls": "demo-panel", "aria-selected": "false" },
        el("b", { text: def.title }), el("small", { text: def.kind || "" }));
      b.addEventListener("click", function () { show(id); });
      b.addEventListener("keydown", function (e) {
        var step = (e.key === "ArrowDown" || e.key === "ArrowRight") ? 1 : (e.key === "ArrowUp" || e.key === "ArrowLeft") ? -1 : 0;
        if (e.key === "Home") { e.preventDefault(); show(ids[0], true); return; }
        if (e.key === "End") { e.preventDefault(); show(ids[ids.length - 1], true); return; }
        if (!step) return;
        e.preventDefault();
        show(ids[(i + step + ids.length) % ids.length], true);
      });
      buttons[id] = b;
      tabsHost.appendChild(b);
    });

    var first = ids[0];
    try { var saved = localStorage.getItem("werkschau-demo"); if (saved && W.demos[saved]) first = saved; } catch (e) { /* storage is optional */ }
    show(first);
    W.showDemo = show;
  }

  function initWerkstatt() {
    var log = document.getElementById("log"), tally = document.getElementById("tally");
    if (log) {
      (W.protokoll || []).forEach(function (p) {
        log.appendChild(el("li", null, el("time", { text: p.zeit }), el("div", null, el("b", { text: p.titel }), el("span", { text: p.text }))));
      });
    }
    var s = W.stats;
    if (tally && s) {
      [["Zeilen Quelltext", W.fmt(s.lines)], ["Dateien", W.fmt(s.files)], ["Prüfanweisungen", W.fmt(s.checks)], ["Fremde Bibliotheken", "0"]]
        .forEach(function (row) { tally.appendChild(el("div", null, el("dt", { text: row[0] }), el("dd", { text: row[1] }))); });
    }
  }

  function start() {
    initNav();
    [initHero, W.initVergleich, W.initKompass, W.initDuell, initGallery, initWerkstatt].forEach(function (fn) {
      try { if (fn) fn(); } catch (e) { console.error(e); }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
