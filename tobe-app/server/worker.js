// Төбе лицензия сервері (Cloudflare Workers)
// Тапсырыс жасайды, төлемді растайды, лицензия кілтін қолтаңбалап береді.
// Жеке кілт тек осы серверде (құпия айнымалы LICENSE_PRIVATE_JWK) сақталады.

const DEVICE_RE = /^[0-9A-F]{8}$/;
const ID_RE = /^[0-9a-f]{32}$/;
const SHARE_RE = /^[a-z0-9]{12}$/;
const SHARE_TTL = 180 * 86400; // 3D-сілтеме 180 күн сақталады
const SHARE_MAX = 60000; // сұраныс көлемі (таңба), қалыпты бөлме ~3-6 мың
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,x-license,x-admin",
  "access-control-max-age": "86400",
};
const J = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/* ---------- көмекші функциялар ---------- */
function plans(env) { try { return JSON.parse(env.PLANS); } catch (e) { return []; } }
// Жеңілдік: бұрын ақылы лицензия болған құрылғыға, мерзімі біткенге дейін және одан кейін N күн.
// env.RENEW_DISCOUNT (%, әдепкі 20; 0 = өшірулі), env.RENEW_GRACE_DAYS (әдепкі 7).
function discountPct(env) {
  const v = env.RENEW_DISCOUNT == null || env.RENEW_DISCOUNT === "" ? 20 : Number(env.RENEW_DISCOUNT);
  return Number.isFinite(v) ? Math.max(0, Math.min(90, Math.round(v))) : 0;
}
function graceDays(env) {
  const v = env.RENEW_GRACE_DAYS == null || env.RENEW_GRACE_DAYS === "" ? 7 : Number(env.RENEW_GRACE_DAYS);
  return Number.isFinite(v) ? Math.max(0, Math.min(365, Math.round(v))) : 7;
}
async function renewInfo(env, device) {
  const pct = discountPct(env);
  if (!pct || !DEVICE_RE.test(device)) return null;
  const l = await env.ORDERS.get("lic:" + device, "json");
  if (!l || !l.paid || !/^\d{4}-\d{2}-\d{2}$/.test(l.exp)) return null;
  const until = addDays(l.exp, graceDays(env));
  return iso(today()) <= until ? { pct, until } : null;
}
function priceWith(price, pct) { return pct ? Math.max(10, Math.round((price * (100 - pct)) / 100 / 10) * 10) : price; }
// Қазақстан уақыты UTC+5: ығыстырылған күнде UTC геттерлері жергілікті күнді береді
function today() { return new Date(Date.now() + 5 * 3600e3); }
function iso(d) { return d.toISOString().slice(0, 10); }
function addMonths(isoDate, m) {
  const [y, mo, d] = isoDate.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + m, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return iso(t);
}
function b64u(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function rid() {
  const a = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(a, (x) => ("0" + x.toString(16)).slice(-2)).join("");
}
/* ---------- 3D-сілтемелер: бөлме деректерін тексеру ----------
   ЕСКЕРТУ: cleanRoom мәтіні www/index.html ішіндегі cleanRoom-мен БІРДЕЙ болуы керек
   (тест екі мәтінді салыстырады). Тек геометрия мен шамдар сақталады: баға, смета, клиент аты жоқ. */
/*CLEAN-BEGIN*/
function cleanRoom(o){
  if(!o||typeof o!=="object")return null;
  var N=function(v,lo,hi,d){v=(typeof v==="number"||(typeof v==="string"&&v.trim()!==""))?+v:NaN;if(!isFinite(v))return d;return Math.min(hi,Math.max(lo,v))};
  var R=function(v){return Math.round(v*1000)/1000};
  var P=function(a,max){
    var out=[];if(!Array.isArray(a))return out;
    for(var i=0;i<a.length&&out.length<max;i++){
      var p=a[i];if(!p||typeof p!=="object")continue;
      var x=N(p.x,-500,500,NaN),y=N(p.y,-500,500,NaN);
      if(isFinite(x)&&isFinite(y))out.push({x:R(x),y:R(y)});
    }
    return out;
  };
  if(!Array.isArray(o.poly)||o.poly.length<3||o.poly.length>120)return null;
  var poly=P(o.poly,120);if(poly.length!==o.poly.length)return null;
  var n=poly.length;
  var G=function(a,max){
    var out=[];if(!Array.isArray(a))return out;
    for(var i=0;i<a.length&&out.length<max;i++){
      var g=a[i];if(!g||typeof g!=="object")continue;
      if(typeof g.e!=="number"||g.e!==Math.floor(g.e)||g.e<0||g.e>=n)continue;
      var a1=N(g.a,0,1,0),b1=N(g.b,0,1,1);
      if(Math.abs(b1-a1)<1e-4)continue;
      out.push({e:g.e,a:R(Math.min(a1,b1)),b:R(Math.max(a1,b1))});
    }
    return out;
  };
  var trks=[],ta=Array.isArray(o.trks)?o.trks:[];
  for(var i=0;i<ta.length&&trks.length<30;i++){
    var t=ta[i];if(!t||typeof t!=="object")continue;
    var cx=N(t.cx,-500,500,NaN),cy=N(t.cy,-500,500,NaN);
    if(!isFinite(cx)||!isFinite(cy))continue;
    trks.push({o:t.o==="y"?"y":"x",cx:R(cx),cy:R(cy),len:R(N(t.len,.1,50,1)),k:t.k==="r"?"r":"s",c:(t.c==="w"||(!t.c&&t.k==="r"))?"w":"b",ll:+t.ll===.3?.3:.6});
  }
  var ch=(o.chand&&typeof o.chand==="object")?o.chand:{};
  return{v:1,n:String(o.n==null?"":o.n).slice(0,60),h:R(N(o.h,1.8,6,2.6)),color:/^#[0-9a-fA-F]{6}$/.test(o.color)?o.color:"#ffffff",mat:String(o.mat==null?"":o.mat).slice(0,40),gain:Math.round(N(o.gain,0,100,40)),poly:poly,lights:P(o.lights,200),chand:{on:!!ch.on,pts:P(ch.pts,30)},gl:G(o.gl,200),cw:G(o.cw,200),trks:trks};
}
/*CLEAN-END*/

function b64uBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const b = atob(s), a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a;
}
// Лицензия кілтінің қолтаңбасы мен мерзімін тексереді (ашық кілт жеке кілттен алынады).
async function licenseOk(env, key) {
  key = String(key || "").replace(/\s+/g, "");
  const parts = key.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  let data, sig, p, pub;
  try {
    data = b64uBytes(parts[0]); sig = b64uBytes(parts[1]);
    p = JSON.parse(new TextDecoder().decode(data));
    const j = JSON.parse(env.LICENSE_PRIVATE_JWK);
    pub = { kty: j.kty, crv: j.crv, x: j.x, y: j.y };
  } catch (e) { return false; }
  if (sig.length !== 64) return false;
  try {
    const pk = await crypto.subtle.importKey("jwk", pub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    if (!(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pk, sig, data))) return false;
  } catch (e) { return false; }
  if (!p || p.v !== 1 || typeof p.e !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.e)) return false;
  return p.e >= iso(today());
}
function keyDevice(key) {
  try {
    const p = JSON.parse(new TextDecoder().decode(b64uBytes(String(key || "").replace(/\s+/g, "").split(".")[0])));
    return DEVICE_RE.test(p.d) ? p.d : "";
  } catch (e) { return ""; }
}
function sid() {
  const al = "abcdefghijklmnopqrstuvwxyz0123456789", a = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(a, (x) => al[x % 36]).join("");
}

