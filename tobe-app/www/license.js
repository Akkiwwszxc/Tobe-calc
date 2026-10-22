(function () {
"use strict";

/* ===================== БАПТАУЛАР ===================== */
var LIC = {
  // Ашық кілт (тек тексеру үшін). Жеке кілт қосымшада ЖОҚ.
  pub: {"kty":"EC","crv":"P-256","x":"BF7u-PKDolKIa5e9flAPfAXbaBxBYbyCofhSdE9THAg","y":"u_T11t0Mj5me7aELR4L3sV9G_CuwUTqhIBIIh-sb9sI"},
  // Лицензия кілтін алу туралы мәтін, құлыптау экранында көрсетіледі.
  // Мысалы: "Kaspi: +7 7XX XXX XX XX · WhatsApp: +7 7XX XXX XX XX"
  // Лицензия серверінің мекенжайы (Cloudflare Worker орнатылған соң қойыңыз), мысалы:
  // "https://tobe-license.СІЗДІҢ-ПОЧТА.workers.dev". Бос болса, тек қолмен кілт енгізіледі.
  api: "",
  contact: "",
  // Мысалы: "Айына 3 000 ₸"
  price: ""
};
/* ====================================================== */

var LS_KEY = "tobe_lic", LS_SEEN = "tobe_ls", LS_DID = "tobe_did";
var G = (typeof globalThis !== "undefined") ? globalThis : window;

function b64uToBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  var b = atob(s), a = new Uint8Array(b.length);
  for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a;
}
function normCode(c) { return String(c || "").toUpperCase().replace(/[^0-9A-Z]/g, ""); }
function fmtCode(c) { return c.slice(0, 4) + "-" + c.slice(4); }
function pad(n) { return (n < 10 ? "0" : "") + n; }
function fmtDate(ms) { var d = new Date(ms); return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear(); }

async function sha8(id) {
  var h = await G.crypto.subtle.digest("SHA-256", new TextEncoder().encode("tobe|" + id));
  var a = new Uint8Array(h), s = "";
  for (var i = 0; i < 4; i++) s += ("0" + a[i].toString(16)).slice(-2);
  return s.toUpperCase();
}

async function verifyKey(key, code, now) {
  if (!G.crypto || !G.crypto.subtle) return { ok: false, err: "Бұл ортада тексеру мүмкін емес" };
  key = String(key || "").replace(/\s+/g, "");
  var parts = key.split(".");
  var bad = { ok: false, err: "Кілт форматы қате" };
  if (parts.length !== 2 || !parts[0] || !parts[1]) return bad;
  var data, sig, p;
  try {
    data = b64uToBytes(parts[0]);
    sig = b64uToBytes(parts[1]);
    p = JSON.parse(new TextDecoder().decode(data));
  } catch (e) { return bad; }
  if (sig.length !== 64) return bad;
  var good = false;
  try {
    var pk = await G.crypto.subtle.importKey("jwk", LIC.pub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    good = await G.crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pk, sig, data);
  } catch (e) { return { ok: false, err: "Кілтті тексеру қатесі" }; }
  if (!good) return { ok: false, err: "Кілт жарамсыз" };
  if (!p || p.v !== 1 || typeof p.e !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.e)) return bad;
  if (normCode(p.d) !== code) return { ok: false, err: "Бұл кілт басқа құрылғыға арналған" };
  var exp = new Date(p.e + "T23:59:59").getTime();
  if (!(exp > 0)) return bad;
  if (now > exp) return { ok: false, expired: true, name: p.n || "", exp: exp, err: "Жазылым мерзімі аяқталды (" + fmtDate(exp) + ")" };
  return { ok: true, name: p.n || "", exp: exp, left: Math.ceil((exp - now) / 864e5) };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { verifyKey: verifyKey, sha8: sha8, LIC: LIC, normCode: normCode };
}
if (typeof document === "undefined" || !document.documentElement) return;

/* ===================== ИНТЕРФЕЙС ===================== */
var html = document.documentElement;
html.classList.add("lic-lock"); // тексерілгенше қосымша жабық
var LS_ORD = "tobe_ord";

