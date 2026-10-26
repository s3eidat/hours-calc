/* Hours Calc — a weekly time card. Pure minute arithmetic; overnight = end at or before start rolls to the next day. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$, h = S3.h;
  var KEY = "hours.v1";
  var DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // ---------- pure maths (tested) ----------
  function toMin(t) { var m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; }
  // Worked minutes of one shift; null when the times are incomplete.
  function shiftMinutes(start, end, breakMin, round) {
    var s = toMin(start), e = toMin(end);
    if (s == null || e == null) return null;
    if (e <= s) e += 1440;
    var m = Math.max(0, e - s - (breakMin > 0 ? breakMin : 0));
    return round > 0 ? Math.round(m / round) * round : m;
  }
  function overnight(start, end) { var s = toMin(start), e = toMin(end); return s != null && e != null && e <= s; }
  // dayMins: minutes per day. Daily overtime first, then weekly overtime on what's left of the regular hours.
  function weekCalc(dayMins, dailyT, weeklyT) {
    var dailyOT = dayMins.map(function (m) { return dailyT != null ? Math.max(0, m - dailyT) : 0; });
    var total = dayMins.reduce(function (a, b) { return a + b; }, 0);
    var dOT = dailyOT.reduce(function (a, b) { return a + b; }, 0), reg = total - dOT;
    var wOT = weeklyT != null ? Math.max(0, reg - weeklyT) : 0;
    return { total: total, regular: reg - wOT, overtime: dOT + wOT, dailyOT: dailyOT, weeklyOT: wOT };
  }
  function pay(c, rate, mult) { var r = rate / 60; return { regular: c.regular * r, overtime: c.overtime * r * mult, total: c.regular * r + c.overtime * r * mult }; }
  function hm(m) { var neg = m < 0; m = Math.abs(Math.round(m)); return (neg ? "-" : "") + Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0"); }
  function dec(m) { return (m / 60).toFixed(2); }
  function num(v) {
    v = String(v == null ? "" : v).trim().replace(/[٠-٩]/g, function (d) { return d.charCodeAt(0) - 0x660; }).replace(/[٫,]/g, ".");
    return v === "" || !/^\d*\.?\d+$|^\d+\.$/.test(v) ? null : parseFloat(v);
  }

  // ---------- state (validated, it comes from localStorage) ----------
  function cleanShift(x) {
    x = x && typeof x === "object" ? x : {};
    var t = function (v) { return typeof v === "string" && toMin(v) != null ? v : ""; };
    var b = typeof x.b === "number" && x.b >= 0 && x.b < 1440 ? Math.round(x.b) : 0;
    return { s: t(x.s), e: t(x.e), b: b };
  }
  function cleanState(o) {
    o = o && typeof o === "object" ? o : {};
    var str = function (v, max) { return typeof v === "string" ? v.slice(0, max) : ""; };
    var days = [];
    for (var i = 0; i < 7; i++) {
      var d = Array.isArray(o.days) && Array.isArray(o.days[i]) ? o.days[i].slice(0, 6).map(cleanShift) : [];
      days.push(d.length ? d : [cleanShift()]);
    }
    return {
      weekStart: [0, 1, 6].indexOf(o.weekStart) >= 0 ? o.weekStart : 6,
      weekOf: /^\d{4}-\d{2}-\d{2}$/.test(o.weekOf) ? o.weekOf : "",
      rate: str(o.rate, 12), cur: str(o.cur, 6), dailyOT: str(o.dailyOT, 6), weeklyOT: str(o.weeklyOT, 6), mult: str(o.mult, 6),
      round: [0, 5, 6, 15].indexOf(o.round) >= 0 ? o.round : 0, days: days
    };
  }
  var st = cleanState(S3.store(KEY));
  function save() { S3.store(KEY, st); }

  function order() { var a = []; for (var i = 0; i < 7; i++) a.push((st.weekStart + i) % 7); return a; }
  function dateFor(wd) {
    if (!st.weekOf) return null;
    var p = st.weekOf.split("-"), d = new Date(+p[0], p[1] - 1, +p[2]);
    var back = (d.getDay() - st.weekStart + 7) % 7;
    d.setDate(d.getDate() - back + (wd - st.weekStart + 7) % 7);
    return d;
  }
  function fmtDate(d, long) { return d ? d.toLocaleDateString("en-GB", long ? { day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "short" }) : ""; }

  // ---------- render ----------
  var daysEl = $("#days");
  function shiftRow(wd, i, x) {
    return h("div", { "class": "hc-shift", "data-wd": wd, "data-i": i }, [
      h("input", { "class": "input hc-time", type: "time", value: x.s, "data-f": "s", "aria-label": DAY[wd] + " shift " + (i + 1) + " start" }),
      h("span", { "class": "hc-arrow", "aria-hidden": "true", text: "→" }),
      h("input", { "class": "input hc-time", type: "time", value: x.e, "data-f": "e", "aria-label": DAY[wd] + " shift " + (i + 1) + " end" }),
      h("label", { "class": "hc-brk" }, [
        h("input", { "class": "input", inputmode: "numeric", value: x.b ? String(x.b) : "", placeholder: "0", "data-f": "b", "aria-label": DAY[wd] + " shift " + (i + 1) + " break minutes" }),
        h("span", { text: "min break" })
      ]),
      h("span", { "class": "hc-sh-tot" }),
      h("button", { type: "button", "class": "btn ghost icon small no-print", "data-del": "1", "aria-label": "Remove shift", title: "Remove shift", html: S3.icon("x") })
    ]);
  }
  function render() {
    daysEl.textContent = "";
    order().forEach(function (wd) {
      var d = dateFor(wd);
      var shifts = h("div", { "class": "hc-shifts" });
      st.days[wd].forEach(function (x, i) {
        var row = shiftRow(wd, i, x);
        if (i === st.days[wd].length - 1 && st.days[wd].length < 6)
          row.appendChild(h("button", { type: "button", "class": "btn ghost small hc-add no-print", "data-add": wd, title: "Add another shift this day", html: S3.icon("plus") + "Shift" }));
        shifts.appendChild(row);
      });
      daysEl.appendChild(h("div", { "class": "hc-day", "data-day": wd }, [
        h("div", { "class": "hc-dname" }, [h("b", { text: DAY[wd] }), h("span", { text: fmtDate(d) })]),
        shifts,
        h("div", { "class": "hc-dtot" }, [h("b", { text: "0:00" }), h("span", { text: "" })])
      ]));
    });
    compute();
  }
  function stat(label, value, cls) { return h("div", { "class": "stat" + (cls ? " " + cls : "") }, [h("b", { text: value }), h("span", { text: label })]); }
  function money(v) { return (st.cur ? st.cur + " " : "") + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  var last = null;
  function compute() {
    var dt = num(st.dailyOT), wt = num(st.weeklyOT), rate = num(st.rate), mult = num(st.mult);
    if (mult == null) mult = 1.5;
    var mins = [0, 0, 0, 0, 0, 0, 0];
    $$(".hc-shift", daysEl).forEach(function (row) {
      var x = st.days[+row.dataset.wd][+row.dataset.i], m = shiftMinutes(x.s, x.e, x.b, st.round), out = $(".hc-sh-tot", row);
      if (m == null) { out.textContent = x.s || x.e ? "needs start and end" : ""; out.className = "hc-sh-tot faint"; return; }
      mins[+row.dataset.wd] += m;
      out.className = "hc-sh-tot";
      out.textContent = hm(m) + (overnight(x.s, x.e) ? " · overnight" : "") + (x.b && shiftMinutes(x.s, x.e, 0, 0) <= x.b ? " · break too long" : "");
    });
    var c = weekCalc(mins, dt != null ? dt * 60 : null, wt != null ? wt * 60 : null);
    $$(".hc-day", daysEl).forEach(function (el) {
      var wd = +el.dataset.day, t = $(".hc-dtot", el);
      t.firstChild.textContent = hm(mins[wd]);
      t.lastChild.textContent = mins[wd] ? dec(mins[wd]) + " h" + (c.dailyOT[wd] ? " · " + hm(c.dailyOT[wd]) + " OT" : "") : "";
      el.classList.toggle("off", !mins[wd]);
    });
    var tot = $("#totals"); tot.textContent = "";
    tot.appendChild(stat("total · " + dec(c.total) + " h", hm(c.total), "hc-big"));
    tot.appendChild(stat("regular · " + dec(c.regular) + " h", hm(c.regular)));
    tot.appendChild(stat("overtime · " + dec(c.overtime) + " h", hm(c.overtime), c.overtime ? "hc-ot" : ""));
    var p = null;
    if (rate != null) { p = pay(c, rate, mult); tot.appendChild(stat("pay" + (c.overtime ? " (OT " + money(p.overtime) + ")" : ""), money(p.total), "hc-pay")); }
    var bits = [];
    if (dt != null) bits.push("over " + dt + " h a day");
    if (wt != null) bits.push("over " + wt + " regular hours a week");
    $("#otNote").textContent = bits.length ? "Overtime counts hours " + bits.join(", then ") + ", paid at ×" + mult + "." + (st.round ? " Each shift is rounded to the nearest " + st.round + " minutes." : "") :
      "No overtime rules set. Add a daily or weekly threshold above to split regular and overtime hours." + (st.round ? " Each shift is rounded to the nearest " + st.round + " minutes." : "");
    if (rate != null) $("#otNote").textContent += " Rate: " + money(rate) + " per hour.";
    $("#sheetTitle").textContent = "Time card" + (st.weekOf ? " · week of " + fmtDate(dateFor(st.weekStart), true) : "");
    last = { mins: mins, c: c, p: p, mult: mult, rate: rate };
  }

  // ---------- events ----------
  daysEl.addEventListener("input", function (e) {
    var row = e.target.closest(".hc-shift"), f = e.target.dataset.f; if (!row || !f) return;
    var x = st.days[+row.dataset.wd][+row.dataset.i];
    if (f === "b") { var b = num(e.target.value); x.b = b != null && b < 1440 ? Math.round(b) : 0; } else x[f] = e.target.value;
    save(); compute();
  });
  daysEl.addEventListener("click", function (e) {
    var add = e.target.closest("[data-add]");
    if (add) {
      var list = st.days[+add.dataset.add], prev = list[list.length - 1] || {};
      list.push({ s: prev.e || "", e: "", b: 0 }); save(); render();
      var rows = $$(".hc-day[data-day='" + add.dataset.add + "'] .hc-shift input", daysEl); if (rows.length) rows[rows.length - 2].focus();
      return;
    }
    var del = e.target.closest("[data-del]");
    if (del) {
      var row = del.closest(".hc-shift"), l = st.days[+row.dataset.wd];
      l.splice(+row.dataset.i, 1); if (!l.length) l.push(cleanShift());
      save(); render();
    }
  });
  var SETS = ["rate", "cur", "dailyOT", "weeklyOT", "mult"];
  SETS.forEach(function (k) { $("#" + k).addEventListener("input", function (e) { st[k] = e.target.value; save(); compute(); }); });
  $("#weekStart").addEventListener("change", function (e) { st.weekStart = +e.target.value; save(); render(); });
  $("#round").addEventListener("change", function (e) { st.round = +e.target.value; save(); compute(); });
  $("#weekOf").addEventListener("change", function (e) { st.weekOf = /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) ? e.target.value : ""; save(); render(); });
  function syncInputs() {
    SETS.forEach(function (k) { $("#" + k).value = st[k]; });
    $("#weekStart").value = String(st.weekStart); $("#round").value = String(st.round); $("#weekOf").value = st.weekOf;
  }

  function summaryLines() {
    var lines = [];
    order().forEach(function (wd) {
      var parts = st.days[wd].filter(function (x) { return shiftMinutes(x.s, x.e, x.b, st.round) != null; })
        .map(function (x) { return x.s + "–" + x.e + (x.b ? " (" + x.b + " min break)" : ""); });
      if (parts.length) lines.push(DAY[wd] + (st.weekOf ? " " + fmtDate(dateFor(wd)) : "") + ": " + parts.join(", ") + " = " + hm(last.mins[wd]) + " (" + dec(last.mins[wd]) + " h)");
    });
    lines.push("Total: " + hm(last.c.total) + " (" + dec(last.c.total) + " h) · regular " + hm(last.c.regular) + " · overtime " + hm(last.c.overtime));
    if (last.p) lines.push("Pay: " + money(last.p.total) + " at " + money(last.rate) + "/h, overtime ×" + last.mult);
    return lines;
  }
  function csvCell(v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  $("#csv").addEventListener("click", function () {
    var rows = [["Day", "Date", "Shift", "Start", "End", "Break (min)", "Hours (h:mm)", "Hours (decimal)"]];
    order().forEach(function (wd) {
      var d = dateFor(wd), iso = d ? d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") : "";
      st.days[wd].forEach(function (x, i) {
        var m = shiftMinutes(x.s, x.e, x.b, st.round); if (m == null) return;
        rows.push([DAY[wd], iso, i + 1, x.s, x.e, x.b, hm(m), dec(m)]);
      });
    });
    rows.push([]); rows.push(["Total", "", "", "", "", "", hm(last.c.total), dec(last.c.total)]);
    rows.push(["Regular", "", "", "", "", "", hm(last.c.regular), dec(last.c.regular)]);
    rows.push(["Overtime", "", "", "", "", "", hm(last.c.overtime), dec(last.c.overtime)]);
    if (last.p) rows.push(["Pay", "", "", "", "", "", "", last.p.total.toFixed(2)]);
    // Leading "=" "+" "-" "@" could run as a formula in a spreadsheet; our cells are times and numbers only.
    S3.download("﻿" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n"), "timecard" + (st.weekOf ? "-" + st.weekOf : "") + ".csv", "text/csv;charset=utf-8");
    S3.done();
  });
  $("#copy").addEventListener("click", function () { S3.copy(summaryLines().join("\n")); S3.done(); });
  $("#print").addEventListener("click", function () { window.print(); S3.done(); });
  $("#clear").addEventListener("click", function () {
    var old = JSON.parse(JSON.stringify(st.days));
    st.days = st.days.map(function () { return [cleanShift()]; }); save(); render();
    var t = S3.toast("Week cleared ");
    t.appendChild(h("button", { "class": "btn small", text: "Undo", onclick: function () { st.days = old; save(); render(); t.remove(); } }));
  });

  syncInputs(); render();

  window.S3_DEMO = function () {
    st = cleanState({ weekStart: 0, weekOf: "2026-10-25", rate: "12.50", cur: "$", dailyOT: "8", weeklyOT: "40", mult: "1.5", round: 0, days: [
      [], [{ s: "09:00", e: "17:30", b: 30 }], [{ s: "09:00", e: "18:45", b: 45 }], [{ s: "08:30", e: "12:30" }, { s: "13:15", e: "17:45" }],
      [{ s: "22:00", e: "06:00", b: 30 }], [{ s: "09:00", e: "19:00", b: 30 }], [{ s: "10:00", e: "14:00" }]] });
    save(); syncInputs(); render();
  };

  window.S3_SELFTEST = function () {
    var a = shiftMinutes("22:00", "06:00", 30, 0) === 450 && shiftMinutes("09:00", "17:00", 60, 0) === 420 && shiftMinutes("09:00", "09:00", 0, 0) === 1440 &&
      shiftMinutes("09:00", "", 0, 0) === null && shiftMinutes("08:58", "17:07", 0, 15) === 495 && shiftMinutes("10:00", "11:00", 90, 0) === 0 &&
      overnight("23:30", "07:00") && !overnight("07:00", "23:30") && hm(450) === "7:30" && dec(450) === "7.50" && hm(65) === "1:05";
    var d = weekCalc([600, 600, 600, 600, 480, 0, 0], 480, 2400);
    var w = weekCalc([540, 540, 540, 540, 540, 0, 0], null, 2400);
    var b = weekCalc([600, 600, 600, 600, 600, 300, 0], 480, 2400);   // 55 h: 10 h daily OT, 45 h left → 5 h weekly OT
    var p = pay(w, 20, 1.5);
    return a && d.total === 2880 && d.overtime === 480 && d.regular === 2400 && d.weeklyOT === 0 &&
      w.overtime === 300 && w.regular === 2400 && p.regular === 800 && p.overtime === 150 && p.total === 950 &&
      b.overtime === 600 + 300 + 0 && b.regular === 2400 && num("12,5") === 12.5 && num("") === null && num("abc") === null && num("١٠") === 10 &&
      cleanState({ days: [[{ s: "<b>", e: "25:00", b: -4 }]], weekStart: 3 }).days[0][0].s === "" && cleanState({ weekStart: 3 }).weekStart === 6;
  };
})();