async function signKey(env, payload) {
  const jwk = JSON.parse(env.LICENSE_PRIVATE_JWK);
  const k = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, data));
  return b64u(data) + "." + b64u(sig);
}

/* ---------- төлем жүйелері ----------
   Әр жүйе мына интерфейсті орындайды:
     create(order, env, origin) -> { payUrl }        — төлем сілтемесін жасау
     webhook(request, env)      -> { orderId, amount, response? } | null
                                   (қолтаңбаны тексеріп, төлем нәтижесін қайтарады; жарамсыз болса null)
   Нақты жүйе (Kaspi Pay, CloudPayments, Freedom Pay…) осында жеке адаптер ретінде қосылады,
   ал env.PROVIDER сол атауға ауыстырылады. Қалған бәрі (кілт беру, қосымша) өзгермейді. */
const providers = {
  // Тестілік: нақты ақша жоқ. Тек ALLOW_TEST_PAYMENTS=1 болғанда жұмыс істейді.
  test: {
    async create(order, env, origin) {
      return { payUrl: origin + "/pay/test?order=" + order.id };
    },
  },
};

/* ---------- төлемді орындау (кілт беру) ---------- */
async function fulfil(env, id, amount) {
  const o = await env.ORDERS.get("ord:" + id, "json");
  if (!o) return { error: "no_order" };
  if (o.status === "paid") return { order: o }; // қайталанған webhook: екінші рет ұзартпаймыз
  if (amount != null && Number(amount) < o.price) return { error: "amount" };
  const cur = await env.ORDERS.get("lic:" + o.device, "json");
  const t = iso(today());
  const base = cur && cur.exp >= t ? cur.exp : t; // әлі жарамды болса, соңынан ұзартамыз
  const exp = addMonths(base, o.months);
  const key = await signKey(env, { v: 1, n: "", d: o.device, e: exp });
  o.status = "paid"; o.key = key; o.exp = exp; o.paidAt = Date.now();
  await env.ORDERS.put("ord:" + id, JSON.stringify(o), { expirationTtl: 30 * 86400 });
  await env.ORDERS.put("lic:" + o.device, JSON.stringify({ key, exp, paid: true }));
  await env.ORDERS.delete("pend:" + id);
  await logKey(env, o.code ? "Kaspi " + o.code : "Төлем", o.device, exp, key);
  await env.ORDERS.delete("rev:" + o.device); // жаңа төлем = құрылғы қайта рұқсат алады
  return { order: o };
}

