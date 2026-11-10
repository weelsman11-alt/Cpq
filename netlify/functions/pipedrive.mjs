// Pipedrive bridge for the CPQ app. The API token stays on the server (env var PIPEDRIVE_API_TOKEN).
// GET  /api/pipedrive?deal=123  -> customer details from the deal's organisation and contact person
// POST /api/pipedrive           -> { dealId, filename, pdfBase64, note, value }: attaches the PDF, adds a note, sets the deal value
// Pushes are made as the quote author (Albert Field by default, PIPEDRIVE_AUTHOR_EMAIL to change). Pipedrive records files
// and notes under the owner of the API token, so set PIPEDRIVE_PUSH_API_TOKEN to Albert's own token. Without it, the note's
// author is set to Albert via user_id (Pipedrive only allows this when the main token belongs to an admin).
const BASE = "https://api.pipedrive.com/api/v1";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const AUTHOR_EMAIL = (process.env.PIPEDRIVE_AUTHOR_EMAIL || "albert.field@waimea.co.nz").trim().toLowerCase();

async function pd(path, init = {}, token = process.env.PIPEDRIVE_API_TOKEN) {
  if (!token) throw Object.assign(new Error("PIPEDRIVE_API_TOKEN is not set on Netlify"), { status: 500 });
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${BASE}${path}${sep}api_token=${encodeURIComponent(token)}`, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw Object.assign(new Error(j.error || `Pipedrive returned ${r.status}`), { status: r.status === 404 ? 404 : 502 });
  return j.data;
}
const primary = list => (Array.isArray(list) ? (list.find(x => x.primary) || list[0] || {}).value : "") || "";
let authorCache = null;
// Pipedrive user id of the quote author, or null if no such user exists.
async function authorId(token) {
  if (authorCache) return authorCache;
  const users = await pd(`/users/find?search_by_email=1&term=${encodeURIComponent(AUTHOR_EMAIL)}`, {}, token);
  const u = (users || []).find(x => String(x.email || "").toLowerCase() === AUTHOR_EMAIL) || (users || [])[0];
  return (authorCache = u ? { id: u.id, name: u.name } : null);
}
const idOf = v => (v && typeof v === "object" ? v.value : v) || null;

export default async (req) => {
  try {
    if (req.method === "GET") {
      const dealId = new URL(req.url).searchParams.get("deal");
      if (!/^\d+$/.test(dealId || "")) return json({ error: "Deal ID must be a number" }, 400);
      const deal = await pd(`/deals/${dealId}`);
      const orgId = idOf(deal.org_id), personId = idOf(deal.person_id);
      const [org, person] = await Promise.all([orgId ? pd(`/organizations/${orgId}`) : null, personId ? pd(`/persons/${personId}`) : null]);
      return json({
        title: deal.title || "",
        company: (org && org.name) || (deal.org_id && deal.org_id.name) || "",
        address: (org && (org.address_formatted_address || org.address)) || "",
        contact: (person && person.name) || (deal.person_id && deal.person_id.name) || "",
        email: primary(person ? person.email : deal.person_id && deal.person_id.email),
        phone: primary(person ? person.phone : deal.person_id && deal.person_id.phone),
      });
    }
    if (req.method === "POST") {
      const { dealId, filename, pdfBase64, note, value } = await req.json();
      if (!/^\d+$/.test(String(dealId || ""))) return json({ error: "Deal ID must be a number" }, 400);
      const pushToken = process.env.PIPEDRIVE_PUSH_API_TOKEN || process.env.PIPEDRIVE_API_TOKEN;
      const asAuthor = !!process.env.PIPEDRIVE_PUSH_API_TOKEN;
      const req2 = (path, init) => pd(path, init, pushToken);
      const form = new FormData();
      form.append("file", new Blob([Buffer.from(pdfBase64, "base64")], { type: "application/pdf" }), filename || "Quote.pdf");
      form.append("deal_id", String(dealId));
      const file = await req2(`/files`, { method: "POST", body: form });
      let warning = null;
      if (note) {
        const body = { content: note, deal_id: Number(dealId) };
        const author = await authorId(pushToken).catch(() => null);
        if (author) body.user_id = author.id;
        const post = b => req2(`/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
        try { await post(body); }
        catch (e) {
          if (!body.user_id || asAuthor) throw e;
          // The token's user can't set another author (not an admin): add the note anyway and say so.
          delete body.user_id; await post(body);
          warning = `The note was added under the connected Pipedrive user, not ${author.name}. Add ${author.name}'s API token as PIPEDRIVE_PUSH_API_TOKEN to push as ${author.name}.`;
        }
      }
      if (process.env.UPDATE_DEAL_VALUE !== "false" && value) {
        await req2(`/deals/${dealId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: Math.round(value * 100) / 100, currency: "AUD" }) });
      }
      if (!asAuthor && !warning) warning = "The PDF was attached under the connected Pipedrive user. Add Albert Field's API token as PIPEDRIVE_PUSH_API_TOKEN to push as Albert.";
      return json({ ok: true, fileId: file && file.id, warning });
    }
    return json({ error: "Unsupported request" }, 405);
  } catch (e) {
    return json({ error: e.message }, e.status || 500);
  }
};

export const config = { path: "/api/pipedrive" };