var st = document.createElement("style");
st.textContent =
  "html.lic-lock main{display:none!important}" +
  "#licBox{position:fixed;inset:0;z-index:99999;background:var(--bg);color:var(--ink);overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:16px}" +
  "#licBox .lc{width:100%;max-width:460px;margin:6vh 0 24px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px}" +
  "#licBox h2{margin:0 0 6px;font-size:20px}" +
  "#licBox p{margin:6px 0;color:var(--mute);font-size:14px}" +
  "#licBox .code{font:700 26px/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:2px;text-align:center;padding:12px;margin:10px 0 6px;border:1px dashed var(--acc);border-radius:8px;background:var(--accbg);color:var(--ink);user-select:all}" +
  "#licBox textarea{width:100%;min-height:96px;font:13px/1.35 ui-monospace,Menlo,Consolas,monospace;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:9px 10px;resize:vertical}" +
  "#licBox button{font:inherit;padding:10px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}" +
  "#licBox button.pr{background:var(--acc);color:var(--bg);border-color:var(--acc);font-weight:600;width:100%;margin-top:10px}" +
  "#licBox button.plan{width:100%;margin-top:8px;background:var(--acc);color:var(--bg);border-color:var(--acc);font-weight:600;padding:13px 14px;display:flex;justify-content:space-between}" +
  "#licBox .test{margin:8px 0;padding:8px 10px;border-radius:8px;background:#fff4d6;color:#7a5200;font-size:13px;font-weight:600}" +
  "#licBox details{margin-top:14px;border-top:1px solid var(--line);padding-top:10px}" +
  "#licBox summary{cursor:pointer;color:var(--mute);font-size:14px}" +
  "#licBox .row{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}" +
  "#licBox .msg{min-height:20px;margin:8px 0 0;font-size:14px;font-weight:600}" +
  "#licBox ol{margin:8px 0 8px 18px;padding:0;color:var(--mute);font-size:14px}";
document.head.appendChild(st);

var renewing = false, box = null, codeEl, msgEl, taEl, closeEl, plansEl, manualEl, introEl;
var devCode = "", polling = null, polled = false, claiming = false, planData = null;

async function getCode() {
  if (devCode) return devCode;
  var id = "";
  try {
    var C = G.Capacitor;
    if (C && C.Plugins && C.Plugins.Device) {
      var r = await C.Plugins.Device.getId();
      id = (r && (r.identifier || r.uuid)) || "";
    }
  } catch (e) {}
  if (!id) {
    try {
      id = localStorage.getItem(LS_DID);
      if (!id) {
        id = (G.crypto && G.crypto.randomUUID) ? G.crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
        localStorage.setItem(LS_DID, id);
      }
    } catch (e) { id = "fallback"; }
  }
  devCode = await sha8(id);
  return devCode;
}

function effectiveNow() {
  var n = Date.now(), s = 0;
  try { s = +localStorage.getItem(LS_SEEN) || 0; } catch (e) {}
  if (n > s) { try { localStorage.setItem(LS_SEEN, String(n)); } catch (e) {} } else n = s;
  return n;
}

function copyText(t) {
  function fb() {
    var a = document.createElement("textarea");
    a.value = t; a.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(a); a.select();
    try { document.execCommand("copy"); } catch (e) {}
    a.remove();
  }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(fb);
  else fb();
}

function setMsg(t, good) {
  if (!msgEl) return;
  msgEl.textContent = t || "";
  msgEl.style.color = good ? "var(--acc)" : "#d64545";
}

/* ---------- сервермен байланыс ---------- */
function api(path, opts) {
  if (!LIC.api) return Promise.reject(new Error("noapi"));
  var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 12000);
  opts = opts || {}; opts.signal = ctl.signal;
  return fetch(LIC.api.replace(/\/+$/, "") + path, opts).then(function (r) {
    return r.json().then(function (j) { clearTimeout(t); j._http = r.status; return j; });
  }, function (e) { clearTimeout(t); throw e; });
}

function openUrl(u) {
  try {
    var C = G.Capacitor;
    if (C && C.Plugins && C.Plugins.Browser) { C.Plugins.Browser.open({ url: u }); return; }
  } catch (e) {}
  window.open(u, "_blank");
}

function getOrd() { try { return JSON.parse(localStorage.getItem(LS_ORD) || "null"); } catch (e) { return null; } }

