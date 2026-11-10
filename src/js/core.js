/* Shared runtime for the page and every demo. No dependencies. */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var W = (root.Werkschau = root.Werkschau || {});
  W.demos = W.demos || {};
  W.order = W.order || [];

  /* A demo registers itself:
     Werkschau.register("id", {
       title: "…", kind: "…", lead: "…", facts: ["…"], moral: "…",
       mount(rootEl) { …; return { destroy() {} }; }
     }); */
  W.register = function (id, def) {
    W.demos[id] = def;
    if (W.order.indexOf(id) === -1) W.order.push(id);
  };

  /* el("div", {class: "x", onclick: fn, "aria-label": "…"}, child, "text", [more]) */
  W.el = function (tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
        else if (k.slice(0, 2) === "on" && typeof v === "function") node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, "");
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  };
  function append(node, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) child.forEach(function (c) { append(node, c); });
    else node.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }

  /* Read a design token as it currently resolves (theme-aware). */
  W.token = function (name, el) {
    return getComputedStyle(el || document.documentElement).getPropertyValue(name).trim();
  };

  W.reducedMotion = function () {
    return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  };

  /* Call cb whenever the effective theme changes. Returns an unsubscribe function. */
  var themeSubs = [];
  W.onTheme = function (cb) {
    themeSubs.push(cb);
    return function () { themeSubs = themeSubs.filter(function (f) { return f !== cb; }); };
  };
  function fireTheme() { themeSubs.slice().forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); }
  if (root.matchMedia) {
    var mq = root.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", fireTheme);
    else if (mq.addListener) mq.addListener(fireTheme);
  }
  if (root.MutationObserver && root.document) {
    new MutationObserver(fireTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  /* Size a canvas backing store to its CSS box × devicePixelRatio (capped). Returns the scale used. */
  W.fitCanvas = function (canvas, cssW, cssH, maxDpr) {
    var dpr = Math.min(root.devicePixelRatio || 1, maxDpr || 2);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    return dpr;
  };

  /* cb(true/false) as the element enters/leaves the viewport. Returns a disconnect function. */
  W.visible = function (el, cb) {
    if (!root.IntersectionObserver) { cb(true); return function () {}; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { cb(e.isIntersecting); });
    }, { threshold: 0.05 });
    io.observe(el);
    return function () { io.disconnect(); };
  };

  /* Number formatting, German conventions. */
  W.fmt = function (n, digits) {
    return Number(n).toLocaleString("de-DE", { minimumFractionDigits: digits || 0, maximumFractionDigits: digits == null ? 0 : digits });
  };

  /* Reach an Artifact runtime capability; resolves null anywhere else (local file, GitHub Pages). */
  W.capability = function (name) {
    try {
      if (root.claude && typeof root.claude.use === "function") return root.claude.use(name).catch(function () { return null; });
    } catch (e) { /* fall through */ }
    return Promise.resolve(null);
  };
})();
