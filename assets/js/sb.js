/* ============================================================
   Capitan — shared Supabase data layer for the public site.
   Plain REST with the anon key (public by design); RLS enforces
   what anonymous visitors can read (published rows) and write
   (enquiries / applications inserts only).
   ============================================================ */
(() => {
  "use strict";

  const SB_URL = "https://iybbkkwffusypyavmmvd.supabase.co";
  const SB_ANON =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5YmJra3dmZnVzeXB5YXZtbXZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5OTk5MzksImV4cCI6MjEwMTU3NTkzOX0.qKD9jSKzJP8_AR9qu_RISdEm1tE0Ta5xnXZ2Bj2CbB8";

  async function rest(path, { method = "GET", body, headers = {} } = {}) {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: SB_ANON,
        Authorization: `Bearer ${SB_ANON}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }

  const q = (o) =>
    Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

  const CapitanDB = {
    posts: (limit = 24) =>
      rest(`posts?${q({
        select: "slug,title,excerpt,cover_url,category,published_at",
        published: "eq.true",
        order: "published_at.desc",
        limit,
      })}`),
    post: (slug) =>
      rest(`posts?${q({
        select: "slug,title,excerpt,content,cover_url,category,published_at",
        published: "eq.true",
        slug: `eq.${slug}`,
        limit: 1,
      })}`).then((r) => r[0] || null),
    projects: () =>
      rest(`projects?${q({
        select: "id,title,tag,meta,image_url,link_url,year",
        published: "eq.true",
        order: "sort_order.asc",
      })}`),
    project: (id) =>
      rest(`projects?${q({
        select: "id,title,tag,meta,image_url,link_url,intro,body,year,location,status,summary,client,industry,duration,live_url,objective,challenge,result,gallery_url,gallery2_url,gallery3_url",
        published: "eq.true",
        id: `eq.${id}`,
        limit: 1,
      })}`).then((r) => r[0] || null),
    subscribe: (email, source) =>
      rest("subscribers", { method: "POST", body: { email, source: source || "blog" }, headers: { Prefer: "return=minimal" } }),
    products: () =>
      rest(`products?${q({
        select: "slug,title,tag,summary,cover_url",
        published: "eq.true",
        order: "sort_order.asc",
      })}`),
    product: (slug) =>
      rest(`products?${q({
        select: "slug,title,tag,summary,cover_url,gallery_url,gallery2_url,gallery3_url,intro,body,specs,uses",
        published: "eq.true",
        slug: `eq.${slug}`,
        limit: 1,
      })}`).then((r) => r[0] || null),
    careers: () =>
      rest(`careers?${q({
        select: "id,title,department,location,type,description,requirements",
        published: "eq.true",
        order: "created_at.asc",
      })}`),
    submitEnquiry: (row) =>
      rest("enquiries", { method: "POST", body: row, headers: { Prefer: "return=minimal" } }),
    // Résumé upload. The bucket is private: anyone may write, only an
    // admin can read it back, so CVs are never publicly addressable.
    uploadResume: async (file) => {
      const safe = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
      const res = await fetch(`${SB_URL}/storage/v1/object/resumes/${encodeURIComponent(path)}`, {
        method: "POST",
        headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}`, "x-upsert": "false" },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      return `resumes/${path}`;
    },
    submitApplication: (row) =>
      rest("applications", { method: "POST", body: row, headers: { Prefer: "return=minimal" } }),
  };

  /* ---------- tiny markdown renderer (headings, lists, quotes,
     bold/italic/code, links, images, hr, paragraphs) ---------- */
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function inline(s) {
    return s
      .replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  }
  function renderMarkdown(md) {
    const lines = esc(md || "").replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let list = null, para = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };
    for (const raw of lines) {
      const line = raw.trimEnd();
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      const ul = line.match(/^[-*]\s+(.*)$/);
      const ol = line.match(/^\d+\.\s+(.*)$/);
      if (!line.trim()) { flushPara(); flushList(); continue; }
      if (h) { flushPara(); flushList(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); continue; }
      if (/^(---|\*\*\*)\s*$/.test(line)) { flushPara(); flushList(); out.push("<hr>"); continue; }
      if (line.startsWith("&gt; ")) { flushPara(); flushList(); out.push(`<blockquote>${inline(line.slice(5))}</blockquote>`); continue; }
      if (ul) { flushPara(); if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; } list.items.push(ul[1]); continue; }
      if (ol) { flushPara(); if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; } list.items.push(ol[1]); continue; }
      para.push(line);
    }
    flushPara(); flushList();
    return out.join("\n");
  }

  const fmtDate = (iso) =>
    new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const readMins = (t) => Math.max(2, Math.round((t || "").split(/\s+/).length / 200));

  window.CapitanDB = CapitanDB;
  window.CapitanMD = { renderMarkdown, esc, fmtDate, readMins };
})();
