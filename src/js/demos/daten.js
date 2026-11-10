/* Datenblick: paste a CSV, get an analysis. Parser, type inference, statistics,
   charts and rule-based findings are written by hand; nothing calls a model. */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var W = root.Werkschau;

  var MAX_ROWS = 5000, MAX_COLS = 30, MAX_CHARS = 5e6, MAX_POINTS = 1500, MAX_HEAT = 12;
  var SEP_NAME = { ";": "Semikolon", ",": "Komma", "\t": "Tabulator" };
  var TYPE_NAME = { zahl: "Zahl", kategorie: "Kategorie", datum: "Datum", text: "Text" };
  var MISSING = { "": 1, "na": 1, "n/a": 1, "nan": 1, "null": 1, "-": 1, "–": 1, "k.a.": 1, "k. a.": 1 };
  var EXAMPLE_LABEL = "Synthetische Beispieldaten, per Zufallsgenerator erzeugt";

  /* ---------- formatting (German conventions) ---------- */
  function nf(v, d) {
    if (!Number.isFinite(v)) return "–";
    d = d || 0;
    var p = Math.pow(10, d), r = Math.round(v * p) / p;
    if (r === 0) r = 0;
    return r.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/^-/, "−");
  }
  function nfAuto(v) { var a = Math.abs(v); return nf(v, a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3); }
  function fmtP(p) { return p < 0.001 ? "p < 0,001" : "p = " + nf(p, 3); }
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function fmtDay(d) { var t = new Date(d * 864e5); return pad2(t.getUTCDate()) + "." + pad2(t.getUTCMonth() + 1) + "." + t.getUTCFullYear(); }
  function num(a, b) { return a - b; }

  /* ---------- CSV ---------- */
  function detectSeparator(text) {
    var lines = [], cur = { ";": 0, ",": 0, "\t": 0 }, inQ = false, any = false, i, ch;
    for (i = 0; i < text.length && lines.length < 12; i++) {
      ch = text[i];
      if (ch === '"') { inQ = !inQ; any = true; }
      else if (!inQ && (ch === "\n" || ch === "\r")) {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        if (any) lines.push(cur);
        cur = { ";": 0, ",": 0, "\t": 0 }; any = false;
      } else { any = true; if (!inQ && (ch === ";" || ch === "," || ch === "\t")) cur[ch]++; }
    }
    if (any && lines.length < 12) lines.push(cur);
    var best = null, bestScore = -1;
    [";", ",", "\t"].forEach(function (c) {
      if (!lines.length || !lines[0][c]) return;
      var head = lines[0][c], same = 0;
      lines.forEach(function (l) { if (l[c] === head) same++; });
      var score = same / lines.length * 1000 + head; /* consistency first, then column count */
      if (score > bestScore) { bestScore = score; best = c; }
    });
    return best;
  }

  function toNumber(s, decComma) {
    s = s.replace(/[\s\u00a0\u202f]/g, "").replace(/^[€$£]|(?:€|%|EUR)$/gi, "").replace("−", "-");
    if (!s) return NaN;
    if (decComma) {
      if (/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(s)) return parseFloat(s.replace(/\./g, "").replace(",", "."));
      return /^[+-]?\d*\.\d+$/.test(s) ? parseFloat(s) : NaN;
    }
    if (/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(s) || /^[+-]?\.\d+$/.test(s)) return parseFloat(s.replace(/,/g, ""));
    return NaN;
  }

  function toDay(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s), y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else return NaN;
    var t = Date.UTC(y, mo - 1, d), dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return NaN;
    return t / 864e5;
  }

  function parseCSV(text) {
    var res = { header: [], rows: [], separator: null, decimalComma: false, errors: [], warnings: [] };
    text = typeof text === "string" ? text : String(text == null ? "" : text);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (!text.trim()) { res.errors.push("Die Eingabe ist leer. Füge CSV-Text mit einer Kopfzeile und mindestens einer Datenzeile ein."); return res; }
    if (text.length > MAX_CHARS) { res.errors.push("Die Eingabe ist größer als 5 MB. Kürze die Datei auf höchstens " + nf(MAX_ROWS) + " Zeilen."); return res; }
    var sep = detectSeparator(text);
    res.separator = sep;
    if (!sep) res.warnings.push("Kein Trennzeichen (Semikolon, Komma, Tabulator) gefunden. Ich lese die Eingabe als eine einzige Spalte.");

    var records = [], rec = [], field = "", inQ = false, quoted = false, line = 1, qLine = 0, i, ch;
    function endField() { rec.push(quoted ? field : field.trim()); field = ""; quoted = false; }
    function endRecord() { endField(); if (rec.length > 1 || rec[0] !== "") records.push(rec); rec = []; }
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else { if (ch === "\n") line++; field += ch; }
      } else if (ch === '"' && !quoted && field.trim() === "") { inQ = true; quoted = true; qLine = line; field = ""; }
      else if (ch === sep) endField();
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; line++; endRecord(); }
      else if (!(quoted && ch === " ")) field += ch;
    }
    if (inQ) { res.errors.push("Ein Anführungszeichen, das in Zeile " + qLine + " beginnt, wird nicht geschlossen. Schließe es oder verdopple Anführungszeichen im Text (\"\")."); return res; }
    if (field !== "" || quoted || rec.length) endRecord();
    if (records.length < 2) { res.errors.push("Ich finde nur eine Kopfzeile und keine Datenzeilen. Die erste Zeile gilt als Spaltennamen, darunter brauche ich mindestens eine Zeile mit Werten."); return res; }

    var head = records[0], width = head.length, nCols = width, seen = Object.create(null);
    if (nCols > MAX_COLS) { res.warnings.push("Die Tabelle hat " + nCols + " Spalten. Ich werte die ersten " + MAX_COLS + " aus."); nCols = MAX_COLS; }
    if (head.every(function (h) { return Number.isFinite(toNumber(h, sep === ";")); })) res.warnings.push("Die erste Zeile sieht nach Werten aus, nicht nach Spaltennamen. Ich behandle sie trotzdem als Kopfzeile.");
    res.header = head.slice(0, nCols).map(function (h, j) {
      var name = h || "Spalte " + (j + 1), k = 2, base = name;
      while (seen[name]) name = base + " (" + k++ + ")";
      seen[name] = 1;
      return name;
    });
    var body = records.slice(1), ragged = 0;
    if (body.length > MAX_ROWS) { res.warnings.push("Die Tabelle hat " + nf(body.length) + " Datenzeilen. Ich werte die ersten " + nf(MAX_ROWS) + " aus."); body = body.slice(0, MAX_ROWS); }
    res.rows = body.map(function (r) {
      if (r.length !== width) ragged++;
      var out = r.slice(0, nCols);
      while (out.length < nCols) out.push("");
      return out;
    });
    if (ragged) res.warnings.push((ragged === 1 ? "1 Zeile hat" : nf(ragged) + " Zeilen haben") + " eine andere Spaltenzahl als die Kopfzeile. Fehlende Zellen gelten als leer, überzählige lasse ich weg.");
    if (sep === ";") res.decimalComma = true;
    else if (sep !== ",") {
      var de = false, en = false;
      res.rows.forEach(function (r) { r.forEach(function (c) { if (/^[+-]?\d+,\d+$/.test(c)) de = true; else if (/^[+-]?\d+\.\d+$/.test(c)) en = true; }); });
      res.decimalComma = de && !en;
    }
    return res;
  }

  /* ---------- statistics ---------- */
  function quantile(sorted, p) { /* linear interpolation, the "type 7" definition */
    var n = sorted.length;
    if (!n) return NaN;
    var h = (n - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
  }
  function mean(xs) { var s = 0; for (var i = 0; i < xs.length; i++) s += xs[i]; return xs.length ? s / xs.length : NaN; }
  function describe(xs) {
    var v = xs.filter(Number.isFinite).sort(num), n = v.length;
    if (!n) return { n: 0, min: NaN, max: NaN, mean: NaN, median: NaN, q1: NaN, q3: NaN, sd: NaN, skew: 0 };
    var m = mean(v), m2 = 0, m3 = 0;
    v.forEach(function (x) { var d = x - m; m2 += d * d; m3 += d * d * d; });
    return {
      n: n, min: v[0], max: v[n - 1], mean: m, median: quantile(v, 0.5), q1: quantile(v, 0.25), q3: quantile(v, 0.75),
      sd: n > 1 ? Math.sqrt(m2 / (n - 1)) : 0, skew: n > 2 && m2 > 0 ? (m3 / n) / Math.pow(m2 / n, 1.5) : 0
    };
  }
  /* Least squares on the rows where both values are finite; skip[i] leaves row i out. */
  function linreg(xs, ys, skip) {
    var n = 0, mx = 0, my = 0, i, ok = [];
    for (i = 0; i < xs.length; i++) if (Number.isFinite(xs[i]) && Number.isFinite(ys[i]) && !(skip && skip[i])) { ok.push(i); n++; mx += xs[i]; my += ys[i]; }
    if (n < 2) return { n: n, r: NaN, slope: NaN, intercept: NaN };
    mx /= n; my /= n;
    var sxx = 0, syy = 0, sxy = 0;
    ok.forEach(function (k) { var dx = xs[k] - mx, dy = ys[k] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; });
    var slope = sxx > 0 ? sxy / sxx : NaN;
    var r = n >= 3 && sxx > 0 && syy > 0 ? Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy))) : NaN;
    return { n: n, r: r, slope: slope, intercept: my - slope * mx };
  }
  function pearson(xs, ys, skip) { return linreg(xs, ys, skip).r; }

  /* Robust outlier rule: modified z-score (Iglewicz & Hoaglin) above 3.5.
     If more than half the values are identical (MAD = 0) fall back to 3 x IQR. */
  function outlierInfo(xs) {
    var v = xs.filter(Number.isFinite).sort(num), n = v.length, idx = [], i, distinct = n ? 1 : 0, lo, hi, rule = "mz";
    for (i = 1; i < n; i++) if (v[i] !== v[i - 1]) distinct++;
    if (n < 8 || distinct <= 5) return { idx: idx, rule: rule };
    var med = quantile(v, 0.5), mad = quantile(v.map(function (x) { return Math.abs(x - med); }).sort(num), 0.5);
    if (mad > 0) { lo = med - 3.5 * mad / 0.6745; hi = med + 3.5 * mad / 0.6745; }
    else {
      var q1 = quantile(v, 0.25), q3 = quantile(v, 0.75);
      if (!(q3 - q1 > 0)) return { idx: idx, rule: rule };
      rule = "iqr"; lo = q1 - 3 * (q3 - q1); hi = q3 + 3 * (q3 - q1);
    }
    for (i = 0; i < xs.length; i++) if (Number.isFinite(xs[i]) && (xs[i] < lo || xs[i] > hi)) idx.push(i);
    return { idx: idx, rule: rule };
  }
  function outliers(xs) { return outlierInfo(xs).idx; }

  /* p-values through the regularized incomplete beta function (continued fraction). */
  function lgamma(x) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, t = x + 5.5, ser = 1.000000000190015;
    t -= (x + 0.5) * Math.log(t);
    for (var j = 0; j < 6; j++) ser += c[j] / ++y;
    return -t + Math.log(2.5066282746310005 * ser / x);
  }
  function betacf(a, b, x) {
    var TINY = 1e-300, qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap, h, m, m2, aa, del;
    if (Math.abs(d) < TINY) d = TINY;
    d = 1 / d; h = d;
    for (m = 1; m <= 300; m++) {
      m2 = 2 * m; aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
      c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
      c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d; del = d * c; h *= del;
      if (Math.abs(del - 1) < 3e-12) break;
    }
    return h;
  }
  function betai(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  function pCorr(r, n) { /* two-sided, t distribution with n - 2 degrees of freedom */
    if (!(n > 2) || !Number.isFinite(r)) return NaN;
    if (Math.abs(r) >= 1) return 0;
    var df = n - 2, t2 = r * r * df / (1 - r * r);
    return betai(df / 2, 0.5, df / (df + t2));
  }
  function pF(F, d1, d2) { return F > 0 ? betai(d2 / 2, d1 / 2, d2 / (d2 + d1 * F)) : 1; }
  function anova(groups) {
    var k = groups.length, N = 0, sum = 0, ssb = 0, ssw = 0;
    groups.forEach(function (g) { N += g.length; g.forEach(function (x) { sum += x; }); });
    var grand = sum / N, d1 = k - 1, d2 = N - k;
    if (d1 < 1 || d2 < 1) return null;
    groups.forEach(function (g) { var m = mean(g); ssb += g.length * (m - grand) * (m - grand); g.forEach(function (x) { ssw += (x - m) * (x - m); }); });
    var F = ssw > 0 ? (ssb / d1) / (ssw / d2) : (ssb > 0 ? Infinity : 0);
    return { F: F, d1: d1, d2: d2, p: F === Infinity ? 0 : pF(F, d1, d2), eta2: ssb + ssw > 0 ? ssb / (ssb + ssw) : 0 };
  }

  /* ---------- profile: types, per-column statistics, outliers, correlations ---------- */
  function histogram(vals, st) {
    var bins = Math.max(6, Math.min(14, Math.ceil(Math.sqrt(st.n)))), span = st.max - st.min, counts = [], i;
    if (!(span > 0)) return { lo: st.min, step: 0, counts: [st.n] };
    for (i = 0; i < bins; i++) counts.push(0);
    vals.forEach(function (v) { if (Number.isFinite(v)) counts[Math.min(bins - 1, Math.floor((v - st.min) / span * bins))]++; });
    return { lo: st.min, step: span / bins, counts: counts };
  }

  function profile(table) {
    var rows = table.rows, nR = rows.length, dec = !!table.decimalComma;
    var cols = table.header.map(function (name, j) {
      var raw = new Array(nR), nums = new Array(nR), days = new Array(nR), missing = 0, numOk = 0, dayOk = 0, decimals = 0, i, s;
      for (i = 0; i < nR; i++) {
        s = rows[i][j] == null ? "" : String(rows[i][j]);
        if (MISSING[s.toLowerCase()]) { raw[i] = ""; nums[i] = NaN; days[i] = NaN; missing++; continue; }
        raw[i] = s;
        days[i] = toDay(s); if (Number.isFinite(days[i])) dayOk++;
        nums[i] = toNumber(s, dec);
        if (Number.isFinite(nums[i])) { numOk++; decimals = Math.max(decimals, (String(nums[i]).split(".")[1] || "").length); }
      }
      var present = nR - missing, col = { name: name, index: j, raw: raw, missing: missing, invalid: 0, n: present, outliers: [] };
      if (present && dayOk === present) {
        col.type = "datum"; col.values = days; col.stats = describe(days);
        col.min = col.stats.min; col.max = col.stats.max; col.distinct = countDistinct(raw);
      } else if (present && numOk >= Math.ceil(present * 0.9)) {
        var info = outlierInfo(nums);
        col.type = "zahl"; col.values = nums; col.n = numOk; col.invalid = present - numOk;
        col.decimals = Math.min(decimals, 3); col.stats = describe(nums); col.hist = histogram(nums, col.stats);
        col.outliers = info.idx; col.outlierRule = info.rule;
      } else {
        var map = Object.create(null), order = [];
        raw.forEach(function (v) { if (v === "") return; if (map[v] === undefined) { map[v] = 0; order.push(v); } map[v]++; });
        col.values = raw; col.distinct = order.length;
        col.counts = order.map(function (v) { return { value: v, count: map[v] }; }).sort(function (a, b) { return b.count - a.count || (a.value < b.value ? -1 : 1); });
        col.type = order.length <= 20 && order.length < present && order.length <= Math.max(2, present * 0.6) ? "kategorie" : "text";
      }
      return col;
    });
    function countDistinct(arr) { var m = Object.create(null), c = 0; arr.forEach(function (v) { if (v !== "" && !m[v]) { m[v] = 1; c++; } }); return c; }

    var numeric = cols.filter(function (c) { return c.type === "zahl"; });
    var isOut = new Array(nR).fill(false), cells = [];
    numeric.forEach(function (c) {
      c.outliers.forEach(function (i) { isOut[i] = true; cells.push({ row: i + 1, col: c.name, value: c.values[i], raw: c.raw[i], rule: c.outlierRule }); });
    });
    cells.sort(function (a, b) { return a.row - b.row; });
    var outlierRows = [];
    isOut.forEach(function (o, i) { if (o) outlierRows.push(i + 1); });

    var heat = numeric.slice(0, MAX_HEAT), corr = [], best = null, a, b, all, clean, pick;
    for (a = 0; a < heat.length; a++) corr.push([]);
    for (a = 0; a < heat.length; a++) for (b = a; b < heat.length; b++) {
      all = linreg(heat[a].values, heat[b].values);
      clean = outlierRows.length ? linreg(heat[a].values, heat[b].values, isOut) : all;
      corr[a][b] = corr[b][a] = { all: { r: all.r, n: all.n }, clean: { r: clean.r, n: clean.n } };
      pick = Number.isFinite(clean.r) ? clean.r : all.r;
      if (a !== b && Number.isFinite(pick) && (!best || Math.abs(pick) > best.abs)) best = { a: a, b: b, abs: Math.abs(pick) };
    }
    return {
      cols: cols, numeric: numeric, nRows: nR, nCols: cols.length,
      missing: cols.reduce(function (s, c) { return s + c.missing; }, 0),
      isOut: isOut, outlierRows: outlierRows, outlierCells: cells, corr: corr, best: best ? [best.a, best.b] : null
    };
  }

  /* ---------- findings: rules that turn the numbers into sentences ---------- */
  function findings(table, prof) {
    prof = prof || profile(table);
    var out = [], numeric = prof.numeric, nOut = prof.outlierRows.length, skip = nOut ? prof.isOut : null;
    var without = nOut === 1 ? "ohne die Ausreißer-Zeile" : "ohne die " + nOut + " Ausreißer-Zeilen";
    function add(rank, kind, text) { out.push({ rank: rank, kind: kind, text: text }); }
    function meanDigits(c) { return Math.min(Math.max(c.decimals, 1), 2); }

    if (prof.nRows < 8) add(0, "hinweis", "Nur " + prof.nRows + (prof.nRows === 1 ? " Zeile" : " Zeilen") + ": zu wenig für belastbare Zusammenhänge, die rechne ich erst ab 8 Zeilen. Die Kennzahlen pro Spalte stimmen trotzdem.");

    /* 1. linear relationships between numeric columns, Bonferroni-corrected */
    var pairs = [], a, b, c, st;
    for (a = 0; a < prof.corr.length; a++) for (b = a + 1; b < prof.corr.length; b++) {
      c = prof.corr[a][b];
      st = nOut && c.clean.n >= 8 && Number.isFinite(c.clean.r) ? c.clean : c.all;
      if (st.n >= 8 && Number.isFinite(st.r)) pairs.push({ a: a, b: b, r: st.r, n: st.n, p: pCorr(st.r, st.n), clean: st === c.clean && nOut > 0, rAll: c.all.r });
    }
    pairs.sort(function (p, q) { return Math.abs(q.r) - Math.abs(p.r); });
    var shown = 0;
    pairs.slice(0, 2).forEach(function (pr, k) {
      var abs = Math.abs(pr.r);
      if (abs < (k ? 0.5 : 0.3) || pr.p * pairs.length >= 0.05) return;
      var t = (k ? "Zweitstärkster" : "Stärkster") + " Zusammenhang (" + (abs >= 0.7 ? "stark" : abs >= 0.5 ? "deutlich" : "mäßig") + "): Wo " + numeric[pr.a].name + " höher ist, ist " + numeric[pr.b].name + " meist " + (pr.r > 0 ? "auch höher" : "niedriger") + " (r = " + nf(pr.r, 2) + ", n = " + pr.n + (pr.clean ? ", " + without : "") + ").";
      if (pr.clean && Number.isFinite(pr.rAll) && Math.abs(pr.r - pr.rAll) >= 0.1) t += " Mit " + (nOut === 1 ? "ihr" : "ihnen") + " wäre r = " + nf(pr.rAll, 2) + ".";
      add(k ? 5 : 1, "zusammenhang", t); shown++;
    });
    if (!shown && pairs.length) add(6, "zusammenhang", "Zwischen den Zahlenspalten finde ich keinen belastbaren linearen Zusammenhang (größtes |r| = " + nf(Math.abs(pairs[0].r), 2) + ").");

    /* 2. group differences: one-way ANOVA per category column, best numeric column each */
    var tests = 0, groupsFound = [];
    prof.cols.forEach(function (cat) {
      if (cat.type !== "kategorie") return;
      var best = null;
      numeric.forEach(function (nc) {
        var map = Object.create(null), order = [], i, key, v;
        for (i = 0; i < prof.nRows; i++) {
          key = cat.values[i]; v = nc.values[i];
          if (key === "" || !Number.isFinite(v) || (skip && skip[i])) continue;
          if (!map[key]) { map[key] = []; order.push(key); }
          map[key].push(v);
        }
        var gs = order.filter(function (k) { return map[k].length >= 3; });
        if (gs.length < 2 || gs.length > 12) return;
        var an = anova(gs.map(function (k) { return map[k]; }));
        if (!an) return;
        tests++;
        var stats = gs.map(function (k) { return { name: k, mean: mean(map[k]) }; }).sort(function (x, y) { return y.mean - x.mean; });
        if (!best || an.p < best.an.p || (an.p === best.an.p && an.eta2 > best.an.eta2)) best = { cat: cat, nc: nc, an: an, hi: stats[0], lo: stats[stats.length - 1], k: gs.length };
      });
      if (best) groupsFound.push(best);
    });
    groupsFound.sort(function (x, y) { return x.an.p - y.an.p || y.an.eta2 - x.an.eta2; });
    groupsFound.slice(0, 2).forEach(function (g, k) {
      if (g.an.p * tests >= 0.05 || g.an.eta2 < 0.06) return;
      var d = meanDigits(g.nc), tail = ": " + fmtP(g.an.p) + (nOut ? ", " + without + " gerechnet" : "") + ".";
      add(k ? 7 : 2, "gruppen", "Gruppenunterschied: " + g.nc.name + " ist bei " + g.cat.name + " = " + g.hi.name + " im Mittel " +
        (g.k === 2 ? "höher (" + nf(g.hi.mean, d) + ") als bei " + g.lo.name + " (" + nf(g.lo.mean, d) + "). F-Test" :
          "am höchsten (" + nf(g.hi.mean, d) + "), bei " + g.lo.name + " am niedrigsten (" + nf(g.lo.mean, d) + "). F-Test über " + g.k + " Gruppen") + tail);
    });

    /* 3. trend over a date column */
    var trends = [];
    prof.cols.forEach(function (dc) {
      if (dc.type !== "datum") return;
      numeric.forEach(function (nc) { var s = linreg(dc.values, nc.values, skip); if (s.n >= 8 && Number.isFinite(s.r)) trends.push({ dc: dc, nc: nc, r: s.r, n: s.n, p: pCorr(s.r, s.n) }); });
    });
    trends.sort(function (p, q) { return Math.abs(q.r) - Math.abs(p.r); });
    if (trends.length && Math.abs(trends[0].r) >= 0.3 && trends[0].p * trends.length < 0.05) {
      var tr = trends[0];
      add(4, "zeit", "Über die Zeit (" + tr.dc.name + ", " + fmtDay(tr.dc.min) + " bis " + fmtDay(tr.dc.max) + ") " + (tr.r > 0 ? "steigt " : "fällt ") + tr.nc.name + " tendenziell (r = " + nf(tr.r, 2) + ", n = " + tr.n + ").");
    }

    /* 4. outliers */
    var cells = prof.outlierCells;
    if (cells.length) {
      var onlyMz = cells.every(function (o) { return o.rule === "mz"; });
      add(3, "ausreisser", (cells.length === 1 ? "1 Ausreißer" : cells.length + " Ausreißer") + " nach robuster Regel (modifizierter z-Wert über 3,5" + (onlyMz ? "" : "; bei Spalten mit vielen gleichen Werten der 3-fache Quartilsabstand") + "): " +
        cells.slice(0, 5).map(function (o) { return "Zeile " + o.row + ": " + o.col + " = " + o.raw; }).join("; ") + (cells.length > 5 ? " und " + (cells.length - 5) + " weitere" : "") + ".");
    }

    /* 5. missing and unreadable cells */
    var total = prof.nRows * prof.nCols;
    if (prof.missing) {
      var worst = prof.cols.slice().sort(function (x, y) { return y.missing - x.missing; })[0];
      add(8, "fehlend", prof.missing === 1 ? "1 von " + nf(total) + " Zellen ist leer, in " + worst.name + "." :
        nf(prof.missing) + " von " + nf(total) + " Zellen sind leer (" + nf(100 * prof.missing / total, 1) + " %), die meisten in " + worst.name + " (" + worst.missing + ").");
    } else add(9, "fehlend", "Keine Zelle fehlt.");
    prof.cols.forEach(function (col) {
      if (col.invalid) add(8.5, "fehlend", "In " + col.name + (col.invalid === 1 ? " ist 1 Eintrag nicht als Zahl lesbar; er zählt" : " sind " + col.invalid + " Einträge nicht als Zahl lesbar; sie zählen") + " als fehlend.");
    });

    /* 6. skew */
    var sk = null;
    numeric.forEach(function (nc) {
      var d = describe(skip ? nc.values.filter(function (v, i) { return !skip[i]; }) : nc.values);
      if (d.n >= 20 && Math.abs(d.skew) >= 1 && (!sk || Math.abs(d.skew) > Math.abs(sk.skew))) sk = { name: nc.name, skew: d.skew };
    });
    if (sk) add(6.5, "schiefe", sk.name + " ist deutlich " + (sk.skew > 0 ? "rechtsschief: viele kleine Werte, wenige große" : "linksschief: viele große Werte, wenige kleine") + " (Schiefe " + nf(sk.skew, 1) + (nOut ? ", " + without : "") + "). Der Median beschreibt die Mitte hier besser als der Mittelwert.");

    return out.sort(function (x, y) { return x.rank - y.rank; }).slice(0, 6).map(function (f) { return { kind: f.kind, text: f.text }; });
  }

  /* ---------- synthetic example: a café, 120 days, three planted outliers ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6d2b79f5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function example() {
    var rnd = mulberry32(5202), n = 120, WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    var lines = ["datum;wochentag;temperatur_c;regen;besucher;umsatz_eur"];
    var blanks = { 12: 2, 77: 2, 23: 5, 104: 5, 50: 3 }; /* data row -> column index left empty */
    function gauss() { var u = 1 - rnd(), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
    function de(v, d) { return v.toFixed(d).replace(".", ","); }
    for (var i = 0; i < n; i++) {
      var day = new Date(Date.UTC(2026, 2, 2 + i)), wd = day.getUTCDay(), weekend = wd === 0 || wd === 6, row = i + 1;
      var temp = Math.round((6 + 17 * i / (n - 1) + 3 * gauss()) * 10) / 10;
      var rain = rnd() < 0.3;
      var guests = Math.max(8, Math.round(60 + 2.3 * (temp - 12) + (weekend ? 36 : 0) - (rain ? 19 : 0) + 8 * gauss()));
      var sales = guests * (7.4 + 0.8 * gauss());
      if (row === 37) temp = 47.5;      /* sensor glitch */
      if (row === 64) guests = 298;     /* counting error, revenue stays plausible */
      if (row === 91) sales *= 3.1;     /* booking typo */
      var cells = [pad2(day.getUTCDate()) + "." + pad2(day.getUTCMonth() + 1) + "." + day.getUTCFullYear(), WD[wd], de(temp, 1), rain ? "ja" : "nein", String(guests), de(sales, 2)];
      if (blanks[row] !== undefined) cells[blanks[row]] = "";
      lines.push(cells.join(";"));
    }
    return {
      csv: lines.join("\n") + "\n", rows: n, missing: 5,
      planted: [{ row: 37, column: "temperatur_c" }, { row: 64, column: "besucher" }, { row: 91, column: "umsatz_eur" }]
    };
  }

  /* ---------- chart helpers ---------- */
  function niceScale(lo, hi, target) {
    if (lo === hi) { var padv = Math.abs(lo) * 0.1 || 1; lo -= padv; hi += padv; }
    var raw = (hi - lo) / (target || 5), mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
    var step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    var a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step, ticks = [], k, count = Math.round((b - a) / step);
    for (k = 0; k <= count; k++) ticks.push(a + k * step);
    return { lo: a, hi: b, ticks: ticks, digits: Math.min(6, Math.max(0, -Math.floor(Math.log10(step) + 1e-9))) };
  }
  function tickLabel(v, scale) {
    if (Math.max(Math.abs(scale.lo), Math.abs(scale.hi)) >= 10000) return (Math.round(v) === 0 ? 0 : v).toLocaleString("de-DE", { notation: "compact", maximumFractionDigits: 1 }).replace(/^-/, "−");
    return nf(v, scale.digits);
  }
  /* Resolve any CSS color (hex, color-mix result, oklab ...) to sRGB through a 1 px canvas. */
  var probe = null;
  function rgbOf(color) {
    if (!probe) { var cv = document.createElement("canvas"); cv.width = cv.height = 1; probe = cv.getContext("2d", { willReadFrequently: true }); }
    if (!probe) return null;
    probe.fillStyle = "#010203"; probe.fillStyle = color;
    if (probe.fillStyle === "#010203" && !/^#010203$/i.test(color)) return null; /* this browser cannot parse the color */
    probe.clearRect(0, 0, 1, 1); probe.fillRect(0, 0, 1, 1);
    var d = probe.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }
  function relLum(c) {
    function f(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  function contrast(a, b) { var x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  var SVG_NS = "http://www.w3.org/2000/svg";
  function sv(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag), k, i;
    for (k in attrs) node.setAttribute(k, attrs[k]);
    for (i = 2; i < arguments.length; i++) if (arguments[i] != null) node.appendChild(typeof arguments[i] === "string" ? document.createTextNode(arguments[i]) : arguments[i]);
    return node;
  }

  /* ---------- UI ---------- */
  function mount(rootEl) {
    var el = W.el;
    var S = { table: null, prof: null, x: 0, y: 1, hideOut: false, asTable: false };
    var ro = null, raf = 0, reader = null, lastW = 0, clipId = "d-daten-clip-" + Math.random().toString(36).slice(2, 8);

    var fileIn = el("input", { type: "file", id: "d-daten-file", accept: ".csv,.tsv,.txt,text/csv,text/plain", hidden: true, onchange: function () { if (fileIn.files[0]) readFile(fileIn.files[0]); fileIn.value = ""; } });
    var btnPaste = el("button", { class: "btn btn--sm", type: "button", "aria-expanded": "false", "aria-controls": "d-daten-pastebox", onclick: togglePaste }, "Eigene CSV einfügen");
    var srcChip = el("span", { class: "chip chip--accent" });
    var ta = el("textarea", {
      class: "input", id: "d-daten-text", rows: "7", spellcheck: "false", placeholder: "name;alter;stadt\nAnna;34;Köln\nBen;29;Bonn",
      onkeydown: function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runPaste(); } }
    });
    var pasteBox = el("div", { class: "d-daten-paste", id: "d-daten-pastebox", hidden: true },
      el("label", { class: "field", for: "d-daten-text" }, "CSV-Text, erste Zeile mit den Spaltennamen", ta),
      el("div", { class: "demo-bar" },
        el("button", { class: "btn btn--sm btn--primary", type: "button", onclick: runPaste }, "Auswerten"),
        el("span", { class: "note" }, "Trennzeichen (Semikolon, Komma, Tab) und Dezimalkomma erkenne ich selbst. Eine Datei kannst du auch auf diese Fläche ziehen.")));
    var errBox = el("div", { class: "d-daten-error", role: "alert", hidden: true });
    var sum = el("p", { class: "d-daten-summary" });
    var warn = el("ul", { class: "d-daten-warn note" });
    var findList = el("ol", { class: "d-daten-findings" });
    var cards = el("div", { class: "d-daten-cards" });
    var selX = el("select", { class: "select", id: "d-daten-x", onchange: function () { S.x = +selX.value; drawScatter(); } });
    var selY = el("select", { class: "select", id: "d-daten-y", onchange: function () { S.y = +selY.value; drawScatter(); } });
    var bWith = el("button", { type: "button", "aria-pressed": "true", onclick: function () { setHide(false); } }, "Mit Ausreißern");
    var bWithout = el("button", { type: "button", "aria-pressed": "false", onclick: function () { setHide(true); } }, "Ohne Ausreißer");
    var seg = el("div", { class: "seg", role: "group", "aria-label": "Ausreißer-Zeilen in Diagramm und Korrelationen" }, bWith, bWithout);
    var plot = el("div", { class: "d-daten-plot" });
    var cap = el("p", { class: "d-daten-cap" });
    var keyRing = el("span", {}, el("i", { class: "d-daten-key d-daten-key--ring" }), "Ausreißer-Zeile");
    var legend = el("div", { class: "d-daten-legend" },
      el("span", {}, el("i", { class: "d-daten-key d-daten-key--dot" }), "Datenzeile"),
      keyRing,
      el("span", {}, el("i", { class: "d-daten-key d-daten-key--line" }), "Ausgleichsgerade"));
    var heat = el("div", { class: "d-daten-heatwrap" });
    var heatCap = el("p", { class: "note" });
    var btnTable = el("button", { class: "btn btn--sm btn--ghost", type: "button", onclick: function () { S.asTable = !S.asTable; drawHeat(); } }, "Als Tabelle");
    var scaleKey = el("div", { class: "d-daten-scale" },
      el("div", { class: "d-daten-scale-bar" }),
      el("div", { class: "d-daten-scale-x" }, el("span", {}, "−1 gegenläufig"), el("span", {}, "0"), el("span", {}, "+1 gleichläufig")));
    var tip = el("div", { class: "d-daten-tip", role: "tooltip", hidden: true });

    var wrap = el("div", { class: "d-daten", ondragover: onDragOver, ondragleave: onDragLeave, ondrop: onDrop },
      el("div", { class: "demo-bar" },
        el("button", { class: "btn btn--sm btn--primary", type: "button", onclick: loadExample }, "Beispiel laden"),
        btnPaste,
        el("button", { class: "btn btn--sm", type: "button", onclick: function () { fileIn.click(); } }, "CSV-Datei wählen"),
        fileIn, el("span", { class: "spacer" }), srcChip),
      pasteBox, errBox,
      el("div", { class: "d-daten-block" }, sum, warn),
      el("section", { class: "d-daten-block" }, el("h4", { class: "demo-h" }, "Befunde"), findList),
      el("section", { class: "d-daten-block" }, el("h4", { class: "demo-h" }, "Spalten"), cards),
      el("div", { class: "d-daten-two" },
        el("section", { class: "d-daten-panel" },
          el("div", { class: "demo-bar d-daten-head" }, el("h4", { class: "demo-h" }, "Zusammenhang zweier Spalten")),
          el("div", { class: "d-daten-controls" },
            el("label", { class: "field", for: "d-daten-x" }, "Waagerecht (X)", selX),
            el("label", { class: "field", for: "d-daten-y" }, "Senkrecht (Y)", selY), seg),
          plot, cap, legend),
        el("section", { class: "d-daten-panel" },
          el("div", { class: "demo-bar d-daten-head" }, el("h4", { class: "demo-h" }, "Korrelationen"), el("span", { class: "spacer" }), btnTable),
          heat, scaleKey, heatCap)),
      el("p", { class: "note" }, "Alles hier rechnet Code, den ich geschrieben habe, direkt in deinem Browser: Parser, Statistik, Diagramme und die Befunde als feste Regeln. Zur Laufzeit läuft kein Sprachmodell, und deine Daten verlassen den Browser nicht. Ein Zusammenhang ist kein Beleg für eine Ursache. Zeilennummern zählen ab der ersten Datenzeile."),
      tip);
    rootEl.appendChild(wrap);

    /* tooltip: one element, positioned inside the demo */
    function showTip(build, cx, top, bottom) {
      tip.replaceChildren(); build(tip); tip.hidden = false;
      var wr = wrap.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      var x = Math.max(4, Math.min(cx - wr.left - tw / 2, wr.width - tw - 4));
      var y = top - th - 8 < 0 ? bottom - wr.top + 8 : top - wr.top - th - 8;
      tip.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    }
    function hideTip() { tip.hidden = true; }
    function tipTarget(e) { var t = e.target && e.target.closest ? e.target.closest("[data-tip]") : null; return t && wrap.contains(t) ? t : null; }
    function textTip(t) {
      var r = t.getBoundingClientRect(), lines = t.getAttribute("data-tip").split("\n");
      showTip(function (box) { lines.forEach(function (l, i) { box.appendChild(el(i ? "span" : "b", { text: l })); }); }, r.left + r.width / 2, r.top, r.bottom);
    }
    wrap.addEventListener("pointerover", function (e) { var t = tipTarget(e); if (t) textTip(t); });
    wrap.addEventListener("pointerout", function (e) { var t = tipTarget(e); if (t && !t.contains(e.relatedTarget)) hideTip(); });

    /* loading */
    function showError(msg) {
      errBox.replaceChildren(el("strong", {}, "Das konnte ich nicht auswerten. "), msg + (S.prof ? " Die Auswertung unten gehört noch zum vorherigen Datensatz." : ""));
      errBox.hidden = false;
    }
    function load(text, label) {
      var table = parseCSV(text);
      if (table.errors.length) { showError(table.errors[0]); return false; }
      errBox.hidden = true;
      S.table = table; S.prof = profile(table);
      S.x = S.prof.best ? S.prof.best[0] : 0; S.y = S.prof.best ? S.prof.best[1] : Math.min(1, S.prof.numeric.length - 1);
      S.hideOut = false; srcChip.textContent = label;
      renderAll();
      return true;
    }
    function loadExample() { load(example().csv, EXAMPLE_LABEL); }
    function runPaste() { load(ta.value, "Eingefügte CSV"); }
    function togglePaste() {
      pasteBox.hidden = !pasteBox.hidden;
      btnPaste.setAttribute("aria-expanded", String(!pasteBox.hidden));
      if (!pasteBox.hidden) ta.focus();
    }
    function readFile(file) {
      if (file.size > MAX_CHARS) { showError("Die Datei ist größer als 5 MB. Kürze sie auf höchstens " + nf(MAX_ROWS) + " Zeilen."); return; }
      if (reader) reader.abort();
      var retried = false, rd = reader = new FileReader();
      rd.onload = function () {
        var txt = String(rd.result);
        if (!retried && txt.indexOf("\ufffd") !== -1) { retried = true; rd.readAsText(file, "windows-1252"); return; } /* typical Excel export */
        reader = null; load(txt, "Datei: " + file.name);
      };
      rd.onerror = function () { reader = null; showError("Die Datei ließ sich nicht lesen. Versuche es mit Einfügen als Text."); };
      rd.readAsText(file);
    }
    function onDragOver(e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") !== -1) { e.preventDefault(); wrap.classList.add("is-drop"); } }
    function onDragLeave(e) { if (!wrap.contains(e.relatedTarget)) wrap.classList.remove("is-drop"); }
    function onDrop(e) {
      wrap.classList.remove("is-drop");
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) { e.preventDefault(); readFile(f); }
    }
    function setHide(v) {
      S.hideOut = v;
      bWith.setAttribute("aria-pressed", String(!v)); bWithout.setAttribute("aria-pressed", String(v));
      drawScatter(); drawHeat();
    }

    /* rendering */
    function renderAll() {
      var p = S.prof, t = S.table, hasDec = p.numeric.some(function (c) { return c.decimals > 0; });
      sum.textContent = nf(p.nRows) + (p.nRows === 1 ? " Zeile" : " Zeilen") + " · " + p.nCols + (p.nCols === 1 ? " Spalte" : " Spalten") +
        " · Trennzeichen: " + (SEP_NAME[t.separator] || "keines") + (t.decimalComma && hasDec ? ", Dezimalkomma" : "") +
        " · " + (p.missing === 0 ? "keine fehlenden Zellen" : p.missing === 1 ? "1 fehlende Zelle" : nf(p.missing) + " fehlende Zellen");
      warn.replaceChildren.apply(warn, t.warnings.map(function (w) { return el("li", { text: w }); }));
      warn.hidden = !t.warnings.length;
      findList.replaceChildren.apply(findList, findings(t, p).map(function (f) { return el("li", { text: f.text }); }));
      cards.replaceChildren.apply(cards, p.cols.map(card));
      [selX, selY].forEach(function (sel, which) {
        sel.replaceChildren.apply(sel, p.numeric.map(function (c, k) { return el("option", { value: String(k), text: c.name }); }));
        sel.value = String(which ? S.y : S.x); sel.disabled = p.numeric.length < 2;
      });
      seg.hidden = !p.outlierRows.length;
      bWith.setAttribute("aria-pressed", "true"); bWithout.setAttribute("aria-pressed", "false");
      drawScatter(); drawHeat();
    }

    function stat(label, value) { return el("div", {}, el("dt", { text: label }), el("dd", { text: value })); }
    function card(col) {
      var body = [], st = col.stats, d, md, notes = [];
      if (col.type === "zahl") {
        d = col.decimals; md = Math.min(Math.max(d, 1), 2);
        var max = Math.max.apply(null, col.hist.counts), h = col.hist;
        body.push(el("dl", { class: "d-daten-stats" }, stat("Min", nf(st.min, d)), stat("Max", nf(st.max, d)), stat("Median", nf(st.median, md)), stat("Mittel", nf(st.mean, md))));
        body.push(el("div", { class: "d-daten-hist", role: "img", "aria-label": "Verteilung von " + col.name + ", " + h.counts.length + " Klassen" }, h.counts.map(function (cnt, k) {
          var from = h.lo + k * h.step, to = h.lo + (k + 1) * h.step;
          var label = h.step ? nf(from, md) + " bis " + (k === h.counts.length - 1 ? "" : "unter ") + nf(to, md) : nf(from, d);
          return el("div", { class: "d-daten-bin", "data-tip": label + "\n" + cnt + (cnt === 1 ? " Wert" : " Werte") },
            el("div", { class: "d-daten-bar", style: { height: (cnt ? Math.max(4, cnt / max * 100) : 0) + "%" } }));
        })));
        body.push(el("div", { class: "d-daten-hist-x" }, el("span", { text: nf(st.min, d) }), el("span", { text: nf(st.max, d) })));
        if (col.outliers.length) notes.push(col.outliers.length === 1 ? "1 Ausreißer" : col.outliers.length + " Ausreißer");
        if (col.invalid) notes.push(col.invalid + " nicht lesbar");
      } else if (col.type === "kategorie") {
        var top = col.counts.slice(0, 8), most = top[0].count, rest = col.counts.length - top.length;
        body.push(el("ul", { class: "d-daten-meters" }, top.map(function (c) {
          return el("li", {}, el("span", { class: "d-daten-mname", text: c.value }),
            el("span", { class: "d-daten-meter" }, el("span", { style: { width: c.count / most * 100 + "%" } })),
            el("span", { class: "d-daten-count", text: nf(c.count) }));
        })));
        if (rest > 0) notes.push(rest === 1 ? "1 weiterer Wert" : rest + " weitere Werte");
      } else if (col.type === "datum") {
        body.push(el("dl", { class: "d-daten-stats" }, stat("Von", fmtDay(col.min)), stat("Bis", fmtDay(col.max)), stat("Tage", nf(col.distinct)), stat("Spanne", nf(col.max - col.min + 1) + " Tage")));
      } else {
        body.push(el("dl", { class: "d-daten-stats" }, stat("Verschieden", nf(col.distinct)), stat("Gefüllt", nf(col.n))));
        if (col.counts.length) body.push(el("p", { class: "note d-daten-ex", text: "z. B. " + col.counts.slice(0, 3).map(function (c) { return c.value.length > 28 ? c.value.slice(0, 27) + "…" : c.value; }).join(" · ") }));
      }
      notes.unshift(col.missing ? col.missing + " fehlend" : "nichts fehlt");
      return el("article", { class: "d-daten-card" },
        el("header", { class: "d-daten-card-h" }, el("span", { class: "d-daten-name", text: col.name }), el("span", { class: "chip", text: TYPE_NAME[col.type] })),
        body, el("p", { class: "note", text: notes.join(" · ") }));
    }

    function drawScatter() {
      var p = S.prof, numeric = p.numeric;
      hideTip();
      if (numeric.length < 2) {
        plot.replaceChildren(el("p", { class: "note" }, "Für ein Streudiagramm braucht es mindestens zwei Zahlenspalten."));
        cap.textContent = ""; legend.hidden = true; return;
      }
      var cx = numeric[S.x], cy = numeric[S.y], all = [], i;
      for (i = 0; i < p.nRows; i++) {
        if (!Number.isFinite(cx.values[i]) || !Number.isFinite(cy.values[i]) || (S.hideOut && p.isOut[i])) continue;
        all.push({ i: i, x: cx.values[i], y: cy.values[i], o: p.isOut[i] });
      }
      legend.hidden = !all.length;
      if (!all.length) { plot.replaceChildren(el("p", { class: "note" }, "Keine Zeile hat in beiden Spalten einen Wert.")); cap.textContent = ""; return; }
      var fit = linreg(all.map(function (q) { return q.x; }), all.map(function (q) { return q.y; }));
      var pts = all, stepN = all.length / MAX_POINTS;
      if (stepN > 1) pts = all.filter(function (q, k) { return q.o || Math.floor(k / stepN) !== Math.floor((k - 1) / stepN); });
      var xs = pts.map(function (q) { return q.x; }), ys = pts.map(function (q) { return q.y; });
      var w = Math.max(260, Math.floor(plot.clientWidth || 600)), h = Math.round(Math.max(230, Math.min(380, w * 0.62)));
      lastW = Math.floor(plot.clientWidth || 0);
      var sx = niceScale(Math.min.apply(null, xs), Math.max.apply(null, xs), w < 420 ? 4 : 6), sy = niceScale(Math.min.apply(null, ys), Math.max.apply(null, ys), 5);
      var yl = sy.ticks.map(function (t) { return tickLabel(t, sy); });
      var ml = 14 + Math.max.apply(null, yl.map(function (s) { return s.length; })) * 6.4, mr = 18, mt = 30, mb = 44;
      function X(v) { return ml + (v - sx.lo) / (sx.hi - sx.lo) * (w - ml - mr); }
      function Y(v) { return h - mb - (v - sy.lo) / (sy.hi - sy.lo) * (h - mt - mb); }
      var rText = Number.isFinite(fit.r) ? "r = " + nf(fit.r, 2) : "r nicht berechenbar";
      var svg = sv("svg", {
        viewBox: "0 0 " + w + " " + h, width: w, height: h, role: "img", tabindex: "0",
        "aria-label": "Streudiagramm: " + cx.name + " waagerecht, " + cy.name + " senkrecht, " + all.length + " Punkte, " + rText + ". Mit den Pfeiltasten gehst du die Punkte durch."
      });
      sy.ticks.forEach(function (t, k) {
        svg.appendChild(sv("line", { class: "d-daten-grid", x1: ml, x2: w - mr, y1: Y(t), y2: Y(t) }));
        svg.appendChild(sv("text", { class: "d-daten-tick", x: ml - 8, y: Y(t) + 4, "text-anchor": "end" }, yl[k]));
      });
      sx.ticks.forEach(function (t) {
        svg.appendChild(sv("line", { class: "d-daten-grid", x1: X(t), x2: X(t), y1: mt, y2: h - mb }));
        svg.appendChild(sv("text", { class: "d-daten-tick", x: X(t), y: h - mb + 17, "text-anchor": "middle" }, tickLabel(t, sx)));
      });
      svg.appendChild(sv("line", { class: "d-daten-axis", x1: ml, x2: w - mr, y1: h - mb, y2: h - mb }));
      svg.appendChild(sv("line", { class: "d-daten-axis", x1: ml, x2: ml, y1: mt, y2: h - mb }));
      svg.appendChild(sv("text", { class: "d-daten-axt", x: 0, y: 13 }, cy.name));
      svg.appendChild(sv("text", { class: "d-daten-axt", x: w - mr, y: h - 6, "text-anchor": "end" }, cx.name));
      if (Number.isFinite(fit.slope)) {
        svg.appendChild(sv("clipPath", { id: clipId }, sv("rect", { x: ml, y: mt, width: w - ml - mr, height: h - mt - mb })));
        svg.appendChild(sv("line", { class: "d-daten-fit", "clip-path": "url(#" + clipId + ")", x1: X(sx.lo), y1: Y(fit.intercept + fit.slope * sx.lo), x2: X(sx.hi), y2: Y(fit.intercept + fit.slope * sx.hi) }));
      }
      pts.forEach(function (q) { if (!q.o) svg.appendChild(sv("circle", { class: "d-daten-pt", cx: X(q.x), cy: Y(q.y), r: 5 })); });
      pts.forEach(function (q) { /* outlier rows last, so their ring is never buried under other points */
        if (!q.o) return;
        svg.appendChild(sv("circle", { class: "d-daten-ring", cx: X(q.x), cy: Y(q.y), r: 9.5 }));
        svg.appendChild(sv("circle", { class: "d-daten-pt", cx: X(q.x), cy: Y(q.y), r: 5 }));
      });
      keyRing.hidden = !pts.some(function (q) { return q.o; });
      var hov = sv("circle", { class: "d-daten-hover", r: 7.5, visibility: "hidden" });
      svg.appendChild(hov);

      var active = -1, order = pts.map(function (q, k) { return k; }).sort(function (a, b) { return pts[a].x - pts[b].x || pts[a].y - pts[b].y; }), kpos = -1;
      function setActive(idx) {
        if (idx === active) return;
        active = idx;
        if (idx < 0) { hov.setAttribute("visibility", "hidden"); hideTip(); return; }
        var q = pts[idx], r = svg.getBoundingClientRect(), k = r.width / w, px = r.left + X(q.x) * k, py = r.top + Y(q.y) * k;
        hov.setAttribute("cx", X(q.x)); hov.setAttribute("cy", Y(q.y)); hov.setAttribute("visibility", "visible");
        showTip(function (box) { rowTip(box, q, cx, cy); }, px, py - 12, py + 12);
      }
      svg.addEventListener("pointermove", function (e) {
        var r = svg.getBoundingClientRect(), k = w / r.width, mx = (e.clientX - r.left) * k, my = (e.clientY - r.top) * k, best = -1, bd = 18 * 18;
        pts.forEach(function (q, idx) { var dx = X(q.x) - mx, dy = Y(q.y) - my, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = idx; } });
        setActive(best);
      });
      svg.addEventListener("pointerleave", function () { setActive(-1); });
      svg.addEventListener("blur", function () { setActive(-1); });
      svg.addEventListener("keydown", function (e) {
        var n = order.length;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") kpos = (kpos + 1) % n;
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") kpos = (kpos - 1 + n) % n;
        else if (e.key === "Home") kpos = 0;
        else if (e.key === "End") kpos = n - 1;
        else if (e.key === "Escape") { kpos = -1; setActive(-1); return; }
        else return;
        e.preventDefault(); setActive(order[kpos]);
      });
      plot.replaceChildren(svg);

      cap.textContent = rText + " · n = " + nf(fit.n) + (Number.isFinite(fit.r) && fit.n >= 8 ? " · " + fmtP(pCorr(fit.r, fit.n)) : "") +
        (Number.isFinite(fit.slope) ? " · Ausgleichsgerade: " + cy.name + " ≈ " + nfAuto(fit.slope) + " · " + cx.name + (fit.intercept < 0 ? " − " : " + ") + nfAuto(Math.abs(fit.intercept)) : "") +
        (pts.length < all.length ? " · gezeichnet sind " + nf(pts.length) + " von " + nf(all.length) + " Punkten, gerechnet wird mit allen" : "");
    }

    function rowTip(box, q, cx, cy) {
      var p = S.prof, flagged = p.outlierCells.filter(function (o) { return o.row === q.i + 1; }).map(function (o) { return o.col; });
      box.appendChild(el("b", { text: "Zeile " + (q.i + 1) + (flagged.length ? " · Ausreißer in " + flagged.join(", ") : "") }));
      var cols = [cx]; if (cy !== cx) cols.push(cy);
      p.cols.forEach(function (c) { if (cols.indexOf(c) === -1 && cols.length < 8) cols.push(c); });
      box.appendChild(el("dl", {}, cols.map(function (c) { return [el("dt", { text: c.name }), el("dd", { text: c.raw[q.i] === "" ? "–" : c.raw[q.i] })]; })));
    }

    function drawHeat() {
      var p = S.prof, cols = p.numeric.slice(0, MAX_HEAT), k = cols.length, key = S.hideOut ? "clean" : "all";
      btnTable.textContent = S.asTable ? "Als Farbfeld" : "Als Tabelle";
      btnTable.hidden = scaleKey.hidden = k < 2;
      if (k < 2) { heat.replaceChildren(el("p", { class: "note" }, "Für Korrelationen braucht es mindestens zwei Zahlenspalten.")); heatCap.textContent = ""; return; }
      scaleKey.hidden = S.asTable;
      function val(a, b) { return p.corr[a][b][key]; }
      if (S.asTable) {
        heat.replaceChildren(el("table", { class: "d-daten-table" },
          el("thead", {}, el("tr", {}, el("td", {}), cols.map(function (c) { return el("th", { scope: "col", text: c.name }); }))),
          el("tbody", {}, cols.map(function (r, a) {
            return el("tr", {}, el("th", { scope: "row", text: r.name }), cols.map(function (c, b) { return el("td", { text: nf(val(a, b).r, 2) }); }));
          }))));
      } else {
        var grid = el("div", { class: "d-daten-heat", role: "img", "aria-label": "Korrelationen zwischen " + k + " Zahlenspalten als Farbfeld. Die Werte stehen auch in der Tabellenansicht.", style: { gridTemplateColumns: "minmax(4.5rem, max-content) repeat(" + k + ", minmax(52px, 1fr))" } });
        grid.appendChild(el("span", {}));
        cols.forEach(function (c) { grid.appendChild(el("span", { class: "d-daten-hl d-daten-hl--col", text: c.name })); });
        cols.forEach(function (r, a) {
          grid.appendChild(el("span", { class: "d-daten-hl", text: r.name }));
          cols.forEach(function (c, b) {
            var v = val(a, b), abs = Math.abs(v.r), cell;
            if (a === b) cell = el("span", { class: "d-daten-cell is-diag", "data-tip": r.name + "\nmit sich selbst: r = 1" }, "1");
            else if (!Number.isFinite(v.r)) cell = el("span", { class: "d-daten-cell is-diag", "data-tip": r.name + " × " + c.name + "\nnicht berechenbar (Spalte konstant oder zu wenige Werte)" }, "–");
            else cell = el("span", { class: "d-daten-cell is-val " + (v.r >= 0 ? "is-pos" : "is-neg") + (abs >= 0.75 ? " is-strong" : ""), style: "--t:" + Math.round(abs * 100) + "%", "data-tip": r.name + " × " + c.name + "\nr = " + nf(v.r, 2) + ", n = " + nf(v.n) }, nf(v.r, 2));
            grid.appendChild(cell);
          });
        });
        heat.replaceChildren(grid);
        /* text on each cell: whichever of the two ink tokens contrasts more with the measured fill */
        var ink = rgbOf(W.token("--ink")), on = rgbOf(W.token("--accent-ink"));
        if (ink && on) Array.prototype.forEach.call(grid.querySelectorAll(".is-val"), function (cell) {
          var bg = rgbOf(getComputedStyle(cell).backgroundColor);
          if (bg) cell.classList.toggle("is-strong", contrast(bg, on) > contrast(bg, ink));
        });
      }
      heatCap.textContent = (S.hideOut && p.outlierRows.length ? "Gerechnet ohne die " + (p.outlierRows.length === 1 ? "Ausreißer-Zeile" : p.outlierRows.length + " Ausreißer-Zeilen") + ". " : "") +
        "Pearson-Korrelation r je Spaltenpaar" + (p.numeric.length > MAX_HEAT ? ", die ersten " + MAX_HEAT + " von " + p.numeric.length + " Zahlenspalten" : "") + ".";
    }

    var offTheme = W.onTheme(function () { if (S.prof) drawHeat(); });
    if (root.ResizeObserver) {
      ro = new ResizeObserver(function () {
        var w = Math.floor(plot.clientWidth);
        if (!S.prof || Math.abs(w - lastW) < 2) return;
        root.cancelAnimationFrame(raf); raf = root.requestAnimationFrame(drawScatter);
      });
      ro.observe(plot);
    }
    loadExample();

    return {
      destroy: function () {
        if (ro) ro.disconnect();
        offTheme();
        root.cancelAnimationFrame(raf);
        if (reader) { try { reader.abort(); } catch (e) { /* already done */ } reader = null; }
        wrap.remove();
      }
    };
  }

  W.daten = { parseCSV: parseCSV, profile: profile, pearson: pearson, linreg: linreg, outliers: outliers, findings: findings, example: example, describe: describe, pCorr: pCorr, pF: pF };

  W.register("daten", {
    title: "Datenblick",
    kind: "Datenanalyse im Browser",
    lead: "Ich habe einen CSV-Parser, die Statistik und die Diagramme von Hand geschrieben. Lade das Beispiel oder füge eine eigene CSV ein: Du bekommst Kennzahlen, Ausreißer, Zusammenhänge und Befunde in ganzen Sätzen.",
    facts: [
      "0 Bibliotheken: Parser, Statistik und SVG-Diagramme sind selbst geschrieben",
      "Ausreißer per modifiziertem z-Wert, p-Werte über die unvollständige Betafunktion",
      "Kein Sprachmodell zur Laufzeit, die Befunde sind feste Regeln"
    ],
    moral: "Erst die Daten prüfen, dann den Zahlen glauben: Wenige falsche Werte reichen, um einen Zusammenhang zu verzerren.",
    mount: mount
  });
})();
