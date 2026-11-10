// In-app login for the CPQ app: one shared team password (env var APP_PASSWORD).
// Signed-in users get a long-lived, HttpOnly session cookie. Everything else (the app page and /api/*)
// needs that cookie, except the files a phone needs to install the app (manifest, icons, service worker).
// Changing APP_PASSWORD signs everyone out, because the cookie signature is derived from it.

const COOKIE = "cpq_session";
const MAX_AGE = 60 * 60 * 24 * 180; // 180 days
const enc = new TextEncoder();

async function sign(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function validSession(token, secret) {
  const [exp, sig] = (token || "").split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) * 1000 < Date.now()) return false;
  return safeEqual(sig, await sign(secret, "cpq:" + exp));
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req, context) => {
  const url = new URL(req.url);
  const secret = Netlify.env.get("APP_PASSWORD");
  if (!secret) return new Response("Login is not set up yet: add the APP_PASSWORD environment variable in Netlify.", { status: 503 });

  if (url.pathname === "/api/login" && req.method === "POST") {
    let password = "";
    try { password = String((await req.json()).password || ""); } catch {}
    if (!safeEqual(await sign(secret, "pw:" + password), await sign(secret, "pw:" + secret))) {
      await new Promise(r => setTimeout(r, 600));
      return json({ error: "Wrong password" }, 401);
    }
    const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
    context.cookies.set({ name: COOKIE, value: `${exp}.${await sign(secret, "cpq:" + exp)}`, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax", maxAge: MAX_AGE });
    return json({ ok: true });
  }

  if (url.pathname === "/api/logout") {
    context.cookies.delete({ name: COOKIE, path: "/" });
    return new Response(null, { status: 302, headers: { location: "/" } });
  }

  if (await validSession(context.cookies.get(COOKIE), secret)) return context.next();

  if (url.pathname.startsWith("/api/")) return json({ error: "Please log in" }, 401);
  return new Response(LOGIN_PAGE, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
};

export const config = {
  path: "/*",
  excludedPath: ["/manifest.webmanifest", "/sw.js", "/favicon.png", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"],
};

const LOGIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Waimea CPQ · Log in</title>
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#1462AC">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Waimea CPQ">
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f4f4;color:#1d1d1d;
    font:15px ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;padding:24px}
  .card{width:100%;max-width:360px;background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.08);overflow:hidden}
  .top{background:#1462AC;color:#fff;padding:22px 24px;display:flex;gap:14px;align-items:center}
  .top img{width:44px;height:44px;border-radius:10px;background:#fff}
  .top b{display:block;font-size:17px}.top span{opacity:.8;font-size:13px}
  form{padding:24px;display:grid;gap:14px}
  label{font-weight:600;font-size:13px}
  input{width:100%;font:inherit;font-size:16px;padding:12px 14px;border:1px solid #cfd6de;border-radius:10px;margin-top:6px}
  input:focus{outline:2px solid #1462AC;outline-offset:1px;border-color:#1462AC}
  button{font:inherit;font-weight:600;padding:12px;border:0;border-radius:10px;background:#1462AC;color:#fff;cursor:pointer}
  button:disabled{opacity:.6}
  .err{color:#b3261e;font-size:13px;min-height:18px;margin:0}
</style>
</head>
<body>
<main class="card">
  <div class="top"><img src="/icon-192.png" alt=""><div><b>Waimea CPQ</b><span>Configure · Price · Quote</span></div></div>
  <form id="f">
    <label>Team password<input id="pw" type="password" autocomplete="current-password" required autofocus></label>
    <p class="err" id="err" role="alert"></p>
    <button id="btn" type="submit">Log in</button>
  </form>
</main>
<script>
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{});}
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn'), err = document.getElementById('err');
  btn.disabled = true; err.textContent = '';
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: document.getElementById('pw').value }) });
    if (r.ok) return location.reload();
    err.textContent = r.status === 401 ? 'That password is not right. Try again.' : 'Could not log in. Try again.';
  } catch { err.textContent = 'No connection. Check your internet and try again.'; }
  btn.disabled = false;
});
</script>
</body>
</html>`;