/* ---------- маршруттар ---------- */
async function createOrder(req, env, u) {
  let b;
  try { b = await req.json(); } catch (e) { return J({ error: "bad_request" }, 400); }
  const device = String(b.device || "").toUpperCase();
  const plan = plans(env).find((x) => x.id === b.plan);
  if (!DEVICE_RE.test(device) || !plan) return J({ error: "bad_request" }, 400);
  const prov = providers[env.PROVIDER];
  if (!prov || (env.PROVIDER === "test" && env.ALLOW_TEST_PAYMENTS !== "1") || (prov.ready && !prov.ready(env))) return J({ error: "provider_not_configured" }, 503);
  if (prov.manual) { // қайталап басқанда жаңа тапсырыс жасамай, ашық тапсырысты қайтарамыз
    const ex = await env.ORDERS.get("kp:" + device + ":" + plan.id);
    const eo = ex && ID_RE.test(ex) ? await env.ORDERS.get("ord:" + ex, "json") : null;
    if (eo && eo.status === "pending" && eo.price === priceWith(plan.price, (await renewInfo(env, device) || { pct: 0 }).pct)) { const r0 = await prov.create(eo, env, u.origin); return J({ order: eo.id, payUrl: r0.payUrl, kaspi: r0.kaspi }); }
  }
  const ri = await renewInfo(env, device);
  const price = priceWith(plan.price, ri ? ri.pct : 0);
  const o = { id: rid(), device, plan: plan.id, months: plan.months, price, status: "pending", created: Date.now() };
  if (ri) { o.discount = ri.pct; o.full = plan.price; }
  if (prov.manual) o.code = kcode();
  await env.ORDERS.put("ord:" + o.id, JSON.stringify(o), { expirationTtl: prov.ttl || 86400 });
  if (prov.manual) {
    await env.ORDERS.put("pend:" + o.id, "1", { expirationTtl: prov.ttl, metadata: { device, plan: plan.id, months: o.months, price: o.price, code: o.code, created: o.created, ...(o.discount ? { disc: o.discount } : {}) } });
    await env.ORDERS.put("kp:" + device + ":" + plan.id, o.id, { expirationTtl: 43200 });
  }
  const r = await prov.create(o, env, u.origin);
  return J({ order: o.id, payUrl: r.payUrl, kaspi: r.kaspi });
}

async function claim(u, env) {
  const id = u.searchParams.get("order") || "";
  const device = (u.searchParams.get("device") || "").toUpperCase();
  if (!ID_RE.test(id) || !DEVICE_RE.test(device)) return J({ error: "bad_request" }, 400);
  const o = await env.ORDERS.get("ord:" + id, "json");
  if (!o || o.device !== device) return J({ status: "unknown" }, 404);
  if (o.status === "paid") return J({ status: "paid", key: o.key, exp: o.exp });
  if (o.status === "rejected") return J({ status: "rejected" });
  return J({ status: "pending" });
}

async function restore(u, env) {
  const device = (u.searchParams.get("device") || "").toUpperCase();
  if (!DEVICE_RE.test(device)) return J({ error: "bad_request" }, 400);
  const l = await env.ORDERS.get("lic:" + device, "json");
  if (l && l.exp >= iso(today())) return J({ status: "active", key: l.key, exp: l.exp });
  return J({ status: "none" });
}

/* ---------- 3D-сілтеме: сақтау және оқу ---------- */
async function createShare(req, env) {
  if (!(await licenseOk(env, req.headers.get("x-license")))) return J({ error: "license" }, 401);
  const kd = keyDevice(req.headers.get("x-license"));
  if (kd && await env.ORDERS.get("rev:" + kd)) return J({ error: "license" }, 401);
  const text = await req.text();
  if (text.length > SHARE_MAX) return J({ error: "too_large" }, 413);
  let b;
  try { b = JSON.parse(text); } catch (e) { return J({ error: "bad_request" }, 400); }
  const room = cleanRoom(b);
  if (!room) return J({ error: "bad_request" }, 400);
  const id = sid();
  await env.ORDERS.put("sh:" + id, JSON.stringify(room), { expirationTtl: SHARE_TTL });
  return J({ id });
}

async function readShare(id, env) {
  if (!SHARE_RE.test(id)) return J({ error: "bad_request" }, 400);
  const r = await env.ORDERS.get("sh:" + id, "json");
  return r ? J(r) : J({ error: "not_found" }, 404);
}

function testOn(env) { return env.PROVIDER === "test" && env.ALLOW_TEST_PAYMENTS === "1"; }

