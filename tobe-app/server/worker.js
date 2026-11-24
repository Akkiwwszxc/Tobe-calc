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
    if (eo && eo.status === "pending" && eo.price === priceWith(plan.price, (await renewInfo(env, device) || { pct: 0 }).pct)) { const r0 = await prov.create(eo, env, u.origin); if (r0.kaspi && await tgChat(env)) r0.kaspi.receipt = true; return J({ order: eo.id, payUrl: r0.payUrl, kaspi: r0.kaspi }); }
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
    // Бір мезгілде келген қос сұраныс (қос басу): kp-ны соңғы жазған ғана қалады, қалғаны өз тапсырысын өшіріп, жеңімпаздікін қайтарады
    await new Promise((ok) => setTimeout(ok, 300));
    const win = await env.ORDERS.get("kp:" + device + ":" + plan.id);
    if (win && win !== o.id && ID_RE.test(win)) {
      const wo = await env.ORDERS.get("ord:" + win, "json");
      if (wo && wo.status === "pending") {
        await env.ORDERS.delete("ord:" + o.id); await env.ORDERS.delete("pend:" + o.id);
        const rw = await prov.create(wo, env, u.origin);
        if (rw.kaspi && await tgChat(env)) rw.kaspi.receipt = true;
        return J({ order: wo.id, payUrl: rw.payUrl, kaspi: rw.kaspi });
      }
    }
  }
  const r = await prov.create(o, env, u.origin);
  if (prov.manual) { await notifyOrder(env, o); if (r.kaspi && await tgChat(env)) r.kaspi.receipt = true; }
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

// Растау/қабылдамау: /admin беті де, Telegram батырмасы да осыны шақырады
async function confirmOrder(env, id) {
  const o = await env.ORDERS.get("ord:" + id, "json");
  if (!o) return { error: "no_order", status: 404 };
  if (o.status === "rejected") return { error: "rejected", status: 409 };
  const f = await fulfil(env, id, null);
  if (f.error) return { error: f.error, status: 400 };
  await env.ORDERS.delete("pend:" + id);
  return { ok: true, exp: f.order.exp, device: o.device, was: o.status };
}
async function rejectOrder(env, id) {
  const o = await env.ORDERS.get("ord:" + id, "json");
  if (!o) return { error: "no_order", status: 404 };
  if (o.status === "paid") return { error: "paid", status: 409 };
  o.status = "rejected";
  await env.ORDERS.put("ord:" + id, JSON.stringify(o), { expirationTtl: 7 * 86400 });
  await env.ORDERS.delete("pend:" + id);
  await env.ORDERS.delete("kp:" + o.device + ":" + o.plan);
  return { ok: true, device: o.device };
}
async function adminAct(req, env, action) {
  let b;
  try { b = await req.json(); } catch (e) { return J({ error: "bad_request" }, 400); }
  const id = String((b && b.order) || "");
  if (!ID_RE.test(id)) return J({ error: "bad_request" }, 400);
  if (!(await adminOk(env, req, action, id))) return J({ error: "auth" }, 401);
  const r = action === "confirm" ? await confirmOrder(env, id) : await rejectOrder(env, id);
  if (r.error) return J({ error: r.error }, r.status);
  return J(action === "confirm" ? { ok: true, exp: r.exp, device: r.device } : { ok: true });
}

/* ---------- Telegram: хабарлама, чек, растау батырмалары ----------
   Құпия: TELEGRAM_BOT_TOKEN (Cloudflare secret). Чат id /admin → «Telegram қосу» арқылы KV-ға түседі
   (немесе env.TELEGRAM_CHAT_ID). Webhook қорғанысы: secret_token = sha256(token) туындысы. */