async function applyKey(k) {
  var code = await getCode();
  var r = await verifyKey(k, code, effectiveNow());
  if (!r.ok) return r;
  try { localStorage.setItem(LS_KEY, k); }
  catch (e) { return { ok: false, err: "Кілтті сақтау мүмкін болмады" }; }
  return r;
}

function finish() {
  stopPoll();
  try { localStorage.removeItem(LS_ORD); } catch (e) {}
  renewing = false;
  setMsg("Белсендірілді ✓", true);
  check();
}

async function claimOrder() {
  if (!LIC.api) return "";
  var ord = getOrd();
  if (!ord) return "";
  var code = await getCode();
  if (ord.device !== code) return "";
  try {
    var c = await api("/claim?order=" + ord.id + "&device=" + code);
    if (c.status === "paid") return c.key;
    if (c._http === 404) { try { localStorage.removeItem(LS_ORD); } catch (e) {} }
  } catch (e) {}
  return "";
}

async function pollOnce() {
  if (polled) return;
  polled = true;
  try {
    var k = await claimOrder();
    if (k) { var r = await applyKey(k); if (r.ok) finish(); }
  } catch (e) {}
  polled = false;
}
function startPoll() {
  stopPoll();
  var n = 0;
  polling = setInterval(function () {
    if (++n > 400) { // ~20 минут
      stopPoll();
      setMsg("Төлем расталмады. Төлесеңіз, қосымшаны қайта ашыңыз: кілт автоматты түседі.", false);
      return;
    }
    pollOnce();
  }, 3000);
}
function stopPoll() { if (polling) { clearInterval(polling); polling = null; } }

// Қосымша жабық күйде ашылғанда: төленген тапсырыс немесе серверде жарамды лицензия бар ма
async function autoClaim() {
  if (!LIC.api || claiming) return;
  claiming = true;
  try {
    var key = await claimOrder();
    if (!key) {
      var code = await getCode();
      var s = await api("/restore?device=" + code);
      if (s.status === "active") key = s.key;
    }
    if (key) { var r = await applyKey(key); if (r.ok) finish(); }
  } catch (e) {}
  claiming = false;
}

async function pay(id) {
  setMsg("Төлем беті ашылуда…", true);
  try {
    var code = await getCode();
    var r = await api("/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device: code, plan: id }) });
    if (!r.order || !r.payUrl) {
      setMsg(r.error === "provider_not_configured" ? "Төлем әзірге қосылмаған" : "Тапсырыс жасалмады", false);
      return;
    }
    try { localStorage.setItem(LS_ORD, JSON.stringify({ id: r.order, device: code })); } catch (e) {}
    openUrl(r.payUrl);
    setMsg("Төлемді аяқтап, осында қайтыңыз: кілт автоматты түседі…", true);
    startPoll();
  } catch (e) {
    setMsg("Серверге қосылу мүмкін болмады. Интернетті тексеріңіз", false);
  }
}

async function loadPlans() {
  plansEl.textContent = "";
  if (!LIC.api) { plansEl.hidden = true; manualEl.open = true; manualEl.querySelector("summary").hidden = true; introEl.textContent = "Қосымшаны пайдалану үшін лицензия кілтін енгізіңіз."; return; }
  plansEl.hidden = false;
  try {
    var d = planData || (planData = await api("/plans"));
    if (!d.plans || !d.plans.length) throw new Error("empty");
    if (d.mode === "test") {
      var tb = document.createElement("div"); tb.className = "test";
      tb.textContent = "ТЕСТ РЕЖИМІ: нақты төлем жоқ, төлем беті тек тексеру үшін.";
      plansEl.appendChild(tb);
    }
    d.plans.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "plan";
      var a = document.createElement("span"); a.textContent = p.title;
      var c = document.createElement("span"); c.textContent = Number(p.price).toLocaleString("ru-RU") + " ₸";
      b.appendChild(a); b.appendChild(c);
      b.addEventListener("click", function () { pay(p.id); });
      plansEl.appendChild(b);
    });
  } catch (e) {
    planData = null;
    var rb = document.createElement("button");
    rb.type = "button"; rb.textContent = "Пакеттерді жүктеу мүмкін болмады. Қайталау";
    rb.addEventListener("click", loadPlans);
    plansEl.appendChild(rb);
  }
}