function testPage(u) {
  const id = u.searchParams.get("order") || "";
  if (!ID_RE.test(id)) return new Response("Bad order", { status: 400 });
  const html = `<!doctype html><html lang="kk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Тест төлем</title><body style="font:16px system-ui;max-width:420px;margin:40px auto;padding:0 16px">
<h2>ТЕСТ төлем</h2><p>Бұл тестілік бет, нақты ақша алынбайды.</p>
<button id="b" style="font:inherit;padding:12px 18px;width:100%">Төлеу (тест)</button><p id="m"></p>
<script>document.getElementById("b").onclick=async function(){
var r=await fetch("/pay/test/confirm",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({order:"${id}"})});
document.getElementById("m").textContent=r.ok?"Төлем сәтті. Қосымшаға қайтыңыз: кілт автоматты түседі.":"Қате шықты";};</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function testConfirm(req, env) {
  let b;
  try { b = await req.json(); } catch (e) { return J({ error: "bad_request" }, 400); }
  if (!ID_RE.test(String(b.order || ""))) return J({ error: "bad_request" }, 400);
  const f = await fulfil(env, b.order, null);
  return f.error ? J({ error: f.error }, 400) : J({ ok: true });
}

async function webhook(name, req, env) {
  const pr = providers[name];
  if (!pr || !pr.webhook) return J({ error: "not_found" }, 404);
  const r = await pr.webhook(req.clone(), env);
  if (!r) return J({ error: "invalid" }, 400);
  const f = await fulfil(env, r.orderId, r.amount);
  if (f.error) return J({ error: f.error }, 400);
  return r.response || J({ ok: true });
}

/* ---------- Kaspi: клиент аударым жасайды, сатушы растайды ----------
   Kaspi-дің төлем қабылдауға ашық API-ы жоқ, сондықтан:
   1) қосымша тапсырыс жасайды (сома + 5 таңбалы код);
   2) клиент Kaspi-де сіздің нөміріңізге сол соманы аударады, түсініктемеге кодты жазады;
   3) сіз /admin бетінде «Растау» басасыз, кілт клиентке автоматты түседі.
   Растау сұраныстары жеке кілтпен қолтаңбаланады, сондықтан қосымша құпия сөз қажет емес. */
const KALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function kcode() { const a = crypto.getRandomValues(new Uint8Array(5)); return Array.from(a, (x) => KALPH[x % 32]).join(""); }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function kaspiInfo(o, env) { return { phone: String(env.KASPI_PHONE || ""), name: String(env.KASPI_NAME || ""), amount: o.price, code: o.code }; }
providers.kaspi = {
  manual: true,
  ttl: 3 * 86400, // сатушы растауға 3 күн уақыт
  ready(env) { return String(env.KASPI_PHONE || "").replace(/\D/g, "").length >= 10; },
  async create(order, env, origin) {
    return { payUrl: origin + "/pay/kaspi?order=" + order.id, kaspi: kaspiInfo(order, env) };
  },
};

const HTML_HEAD = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" };
const PAGE_CSS = `:root{--bg:#eef2f6;--card:#fff;--ink:#14213d;--mute:#5b6b82;--line:#d5dde8;--acc:#0b7a75;--accbg:#dff1ef}
@media (prefers-color-scheme:dark){:root{--bg:#0e1522;--card:#17202f;--ink:#e8eef7;--mute:#97a6bd;--line:#2a3649;--acc:#4fd1c5;--accbg:#143333}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,Segoe UI,Roboto,sans-serif}
main{max-width:480px;margin:0 auto;padding:16px}h1{font-size:21px;margin:10px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:12px 0}
.row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line)}.row:first-child{border-top:0}
.row b{font:700 19px/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:1px}.lab{font-size:13px;color:var(--mute)}
button{font:inherit;padding:9px 13px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
button.pr{background:#ffab00;color:#1b1c1e;border-color:#ffab00;font-weight:700}button.no{color:#d64545}
textarea{width:100%;min-height:84px;font:13px/1.35 ui-monospace,Menlo,Consolas,monospace;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:9px 10px}
.note{font-size:14px;color:var(--mute);margin:8px 0}.ok{color:var(--acc);font-weight:700}.bad{color:#d64545;font-weight:700}`;

async function kaspiPage(u, env) {
  const id = u.searchParams.get("order") || "";
  if (!ID_RE.test(id)) return new Response("Bad order", { status: 400 });
  const o = await env.ORDERS.get("ord:" + id, "json");
  if (!o || !o.code) return new Response("Order not found", { status: 404 });
  const k = kaspiInfo(o, env), sum = String(Math.round(Number(k.amount))).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0") + " ₸"; // ICU-ға тәуелсіз, әр ортада бірдей
  const row = (lab, val, cp) => `<div class="row"><div><div class="lab">${lab}</div><b>${esc(val)}</b></div>${cp ? `<button type="button" data-cp="${esc(cp)}">Көшіру</button>` : ""}</div>`;
  const html = `<!doctype html><html lang="kk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kaspi арқылы төлеу</title>
<style>${PAGE_CSS}</style><main><h1>Kaspi арқылы төлеу</h1>
<div class="card">${row("Kaspi нөмірі", k.phone, k.phone)}${k.name ? row("Алушы", k.name, "") : ""}${row("Сома (дәл осы сома)", sum, String(k.amount))}${row("Түсініктемеге жазыңыз", k.code, k.code)}</div>
<p class="note">Kaspi.kz қосымшасын ашыңыз → «Аударымдар» → «Телефон нөміріне». Нөмірді, соманы көрсетіп, түсініктемеге кодты жазыңыз.</p>
<p class="note">Аударымнан кейін сатушы төлемді растайды (әдетте бірнеше минут). Кілт қосымшаға автоматты түседі, осы бетті жауып, қосымшаға оралуға болады.</p>
<p id="st" class="note">Растауды күтудеміз…</p></main>
<script>var ID=${JSON.stringify(id)};
function cp(t,b){var f=function(){var a=document.createElement("textarea");a.value=t;document.body.appendChild(a);a.select();try{document.execCommand("copy")}catch(e){}a.remove()};
if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).catch(f);else f();b.textContent="Көшірілді ✓";setTimeout(function(){b.textContent="Көшіру"},1500)}
Array.prototype.forEach.call(document.querySelectorAll("[data-cp]"),function(b){b.onclick=function(){cp(b.getAttribute("data-cp"),b)}});
var T;function chk(){fetch("/pay/kaspi/status?order="+ID).then(function(r){return r.json()}).then(function(j){var m=document.getElementById("st");
if(j.status==="paid"){m.className="ok";m.textContent="Төлем расталды ✓ Қосымшаға оралыңыз: кілт автоматты түседі.";clearInterval(T)}
else if(j.status==="rejected"){m.className="bad";m.textContent="Төлем расталмады. Сатушымен байланысыңыз.";clearInterval(T)}}).catch(function(){})}
T=setInterval(chk,5000);chk();</script></html>`;
  return new Response(html, { headers: HTML_HEAD });
}

async function kaspiStatus(u, env) {
  const id = u.searchParams.get("order") || "";
  if (!ID_RE.test(id)) return J({ error: "bad_request" }, 400);
  const o = await env.ORDERS.get("ord:" + id, "json");
  if (!o || !o.code) return J({ status: "unknown" }, 404);
  return J({ status: o.status });
}

// Сатушы сұранысы: x-admin: <мс-уақыт>.<қолтаңба>; қолтаңба = ECDSA("tobe-admin|әрекет|аргумент|уақыт")
async function adminOk(env, req, action, arg) {
  const h = String(req.headers.get("x-admin") || ""), i = h.indexOf(".");
  if (i < 1) return false;
  const ts = h.slice(0, i);
  if (!/^\d{10,14}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > 300000) return false;
  let sig, pub;
  try {
    sig = b64uBytes(h.slice(i + 1));
    const j = JSON.parse(env.LICENSE_PRIVATE_JWK);
    pub = { kty: j.kty, crv: j.crv, x: j.x, y: j.y };
  } catch (e) { return false; }
  if (sig.length !== 64) return false;
  try {
    const pk = await crypto.subtle.importKey("jwk", pub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pk, sig, new TextEncoder().encode("tobe-admin|" + action + "|" + arg + "|" + ts));
  } catch (e) { return false; }
}

async function adminOrders(req, env) {
  if (!(await adminOk(env, req, "list", "-"))) return J({ error: "auth" }, 401);
  const l = await env.ORDERS.list({ prefix: "pend:", limit: 100 });
  const orders = l.keys.map((k) => ({ id: k.name.slice(5), ...(k.metadata || {}) })).sort((a, b) => (b.created || 0) - (a.created || 0));
  return J({ orders });
}

async function adminAct(req, env, action) {
  let b;
  try { b = await req.json(); } catch (e) { return J({ error: "bad_request" }, 400); }
  const id = String((b && b.order) || "");
  if (!ID_RE.test(id)) return J({ error: "bad_request" }, 400);
  if (!(await adminOk(env, req, action, id))) return J({ error: "auth" }, 401);
  const o = await env.ORDERS.get("ord:" + id, "json");
  if (!o) return J({ error: "no_order" }, 404);
  if (action === "confirm") {
    if (o.status === "rejected") return J({ error: "rejected" }, 409);
    const f = await fulfil(env, id, null);
    if (f.error) return J({ error: f.error }, 400);
    await env.ORDERS.delete("pend:" + id);
    return J({ ok: true, exp: f.order.exp, device: o.device });
  }
  if (o.status === "paid") return J({ error: "paid" }, 409);
  o.status = "rejected";
  await env.ORDERS.put("ord:" + id, JSON.stringify(o), { expirationTtl: 7 * 86400 });
  await env.ORDERS.delete("pend:" + id);
  await env.ORDERS.delete("kp:" + o.device + ":" + o.plan);
  return J({ ok: true });
}

// Берілген кілттер журналы (жаңасы алдымен): metadata-да, сондықтан бір list жеткілікті
async function logKey(env, name, device, exp, key) {
  const created = Date.now();
  await env.ORDERS.put("iss:" + String(1e13 - created).padStart(14, "0") + ":" + device, "1", { metadata: { name: String(name).slice(0, 40), device, exp, created, key } });
}
function addDays(isoDate, d) { return iso(new Date(Date.parse(isoDate + "T00:00:00Z") + d * 864e5)); }

async function adminIssue(req, env) {
  let b;
  try { b = await req.json(); } catch (e) { return J({ error: "bad_request" }, 400); }
  const device = String((b && b.device) || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!DEVICE_RE.test(device)) return J({ error: "bad_device" }, 400);
  if (!(await adminOk(env, req, "issue", device))) return J({ error: "auth" }, 401);
  const t = iso(today());
  let exp;
  if (Number.isInteger(b.days) && b.days >= 1 && b.days <= 366) exp = addDays(t, b.days);
  else if (Number.isInteger(b.months) && b.months >= 1 && b.months <= 60) exp = addMonths(t, b.months);
  else return J({ error: "bad_term" }, 400);
  const name = String(b.name || "").trim().slice(0, 40);
  const key = await signKey(env, { v: 1, n: name, d: device, e: exp });
  const cur = await env.ORDERS.get("lic:" + device, "json");
  const longer = cur && cur.exp > exp;
  const paid = !!(cur && cur.paid) || !(Number.isInteger(b.days) && b.days >= 1 && b.days <= 366); // ай бойынша берілсе (қолма-қол төлем) — ақылы деп саналады, сынақ күндер — жоқ
  if (!longer) await env.ORDERS.put("lic:" + device, JSON.stringify({ key, exp, ...(paid ? { paid: true } : {}) }));
  else if (paid && !cur.paid) await env.ORDERS.put("lic:" + device, JSON.stringify({ ...cur, paid: true }));
  await logKey(env, name || "Қолмен", device, exp, key);
  await env.ORDERS.delete("rev:" + device);
  return J({ ok: true, key, exp, device, ...(longer ? { note: "longer_exists", current: cur.exp } : {}) });
}

async function adminRev(req, env, action) {
  let b;
  try { b = await req.json(); } catch (e) { return J({ error: "bad_request" }, 400); }
  const device = String((b && b.device) || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!DEVICE_RE.test(device)) return J({ error: "bad_device" }, 400);
  if (!(await adminOk(env, req, action, device))) return J({ error: "auth" }, 401);
  if (action === "revoke") {
    await env.ORDERS.put("rev:" + device, "1", { metadata: { t: Date.now() } });
    await env.ORDERS.delete("lic:" + device); // /restore ескі кілтті қайтармасын
  } else {
    await env.ORDERS.delete("rev:" + device);
  }
  return J({ ok: true, device });
}

// Қосымша осыны сұрайды: қайтарып алынған құрылғы құлыпталады
async function deviceStatus(u, env) {
  const device = (u.searchParams.get("device") || "").toUpperCase();
  if (!DEVICE_RE.test(device)) return J({ error: "bad_request" }, 400);
  return J({ revoked: !!(await env.ORDERS.get("rev:" + device)) });
}

async function adminKeys(req, env) {
  if (!(await adminOk(env, req, "keys", "-"))) return J({ error: "auth" }, 401);
  const l = await env.ORDERS.list({ prefix: "iss:", limit: 100 });
  const rl = await env.ORDERS.list({ prefix: "rev:", limit: 200 });
  const revoked = rl.keys.map((k) => ({ device: k.name.slice(4), t: (k.metadata && k.metadata.t) || 0 }));
  return J({ keys: l.keys.map((k) => k.metadata).filter(Boolean), revoked });
}

function adminPage() {
  const html = `<!doctype html><html lang="kk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Төлемді растау</title>
<style>${PAGE_CSS}</style><main><h1>Төлемді растау (Kaspi)</h1>
<div class="card"><div class="lab">Жеке кілт (private-key.jwk.json мәтіні). Құрылғыдан шықпайды: қолтаңба осы жерде жасалады.</div>
<textarea id="priv" spellcheck="false" placeholder="{...}"></textarea>
<label class="note" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="rem"> Осы құрылғыда есте сақтау</label></div>
<div style="display:flex;gap:8px"><button type="button" class="pr" id="rf">Жаңарту</button><span id="err" class="bad" style="align-self:center"></span></div>
<div id="list"></div><p class="note" id="empty">Кілтті енгізіп, «Жаңарту» басыңыз.</p>
<h1 style="margin-top:28px">Кілт шығару</h1>
<div class="card"><div class="lab">Аты (міндетті емес)</div><input id="nm" maxlength="40" style="width:100%;font:inherit;padding:9px;margin:4px 0 10px">
<div class="lab">Клиенттің құрылғы коды (қосымшада «Жазылым қажет» экранында)</div><input id="dv" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX" style="width:100%;font:inherit;padding:9px;margin:4px 0 10px">
<div class="lab">Мерзімі</div><select id="tm" style="width:100%;font:inherit;padding:9px;margin:4px 0 12px"><option value="d3">3 күн (сынақ)</option><option value="d7">7 күн</option><option value="m1">1 ай</option><option value="m3">3 ай</option><option value="m6">6 ай</option><option value="m12">12 ай</option></select>
<button type="button" class="pr" id="go" style="width:100%">Кілт жасау</button><div id="ierr" class="bad" style="margin-top:8px"></div>
<div id="res" hidden><p class="ok" id="resT"></p><textarea id="out" readonly></textarea><div style="display:flex;gap:8px;margin-top:8px"><button type="button" id="cpk">Көшіру</button><button type="button" id="shk">Бөлісу</button></div></div></div>
<h1 style="margin-top:28px">Берілген кілттер</h1>
<div class="card"><div class="lab">Құрылғының кілтін қайтарып алу (құрылғы коды)</div><div style="display:flex;gap:8px;margin-top:6px"><input id="rvd" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX" style="flex:1;min-width:0;font:inherit;padding:9px"><button type="button" class="no" id="rvb" style="flex:none;white-space:nowrap">Қайтарып алу</button></div><div id="rerr" class="bad" style="margin-top:6px"></div></div>
<div id="keys"><p class="note">Кілтті енгізгеннен кейін көрінеді.</p></div></main>
<script>var $=function(i){return document.getElementById(i)};
try{var sv=localStorage.getItem("adm_priv");if(sv){$("priv").value=sv;$("rem").checked=true}}catch(e){}
function b64u(a){var s="";for(var i=0;i<a.length;i++)s+=String.fromCharCode(a[i]);return btoa(s).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"")}
async function sig(action,arg){var k=await crypto.subtle.importKey("jwk",JSON.parse($("priv").value.trim()),{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
var ts=String(Date.now());var s=new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},k,new TextEncoder().encode("tobe-admin|"+action+"|"+arg+"|"+ts)));return ts+"."+b64u(s)}
async function call(path,action,arg,body){var h={"x-admin":await sig(action,arg)},o={headers:h};
if(body){o.method="POST";h["content-type"]="application/json";o.body=JSON.stringify(body)}
var r=await fetch(path,o),j={};try{j=await r.json()}catch(e){}j._s=r.status;return j}
function two(n){return("0"+n).slice(-2)}
function fmt(t){var d=new Date(t);return two(d.getDate())+"."+two(d.getMonth()+1)+" "+two(d.getHours())+":"+two(d.getMinutes())}
function row(lab,val){var d=document.createElement("div");d.className="row";var a=document.createElement("div");var l=document.createElement("div");l.className="lab";l.textContent=lab;var b=document.createElement("b");b.textContent=val;a.appendChild(l);a.appendChild(b);d.appendChild(a);return d}
var seen=null;
function draw(list){var el=$("list");el.textContent="";$("empty").textContent=list.length?"":"Растауды күтетін төлем жоқ.";
list.forEach(function(o){var c=document.createElement("div");c.className="card";
c.appendChild(row("Түсініктеме (код)",o.code||"—"));c.appendChild(row("Сома",Number(o.price).toLocaleString("ru-RU")+" ₸ · "+o.months+" ай"+(o.disc?" · жеңілдік −"+o.disc+"%":"")));
c.appendChild(row("Уақыты · құрылғы",fmt(o.created)+" · "+String(o.device||"").slice(0,4)+"-"+String(o.device||"").slice(4)));
var r=document.createElement("div");r.style.cssText="display:flex;gap:8px;margin-top:10px";
var ok=document.createElement("button");ok.type="button";ok.className="pr";ok.style.flex="1";ok.textContent="Растау";ok.onclick=function(){act("confirm",o)};
var no=document.createElement("button");no.type="button";no.className="no";no.textContent="Қабылдамау";no.onclick=function(){act("reject",o)};
r.appendChild(ok);r.appendChild(no);c.appendChild(r);el.appendChild(c)});
document.title=(list.length?"("+list.length+") ":"")+"Төлемді растау";
if(seen!==null&&list.length>seen&&navigator.vibrate)navigator.vibrate(200);seen=list.length}
async function load(){$("err").textContent="";if(!$("priv").value.trim()){return}
try{localStorage.removeItem("adm_priv");if($("rem").checked)localStorage.setItem("adm_priv",$("priv").value.trim())}catch(e){}
try{var j=await call("/admin/orders","list","-");
if(j._s===401){$("err").textContent="Кілт сәйкес емес немесе құрылғы сағаты қате";return}
if(j._s!==200){$("err").textContent="Қате ("+j._s+")";return}draw(j.orders||[])}catch(e){$("err").textContent="Кілт дұрыс емес немесе желі жоқ"}}
async function act(kind,o){
if(kind==="confirm"&&!confirm(Number(o.price).toLocaleString("ru-RU")+" ₸ Kaspi-ге келді ме? Код: "+(o.code||"—")))return;
if(kind==="reject"&&!confirm("Бұл тапсырысты қабылдамайсыз ба? Код: "+(o.code||"—")))return;
try{var j=await call("/admin/"+kind,kind,o.id,{order:o.id});
if(j._s===200){$("err").textContent="";await load()}else $("err").textContent=j.error==="paid"?"Бұрын расталған":j.error==="rejected"?"Бұрын қабылданбаған":"Қате ("+j._s+")"}
catch(e){$("err").textContent="Желі қатесі"}}
function cpy(t,b,lab){var f=function(){var a=document.createElement("textarea");a.value=t;document.body.appendChild(a);a.select();try{document.execCommand("copy")}catch(e){}a.remove()};
if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).catch(f);else f();b.textContent="Көшірілді ✓";setTimeout(function(){b.textContent=lab},1500)}
function fdev(d){d=String(d||"");return d.slice(0,4)+"-"+d.slice(4)}
async function revDev(kind,device){var q=kind==="revoke"?"Құрылғы "+fdev(device)+" кілтін қайтарып аласыз ба? Қосымша келесі байланыста құлыпталады.":"Құрылғы "+fdev(device)+" қайта рұқсат алады. Жалғастырасыз ба?";if(!confirm(q))return;
$("rerr").textContent="";try{var j=await call("/admin/"+kind,kind,device,{device:device});if(j._s===200)loadKeys();else $("rerr").textContent=j.error==="bad_device"?"Құрылғы коды қате":"Қате ("+j._s+")"}catch(e){$("rerr").textContent="Желі қатесі"}}
function drawKeys(a,rv){var el=$("keys");el.textContent="";var rs={};(rv||[]).forEach(function(x){rs[x.device]=1});
if(!a.length){var p=document.createElement("p");p.className="note";p.textContent="Әзірге жоқ.";el.appendChild(p)}
a.forEach(function(k){var c=document.createElement("div");c.className="card";var d=String(k.device||"");c.appendChild(row((k.name||"—")+" · "+fmt(k.created),fdev(d)+" · "+k.exp+" дейін"));
var r=document.createElement("div");r.style.cssText="display:flex;gap:8px;margin-top:8px;align-items:center";
var b=document.createElement("button");b.type="button";b.textContent="Кілтті көшіру";b.onclick=function(){cpy(k.key,b,"Кілтті көшіру")};r.appendChild(b);
if(rs[d]){var s=document.createElement("span");s.className="bad";s.textContent="Қайтарып алынған";r.appendChild(s)}
else{var x=document.createElement("button");x.type="button";x.className="no";x.textContent="Қайтарып алу";x.onclick=function(){revDev("revoke",d)};r.appendChild(x)}
c.appendChild(r);el.appendChild(c)});
if(rv&&rv.length){var h=document.createElement("h1");h.style.marginTop="28px";h.textContent="Қайтарып алынған құрылғылар";el.appendChild(h);
rv.forEach(function(x){var c=document.createElement("div");c.className="card";c.appendChild(row("Құрылғы",fdev(x.device)+(x.t?" · "+fmt(x.t):"")));
var b=document.createElement("button");b.type="button";b.style.marginTop="8px";b.textContent="Қалпына келтіру";b.onclick=function(){revDev("unrevoke",x.device)};c.appendChild(b);el.appendChild(c)})}}
async function loadKeys(){if(!$("priv").value.trim())return;try{var j=await call("/admin/keys","keys","-");if(j._s===200)drawKeys(j.keys||[],j.revoked||[])}catch(e){}}
$("rvb").onclick=function(){var d=$("rvd").value.toUpperCase().replace(/[^0-9A-Z]/g,"");if(d.length!==8){$("rerr").textContent="Құрылғы коды 8 таңба болуы керек";return}
if(!$("priv").value.trim()){$("rerr").textContent="Алдымен жеке кілтті енгізіңіз";return}$("rvd").value="";revDev("revoke",d)};
$("go").onclick=async function(){var e=$("ierr");e.textContent="";$("res").hidden=true;
var d=$("dv").value.toUpperCase().replace(/[^0-9A-Z]/g,"");if(d.length!==8){e.textContent="Құрылғы коды 8 таңба болуы керек";return}
if(!$("priv").value.trim()){e.textContent="Алдымен жеке кілтті енгізіңіз";return}
var t=$("tm").value,body={device:d,name:$("nm").value.trim()};if(t.charAt(0)==="d")body.days=+t.slice(1);else body.months=+t.slice(1);
try{var j=await call("/admin/issue","issue",d,body);
if(j._s===200){$("out").value=j.key;$("resT").textContent="Дайын: "+j.exp+" дейін"+(j.note?" (бұл құрылғыда ұзағырақ лицензия бар: "+j.current+")":"");$("res").hidden=false;loadKeys()}
else e.textContent=j._s===401?"Жеке кілт сәйкес емес":j.error==="bad_device"?"Құрылғы коды қате":"Қате ("+j._s+")"}catch(x){e.textContent="Жеке кілт дұрыс емес немесе желі жоқ"}};
$("cpk").onclick=function(){cpy($("out").value,$("cpk"),"Көшіру")};
$("shk").onclick=function(){var t=$("out").value;if(navigator.share)navigator.share({text:t}).catch(function(){});else cpy(t,$("cpk"),"Көшіру")};
$("rf").onclick=function(){load();loadKeys()};$("priv").addEventListener("change",load);
setInterval(function(){if(!document.hidden)load()},60000);if($("priv").value.trim()){load();loadKeys()}</script></html>`;
  return new Response(html, { headers: HTML_HEAD });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const u = new URL(req.url), p = u.pathname;
    try {
      if (p === "/" && !env.ASSETS) return J({ ok: true, service: "tobe-license" });
      if (p === "/share" && req.method === "POST") return await createShare(req, env);
      if (p.startsWith("/share/") && req.method === "GET") return await readShare(p.slice(7), env);
      if (p === "/plans") {
        const ri = await renewInfo(env, (u.searchParams.get("device") || "").toUpperCase());
        const pl = plans(env).map((x) => (ri ? { ...x, full: x.price, price: priceWith(x.price, ri.pct) } : x));
        return J({ mode: env.PROVIDER === "test" ? "test" : env.PROVIDER === "kaspi" ? "kaspi" : "live", plans: pl, ...(ri ? { renew: ri } : {}) });
      }
      if (p === "/order" && req.method === "POST") return await createOrder(req, env, u);
      if (p === "/pay/kaspi") return await kaspiPage(u, env);
      if (p === "/pay/kaspi/status") return await kaspiStatus(u, env);
      if (p === "/admin") return adminPage();
      if (p === "/admin/orders" && req.method === "GET") return await adminOrders(req, env);
      if (p === "/admin/confirm" && req.method === "POST") return await adminAct(req, env, "confirm");
      if (p === "/admin/reject" && req.method === "POST") return await adminAct(req, env, "reject");
      if (p === "/admin/issue" && req.method === "POST") return await adminIssue(req, env);
      if (p === "/admin/keys" && req.method === "GET") return await adminKeys(req, env);
      if (p === "/admin/revoke" && req.method === "POST") return await adminRev(req, env, "revoke");
      if (p === "/admin/unrevoke" && req.method === "POST") return await adminRev(req, env, "unrevoke");
      if (p === "/status" && req.method === "GET") return await deviceStatus(u, env);
      if (p === "/claim") return await claim(u, env);
      if (p === "/restore") return await restore(u, env);
      if (p === "/pay/test" && testOn(env)) return testPage(u);
      if (p === "/pay/test/confirm" && req.method === "POST" && testOn(env)) return await testConfirm(req, env);
      if (p.startsWith("/webhook/")) return await webhook(p.slice(9), req, env);
      // Қалған GET сұраныстар: қосымша беті (3D көру беті осында ашылады)
      if (env.ASSETS && (req.method === "GET" || req.method === "HEAD")) return await env.ASSETS.fetch(req);
      return J({ error: "not_found" }, 404);
    } catch (e) {
      return J({ error: "server_error" }, 500);
    }
  },
  // тестілеу үшін
  _internals: { fulfil, addMonths, cleanRoom, licenseOk },
};