// Cloudflare-де атау қолмен жазылғанда кірілше-латын ұқсас әріптер (Т, Е, А…) немесе бос орын араласуы мүмкін: түзетіп іздейміз
const LOOK = { "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "О": "O", "Р": "P", "С": "C", "Т": "T", "Н": "H", "Х": "X", "І": "I", "Ү": "Y" };
function normName(k) { return String(k).trim().toUpperCase().replace(/[А-ЯІҮ]/g, (c) => LOOK[c] || c).replace(/[\s\-.]+/g, "_"); }
function fixEnv(env) {
  if (env.TELEGRAM_BOT_TOKEN) return env;
  try {
    for (const k of Object.keys(env)) {
      if (normName(k) === "TELEGRAM_BOT_TOKEN" && typeof env[k] === "string" && env[k].trim()) return { ...env, TELEGRAM_BOT_TOKEN: env[k].trim() };
    }
  } catch (e) { /* env тізімделмесе — ештеңе істемейміз */ }
  return env;
}
async function tg(env, method, body, form) {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method, { method: "POST", headers: form ? undefined : { "content-type": "application/json" }, body: form ? body : JSON.stringify(body), signal: ctl.signal });
    return await r.json();
  } catch (e) { return null; } finally { clearTimeout(t); }
}
async function tgChat(env) {
  if (!env.TELEGRAM_BOT_TOKEN) return "";
  return String(env.TELEGRAM_CHAT_ID || (await env.ORDERS.get("cfg:tgchat")) || "");
}
async function tgSecret(env) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("tobe-tg|" + env.TELEGRAM_BOT_TOKEN)));
  return Array.from(h, (x) => x.toString(16).padStart(2, "0")).join("").slice(0, 48);
}
const rub = (n) => Number(n).toLocaleString("ru-RU").replace(/\s/g, " ") + " ₸";
function orderText(o, head) {
  const d = String(o.device || "");
  return (head || "🧾 Новый заказ Kaspi") + "\nКод в комментарии: " + o.code + "\nСумма: " + rub(o.price) + (o.discount ? " (скидка −" + o.discount + "%, продление)" : "") +
    "\nСрок: " + o.months + " мес.\nУстройство: " + d.slice(0, 4) + "-" + d.slice(4);
}
const tgButtons = (id) => ({ inline_keyboard: [[{ text: "✅ Подтвердить", callback_data: "ok:" + id }, { text: "❌ Отклонить", callback_data: "no:" + id }]] });
async function notifyOrder(env, o) {
  try {
    const chat = await tgChat(env);
    if (!chat) return;
    await tg(env, "sendMessage", { chat_id: chat, text: orderText(o), reply_markup: tgButtons(o.id) });
  } catch (e) { /* хабарлама сәтсіз болса да тапсырыс жасала береді */ }
}

const RECEIPT_TYPES = { "image/jpeg": "photo", "image/png": "photo", "image/webp": "document", "application/pdf": "document" };
const RECEIPT_MAX = 6 * 1024 * 1024;
async function receipt(req, env, u) {
  const id = u.searchParams.get("order") || "", device = (u.searchParams.get("device") || "").toUpperCase();
  if (!ID_RE.test(id) || !DEVICE_RE.test(device)) return J({ error: "bad_request" }, 400);
  const o = await env.ORDERS.get("ord:" + id, "json");
  if (!o || o.device !== device) return J({ error: "no_order" }, 404);
  if (o.status !== "pending") return J({ error: o.status }, 409);
  const type = String(req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const kind = RECEIPT_TYPES[type];
  if (!kind) return J({ error: "bad_type" }, 415);
  const chat = await tgChat(env);
  if (!chat) return J({ error: "tg_off" }, 503);
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) return J({ error: "bad_request" }, 400);
  if (buf.byteLength > RECEIPT_MAX) return J({ error: "too_large" }, 413);
  const cnt = Number(await env.ORDERS.get("rc:" + id)) || 0;
  if (cnt >= 3) return J({ error: "too_many" }, 429);
  await env.ORDERS.put("rc:" + id, String(cnt + 1), { expirationTtl: 3 * 86400 });
  const f = new FormData();
  f.append("chat_id", chat);
  f.append("caption", orderText(o, "🧾 Чек по заказу"));
  f.append("reply_markup", JSON.stringify(tgButtons(id)));
  f.append(kind, new Blob([buf], { type }), kind === "photo" ? "receipt" : type === "application/pdf" ? "receipt.pdf" : "receipt.webp");
  const r = await tg(env, kind === "photo" ? "sendPhoto" : "sendDocument", f, true);
  if (!r || !r.ok) return J({ error: "tg_fail" }, 502);
  return J({ ok: true });
}

