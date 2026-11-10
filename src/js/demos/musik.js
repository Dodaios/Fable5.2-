/* Taktwerk: a 16-step sequencer. Every sound is synthesized with Web Audio.
   Rhythms come from Bjorklund's Euclidean algorithm, the melody from a seeded,
   constrained random walk. The pure parts (euclid, generate, stepTime, scaleNotes)
   touch neither DOM nor audio, so they also run under node for the tests. */
(function () {
  "use strict";
  var root = typeof window !== "undefined" ? window : globalThis;
  var W = root.Werkschau;

  var STEPS = 16;
  var LEAD_ROWS = 7;
  var CHORD_ROWS = [0, 3, 5];            // root, fifth, octave: chord tones in both scales
  var FIRST_SEED = 21;
  var TICK_MS = 25;
  var LOOKAHEAD = 0.1;

  var SCALES = {
    moll: { label: "Moll-Pentatonik", steps: [0, 3, 5, 7, 10], names: ["C", "Des", "D", "Es", "E", "F", "Ges", "G", "As", "A", "B", "H"] },
    dur: { label: "Dur-Pentatonik", steps: [0, 2, 4, 7, 9], names: ["C", "Cis", "D", "Dis", "E", "F", "Fis", "G", "Gis", "A", "Ais", "H"] }
  };
  var ROOTS = {
    C: { lead: 60, bass: 36 }, D: { lead: 62, bass: 38 }, E: { lead: 64, bass: 40 },
    F: { lead: 65, bass: 41 }, G: { lead: 55, bass: 43 }, A: { lead: 57, bass: 45 }
  };

  /* ---------------------------------------------------------------- pure logic */

  /* Bjorklund: k onsets spread as evenly as possible over n steps. A positive
     rotation moves the whole pattern later by that many steps. */
  function euclid(k, n, rotation) {
    n = Math.max(0, Math.floor(n) || 0);
    k = Math.max(0, Math.min(n, Math.floor(k) || 0));
    var flat = [], i;
    if (k === 0 || k === n) {
      for (i = 0; i < n; i++) flat.push(k === 0 ? 0 : 1);
    } else {
      var a = [], b = [];
      for (i = 0; i < k; i++) a.push([1]);
      for (i = 0; i < n - k; i++) b.push([0]);
      while (b.length > 1) {
        var m = Math.min(a.length, b.length), paired = [];
        for (i = 0; i < m; i++) paired.push(a[i].concat(b[i]));
        b = a.length > m ? a.slice(m) : b.slice(m);
        a = paired;
      }
      a.concat(b).forEach(function (group) { flat = flat.concat(group); });
    }
    var r = n ? (((Math.floor(rotation) || 0) % n) + n) % n : 0;
    if (!r) return flat;
    var out = new Array(n);
    for (i = 0; i < n; i++) out[(i + r) % n] = flat[i];
    return out;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function nearestChordRow(row) {
    var best = CHORD_ROWS[0];
    CHORD_ROWS.forEach(function (c) { if (Math.abs(c - row) < Math.abs(best - row)) best = c; });
    return best;
  }

  /* One complete idea for a seed. Same seed and options, same pattern.
     opts.density (0..1, default 0.5) thins out or fills up the melody. */
  function generate(seed, opts) {
    opts = opts || {};
    var density = clamp(opts.density == null ? 0.5 : Number(opts.density) || 0, 0, 1);
    var rnd = mulberry32(seed);
    var pick = function (list) { return list[Math.floor(rnd() * list.length)]; };
    var i;

    var kickK = pick([3, 4, 4, 4, 5, 5]);
    var snareK = pick([2, 2, 2, 3]);
    var hat = pick([[8, 0], [8, 0], [4, 2], [6, 0], [10, 0], [12, 0]]);
    var bassK = pick([4, 5, 6, 6, 7]);

    var bassHits = euclid(bassK, STEPS, 0), bass = [];
    for (i = 0; i < STEPS; i++) {
      if (!bassHits[i]) { bass.push(-1); continue; }
      var p = rnd();
      if (i === 0) bass.push(0);
      else if (i % 4 === 2 && p < 0.45) bass.push(2);
      else bass.push(p < 0.6 ? 0 : p < 0.85 ? 1 : 2);
    }

    /* Melody: an eight-step motif walks through the scale in small steps, the
       second half repeats it with a variation and resolves onto a chord tone. */
    var half = STEPS / 2;
    var hits = clamp(4 + Math.round(density * 2) + pick([-1, 0, 0, 1]), 2, 7);
    var rhythm = euclid(hits, half, pick([0, 0, 1]));
    var lead = [], row = pick([3, 3, 5, 0]), prev = -1, repeats = 0, first = true;
    for (i = 0; i < half; i++) {
      if (!rhythm[i]) { lead.push(-1); continue; }
      if (!first) {
        var delta = pick([-2, -1, -1, 1, 1, 2, 0]);
        if (delta === 0 && repeats >= 1) delta = rnd() < 0.5 ? -1 : 1;
        row = clamp(row + delta, 0, LEAD_ROWS - 1);
      }
      first = false;
      repeats = row === prev ? repeats + 1 : 0;
      prev = row;
      lead.push(row);
    }
    lead = lead.concat(lead);
    var second = [];
    for (i = half; i < STEPS; i++) if (lead[i] >= 0) second.push(i);
    var changes = pick([1, 2, 2]);
    for (i = 0; i < changes && second.length > 1; i++) {
      var at = second[1 + Math.floor(rnd() * (second.length - 1))];
      lead[at] = clamp(lead[at] + pick([-1, 1, 2]), 0, LEAD_ROWS - 1);
    }
    if (second.length > 3 && rnd() < 0.35) lead[second[1 + Math.floor(rnd() * (second.length - 2))]] = -1;
    var last = second[second.length - 1];
    lead[last] = nearestChordRow(lead[last]);

    var notes = 0;
    for (i = 0; i < STEPS; i++) if (lead[i] >= 0) notes++;
    return {
      seed: seed >>> 0,
      kick: euclid(kickK, STEPS, 0),
      snare: euclid(snareK, STEPS, 4),
      hat: euclid(hat[0], STEPS, hat[1]),
      bass: bass,
      lead: lead,
      recipe: { kick: [kickK, 0], snare: [snareK, 4], hat: hat.slice(), bass: [bassK, 0], notes: notes }
    };
  }

  /* How far an off-beat sixteenth is pushed back. swing is a fraction (0..0.6);
     at 0.6 the pair is close to a triplet feel. */
  function swingOffset(stepIndex, bpm, swing) {
    return stepIndex % 2 ? clamp(swing || 0, 0, 0.6) * 0.5 * (15 / bpm) : 0;
  }

  /* Seconds from the first step to step stepIndex (sixteenth notes). */
  function stepTime(stepIndex, bpm, swing) {
    return stepIndex * (15 / bpm) + swingOffset(stepIndex, bpm, swing);
  }

  function midiFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
  function scaleOf(name) { return /dur/i.test(String(name)) ? SCALES.dur : SCALES.moll; }
  function noteName(midi, names) { return names[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1); }

  /* The seven melody rows, lowest first: a pentatonic scale over about 1.5 octaves. */
  function scaleNotes(rootName, scaleName) {
    var scale = scaleOf(scaleName), base = (ROOTS[rootName] || ROOTS.C).lead, out = [];
    for (var i = 0; i < LEAD_ROWS; i++) {
      var semitone = scale.steps[i % 5] + 12 * Math.floor(i / 5);
      out.push({ row: i, semitone: semitone, midi: base + semitone, freq: midiFreq(base + semitone), name: noteName(base + semitone, scale.names) });
    }
    return out;
  }

  function bassNotes(rootName, scaleName) {
    var scale = scaleOf(scaleName), base = (ROOTS[rootName] || ROOTS.C).bass;
    return [0, 7, 12].map(function (s) { return { midi: base + s, freq: midiFreq(base + s), name: noteName(base + s, scale.names) }; });
  }

  W.musik = { euclid: euclid, generate: generate, stepTime: stepTime, scaleNotes: scaleNotes };

  /* -------------------------------------------------------------- sound engine */

  function createEngine(AC) {
    var ctx = new AC();
    var master = ctx.createGain();
    master.gain.value = 0;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5;
    comp.attack.value = 0.004; comp.release.value = 0.18;
    var analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    master.connect(comp); comp.connect(analyser); analyser.connect(ctx.destination);

    var leadBus = ctx.createGain();
    var delay = ctx.createDelay(1.5), damp = ctx.createBiquadFilter(), feedback = ctx.createGain(), wet = ctx.createGain();
    damp.type = "lowpass"; damp.frequency.value = 2400;
    feedback.gain.value = 0.3; wet.gain.value = 0.2;
    leadBus.connect(master); leadBus.connect(delay);
    delay.connect(damp); damp.connect(feedback); feedback.connect(delay); damp.connect(wet); wet.connect(master);

    var noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), data = noise.getChannelData(0);
    for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    function shape(param, t, peak, attack, decay) {
      param.setValueAtTime(0.0001, t);
      param.exponentialRampToValueAtTime(peak, t + attack);
      param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }
    function burst(t, type, freq, q, peak, decay) {
      var src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      src.buffer = noise; filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
      shape(gain.gain, t, peak, 0.002, decay);
      src.connect(filter); filter.connect(gain); gain.connect(master);
      src.start(t, Math.random() * 0.5); src.stop(t + decay + 0.05);
    }

    return {
      ctx: ctx,
      analyser: analyser,
      kick: function (t) {
        var osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.frequency.setValueAtTime(155, t);
        osc.frequency.exponentialRampToValueAtTime(46, t + 0.11);
        shape(gain.gain, t, 0.95, 0.004, 0.33);
        osc.connect(gain); gain.connect(master);
        osc.start(t); osc.stop(t + 0.4);
      },
      snare: function (t) {
        burst(t, "bandpass", 1900, 0.8, 0.55, 0.17);
        var osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(205, t);
        osc.frequency.exponentialRampToValueAtTime(150, t + 0.08);
        shape(gain.gain, t, 0.34, 0.002, 0.09);
        osc.connect(gain); gain.connect(master);
        osc.start(t); osc.stop(t + 0.14);
      },
      hat: function (t, velocity) { burst(t, "highpass", 7500, 0.7, 0.22 * velocity, 0.04); },
      bass: function (t, freq, dur) {
        var osc = ctx.createOscillator(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
        osc.type = "sawtooth"; osc.frequency.value = freq;
        filter.type = "lowpass"; filter.Q.value = 5;
        filter.frequency.setValueAtTime(1100, t);
        filter.frequency.exponentialRampToValueAtTime(220, t + 0.16);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.42, t + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.3, t + dur);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.07);
        osc.connect(filter); filter.connect(gain); gain.connect(master);
        osc.start(t); osc.stop(t + dur + 0.1);
      },
      lead: function (t, freq, dur) {
        var body = ctx.createOscillator(), edge = ctx.createOscillator(), edgeGain = ctx.createGain();
        var filter = ctx.createBiquadFilter(), gain = ctx.createGain();
        body.type = "triangle"; body.frequency.value = freq;
        edge.type = "sawtooth"; edge.frequency.value = freq; edge.detune.value = 7; edgeGain.gain.value = 0.22;
        filter.type = "lowpass"; filter.frequency.value = 3000;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.26, t + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.15, t + dur);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.14);
        body.connect(filter); edge.connect(edgeGain); edgeGain.connect(filter); filter.connect(gain); gain.connect(leadBus);
        body.start(t); edge.start(t); body.stop(t + dur + 0.18); edge.stop(t + dur + 0.18);
      },
      /* Echo length follows the tempo: three sixteenths. */
      tempo: function (bpm) { delay.delayTime.setTargetAtTime(3 * 15 / bpm, ctx.currentTime, 0.05); },
      level: function (volume) {
        var now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setTargetAtTime(volume * 0.9, now, 0.015);
        feedback.gain.cancelScheduledValues(now);
        feedback.gain.setTargetAtTime(0.3, now, 0.015);
      },
      /* Cut what is still scheduled and the echo tail, then reopen for single notes. */
      hush: function (volume) {
        var now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setTargetAtTime(0, now, 0.012);
        master.gain.setTargetAtTime(volume * 0.9, now + 0.9, 0.02);
        feedback.gain.cancelScheduledValues(now);
        feedback.gain.setTargetAtTime(0, now, 0.012);
        feedback.gain.setTargetAtTime(0.3, now + 0.9, 0.02);
      }
    };
  }

  /* ------------------------------------------------------------------- the UI */

  var ICON_PLAY = '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M1.5 0.5l7.5 4.5-7.5 4.5z" fill="currentColor"/></svg>';
  var ICON_STOP = '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><rect x="1" y="1" width="8" height="8" fill="currentColor"/></svg>';

  function mount(rootEl) {
    var el = W.el;
    var AC = root.AudioContext || root.webkitAudioContext;
    var st = { bpm: 104, swing: 0.18, key: "C", scale: "moll", vol: 0.7 };
    var pattern = generate(FIRST_SEED), origin = "idea";      // idea | edited | empty | own
    var notes = scaleNotes(st.key, st.scale), lows = bassNotes(st.key, st.scale);
    var engine = null, playing = false, destroyed = false;
    var timer = 0, raf = 0, queue = [], nextStep = 0, gridTime = 0, shown = -1;
    var colors = {}, scopeDpr = 1, scopeBuf = null;

    var rows = [], i;
    for (i = LEAD_ROWS - 1; i >= 0; i--) rows.push({ track: "lead", v: i, group: "Melodie" });
    [2, 1, 0].forEach(function (v) { rows.push({ track: "bass", v: v, group: "Bass" }); });
    rows.push({ track: "hat", label: "Hi-Hat", group: "Schlagzeug" }, { track: "snare", label: "Snare", group: "Schlagzeug" }, { track: "kick", label: "Kick", group: "Schlagzeug" });

    function column(step) { return String(2 + step + Math.floor(step / 4)); }
    function rowName(row) { return row.track === "lead" ? notes[row.v].name : row.track === "bass" ? lows[row.v].name : row.label; }
    function rowSpoken(row) { return row.track === "lead" ? "Melodie " + notes[row.v].name : row.track === "bass" ? "Bass " + lows[row.v].name : row.label; }
    function isOn(row, step) { return row.v == null ? pattern[row.track][step] === 1 : pattern[row.track][step] === row.v; }

    /* ---- controls */
    var startBtn = el("button", { type: "button", class: "btn btn--primary d-musik-start", id: "d-musik-start", onclick: function () { if (playing) stop(); else start(); } });
    var ideaBtn = el("button", { type: "button", class: "btn btn--sun", id: "d-musik-idea", onclick: newIdea }, "Neue Idee");
    var clearBtn = el("button", { type: "button", class: "btn btn--ghost", id: "d-musik-clear", onclick: clearAll }, "Leeren");
    var chip = el("span", { class: "chip d-musik-chip" });
    var status = el("p", { class: "note d-musik-status", role: "status", hidden: true });

    function slider(id, label, min, max, value, show, onInput) {
      var out = el("output", { for: id }, show(value));
      var input = el("input", {
        type: "range", id: id, min: min, max: max, step: 1, value: value,
        oninput: function () { out.textContent = show(+input.value); onInput(+input.value); }
      });
      return el("label", { class: "field" }, el("span", { class: "field-row" }, el("span", null, label), out), input);
    }
    function chooser(id, label, options, value, onChange) {
      var select = el("select", { class: "select", id: id, onchange: function () { onChange(select.value); } },
        options.map(function (o) { return el("option", { value: o[0], selected: o[0] === value }, o[1]); }));
      return el("label", { class: "field" }, label, select);
    }
    var tempoField = slider("d-musik-tempo", "Tempo", 70, 160, st.bpm, function (v) { return v + " BPM"; }, function (v) { st.bpm = v; if (engine) engine.tempo(v); });
    var swingField = slider("d-musik-swing", "Swing", 0, 60, Math.round(st.swing * 100), function (v) { return v + " %"; }, function (v) { st.swing = v / 100; });
    var volField = slider("d-musik-vol", "Lautstärke", 0, 100, Math.round(st.vol * 100), function (v) { return v + " %"; }, function (v) { st.vol = v / 100; if (engine) engine.level(st.vol); });
    var keyField = chooser("d-musik-key", "Tonart", Object.keys(ROOTS).map(function (k) { return [k, k]; }), st.key, function (v) { st.key = v; retune(); });
    var scaleField = chooser("d-musik-scale", "Skala", [["moll", SCALES.moll.label], ["dur", SCALES.dur.label]], st.scale, function (v) { st.scale = v; retune(); });

    /* ---- grid */
    var grid = el("div", { class: "d-musik-grid", role: "group", "aria-label": "Schrittraster: 13 Spuren mit je 16 Schritten" });
    var lampRow = el("div", { class: "d-musik-row d-musik-lamps", "aria-hidden": "true" }, el("span", { class: "d-musik-label" }));
    var lamps = [], cells = [], labels = [], cols = [];
    for (i = 0; i < STEPS; i++) {
      lamps.push(el("span", { class: "d-musik-lamp", style: { gridColumn: column(i) } }, i % 4 === 0 ? String(i / 4 + 1) : null));
      lampRow.appendChild(lamps[i]);
      cols.push([lamps[i]]);
    }
    grid.appendChild(lampRow);
    rows.forEach(function (row, r) {
      if (r === 0 || rows[r - 1].group !== row.group) grid.appendChild(el("p", { class: "demo-h d-musik-group" }, row.group));
      var label = el("span", { class: "d-musik-label" });
      var line = el("div", { class: "d-musik-row" }, label);
      labels.push(label);
      cells.push([]);
      for (var s = 0; s < STEPS; s++) {
        var cell = el("button", {
          type: "button", class: "d-musik-cell d-musik-cell--" + row.track,
          "aria-pressed": "false", tabindex: r === 0 && s === 0 ? "0" : "-1",
          "data-r": r, "data-s": s, style: { gridColumn: column(s) }
        });
        cells[r].push(cell);
        cols[s].push(cell);
        line.appendChild(cell);
      }
      grid.appendChild(line);
    });

    function refreshCell(r, s) { cells[r][s].setAttribute("aria-pressed", isOn(rows[r], s) ? "true" : "false"); }
    function refreshAll() { for (var r = 0; r < rows.length; r++) for (var s = 0; s < STEPS; s++) refreshCell(r, s); }
    function refreshNames() {
      rows.forEach(function (row, r) {
        labels[r].textContent = rowName(row);
        for (var s = 0; s < STEPS; s++) cells[r][s].setAttribute("aria-label", rowSpoken(row) + ", Schritt " + (s + 1));
      });
    }
    function retune() {
      notes = scaleNotes(st.key, st.scale);
      lows = bassNotes(st.key, st.scale);
      refreshNames();
    }

    /* ---- recipe of the current idea */
    var recipe = el("dl", { class: "kv d-musik-recipe" });
    var recipeNote = el("p", { class: "note" }, "E(k, 16) verteilt k Schläge so gleichmäßig wie möglich auf 16 Schritte.");
    function formula(pair) { return "E(" + pair[0] + ", 16)" + (pair[1] ? ", um " + pair[1] + " versetzt" : ""); }
    function refreshIdea() {
      var byHand = origin === "empty" || origin === "own";
      chip.textContent = origin === "empty" ? "Leeres Raster" : origin === "own" ? "Eigenes Muster"
        : "Idee Nr. " + pattern.seed + (origin === "edited" ? ", bearbeitet" : "");
      recipe.textContent = "";
      recipeNote.hidden = byHand;
      var rc = pattern.recipe;
      var lines = byHand ? [["Raster", origin === "empty" ? "leer" : "von Hand gesetzt"]] : [
        ["Kick", formula(rc.kick)], ["Snare", formula(rc.snare)], ["Hi-Hat", formula(rc.hat)],
        ["Bass", formula(rc.bass)], ["Melodie", rc.notes + " Töne"]
      ];
      lines.forEach(function (pair) { recipe.appendChild(el("dt", null, pair[0])); recipe.appendChild(el("dd", null, pair[1])); });
    }

    function sameIdea(a, b) {
      return ["kick", "snare", "hat", "bass", "lead"].every(function (k) { return a[k].join() === b[k].join(); });
    }
    function newIdea() {
      var next;
      do { next = generate(1 + Math.floor(Math.random() * 9999)); } while (sameIdea(next, pattern));
      pattern = next; origin = "idea";
      refreshAll(); refreshIdea();
    }
    function clearAll() {
      for (var s = 0; s < STEPS; s++) { pattern.kick[s] = pattern.snare[s] = pattern.hat[s] = 0; pattern.bass[s] = pattern.lead[s] = -1; }
      origin = "empty";
      refreshAll(); refreshIdea();
    }

    function toggle(r, s) {
      var row = rows[r], on = isOn(row, s);
      if (row.v == null) {
        pattern[row.track][s] = on ? 0 : 1;
        refreshCell(r, s);
      } else {
        pattern[row.track][s] = on ? -1 : row.v;    // one note per step: another row moves it
        rows.forEach(function (other, k) { if (other.track === row.track) refreshCell(k, s); });
      }
      origin = origin === "idea" || origin === "edited" ? "edited" : "own";
      refreshIdea();
      if (!on) audition(row);
    }

    /* A single note for a field that was just switched on. Only once the viewer has started audio. */
    function audition(row) {
      if (!engine || playing || engine.ctx.state !== "running") return;
      var t = engine.ctx.currentTime + 0.01;
      engine.level(st.vol);
      if (row.track === "kick") engine.kick(t);
      else if (row.track === "snare") engine.snare(t);
      else if (row.track === "hat") engine.hat(t, 1);
      else if (row.track === "bass") engine.bass(t, lows[row.v].freq, 0.16);
      else engine.lead(t, notes[row.v].freq, 0.2);
    }

    function focusCell(r, s) {
      var active = grid.querySelector('.d-musik-cell[tabindex="0"]');
      if (active) active.setAttribute("tabindex", "-1");
      cells[r][s].setAttribute("tabindex", "0");
      return cells[r][s];
    }
    grid.addEventListener("click", function (e) {
      var cell = e.target.closest(".d-musik-cell");
      if (!cell) return;
      focusCell(+cell.getAttribute("data-r"), +cell.getAttribute("data-s"));
      toggle(+cell.getAttribute("data-r"), +cell.getAttribute("data-s"));
    });
    grid.addEventListener("keydown", function (e) {
      var cell = e.target.closest(".d-musik-cell");
      if (!cell) return;
      var r = +cell.getAttribute("data-r"), s = +cell.getAttribute("data-s");
      if (e.key === "ArrowRight") s = (s + 1) % STEPS;
      else if (e.key === "ArrowLeft") s = (s + STEPS - 1) % STEPS;
      else if (e.key === "ArrowDown") r = Math.min(rows.length - 1, r + 1);
      else if (e.key === "ArrowUp") r = Math.max(0, r - 1);
      else if (e.key === "Home") s = 0;
      else if (e.key === "End") s = STEPS - 1;
      else return;
      e.preventDefault();
      focusCell(r, s).focus();
    });

    /* ---- transport */
    function say(text) { status.textContent = text; status.hidden = !text; }
    function syncButton() {
      startBtn.innerHTML = (playing ? ICON_STOP : ICON_PLAY) + "<span>" + (playing ? "Stopp" : "Start") + "</span>";
    }
    function showStep(step) {
      if (step === shown) return;
      if (shown >= 0) cols[shown].forEach(function (node) { node.classList.remove("is-now"); });
      if (step >= 0) cols[step].forEach(function (node) { node.classList.add("is-now"); });
      shown = step;
    }

    function playStep(step, t, dur) {
      if (pattern.kick[step]) engine.kick(t);
      if (pattern.snare[step]) engine.snare(t);
      if (pattern.hat[step]) engine.hat(t, step % 4 === 0 ? 1 : step % 2 === 0 ? 0.75 : 0.5);
      if (pattern.bass[step] >= 0) engine.bass(t, lows[pattern.bass[step]].freq, dur * 0.9);
      if (pattern.lead[step] >= 0) {
        var tied = pattern.lead[(step + 1) % STEPS] < 0;    // ring out into a following rest
        engine.lead(t, notes[pattern.lead[step]].freq, dur * (tied ? 1.8 : 0.95));
      }
    }

    /* Lookahead scheduler: the timer only decides WHAT to queue, the audio clock decides WHEN it sounds. */
    function tick() {
      if (!playing) return;
      var now = engine.ctx.currentTime, horizon = now + LOOKAHEAD;
      if (gridTime < now - 0.2) gridTime = now + 0.05;       // the tab stalled: catch up without a burst
      for (;;) {
        var dur = 15 / st.bpm;
        var t = gridTime + swingOffset(nextStep, st.bpm, st.swing);
        if (t >= horizon) break;
        playStep(nextStep % STEPS, t, dur);
        queue.push({ step: nextStep % STEPS, time: t });
        gridTime += dur;
        nextStep++;
      }
    }

    function frame() {
      if (!playing) return;
      raf = requestAnimationFrame(frame);
      var ctx = engine.ctx, lag = ctx.outputLatency || ctx.baseLatency || 0;
      var heard = ctx.currentTime - (isFinite(lag) ? Math.min(lag, 0.2) : 0);
      while (queue.length > 1 && queue[1].time <= heard) queue.shift();
      showStep(queue.length && queue[0].time <= heard ? queue[0].step : shown);
      if (!W.reducedMotion()) drawScope(false);
    }

    function start() {
      if (!AC || playing || destroyed) return;
      if (!engine) {
        try { engine = createEngine(AC); }
        catch (err) { engine = null; say("Der Ton ließ sich nicht starten. Lade die Seite neu und versuch es noch einmal."); return; }
      }
      var ctx = engine.ctx;
      var go = function () {
        if (destroyed || playing) return;
        if (ctx.state !== "running") { say("Der Browser gibt den Ton noch nicht frei. Klick noch einmal auf Start."); return; }
        say("");
        playing = true;
        engine.level(st.vol);
        engine.tempo(st.bpm);
        queue = []; nextStep = 0; gridTime = ctx.currentTime + 0.06;
        tick();
        timer = setInterval(tick, TICK_MS);
        raf = requestAnimationFrame(frame);
        syncButton();
      };
      if (ctx.state === "running") go();
      else ctx.resume().then(go, function () { say("Der Browser gibt den Ton noch nicht frei. Klick noch einmal auf Start."); });
    }

    function stop() {
      if (!playing) return;
      playing = false;
      clearInterval(timer);
      cancelAnimationFrame(raf);
      queue = [];
      showStep(-1);
      engine.hush(st.vol);
      drawScope(true);
      syncButton();
    }

    /* ---- oscilloscope */
    var scope = el("canvas", { role: "img", "aria-label": "Oszilloskop des Ausgangssignals" });
    var scopeBox = el("div", { class: "demo-canvas d-musik-scope" }, scope);
    var pen = scope.getContext("2d");
    function readColors() { colors.line = W.token("--line-strong"); colors.wave = W.token("--accent"); }
    function sizeScope() {
      var width = scopeBox.clientWidth || 260;
      scopeDpr = W.fitCanvas(scope, width, 64);
      drawScope(!playing);
    }
    function drawScope(idle) {
      if (!pen) return;
      var w = scope.width, h = scope.height;
      pen.clearRect(0, 0, w, h);
      pen.lineWidth = scopeDpr; pen.strokeStyle = colors.line;
      pen.beginPath(); pen.moveTo(0, h / 2); pen.lineTo(w, h / 2); pen.stroke();
      if (idle || !engine) return;
      if (!scopeBuf) scopeBuf = new Uint8Array(engine.analyser.fftSize);
      engine.analyser.getByteTimeDomainData(scopeBuf);
      pen.lineWidth = 2 * scopeDpr; pen.lineJoin = "round"; pen.strokeStyle = colors.wave;
      pen.beginPath();
      for (var k = 0; k < scopeBuf.length; k++) {
        var x = (k / (scopeBuf.length - 1)) * w, y = h / 2 - ((scopeBuf[k] - 128) / 128) * h * 0.47;
        if (k) pen.lineTo(x, y); else pen.moveTo(x, y);
      }
      pen.stroke();
    }

    /* ---- assemble */
    var wrap = el("div", { class: "d-musik" },
      el("div", { class: "demo-grid" },
        el("div", { class: "d-musik-main" },
          el("div", { class: "demo-bar" }, startBtn, ideaBtn, clearBtn, el("span", { class: "spacer" }), chip),
          status,
          grid,
          el("p", { class: "note" }, "Tastatur: Die Pfeiltasten wandern durchs Raster, Leertaste oder Enter schaltet ein Feld. Liegt der Fokus auf einem Regler, startet und stoppt die Leertaste.")
        ),
        el("div", { class: "demo-side" },
          el("div", { class: "d-musik-block" }, el("p", { class: "demo-h" }, "Signal"), scopeBox),
          tempoField, swingField,
          el("div", { class: "d-musik-pair" }, keyField, scaleField),
          volField,
          el("div", { class: "d-musik-block" },
            el("p", { class: "demo-h" }, "Rezept dieser Idee"),
            recipe,
            recipeNote)
        )
      )
    );
    rootEl.appendChild(wrap);

    function onKey(e) {
      if (e.key !== " " && e.code !== "Space") return;
      if (e.target.closest("button, select, textarea, input:not([type=range])")) return;   // native behaviour wins
      e.preventDefault();
      if (playing) stop(); else start();
    }
    function onHidden() { if (document.hidden) stop(); }
    wrap.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onHidden);
    var offVisible = W.visible(wrap, function (inView) { if (!inView) stop(); });
    var offTheme = W.onTheme(function () { readColors(); drawScope(!playing); });
    var resizer = root.ResizeObserver ? new ResizeObserver(sizeScope) : null;
    if (resizer) resizer.observe(scopeBox);

    readColors();
    refreshAll(); refreshNames(); refreshIdea(); syncButton(); sizeScope();
    if (!AC) {
      startBtn.disabled = true;
      say("Dieser Browser kann kein Web Audio. Das Raster lässt sich trotzdem bearbeiten, nur hören kannst du es hier nicht.");
    }

    return {
      /* For tests: where the transport is and whether a signal arrives. */
      state: function () {
        var peak = 0;
        if (engine && engine.ctx.state === "running") {
          var buf = new Uint8Array(engine.analyser.fftSize);
          engine.analyser.getByteTimeDomainData(buf);
          for (var k = 0; k < buf.length; k++) peak = Math.max(peak, Math.abs(buf[k] - 128) / 128);
        }
        return { playing: playing, step: shown, context: engine ? engine.ctx.state : null, peak: peak };
      },
      destroy: function () {
        stop();
        destroyed = true;
        clearInterval(timer);
        cancelAnimationFrame(raf);
        wrap.removeEventListener("keydown", onKey);
        document.removeEventListener("visibilitychange", onHidden);
        offVisible(); offTheme();
        if (resizer) resizer.disconnect();
        if (engine && engine.ctx.state !== "closed") { try { engine.ctx.close().catch(function () {}); } catch (err) { /* already gone */ } }
        rootEl.textContent = "";
      }
    };
  }

  W.register("musik", {
    title: "Taktwerk",
    kind: "Klang · Echtzeit",
    lead: "Ich habe ein kleines Tonstudio gebaut: Schlagzeug, Bass und Melodie laufen über 16 Schritte, und jeder Klang entsteht live aus Oszillatoren und Rauschen. Drück Start, schalte Felder um oder lass mich mit „Neue Idee“ ein neues Muster komponieren.",
    facts: [
      "alle Klänge im Browser synthetisiert, keine Samples",
      "Timer alle 25 ms plant 100 ms voraus, die Audio-Uhr bestimmt den Einsatz",
      "Rhythmen nach Bjorklunds euklidischem Algorithmus"
    ],
    moral: "Regeln liefern den Takt, ob es groovt, entscheidet dein Ohr.",
    mount: mount
  });
})();
