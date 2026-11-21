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
  "access-control-allow-headers": "content-type,x-license",
  "access-control-max-age": "86400",
};
const J = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/* ---------- көмекші функциялар ---------- */
function plans(env) { try { return JSON.parse(env.PLANS); } catch (e) { return []; } }
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
  await env.ORDERS.put("lic:" + o.device, JSON.stringify({ key, exp }));
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
  if (!prov || (env.PROVIDER === "test" && env.ALLOW_TEST_PAYMENTS !== "1")) return J({ error: "provider_not_configured" }, 503);
  const o = { id: rid(), device, plan: plan.id, months: plan.months, price: plan.price, status: "pending", created: Date.now() };
  await env.ORDERS.put("ord:" + o.id, JSON.stringify(o), { expirationTtl: 86400 });
  const r = await prov.create(o, env, u.origin);
  return J({ order: o.id, payUrl: r.payUrl });
}

async function claim(u, env) {
  const id = u.searchParams.get("order") || "";
  const device = (u.searchParams.get("device") || "").toUpperCase();
  if (!ID_RE.test(id) || !DEVICE_RE.test(device)) return J({ error: "bad_request" }, 400);
  const o = await env.ORDERS.get("ord:" + id, "json");
  if (!o || o.device !== device) return J({ status: "unknown" }, 404);
  if (o.status === "paid") return J({ status: "paid", key: o.key, exp: o.exp });
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

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const u = new URL(req.url), p = u.pathname;
    try {
      if (p === "/" && !env.ASSETS) return J({ ok: true, service: "tobe-license" });
      if (p === "/share" && req.method === "POST") return await createShare(req, env);
      if (p.startsWith("/share/") && req.method === "GET") return await readShare(p.slice(7), env);
      if (p === "/plans") return J({ mode: env.PROVIDER === "test" ? "test" : "live", plans: plans(env) });
      if (p === "/order" && req.method === "POST") return await createOrder(req, env, u);
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