// Telegram → бізге: «Подтвердить/Отклонить» батырмасы
async function tgHook(req, env) {
  if (!env.TELEGRAM_BOT_TOKEN || req.headers.get("x-telegram-bot-api-secret-token") !== (await tgSecret(env))) return J({ error: "forbidden" }, 403);
  let up;
  try { up = await req.json(); } catch (e) { return J({ ok: true }); }
  const cq = up && up.callback_query;
  if (!cq || typeof cq.data !== "string") return J({ ok: true });
  const chat = await tgChat(env), from = String((cq.from && cq.from.id) || ""), m = /^(ok|no):([0-9a-f]{32})$/.exec(cq.data);
  const answer = (text) => tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text, show_alert: false });
  if (!chat || from !== chat) { await answer("Нет доступа"); return J({ ok: true }); }
  if (!m) { await answer("Неизвестная команда"); return J({ ok: true }); }
  const r = m[1] === "ok" ? await confirmOrder(env, m[2]) : await rejectOrder(env, m[2]);
  let label, text;
  if (r.ok && r.was === "paid") { label = "✅ Уже подтверждён"; text = "Этот заказ уже подтверждён"; }
  else if (r.ok) { label = m[1] === "ok" ? "✅ Подтверждено" : "❌ Отклонено"; text = m[1] === "ok" ? "Подтверждено: ключ выдан" : "Отклонено"; }
  else if (r.error === "paid") { label = "✅ Уже подтверждён"; text = "Этот заказ уже подтверждён"; }
  else if (r.error === "rejected") { label = "❌ Уже отклонён"; text = "Этот заказ уже отклонён"; }
  else { label = "⚠️ Заказ не найден"; text = "Заказ не найден (устарел?)"; }
  await answer(text);
  if (cq.message && cq.message.message_id)
    await tg(env, "editMessageReplyMarkup", { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [[{ text: label, callback_data: "noop" }]] } });
  return J({ ok: true });
}

