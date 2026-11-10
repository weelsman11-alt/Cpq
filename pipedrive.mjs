// Pipedrive bridge for the CPQ app. The API token stays on the server (env var PIPEDRIVE_API_TOKEN).
// GET  /api/pipedrive?deal=123  -> customer details from the deal's organisation and contact person
// POST /api/pipedrive           -> { dealId, filename, pdfBase64, note, value }: attaches the PDF, adds a note, sets the deal value
const BASE = "https://api.pipedrive.com/api/v1";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function pd(path, init = {}) {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) throw Object.assign(new Error("PIPEDRIVE_API_TOKEN is not set on Netlify"), { status: 500 });
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${BASE}${path}${sep}api_token=${encodeURIComponent(token)}`, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw Object.assign(new Error(j.error || `Pipedrive returned ${r.status}`), { status: r.status === 404 ? 404 : 502 });
  return j.data;
}
const primary = list => (Array.isArray(list) ? (list.find(x => x.primary) || list[0] || {}).value : "") || "";
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
      const form = new FormData();
      form.append("file", new Blob([Buffer.from(pdfBase64, "base64")], { type: "application/pdf" }), filename || "Quote.pdf");
      form.append("deal_id", String(dealId));
      const file = await pd(`/files`, { method: "POST", body: form });
      if (note) await pd(`/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: note, deal_id: Number(dealId) }) });
      if (process.env.UPDATE_DEAL_VALUE !== "false" && value) {
        await pd(`/deals/${dealId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: Math.round(value * 100) / 100, currency: "AUD" }) });
      }
      return json({ ok: true, fileId: file && file.id });
    }
    return json({ error: "Unsupported request" }, 405);
  } catch (e) {
    return json({ error: e.message }, e.status || 500);
  }
};

export const config = { path: "/api/pipedrive" };
