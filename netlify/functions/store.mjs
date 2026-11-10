// Shared storage for the CPQ app: the price book (config/pricebook) and saved quotes (quotes/<id>).
// Backed by Netlify Blobs. Writes to the price book need the ADMIN_KEY header when ADMIN_KEY is set.
import { getStore } from "@netlify/blobs";
import seed from "../../data/pricebook.json";

const DOC_RE = /^(config|quotes)\/[A-Za-z0-9_-]{1,80}$/;
const COLLECTIONS = new Set(["quotes"]);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  const store = getStore({ name: "cpq", consistency: "strong" });
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  const collection = url.searchParams.get("collection");
  const adminOk = !process.env.ADMIN_KEY || req.headers.get("x-admin-key") === process.env.ADMIN_KEY;

  if (path && !DOC_RE.test(path)) return json({ error: "Bad path" }, 400);
  if (collection && !COLLECTIONS.has(collection)) return json({ error: "Bad collection" }, 400);

  try {
    if (req.method === "GET" && path) {
      let data = await store.get(path, { type: "json" });
      if (!data && path === "config/pricebook") { data = seed; await store.setJSON(path, data); }
      return json({ data: data || null });
    }
    if (req.method === "GET" && collection) {
      const { blobs } = await store.list({ prefix: collection + "/" });
      const docs = (await Promise.all(blobs.map(async b => ({ id: b.key.split("/").pop(), data: await store.get(b.key, { type: "json" }) })))).filter(d => d.data);
      return json({ docs });
    }
    if (req.method === "POST" && collection) {
      const { data } = await req.json();
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      await store.setJSON(`${collection}/${id}`, data);
      return json({ id }, 201);
    }
    if (req.method === "PUT" && path) {
      if (path.startsWith("config/") && !adminOk) return json({ error: "Admin key required" }, 403);
      const { data, merge } = await req.json();
      const next = merge ? { ...((await store.get(path, { type: "json" })) || {}), ...data } : data;
      await store.setJSON(path, next);
      return json({ ok: true });
    }
    if (req.method === "DELETE" && path) {
      if (path.startsWith("config/") && !adminOk) return json({ error: "Admin key required" }, 403);
      await store.delete(path);
      return new Response(null, { status: 204 });
    }
    return json({ error: "Unsupported request" }, 400);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};

export const config = { path: "/api/store" };
