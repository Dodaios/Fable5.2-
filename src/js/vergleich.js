/* Vergleich: benchmark dumbbell chart (with table view and tooltips) and the cost calculator. */
(function () {
  "use strict";
  var W = window.Werkschau, el = W.el;
  var pct = function (x) { return x.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); };

  /* ---------- tooltip shared by the chart ---------- */
  var tip = document.getElementById("tip");
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.hidden = false;
    var r = tip.getBoundingClientRect();
    var left = Math.min(Math.max(8, x + 14), window.innerWidth - r.width - 8);
    var top = y + 18 + r.height > window.innerHeight ? y - r.height - 12 : y + 18;
    tip.style.left = left + "px";
    tip.style.top = Math.max(8, top) + "px";
  }
  function hideTip() { tip.hidden = true; }
  window.addEventListener("scroll", hideTip, { passive: true });

  /* ---------- benchmarks ---------- */
  function initBenchmarks() {
    var host = document.getElementById("bm");
    if (!host) return;
    var rows = W.benchmarks.slice().sort(function (a, b) { return (b.f - b.o) - (a.f - a.o); });

    rows.forEach(function (b) {
      var d = b.f - b.o;
      var lo = Math.min(b.f, b.o), hi = Math.max(b.f, b.o);
      var label = b.name + ": Fable 5.2 " + pct(b.f) + " Prozent, Opus 5.5 " + pct(b.o) + " Prozent, Fable 5.1 " + pct(b.p) + " Prozent.";
      var row = el("div", { class: "bm-row", role: "listitem", tabindex: "0", "aria-label": label },
        el("div", { class: "bm-name" }, el("b", { text: b.name }), el("small", { text: b.area })),
        el("div", { class: "bm-track" },
          el("i", { class: "bm-link", style: { left: lo + "%", width: (hi - lo) + "%" } }),
          el("i", { class: "bm-dot bm-dot--prev", style: { left: b.p + "%" } }),
          el("i", { class: "bm-dot bm-dot--opus", style: { left: b.o + "%" } }),
          el("i", { class: "bm-dot bm-dot--fable", style: { left: b.f + "%" } })
        ),
        el("div", { class: "bm-delta", text: (d >= 0 ? "+" : "−") + pct(Math.abs(d)) })
      );
      var html = function () {
        return "<b>" + b.name + "</b>" +
          '<span><span><i style="background:var(--series-fable)"></i>Fable 5.2</span><span>' + pct(b.f) + " %</span></span>" +
          '<span><span><i style="background:var(--series-opus)"></i>Opus 5.5</span><span>' + pct(b.o) + " %</span></span>" +
          '<span><span><i style="background:var(--series-prev)"></i>Fable 5.1</span><span>' + pct(b.p) + " %</span></span>" +
          (b.note ? '<span style="opacity:.75;margin-top:.25rem">' + b.note + "</span>" : "");
      };
      row.addEventListener("pointermove", function (e) { showTip(html(), e.clientX, e.clientY); });
      row.addEventListener("pointerleave", hideTip);
      row.addEventListener("focus", function () { var r = row.getBoundingClientRect(); showTip(html(), r.left + r.width * 0.45, r.top + r.height * 0.5); });
      row.addEventListener("blur", hideTip);
      host.appendChild(row);
    });

    var ticks = el("div", { class: "bm-axis-ticks" });
    [0, 25, 50, 75, 100].forEach(function (t) { ticks.appendChild(el("span", { style: { left: t + "%" }, text: t + " %" })); });
    host.appendChild(el("div", { class: "bm-axis", "aria-hidden": "true" }, el("span"), ticks, el("span")));

    var prev = document.getElementById("bm-prev"), legendPrev = document.getElementById("bm-legend-prev");
    prev.addEventListener("change", function () {
      host.classList.toggle("show-prev", prev.checked);
      legendPrev.hidden = !prev.checked;
    });

    var wrap = document.getElementById("bm-table-wrap"), toggle = document.getElementById("bm-toggle");
    var table = el("table", null,
      el("thead", null, el("tr", null,
        el("th", { scope: "col", text: "Test" }), el("th", { scope: "col", text: "Fable 5.2" }),
        el("th", { scope: "col", text: "Opus 5.5" }), el("th", { scope: "col", text: "Fable 5.1" }),
        el("th", { scope: "col", text: "Vorsprung vor Opus" }))),
      el("tbody", null, rows.map(function (b) {
        return el("tr", null,
          el("th", { scope: "row" }, b.name, el("small", { style: { display: "block", fontWeight: "500", color: "var(--ink-3)" }, text: b.area + (b.note ? " · " + b.note : "") })),
          el("td", { text: pct(b.f) + " %" }), el("td", { text: pct(b.o) + " %" }), el("td", { text: pct(b.p) + " %" }),
          el("td", { text: (b.f - b.o >= 0 ? "+" : "−") + pct(Math.abs(b.f - b.o)) + " Punkte" }));
      }))
    );
    wrap.appendChild(table);
    toggle.addEventListener("click", function () {
      var on = toggle.getAttribute("aria-pressed") !== "true";
      toggle.setAttribute("aria-pressed", String(on));
      toggle.textContent = on ? "Als Diagramm" : "Als Tabelle";
      wrap.hidden = !on;
      host.hidden = on;
      document.getElementById("bm-legend").hidden = on;
    });
  }

  /* ---------- cost calculator ---------- */
  var presets = [
    { titel: "Chat-Antwort", n: 1, inTok: 2000, outTok: 600, cache: 0 },
    { titel: "Code-Review", n: 1, inTok: 40000, outTok: 4000, cache: 0 },
    { titel: "Agenten-Session", n: 60, inTok: 120000, outTok: 1500, cache: 90 },
    { titel: "10.000 Tickets", n: 10000, inTok: 800, outTok: 60, cache: 0 }
  ];
  function initCalc() {
    var form = document.getElementById("calc-form");
    if (!form) return;
    var n = document.getElementById("calc-n"), inT = document.getElementById("calc-in"), outT = document.getElementById("calc-out");
    var cache = document.getElementById("calc-cache"), cacheVal = document.getElementById("calc-cache-val");
    var out = document.getElementById("calc-out-list"), segHost = document.getElementById("calc-presets");

    function num(input) { var v = parseFloat(input.value); return isFinite(v) && v >= 0 ? v : 0; }
    function render() {
      cacheVal.textContent = cache.value + " %";
      var costs = W.modelOrder.map(function (k) { return { m: W.models[k], c: W.kosten(k, num(n), num(inT), num(outT), cache.value / 100) }; });
      var max = Math.max.apply(null, costs.map(function (x) { return x.c; })) || 1;
      var opus = costs[2].c;
      out.textContent = "";
      costs.forEach(function (x) {
        var rel = opus > 0 ? x.c / opus : 0;
        out.appendChild(el("div", { class: "calc-row" },
          el("b", { text: x.m.name }),
          el("div", { class: "calc-bar" }, el("i", { style: { width: Math.max(0.5, x.c / max * 100) + "%" } })),
          el("output", { text: W.dollar(x.c) }),
          el("small", { text: x.m.key === "opus" ? "Bezugsgröße" : rel.toLocaleString("de-DE", { maximumFractionDigits: rel < 0.1 ? 3 : 2 }) + " × Opus 5.5" })
        ));
      });
    }
    function apply(p, btn) {
      n.value = p.n; inT.value = p.inTok; outT.value = p.outTok; cache.value = p.cache;
      Array.prototype.forEach.call(segHost.children, function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
      render();
    }
    presets.forEach(function (p, i) {
      var b = el("button", { type: "button", "aria-pressed": "false", text: p.titel });
      b.addEventListener("click", function () { apply(p, b); });
      segHost.appendChild(b);
      if (i === 2) apply(p, b);
    });
    [n, inT, outT, cache].forEach(function (input) {
      input.addEventListener("input", function () {
        Array.prototype.forEach.call(segHost.children, function (b) { b.setAttribute("aria-pressed", "false"); });
        render();
      });
    });
  }

  W.initVergleich = function () { initBenchmarks(); initCalc(); };
})();
