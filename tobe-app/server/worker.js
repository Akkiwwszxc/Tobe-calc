// Төбе лицензия сервері (Cloudflare Workers)
// Тапсырыс жасайды, төлемді растайды, лицензия кілтін қолтаңбалап береді.
// Жеке кілт тек осы серверде (құпия айнымалы LICENSE_PRIVATE_JWK) сақталады.

const DEVICE_RE = /^[0-9A-F]{8}$/;
const ID_RE = /^[0-9a-f]{32}$/;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
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
      if (p === "/") return J({ ok: true, service: "tobe-license" });
      if (p === "/plans") return J({ mode: env.PROVIDER === "test" ? "test" : "live", plans: plans(env) });
      if (p === "/order" && req.method === "POST") return await createOrder(req, env, u);
      if (p === "/claim") return await claim(u, env);
      if (p === "/restore") return await restore(u, env);
      if (p === "/pay/test" && testOn(env)) return testPage(u);
      if (p === "/pay/test/confirm" && req.method === "POST" && testOn(env)) return await testConfirm(req, env);
      if (p.startsWith("/webhook/")) return await webhook(p.slice(9), req, env);
      return J({ error: "not_found" }, 404);
    } catch (e) {
      return J({ error: "server_error" }, 500);
    }
  },
  // тестілеу үшін
  _internals: { fulfil, addMonths },
};