// /admin: «Telegram қосу» — чат id табады, webhook орнатады, сынақ хабарлама жібереді
async function tgSetup(req, env, u) {
  if (!(await adminOk(env, req, "tgsetup", "-"))) return J({ error: "auth" }, 401);
  if (!env.TELEGRAM_BOT_TOKEN) return J({ error: "no_token", seen: Object.keys(env).filter((k) => !/^(ORDERS|ASSETS)$/.test(k)).map((k) => k.replace(/[^\x20-\x7e]/g, (c) => "<U+" + c.codePointAt(0).toString(16) + ">")) });
  const me = await tg(env, "getMe", {});
  if (!me || !me.ok) return J({ error: "bad_token" });
  let chat = String(env.TELEGRAM_CHAT_ID || ""), who = "";
  if (!chat) {
    await tg(env, "deleteWebhook", {});
    const up = await tg(env, "getUpdates", { limit: 100, allowed_updates: ["message"] });
    const msgs = ((up && up.result) || []).map((x) => x.message).filter((x) => x && x.chat && x.chat.type === "private");
    const last = msgs[msgs.length - 1];
    if (!last) return J({ error: "no_chat", bot: me.result.username });
    chat = String(last.chat.id);
    who = [last.chat.first_name, last.chat.last_name].filter(Boolean).join(" ") || last.chat.username || "";
    await env.ORDERS.put("cfg:tgchat", chat);
  }
  const wh = await tg(env, "setWebhook", { url: u.origin + "/tg/hook", secret_token: await tgSecret(env), allowed_updates: ["callback_query"] });
  if (!wh || !wh.ok) return J({ error: "webhook_fail" });
  await tg(env, "sendMessage", { chat_id: chat, text: "✅ Бот подключён. Сюда будут приходить заказы и чеки с кнопками «Подтвердить / Отклонить»." });
  return J({ ok: true, bot: me.result.username, who });
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
<div class="card"><div class="lab">Telegram: тапсырыс келгенде хабарлама + чек + «Подтвердить/Отклонить» батырмалары</div><div style="display:flex;gap:8px;margin-top:6px;align-items:center"><button type="button" id="tgb">Telegram қосу</button><span id="tgm" class="note" style="margin:0"></span></div></div>
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
$("tgb").onclick=async function(){var m=$("tgm");m.className="note";m.textContent="";if(!$("priv").value.trim()){m.className="bad";m.textContent="Алдымен жеке кілтті енгізіңіз";return}
try{var j=await call("/admin/tg-setup","tgsetup","-",{});
if(j.ok){m.className="ok";m.textContent="Қосылды ✓ @"+j.bot+(j.who?" · "+j.who:"")+". Ботқа сынақ хабарлама келді."}
else{m.className="bad";m.textContent=j.error==="no_token"?"Cloudflare-де TELEGRAM_BOT_TOKEN secret жоқ. Воркер көретін атаулар: "+(j.seen||[]).join(", "):j.error==="bad_token"?"Токен қате":j.error==="no_chat"?"Алдымен @"+j.bot+" ботын ашып, Start басыңыз, қайта басыңыз":j.error==="webhook_fail"?"Webhook орнатылмады":j._s===401?"Жеке кілт сәйкес емес":"Қате ("+j._s+")"}}catch(e){m.className="bad";m.textContent="Желі қатесі"}};
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

/* ---------- iPhone/PWA: Safari → «Басты экранға қосу» ---------- */
const PWA_ICONS = { "180": "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", "192": "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", "512": "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" };
const PWA_SW = `const V = "tobe-pwa-2", SHELL = "/";
const API = /^\\/(plans|order|claim|restore|status|receipt|share|admin|pay|tg|webhook)(\\/|$)/;
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(V).then((c) => c.add(SHELL)).catch(() => {})); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET") return;
  if (u.origin === location.origin) {
    if (API.test(u.pathname)) return; // сервер сұраныстары кэшке түспейді
    if (r.mode === "navigate" || u.pathname === "/") {
      e.respondWith((async () => {
        const c = await caches.open(V), hit = await c.match(SHELL);
        const net = fetch(r).then((res) => { if (res && res.ok && res.type === "basic") c.put(SHELL, res.clone()); return res; });
        if (!hit) return net;
        return Promise.race([net.catch(() => hit), new Promise((ok) => setTimeout(() => ok(hit), 4000))]); // интернет баяу/жоқ: сақталған көшірме
      })());
      return;
    }
    if (u.pathname.startsWith("/lib/")) { // three.js, jsPDF, html2canvas: бір рет жүктеледі, содан кейін офлайн
      e.respondWith((async () => {
        const c = await caches.open(V), hit = await c.match(r);
        if (hit) return hit;
        const res = await fetch(r);
        if (res && res.ok && res.type === "basic") c.put(r, res.clone());
        return res;
      })());
      return;
    }
    e.respondWith(fetch(r).catch(() => caches.match(r)));
    return;
  }
  // сыртқы кітапханалар (three.js, jsPDF, html2canvas): бірінші ашқаннан кейін офлайн жұмыс істейді
  if (/^https:\\/\\/(cdnjs\\.cloudflare\\.com|cdn\\.jsdelivr\\.net|fonts\\.(googleapis|gstatic)\\.com)\\//.test(r.url)) {
    e.respondWith((async () => {
      const c = await caches.open(V), hit = await c.match(r);
      if (hit) return hit;
      const res = await fetch(r);
      if (res && (res.ok || res.type === "opaque")) c.put(r, res.clone());
      return res;
    })());
  }
});
`;
function pwaAsset(p) {
  const H = { "access-control-allow-origin": "*" };
  if (p === "/manifest.webmanifest") {
    return new Response(JSON.stringify({ name: "Төбе калькуляторы", short_name: "Төбе", description: "Серпімді төбе калькуляторы", start_url: "/", scope: "/", display: "standalone", orientation: "any",
      background_color: "#1b1c1e", theme_color: "#1b1c1e", lang: "kk",
      icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }] }),
      { headers: { ...H, "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" } });
  }
  if (p === "/sw.js") return new Response(PWA_SW, { headers: { ...H, "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
  const m = /^\/(?:apple-touch-icon|icon-(192|512))\.png$/.exec(p);
  if (m) {
    const b = atob(PWA_ICONS[m[1] || "180"]), a = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return new Response(a, { headers: { ...H, "content-type": "image/png", "cache-control": "public, max-age=86400" } });
  }
  return null;
}

export default {
  async fetch(req, env) {
    env = fixEnv(env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const u = new URL(req.url), p = u.pathname;
    try {
      if (req.method === "GET") { const pw = pwaAsset(p); if (pw) return pw; }
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
      if (p === "/admin/tg-setup" && req.method === "POST") return await tgSetup(req, env, u);
      if (p === "/tg/hook" && req.method === "POST") return await tgHook(req, env);
      if (p === "/receipt" && req.method === "POST") return await receipt(req, env, u);
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
