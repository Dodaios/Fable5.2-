/* Kompass: four questions, one recommendation. The rule itself lives in data.js (Werkschau.kompass.empfehle). */
(function () {
  "use strict";
  var W = window.Werkschau, el = W.el;

  W.initKompass = function () {
    var form = document.getElementById("kompass-q"), out = document.getElementById("kompass-a");
    if (!form || !out) return;
    var K = W.kompass, answers = Object.assign({}, K.start);

    K.fragen.forEach(function (q) {
      var opts = el("div", { class: "opts" });
      q.optionen.forEach(function (o) {
        var input = el("input", { type: "radio", name: "k-" + q.id, id: "k-" + q.id + "-" + o.v, value: o.v });
        if (answers[q.id] === o.v) input.checked = true;
        input.addEventListener("change", function () { answers[q.id] = o.v; render(); });
        opts.appendChild(el("label", { class: "opt", for: input.id }, input, el("span", null, el("b", { text: o.titel + ". " }), o.text)));
      });
      form.appendChild(el("fieldset", null, el("legend", { text: q.frage }), opts));
    });

    function render() {
      var r = K.empfehle(answers), m = W.models[r.model];
      out.textContent = "";
      out.appendChild(el("span", { class: "k-label", text: "Meine Empfehlung" }));
      out.appendChild(el("div", { class: "k-model", text: m.name }));
      out.appendChild(el("div", { class: "k-meta" },
        el("span", { text: "Denkstufe " + r.effort }),
        el("span", { text: "$" + String(m.inP).replace(".", ",") + " · $" + String(m.outP).replace(".", ",") + " je Mio. Tokens" }),
        el("span", null, el("code", { text: m.id }))
      ));
      out.appendChild(el("p", { text: r.gruende.join(" ") }));
      if (r.tipp) out.appendChild(el("p", { text: r.tipp }));
      out.appendChild(el("p", { class: "k-next", html: "<b>Wenn das nicht reicht:</b> " + K.weiter[r.model] }));
    }
    render();
  };
})();