function build() {
  box = document.createElement("div");
  box.id = "licBox";
  box.innerHTML =
    '<div class="lc">' +
    '<h2>Жазылым қажет</h2>' +
    '<p id="licIntro">Қосымшаны пайдалану үшін жазылымды таңдаңыз.</p>' +
    '<div id="licPlans"></div>' +
    '<div class="msg" id="licMsg"></div>' +
    '<details id="licManual"><summary>Кілтім бар (қолмен белсендіру)</summary>' +
    '<ol><li>Төмендегі құрылғы кодын сатушыға жіберіңіз.</li><li>Алған кілтті өріске қойып, «Белсендіру» басыңыз.</li></ol>' +
    '<div class="code" id="licCode">…</div>' +
    '<div class="row"><button type="button" id="licCopy">Кодты көшіру</button></div>' +
    '<p id="licContact" style="text-align:center"></p>' +
    '<textarea id="licKey" placeholder="Кілтті осында қойыңыз" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>' +
    '<button type="button" class="pr" id="licGo">Белсендіру</button></details>' +
    '<div class="row" style="margin-top:10px"><button type="button" id="licClose" hidden>Жабу</button></div>' +
    '</div>';
  document.body.appendChild(box);
  codeEl = box.querySelector("#licCode");
  msgEl = box.querySelector("#licMsg");
  taEl = box.querySelector("#licKey");
  closeEl = box.querySelector("#licClose");
  plansEl = box.querySelector("#licPlans");
  manualEl = box.querySelector("#licManual");
  introEl = box.querySelector("#licIntro");
  var ct = [LIC.price, LIC.contact].filter(Boolean).join(" · ");
  box.querySelector("#licContact").textContent = ct;
  box.querySelector("#licCopy").addEventListener("click", function () {
    copyText(devCode); setMsg("Код көшірілді", true);
  });
  closeEl.addEventListener("click", hide);
  box.querySelector("#licGo").addEventListener("click", activate);
}

function show(msg, closable) {
  var first = !box;
  if (first) build();
  renewing = !!closable;
  box.style.display = "flex";
  closeEl.hidden = !closable;
  if (msg || first) setMsg(msg || "", false);
  getCode().then(function (c) { codeEl.textContent = fmtCode(c); });
  if (first || !plansEl.children.length) loadPlans();
}
function hide() { renewing = false; stopPoll(); if (box) box.style.display = "none"; }

async function activate() {
  var k = taEl.value.replace(/\s+/g, "");
  if (!k) { setMsg("Кілтті енгізіңіз", false); return; }
  var r = await applyKey(k);
  if (!r.ok) { setMsg(r.err, false); return; }
  taEl.value = "";
  finish();
}

function showInfo(r) {
  var el = document.getElementById("licInfo");
  if (!el) {
    var host = document.querySelector("#pgCalc .sub");
    if (!host || !host.parentNode) return;
    el = document.createElement("div");
    el.id = "licInfo";
    el.style.cssText = "font-size:13px;margin:-4px 0 10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap";
    host.parentNode.insertBefore(el, host.nextSibling);
  }
  el.style.color = r.left <= 5 ? "#b45309" : "var(--mute)";
  el.textContent = "";
  var t = document.createElement("span");
  t.textContent = "Жазылым" + (r.name ? ": " + r.name : "") + " · " + fmtDate(r.exp) + " дейін (" + r.left + " күн)";
  var b = document.createElement("button");
  b.type = "button"; b.textContent = "Ұзарту";
  b.style.cssText = "font:inherit;padding:3px 10px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer";
  b.addEventListener("click", function () { show("", true); });
  el.appendChild(t); el.appendChild(b);
}

async function check() {
  var code = await getCode(), key = "";
  try { key = localStorage.getItem(LS_KEY) || ""; } catch (e) {}
  var r = key ? await verifyKey(key, code, effectiveNow()) : { ok: false };
  if (r.ok) {
    html.classList.remove("lic-lock");
    if (!renewing) hide();
    showInfo(r);
  } else {
    html.classList.add("lic-lock");
    show(key ? r.err : "", false);
    autoClaim();
  }
}

function start() { check(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
document.addEventListener("visibilitychange", function () {
  if (document.hidden) return;
  check();
  if (box && box.style.display !== "none") pollOnce();
});
setInterval(check, 5 * 60 * 1000);
})();
