/* ============================================================
   CAPITAN Admin panel — CMS (posts / projects / careers) and
   CRM (enquiries / applications) over Supabase with RLS.
   Auth-gated: requires a session AND membership in `admins`.
   ============================================================ */
(() => {
  "use strict";

  const sb = supabase.createClient(
    "https://iybbkkwffusypyavmmvd.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5YmJra3dmZnVzeXB5YXZtbXZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5OTk5MzksImV4cCI6MjEwMTU3NTkzOX0.qKD9jSKzJP8_AR9qu_RISdEm1tE0Ta5xnXZ2Bj2CbB8"
  );
  const MD = window.CapitanMD;
  const $ = (id) => document.getElementById(id);
  const esc = MD.esc;
  const fmt = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const fmtT = (iso) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  /* ---------------- shared UI ---------------- */
  let toastTimer;
  function toast(text, kind) {
    const el = $("toast");
    el.textContent = text;
    el.className = `toast on ${kind || ""}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("on"), 3800);
  }
  function confirmBox(title, text) {
    return new Promise((resolve) => {
      $("confirmTitle").textContent = title;
      $("confirmText").textContent = text;
      $("confirmScrim").classList.add("on");
      const done = (v) => { $("confirmScrim").classList.remove("on"); yes.onclick = no.onclick = null; resolve(v); };
      const yes = $("confirmYes"), no = $("confirmNo");
      yes.onclick = () => done(true);
      no.onclick = () => done(false);
    });
  }
  function openDrawer(title) {
    $("drawerTitle").textContent = title;
    $("drawer").classList.add("on");
    $("drawerScrim").classList.add("on");
  }
  function closeDrawer() {
    $("drawer").classList.remove("on");
    $("drawerScrim").classList.remove("on");
    $("drawerBody").innerHTML = "";
    $("drawerFoot").innerHTML = "";
  }
  $("drawerClose").addEventListener("click", closeDrawer);
  $("drawerScrim").addEventListener("click", closeDrawer);
  addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDrawer(); $("confirmScrim").classList.remove("on"); } });

  $("menuToggle").addEventListener("click", () => document.body.classList.add("sb-open"));
  $("sbScrim").addEventListener("click", () => document.body.classList.remove("sb-open"));

  const fieldHTML = (label, inner) => `<label class="field">${label}${inner}</label>`;
  const inputF = (name, val = "", ph = "", type = "text") =>
    fieldHTML(name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
      `<input name="${name}" value="${esc(String(val ?? ""))}" placeholder="${ph}" ${type === "text" ? "" : `type="${type}"`}>`);

  async function uploadTo(file, folder) {
    const path = `${folder}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const { error } = await sb.storage.from("media").upload(path, file, { upsert: false });
    if (error) throw error;
    return sb.storage.from("media").getPublicUrl(path).data.publicUrl;
  }
  /* An image field: preview, the URL itself, and an Upload button that puts a
     file from the machine into the media bucket and writes the URL back. */
  function imageF(name, val = "", ph = "") {
    const label = name.replace(/_url$/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) + " image";
    return fieldHTML(label, `
      <div class="upload-row">
        <img data-up-prev="${name}" src="${esc(String(val || ""))}" alt="" onerror="this.style.visibility='hidden'">
        <input name="${name}" value="${esc(String(val || ""))}" placeholder="${ph || "https://… or upload →"}" style="flex:1">
        <button type="button" class="btn btn-ghost btn-sm" data-up-btn="${name}">Upload</button>
        <input type="file" data-up-file="${name}" accept="image/*" hidden>
      </div>`);
  }

  /* Delegated on the drawer, so every drawer built later is covered without
     having to remember to wire each field up. */
  $("drawerBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-up-btn]");
    if (!btn) return;
    const file = $("drawerBody").querySelector(`[data-up-file="${btn.dataset.upBtn}"]`);
    if (file) file.click();
  });
  $("drawerBody").addEventListener("change", async (e) => {
    const input = e.target.closest("[data-up-file]");
    if (!input || !input.files[0]) return;
    const key = input.dataset.upFile;
    const body = $("drawerBody");
    const btn = body.querySelector(`[data-up-btn="${key}"]`);
    const field = body.querySelector(`[name="${key}"]`);
    const prev = body.querySelector(`[data-up-prev="${key}"]`);
    const file = input.files[0];
    input.value = "";
    if (!/^image\//.test(file.type)) return toast("Choose an image file.", "err");
    if (file.size > 8 * 1024 * 1024) return toast("Keep images under 8 MB.", "err");
    if (btn) { btn.disabled = true; btn.textContent = "Uploading…"; }
    try {
      const url = await uploadTo(file, "covers");
      if (field) field.value = url;
      if (prev) { prev.src = url; prev.style.visibility = ""; }
      toast("Image uploaded", "ok");
    } catch (err) {
      toast("Upload failed: " + (err.message || err), "err");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Upload"; }
    }
  });


  /* ---------------- visual block editor ----------------
     What you see in the box is the article: real headings, lists, images.
     Markdown remains the storage format — rendered in on open, serialised
     back out on every edit — so the site renderer and old posts are safe. */
  function htmlToMd(root) {
    const inl = (n) => {
      let s = "";
      n.childNodes.forEach((c) => {
        if (c.nodeType === 3) { s += c.nodeValue; return; }
        if (c.nodeType !== 1) return;
        const t = c.tagName;
        if (t === "BR") { s += "\n"; return; }
        if (t === "STRONG" || t === "B") { s += "**" + inl(c) + "**"; return; }
        if (t === "EM" || t === "I") { s += "*" + inl(c) + "*"; return; }
        if (t === "CODE") { s += "`" + c.textContent + "`"; return; }
        if (t === "A") { s += "[" + inl(c) + "](" + (c.getAttribute("href") || "") + ")"; return; }
        if (t === "IMG") { s += "![" + (c.getAttribute("alt") || "") + "](" + (c.getAttribute("src") || "") + ")"; return; }
        s += inl(c);
      });
      return s;
    };
    const H = { H1: "# ", H2: "# ", H3: "## ", H4: "### " };
    const out = [];
    root.childNodes.forEach((el) => {
      if (el.nodeType === 3) { const t = el.nodeValue.trim(); if (t) out.push(t); return; }
      if (el.nodeType !== 1) return;
      const t = el.tagName;
      if (H[t]) { const s = inl(el).trim(); if (s) out.push(H[t] + s); return; }
      if (t === "UL") { out.push([...el.children].map((li) => "- " + inl(li).trim()).join("\n")); return; }
      if (t === "OL") { out.push([...el.children].map((li, i) => (i + 1) + ". " + inl(li).trim()).join("\n")); return; }
      if (t === "BLOCKQUOTE") { const s = inl(el).trim(); if (s) out.push(s.split("\n").map((l) => "> " + l).join("\n")); return; }
      if (t === "HR") { out.push("---"); return; }
      const s = inl(el).trim();
      if (s) out.push(s);
    });
    return out.filter(Boolean).join("\n\n");
  }

  function initBlockEditor() {
    const body = $("drawerBody");
    const area = body.querySelector(".ed-area");
    const store = body.querySelector('textarea[name="content"]');
    if (!area || !store) return;
    area.innerHTML = MD.renderMarkdown(store.value) || "<p><br></p>";
    const sync = () => { store.value = htmlToMd(area); };
    area.addEventListener("input", sync);

    const exec = (cmd, val) => { area.focus(); document.execCommand(cmd, false, val); sync(); };
    body.querySelectorAll("[data-ed]").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.preventDefault();
        const k = b.dataset.ed;
        if (k === "h1") return exec("formatBlock", "<h2>");
        if (k === "h2") return exec("formatBlock", "<h3>");
        if (k === "h3") return exec("formatBlock", "<h4>");
        if (k === "p") return exec("formatBlock", "<p>");
        if (k === "quote") return exec("formatBlock", "<blockquote>");
        if (k === "bold") return exec("bold");
        if (k === "italic") return exec("italic");
        if (k === "ul") return exec("insertUnorderedList");
        if (k === "ol") return exec("insertOrderedList");
        if (k === "link") { const u = prompt("Link URL"); if (u) exec("createLink", u); return; }
      });
    });

    /* ---- the Framer-style gutter "+" ---- */
    const wrap = body.querySelector(".ed-wrap");
    const plus = body.querySelector(".ed-plus");
    const menu = body.querySelector(".ed-menu");
    const file = body.querySelector("#edImgFile");
    let anchorBlock = null;

    area.addEventListener("mousemove", (e) => {
      let el = e.target;
      while (el && el.parentElement !== area) el = el.parentElement;
      if (!el) return;
      anchorBlock = el;
      const wr = wrap.getBoundingClientRect(), br = el.getBoundingClientRect();
      plus.style.top = (br.bottom - wr.top - 13) + "px";
      plus.hidden = false;
    });
    wrap.addEventListener("mouseleave", () => { plus.hidden = true; menu.hidden = true; });

    plus.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.style.top = plus.style.top;
      menu.hidden = !menu.hidden;
    });
    document.addEventListener("click", (e) => {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== plus) menu.hidden = true;
    });

    const insertImage = (url, alt) => {
      const p = document.createElement("p");
      const img = document.createElement("img");
      img.src = url; img.alt = alt || "";
      p.appendChild(img);
      if (anchorBlock && anchorBlock.parentElement === area) anchorBlock.after(p);
      else area.appendChild(p);
      sync();
      toast("Image added", "ok");
    };

    menu.querySelector("[data-ins=upload]").addEventListener("click", () => { menu.hidden = true; file.click(); });
    menu.querySelector("[data-ins=url]").addEventListener("click", () => {
      menu.hidden = true;
      const u = prompt("Image URL");
      if (!u) return;
      insertImage(u, prompt("Describe the image (for screen readers)") || "");
    });
    file.addEventListener("change", async () => {
      const f = file.files[0];
      file.value = "";
      if (!f) return;
      if (!/^image\//.test(f.type)) return toast("Choose an image file.", "err");
      if (f.size > 8 * 1024 * 1024) return toast("Keep images under 8 MB.", "err");
      toast("Uploading image…");
      try {
        const url = await uploadTo(f, "content");
        insertImage(url, prompt("Describe the image (for screen readers)") || "");
      } catch (err) {
        toast("Upload failed: " + (err.message || err), "err");
      }
    });
  }
  const slugify = (s) =>
    s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

  /* ---------------- roles ----------------
     sub_admin  : content only — never sees the roster
     admin      : content + may seat and remove sub_admins
     super_admin: everything, and the only role that can touch admins */
  let myRole = "sub_admin";
  const ROLES = { sub_admin: "Sub admin", admin: "Admin", super_admin: "Super admin" };
  const canManageUsers = () => myRole === "admin" || myRole === "super_admin";
  const isSuper = () => myRole === "super_admin";
  /* who this caller is allowed to edit or remove */
  const canTouch = (row) =>
    row.user_id !== currentUser?.id &&
    (isSuper() || (canManageUsers() && row.role === "sub_admin"));
  const assignableRoles = () => (isSuper() ? ["sub_admin", "admin", "super_admin"] : ["sub_admin"]);

  /* ---------------- auth gate ---------------- */
  async function gate() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace("/admin/login"); return null; }
    const { data: roster, error } = await sb.from("admins")
      .select("user_id,role,full_name,email,phone,avatar_url").eq("user_id", session.user.id);
    if (error || !roster || !roster.length) {
      /* an alert is easy to miss and Chrome can suppress it mid-navigation —
         bounce back with the reason so the login page can state it plainly */
      const who = session.user.email || "";
      await sb.auth.signOut();
      location.replace("/admin/login?denied=" + encodeURIComponent(who));
      return null;
    }
    myRole = roster[0].role || "sub_admin";
    document.body.dataset.role = myRole;
    if (canManageUsers()) $("navUsers").hidden = false;
    renderIdentity(session.user);
    syncRosterRow(session.user, roster[0]);
    return session;
  }
  $("signOut").addEventListener("click", async () => {
    await sb.auth.signOut();
    location.replace("/admin/login");
  });

  /* ---------------- identity + profile ----------------
     Display name and photo live in the user's own auth metadata, so this
     works without a profiles table or extra RLS. The photo goes to the
     public `media` bucket the CMS already uses. */
  let currentUser = null;

  function renderIdentity(user) {
    currentUser = user;
    const email = user.email || "admin";
    const meta = user.user_metadata || {};
    const name =
      [meta.first_name, meta.last_name].filter(Boolean).join(" ").trim() ||
      (meta.full_name || "").trim() ||
      email.split("@")[0];
    document.querySelectorAll("[data-name]").forEach((el) => {
      el.textContent = name; el.title = name;
    });
    document.querySelectorAll("[data-avatar]").forEach((el) => {
      if (meta.avatar_url) el.innerHTML = `<img src="${esc(meta.avatar_url)}" alt="">`;
      else el.textContent = name[0].toUpperCase();
    });
    $("userEmail").textContent = email;
    $("userEmail").title = email;
  }

  /* the roster row is what other admins see; auth metadata is what the owner
     edits. Reconcile them quietly at sign-in. */
  async function syncRosterRow(user, row) {
    const m = user.user_metadata || {};
    const want = {
      full_name: [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || m.full_name || null,
      phone: m.phone || null,
      avatar_url: m.avatar_url || null,
      email: user.email || null,
    };
    const drift = Object.keys(want).some((k) => (row[k] ?? null) !== want[k]);
    if (drift) await sb.from("admins").update(want).eq("user_id", user.id);
  }

  async function saveProfile(patch) {
    const { data, error } = await sb.auth.updateUser({ data: patch });
    if (error) { toast(error.message, "err"); return false; }
    renderIdentity(data.user);
    /* mirror onto the roster row so the Users table isn't stale. RLS lets a
       person edit their own row but pins the role, so this can't self-promote.
       A failure here is not worth blocking the save on. */
    const m = data.user.user_metadata || {};
    const mirror = {};
    if ("first_name" in patch || "last_name" in patch)
      mirror.full_name = [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || null;
    if ("phone" in patch) mirror.phone = m.phone || null;
    if ("avatar_url" in patch) mirror.avatar_url = m.avatar_url || null;
    if (Object.keys(mirror).length)
      await sb.from("admins").update(mirror).eq("user_id", data.user.id);
    return true;
  }

  async function pickAvatar(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast("Choose an image file.", "err"); return; }
    if (file.size > 4 * 1024 * 1024) { toast("Keep the photo under 4 MB.", "err"); return; }
    toast("Uploading photo…");
    try {
      const url = await uploadTo(file, "avatars");
      if (await saveProfile({ avatar_url: url })) toast("Photo updated", "ok");
    } catch (e) {
      toast(e.message || "Upload failed", "err");
    }
  }

  $("avatarFile").addEventListener("change", (e) => {
    pickAvatar(e.target.files[0]);
    e.target.value = "";
  });
  /* profile menu */
  const pmenu = $("profileMenu"), pbtn = $("profileBtn");
  const setMenu = (open) => {
    pmenu.hidden = !open;
    pbtn.setAttribute("aria-expanded", String(open));
  };
  pbtn.addEventListener("click", (e) => { e.stopPropagation(); setMenu(pmenu.hidden); });
  document.addEventListener("click", (e) => {
    if (!pmenu.hidden && !pmenu.contains(e.target)) setMenu(false);
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });
  $("menuPhoto").addEventListener("click", () => { setMenu(false); $("avatarFile").click(); });
  /* notifications — the unread enquiry/application counts, refreshed on
     every view change so the dot is honest away from the dashboard too */
  const nmenu = $("notifMenu"), nbtn = $("notifBell");
  const setNotif = (open) => {
    nmenu.hidden = !open;
    nbtn.setAttribute("aria-expanded", String(open));
  };
  nbtn.addEventListener("click", (e) => { e.stopPropagation(); setMenu(false); setNotif(nmenu.hidden); });
  document.addEventListener("click", (e) => {
    if (!nmenu.hidden && !nmenu.contains(e.target)) setNotif(false);
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape") setNotif(false); });

  async function refreshNotifications() {
    const tally = (t) =>
      sb.from(t).select("*", { count: "exact", head: true }).eq("status", "new").then((r) => r.count ?? 0);
    let e = 0, a = 0;
    try { [e, a] = await Promise.all([tally("enquiries"), tally("applications")]); } catch (_) { return; }
    $("notifDot").hidden = !(e + a);
    const cE = $("cntEnq"), cA = $("cntApp");
    if (cE) { cE.hidden = !e; cE.textContent = e; }
    if (cA) { cA.hidden = !a; cA.textContent = a; }
    const rows = [];
    if (e) rows.push(["enquiries", `${e} new ${e === 1 ? "enquiry" : "enquiries"}`, "Someone asked about a division or product."]);
    if (a) rows.push(["applications", `${a} new ${a === 1 ? "application" : "applications"}`, "A candidate applied for an open role."]);
    $("notifList").innerHTML = rows.length
      ? rows.map(([v, t, d]) => `<button role="menuitem" data-go="${v}"><b>${t}</b><small>${d}</small></button>`).join("")
      : '<div class="tb-notif-empty">Nothing new right now.</div>';
    $("notifList").querySelectorAll("[data-go]").forEach((b) => {
      b.onclick = () => { setNotif(false); nav(b.dataset.go); };
    });
  }

  $("editProfile").addEventListener("click", () => {
    setMenu(false);
    const meta = (currentUser && currentUser.user_metadata) || {};
    const email = (currentUser && currentUser.email) || "";
    /* the name lives in [data-name] slots now, not a single #userName */
    const initial = ((document.querySelector("[data-name]") || {}).textContent || "A")[0].toUpperCase();
    openDrawer("Edit profile");
    $("drawerBody").innerHTML = `
      <div class="pf-row">
        <span class="pf-shot" data-avatar>${meta.avatar_url ? `<img src="${esc(meta.avatar_url)}" alt="">` : initial}</span>
        <div class="pf-actions">
          <button class="btn btn-ghost btn-sm" type="button" id="pfPick">Change photo</button>
          ${meta.avatar_url ? '<button class="btn btn-ghost btn-sm" type="button" id="pfClear">Remove photo</button>' : ""}
          <span class="pf-hint">Hard hat optional.</span>
        </div>
      </div>
      <div class="pf-grid">
        <label class="field">First name
          <input name="first_name" id="pfFirst" value="${esc(meta.first_name || "")}" placeholder="Sujan">
        </label>
        <label class="field">Last name
          <input name="last_name" id="pfLast" value="${esc(meta.last_name || "")}" placeholder="Dandgulkar">
        </label>
      </div>
      <label class="field">Phone
        <input name="phone" id="pfPhone" type="tel" value="${esc(meta.phone || "")}" placeholder="+91 ">
      </label>
      <label class="field">Email
        <input value="${esc(email)}" disabled>
      </label>
      <span class="pf-hint">Email changes and passwords are handled from the sign-in page.</span>
    `;

    $("drawerFoot").innerHTML =
      '<button class="btn btn-ghost" id="pfCancel">Cancel</button><button class="btn btn-accent" id="pfSave">Save</button>';

    $("pfPick").onclick = () => $("avatarFile").click();
    const clr = $("pfClear");
    if (clr) clr.onclick = async () => {
      if (await saveProfile({ avatar_url: null })) { toast("Photo removed", "ok"); closeDrawer(); }
    };
    $("pfCancel").onclick = closeDrawer;
    $("pfSave").onclick = async () => {
      const first = $("pfFirst").value.trim();
      const last = $("pfLast").value.trim();
      const ok = await saveProfile({
        first_name: first,
        last_name: last,
        full_name: [first, last].filter(Boolean).join(" "),
        phone: $("pfPhone").value.trim(),
      });
      if (ok) { toast("Profile saved", "ok"); closeDrawer(); }
    };
  });

  /* ---------------- router ---------------- */
  const root = $("viewRoot");
  const views = {};
  let current = "dashboard";
  let searchTerm = "";

  function setChrome({ title, action, search }) {
    $("pageTitle").textContent = title;
    const pa = $("primaryAction");
    pa.hidden = !action;
    if (action) { pa.textContent = action.label; pa.onclick = action.onClick; }
    searchTerm = "";
  }


  function nav(view) {
    current = view;
    document.querySelectorAll(".sb-link").forEach((a) =>
      a.classList.toggle("on", a.dataset.view === view));
    document.body.classList.remove("sb-open");
    root.innerHTML = `<div class="skel" style="height:180px"></div>`;
    views[view].render();
    refreshNotifications();
  }
  $("sbNav").addEventListener("click", (e) => {
    const a = e.target.closest(".sb-link");
    if (!a) return;
    e.preventDefault();
    history.replaceState(null, "", "#" + a.dataset.view);
    nav(a.dataset.view);
  });

  const table = (cols, rowsHTML, emptyMsg) => `
    <div class="panel"><table class="grid">
      <thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
      <tbody>${rowsHTML || ""}</tbody>
    </table>${rowsHTML ? "" : `<div class="empty"><b>Nothing here yet</b>${emptyMsg}</div>`}</div>`;

  const editIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4L20 8l-4-4L4 16v4Z"/></svg>`;
  const trashIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7"/></svg>`;

  /* KPI tile — coloured plate, translucent icon, figure right (Figma 20:3) */
  const ICO = {
    doc:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h13a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4Z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.5-5.4A8.5 8.5 0 1 1 21 12Z"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z"/><path d="m3 7 9 6 9-6"/></svg>',
  };
  const kpi = (tone, icon, num, label) => `
    <div class="kpi kpi-${tone}">
      <span class="kpi-ico">${icon}</span>
      <span class="kpi-txt">
        <span class="kpi-lbl">${label}</span>
        <span class="kpi-num">${num}</span>
      </span>
    </div>`;

  /* ================= DASHBOARD ================= */
  views.dashboard = {
    async render() {
      setChrome({ title: "Dashboard" });
      const count = (t, filt) => {
        let q = sb.from(t).select("*", { count: "exact", head: true });
        if (filt) q = q.eq(...filt);
        return q.then((r) => r.count ?? 0);
      };
      const [posts, pubPosts, enqNew, appNew, subs, recent] = await Promise.all([
        count("posts"), count("posts", ["published", true]),
        count("enquiries", ["status", "new"]), count("applications", ["status", "new"]),
        count("subscribers"),
        sb.from("enquiries").select("name,contact,division,created_at,status").order("created_at", { ascending: false }).limit(6),
      ]);
      root.innerHTML = `
        <div class="cards">
          ${kpi(1, ICO.doc,  posts, `Insights <span style="opacity:.8">(${pubPosts} live)</span>`)}
          ${kpi(2, ICO.chat, enqNew, "New enquiries")}
          ${kpi(3, ICO.user, appNew, "New applications")}
          ${kpi(4, ICO.mail, subs, "Subscribers")}
        </div>
        <div class="panel">
          <div class="panel-head"><h2>Latest enquiries</h2></div>
          ${(recent.data || []).length ? `<table class="grid"><tbody>
            ${recent.data.map((r) => `<tr>
              <td class="title-cell">${esc(r.name)}<div class="muted">${esc(r.contact)}</div></td>
              <td>${esc(r.division || "—")}</td>
              <td><span class="pillstat ${r.status === "new" ? "draft" : "pub"}">${r.status}</span></td>
              <td class="muted">${fmtT(r.created_at)}</td>
            </tr>`).join("")}
          </tbody></table>` : `<div class="empty"><b>No enquiries yet</b>They'll appear here as the contact form is used.</div>`}
        </div>`;
      const [e, a] = await Promise.all([count("enquiries", ["status", "new"]), count("applications", ["status", "new"])]);
      $("cntEnq").hidden = !e; $("cntEnq").textContent = e;
      $("cntApp").hidden = !a; $("cntApp").textContent = a;
      $("notifDot").hidden = !(e + a);
    },
  };

  /* ================= USERS ================= */
  views.users = {
    async render() {
      if (!canManageUsers()) {
        setChrome({ title: "Users" });
        root.innerHTML = '<div class="empty"><b>No access</b>Only admins and super admins can manage users.</div>';
        return;
      }
      setChrome({ title: "Users", action: { label: "＋ Add user", onClick: () => userDrawer() } });

      const [roster, invites] = await Promise.all([
        sb.from("admins").select("user_id,role,full_name,email,phone,avatar_url,created_at").order("created_at"),
        sb.from("admin_invites").select("id,email,full_name,phone,role,created_at").order("created_at"),
      ]);
      if (roster.error) {
        root.innerHTML = `<div class="empty"><b>Couldn't load the roster</b>${esc(roster.error.message)}</div>`;
        return;
      }
      const rows = roster.data || [];
      const pend = invites.data || [];

      root.innerHTML = `
        <div class="panel">
          <div class="panel-head"><h2>Team</h2><span class="muted">${rows.length} ${rows.length === 1 ? "person" : "people"}</span></div>
          <table class="grid"><thead><tr>
            <th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th></th>
          </tr></thead><tbody>
          ${rows.map((r) => `<tr>
            <td class="title-cell">
              <span class="u-row">
                <span class="u-av">${r.avatar_url
                  ? `<img src="${esc(r.avatar_url)}" alt="">`
                  : esc(((r.full_name || r.email || "?").trim()[0] || "?").toUpperCase())}</span>
                <span class="u-name">${esc(r.full_name || "—")}</span>
                ${r.user_id === currentUser?.id ? '<span class="pillstat pub">You</span>' : ""}
              </span>
            </td>
            <td class="muted">${esc(r.email || "—")}</td>
            <td class="muted">${esc(r.phone || "—")}</td>
            <td><span class="pillstat ${r.role === "super_admin" ? "pub" : "draft"}">${ROLES[r.role] || r.role}</span></td>
            <td class="row-actions">
              ${canTouch(r) ? `<button class="icon-btn" data-edit="${r.user_id}" title="Edit">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/></svg>
              </button>
              <button class="icon-btn danger" data-del="${r.user_id}" title="Remove">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>
              </button>` : '<span class="muted" style="font-size:12.5px">—</span>'}
            </td></tr>`).join("")}
          </tbody></table>
        </div>

        ${pend.length ? `<div class="panel" style="margin-top:20px">
          <div class="panel-head"><h2>Pending invites</h2><span class="muted">Access starts at their first sign-in</span></div>
          <table class="grid"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th></th></tr></thead><tbody>
          ${pend.map((p) => `<tr>
            <td class="title-cell">
              <span class="u-row">
                <span class="u-av ghost">${esc(((p.full_name || p.email || "?").trim()[0] || "?").toUpperCase())}</span>
                <span class="u-name">${esc(p.full_name || "—")}</span>
              </span>
            </td>
            <td class="muted">${esc(p.email)}</td>
            <td class="muted">${esc(p.phone || "—")}</td>
            <td><span class="pillstat draft">${ROLES[p.role] || p.role}</span></td>
            <td class="row-actions"><button class="icon-btn danger" data-cancel="${p.id}" title="Cancel invite">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button></td></tr>`).join("")}
          </tbody></table></div>` : ""}
      `;

      root.querySelectorAll("[data-edit]").forEach((b) => {
        b.onclick = () => userDrawer(rows.find((r) => r.user_id === b.dataset.edit));
      });
      root.querySelectorAll("[data-del]").forEach((b) => {
        b.onclick = async () => {
          const r = rows.find((x) => x.user_id === b.dataset.del);
          if (!(await confirmBox("Remove this person?", `${r.full_name || r.email} loses access to the panel immediately.`))) return;
          const { error } = await sb.from("admins").delete().eq("user_id", r.user_id);
          if (error) return toast(error.message, "err");
          toast("Access removed", "ok");
          views.users.render();
        };
      });
      root.querySelectorAll("[data-cancel]").forEach((b) => {
        b.onclick = async () => {
          const { error } = await sb.from("admin_invites").delete().eq("id", b.dataset.cancel);
          if (error) return toast(error.message, "err");
          toast("Invite cancelled", "ok");
          views.users.render();
        };
      });
    },
  };

  /* Add = an invite keyed on email; the row is seated automatically the first
     time that address signs in. Edit = change an existing member in place. */
  function userDrawer(row) {
    const editing = !!row;
    openDrawer(editing ? "Edit user" : "Add user");
    const opts = assignableRoles()
      .map((r) => `<option value="${r}"${row && row.role === r ? " selected" : ""}>${ROLES[r]}</option>`)
      .join("");
    $("drawerBody").innerHTML = `
      <label class="field">Full name
        <input name="full_name" value="${esc(row?.full_name || "")}" placeholder="Their name">
      </label>
      <label class="field">Email
        <input name="email" type="email" value="${esc(row?.email || "")}" placeholder="name@capitan.co.in" ${editing ? "disabled" : ""}>
      </label>
      <label class="field">Phone
        <input name="phone" value="${esc(row?.phone || "")}" placeholder="+91 ">
      </label>
      <label class="field">Role
        <select name="role">${opts}</select>
      </label>
      <p class="pf-hint">${editing
        ? (isSuper() ? "Super admins can change any role." : "Admins can edit sub admins only.")
        : "They get access the first time they sign in with this email."}</p>
    `;
    $("drawerFoot").innerHTML =
      '<button class="btn btn-ghost" id="uCancel">Cancel</button><button class="btn btn-accent" id="uSave">Save</button>';
    $("uCancel").onclick = closeDrawer;
    $("uSave").onclick = async () => {
      const body = $("drawerBody");
      const val = (n) => body.querySelector(`[name=${n}]`).value.trim();
      const payload = { full_name: val("full_name"), phone: val("phone"), role: val("role") };
      if (!editing) {
        const email = val("email").toLowerCase();
        if (!email) return toast("An email is required.", "err");
        const { error } = await sb.from("admin_invites").insert({ ...payload, email, invited_by: currentUser?.id });
        if (error) return toast(/duplicate/i.test(error.message) ? "That email is already invited." : error.message, "err");
        toast("Invite created", "ok");
      } else {
        const { error } = await sb.from("admins").update(payload).eq("user_id", row.user_id);
        if (error) return toast(error.message, "err");
        toast("User updated", "ok");
      }
      closeDrawer();
      views.users.render();
    };
  }

  /* ================= POSTS ================= */
  views.posts = {
    rows: [],
    async render() {
      setChrome({
        title: "Insights",
        search: true,
        action: { label: "＋ New post", onClick: () => views.posts.edit(null) },
      });
      const { data, error } = await sb.from("posts").select("*").order("created_at", { ascending: false });
      if (error) { toast(error.message, "err"); return; }
      this.rows = data;
      this.paint();
    },
    paint() {
      const rows = this.rows.filter((p) =>
        !searchTerm || (p.title + p.slug + p.category).toLowerCase().includes(searchTerm));
      root.innerHTML = table(
        ["", "Title", "Category", "Status", "Published", ""],
        rows.map((p) => `<tr data-id="${p.id}">
          <td style="width:76px"><img class="thumb" src="${p.cover_url || ""}" alt="" onerror="this.style.visibility='hidden'"></td>
          <td class="title-cell">${esc(p.title)}<div class="muted">/${esc(p.slug)}</div></td>
          <td>${esc(p.category)}</td>
          <td><span class="pillstat ${p.published ? "pub" : "draft"}">${p.published ? "Live" : "Draft"}</span></td>
          <td class="muted">${p.published_at ? fmt(p.published_at) : "—"}</td>
          <td><div class="row-actions">
            <button class="icon-btn" data-act="edit" title="Edit">${editIcon}</button>
            <button class="icon-btn danger" data-act="del" title="Delete">${trashIcon}</button>
          </div></td>
        </tr>`).join(""),
        "Create your first insight with “New post”."
      );
      root.querySelector("tbody")?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        const row = this.rows.find((r) => r.id === btn.closest("tr").dataset.id);
        btn.dataset.act === "edit" ? this.edit(row) : this.del(row);
      });
    },
    onSearch() { this.paint(); },
    async del(row) {
      if (!(await confirmBox("Delete post?", `“${row.title}” will be permanently removed.`))) return;
      const { error } = await sb.from("posts").delete().eq("id", row.id);
      if (error) return toast(error.message, "err");
      toast("Post deleted", "ok");
      this.render();
    },
    edit(row) {
      const isNew = !row;
      row = row || { title: "", slug: "", category: "Insights", excerpt: "", content: "", cover_url: "", published: false };
      openDrawer(isNew ? "New post" : "Edit post");
      $("drawerBody").innerHTML = `
        ${inputF("title", row.title, "Post headline")}
        <div class="two-col">
          ${inputF("slug", row.slug, "auto-from-title")}
          ${inputF("category", row.category, "Materials / Industry / Operations")}
        </div>
        ${fieldHTML("Excerpt", `<textarea name="excerpt" rows="2" placeholder="One–two lines shown on cards">${esc(row.excerpt || "")}</textarea>`)}
        ${imageF("cover_url", row.cover_url, "Card and hero image")}
        <div class="field">Content
          <div class="ed-wrap">
            <div class="md-bar">
              <button type="button" data-ed="h1" title="Heading">H1</button>
              <button type="button" data-ed="h2" title="Subheading">H2</button>
              <button type="button" data-ed="h3" title="Small heading">H3</button>
              <button type="button" data-ed="p" title="Paragraph">P</button>
              <i class="md-sep"></i>
              <button type="button" data-ed="bold" title="Bold"><b>B</b></button>
              <button type="button" data-ed="italic" title="Italic"><em>I</em></button>
              <i class="md-sep"></i>
              <button type="button" data-ed="ul" title="Bullet list">• List</button>
              <button type="button" data-ed="ol" title="Numbered list">1. List</button>
              <button type="button" data-ed="quote" title="Quote">❝</button>
              <i class="md-sep"></i>
              <button type="button" data-ed="link" title="Link">Link</button>
            </div>
            <div class="ed-area" contenteditable="true" spellcheck="true"></div>
            <button type="button" class="ed-plus" hidden title="Insert an image here">＋</button>
            <div class="ed-menu" hidden>
              <button type="button" data-ins="upload">Upload image…</button>
              <button type="button" data-ins="url">Image by URL…</button>
            </div>
            <input type="file" id="edImgFile" accept="image/*" hidden>
          </div>
          <textarea name="content" hidden>${esc(row.content || "")}</textarea>
        </div>
        <label class="switch"><input type="checkbox" name="published" ${row.published ? "checked" : ""}><span class="track"></span> Published (visible on the site)</label>`;
      $("drawerFoot").innerHTML = `
        ${isNew ? "" : `<button class="btn btn-danger" id="dDel">Delete</button>`}
        <div class="grow"></div>
        <button class="btn btn-ghost" id="dCancel">Cancel</button>
        <button class="btn btn-accent" id="dSave">${isNew ? "Create post" : "Save changes"}</button>`;

      const body = $("drawerBody");
      const titleInp = body.querySelector("[name=title]");
      const slugInp = body.querySelector("[name=slug]");
      let slugTouched = !isNew && !!row.slug;
      slugInp.addEventListener("input", () => (slugTouched = true));
      titleInp.addEventListener("input", () => { if (!slugTouched) slugInp.value = slugify(titleInp.value); });

      initBlockEditor();

      $("dCancel").onclick = closeDrawer;
      if (!isNew) $("dDel").onclick = () => { closeDrawer(); this.del(row); };
      $("dSave").onclick = async () => {
        const f = new FormData();
        body.querySelectorAll("input[name],textarea[name]").forEach((i) =>
          f.set(i.name, i.type === "checkbox" ? i.checked : i.value));
        const published = f.get("published") === "true" || f.get("published") === true;
        const rec = {
          title: f.get("title").trim(),
          slug: slugify(f.get("slug") || f.get("title")),
          category: f.get("category").trim() || "Insights",
          excerpt: f.get("excerpt").trim() || null,
          cover_url: f.get("cover_url").trim() || null,
          content: f.get("content"),
          published,
          published_at: published ? (row.published_at || new Date().toISOString()) : row.published_at,
        };
        if (!rec.title || !rec.slug) return toast("Title and slug are required.", "err");
        $("dSave").disabled = true;
        const { error } = isNew
          ? await sb.from("posts").insert(rec)
          : await sb.from("posts").update(rec).eq("id", row.id);
        $("dSave").disabled = false;
        if (error) return toast(/duplicate/i.test(error.message) ? "That slug is already in use." : error.message, "err");
        closeDrawer();
        toast(isNew ? "Post created" : "Post saved", "ok");
        this.render();
      };
    },
  };

  /* ================= PROJECTS ================= */
  views.projects = {
    rows: [],
    async render() {
      setChrome({
        title: "Projects",
        action: { label: "＋ New project", onClick: () => views.projects.edit(null) },
      });
      const { data, error } = await sb.from("projects").select("*").order("sort_order");
      if (error) { toast(error.message, "err"); return; }
      this.rows = data;
      root.innerHTML = table(
        ["", "Title", "Tag", "Order", "Status", ""],
        data.map((p, i) => `<tr data-id="${p.id}">
          <td style="width:76px"><img class="thumb" src="${p.image_url || ""}" alt="" onerror="this.style.visibility='hidden'"></td>
          <td class="title-cell">${esc(p.title)}<div class="muted">${esc(p.meta || "")}</div></td>
          <td>${esc(p.tag)}</td>
          <td><div class="row-actions" style="justify-content:flex-start">
            <button class="icon-btn" data-act="up" ${i === 0 ? "disabled style='opacity:.3'" : ""}>▲</button>
            <button class="icon-btn" data-act="down" ${i === data.length - 1 ? "disabled style='opacity:.3'" : ""}>▼</button>
          </div></td>
          <td><span class="pillstat ${p.published ? "pub" : "draft"}">${p.published ? "Live" : "Hidden"}</span></td>
          <td><div class="row-actions">
            <button class="icon-btn" data-act="edit">${editIcon}</button>
            <button class="icon-btn danger" data-act="del">${trashIcon}</button>
          </div></td>
        </tr>`).join(""),
        "Add the projects shown on the homepage stack."
      );
      root.querySelector("tbody")?.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn || btn.disabled) return;
        const idx = this.rows.findIndex((r) => r.id === btn.closest("tr").dataset.id);
        const row = this.rows[idx];
        const act = btn.dataset.act;
        if (act === "edit") return this.edit(row);
        if (act === "del") {
          if (!(await confirmBox("Delete project?", `“${row.title}” will be removed.`))) return;
          const { error } = await sb.from("projects").delete().eq("id", row.id);
          error ? toast(error.message, "err") : (toast("Project deleted", "ok"), this.render());
          return;
        }
        // reorder: swap sort_order with neighbour
        const other = this.rows[act === "up" ? idx - 1 : idx + 1];
        await Promise.all([
          sb.from("projects").update({ sort_order: other.sort_order }).eq("id", row.id),
          sb.from("projects").update({ sort_order: row.sort_order }).eq("id", other.id),
        ]);
        this.render();
      });
    },
    edit(row) {
      const isNew = !row;
      row = row || { title: "", tag: "Mining", meta: "", image_url: "", link_url: "", published: true,
                     sort_order: (this.rows.at(-1)?.sort_order ?? 0) + 1 };
      openDrawer(isNew ? "New project" : "Edit project");
      $("drawerBody").innerHTML = `
        ${inputF("title", row.title, "Project name")}
        <div class="two-col">
          ${inputF("tag", row.tag, "Mining / C'Square / Infrastructure / Realty")}
          ${inputF("meta", row.meta, "Short subtitle line")}
        </div>
        imageF("image_url", row.image_url, "Card and hero image")}
        ${fieldHTML("Summary (one line, shown on the project hero)", `<textarea name="summary" rows="2">${esc(row.summary || "")}</textarea>`)}
        <div class="two-col">
          ${inputF("year", row.year || "", "e.g. 2021 — 2024")}
          ${inputF("client", row.client || "", "e.g. Capitan Mining")}
        </div>
        <div class="two-col">
          ${inputF("industry", row.industry || "", "e.g. Mining / Aggregates")}
          ${inputF("duration", row.duration || "", "e.g. Ongoing since 2005")}
        </div>
        <div class="two-col">
          ${inputF("location", row.location || "", "e.g. Vasai, Maharashtra")}
          ${fieldHTML("Status", `<select name="status">
            ${["Ongoing", "Operational", "Delivered", "Upcoming"].map((s) =>
              `<option ${(row.status || "Ongoing") === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>`)}
        </div>
        ${fieldHTML("Intro", `<textarea name="intro" rows="3">${esc(row.intro || "")}</textarea>`)}
        ${fieldHTML("Objective", `<textarea name="objective" rows="3">${esc(row.objective || "")}</textarea>`)}
        ${fieldHTML("Challenge", `<textarea name="challenge" rows="3">${esc(row.challenge || "")}</textarea>`)}
        ${fieldHTML("Result", `<textarea name="result" rows="3">${esc(row.result || "")}</textarea>`)}
        ${imageF("gallery_url", row.gallery_url, "Wide image under the Intro")}
        <div class="two-col">
          ${imageF("gallery2_url", row.gallery2_url, "Paired image A")}
          ${imageF("gallery3_url", row.gallery3_url, "Paired image B")}
        </div>
        ${fieldHTML("Extra body (markdown, optional)", `<textarea name="body" rows="6" style="font:13px/1.6 ui-monospace,Consolas,monospace">${esc(row.body || "")}</textarea>`)}
        <div class="two-col">
          ${inputF("live_url", row.live_url || "", "Live Project button link")}
          ${inputF("link_url", row.link_url || "", "Overrides the project page link")}
        </div>
        <label class="switch"><input type="checkbox" name="published" ${row.published ? "checked" : ""}><span class="track"></span> Visible on site</label>`;
      $("drawerFoot").innerHTML = `
        <div class="grow"></div>
        <button class="btn btn-ghost" id="dCancel">Cancel</button>
        <button class="btn btn-accent" id="dSave">${isNew ? "Create" : "Save"}</button>`;
      $("dCancel").onclick = closeDrawer;
      $("dSave").onclick = async () => {
        const body = $("drawerBody");
        const rec = {
          title: body.querySelector("[name=title]").value.trim(),
          tag: body.querySelector("[name=tag]").value.trim() || "Mining",
          meta: body.querySelector("[name=meta]").value.trim() || null,
          image_url: body.querySelector("[name=image_url]").value.trim() || null,
          link_url: body.querySelector("[name=link_url]").value.trim() || null,
          year: body.querySelector("[name=year]").value.trim() || null,
          client: body.querySelector("[name=client]").value.trim() || null,
          industry: body.querySelector("[name=industry]").value.trim() || null,
          duration: body.querySelector("[name=duration]").value.trim() || null,
          location: body.querySelector("[name=location]").value.trim() || null,
          status: body.querySelector("[name=status]").value,
          summary: body.querySelector("[name=summary]").value.trim() || null,
          intro: body.querySelector("[name=intro]").value.trim() || null,
          objective: body.querySelector("[name=objective]").value.trim() || null,
          challenge: body.querySelector("[name=challenge]").value.trim() || null,
          result: body.querySelector("[name=result]").value.trim() || null,
          gallery_url: body.querySelector("[name=gallery_url]").value.trim() || null,
          gallery2_url: body.querySelector("[name=gallery2_url]").value.trim() || null,
          gallery3_url: body.querySelector("[name=gallery3_url]").value.trim() || null,
          live_url: body.querySelector("[name=live_url]").value.trim() || null,
          body: body.querySelector("[name=body]").value.trim() || null,
          published: body.querySelector("[name=published]").checked,
          sort_order: row.sort_order,
        };
        if (!rec.title) return toast("Title is required.", "err");
        const { error } = isNew
          ? await sb.from("projects").insert(rec)
          : await sb.from("projects").update(rec).eq("id", row.id);
        if (error) return toast(error.message, "err");
        closeDrawer(); toast("Saved", "ok"); this.render();
      };
    },
  };

  /* ================= CAREERS ================= */
  views.careers = {
    rows: [],
    async render() {
      setChrome({
        title: "Careers",
        action: { label: "＋ New opening", onClick: () => views.careers.edit(null) },
      });
      const { data, error } = await sb.from("careers").select("*").order("created_at", { ascending: false });
      if (error) { toast(error.message, "err"); return; }
      this.rows = data;
      root.innerHTML = table(
        ["Role", "Department", "Location", "Type", "Status", ""],
        data.map((c) => `<tr data-id="${c.id}">
          <td class="title-cell">${esc(c.title)}</td>
          <td>${esc(c.department)}</td>
          <td>${esc(c.location)}</td>
          <td>${esc(c.type)}</td>
          <td><span class="pillstat ${c.published ? "pub" : "draft"}">${c.published ? "Open" : "Hidden"}</span></td>
          <td><div class="row-actions">
            <button class="icon-btn" data-act="edit">${editIcon}</button>
            <button class="icon-btn danger" data-act="del">${trashIcon}</button>
          </div></td>
        </tr>`).join(""),
        "Post your first opening with “New opening”."
      );
      root.querySelector("tbody")?.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        const row = this.rows.find((r) => r.id === btn.closest("tr").dataset.id);
        if (btn.dataset.act === "edit") return this.edit(row);
        if (!(await confirmBox("Delete opening?", `“${row.title}” will be removed. Existing applications stay in the CRM.`))) return;
        const { error } = await sb.from("careers").delete().eq("id", row.id);
        error ? toast(error.message, "err") : (toast("Opening deleted", "ok"), this.render());
      });
    },
    edit(row) {
      const isNew = !row;
      row = row || { title: "", department: "Operations", location: "Vasai, Mumbai", type: "Full-time",
                     description: "", requirements: "", published: true };
      openDrawer(isNew ? "New opening" : "Edit opening");
      $("drawerBody").innerHTML = `
        ${inputF("title", row.title, "Role title")}
        <div class="two-col">
          ${inputF("department", row.department)}
          ${inputF("location", row.location)}
        </div>
        ${fieldHTML("Type", `<select name="type">
          ${["Full-time", "Part-time", "Contract", "Internship"].map((t) =>
            `<option ${row.type === t ? "selected" : ""}>${t}</option>`).join("")}
        </select>`)}
        ${fieldHTML("Role description", `<textarea name="description" rows="4">${esc(row.description || "")}</textarea>`)}
        ${fieldHTML("Requirements (markdown list)", `<textarea name="requirements" rows="5" placeholder="- 3+ years …">${esc(row.requirements || "")}</textarea>`)}
        <label class="switch"><input type="checkbox" name="published" ${row.published ? "checked" : ""}><span class="track"></span> Open (listed on careers page)</label>`;
      $("drawerFoot").innerHTML = `
        <div class="grow"></div>
        <button class="btn btn-ghost" id="dCancel">Cancel</button>
        <button class="btn btn-accent" id="dSave">${isNew ? "Create" : "Save"}</button>`;
      $("dCancel").onclick = closeDrawer;
      $("dSave").onclick = async () => {
        const b = $("drawerBody");
        const rec = {
          title: b.querySelector("[name=title]").value.trim(),
          department: b.querySelector("[name=department]").value.trim(),
          location: b.querySelector("[name=location]").value.trim(),
          type: b.querySelector("[name=type]").value,
          description: b.querySelector("[name=description]").value.trim() || null,
          requirements: b.querySelector("[name=requirements]").value.trim() || null,
          published: b.querySelector("[name=published]").checked,
        };
        if (!rec.title) return toast("Role title is required.", "err");
        const { error } = isNew
          ? await sb.from("careers").insert(rec)
          : await sb.from("careers").update(rec).eq("id", row.id);
        if (error) return toast(error.message, "err");
        closeDrawer(); toast("Saved", "ok"); this.render();
      };
    },
  };

  /* ================= CRM (shared factory) ================= */
  function crmView({ table: tbl, title, statuses, cols, rowHTML, drawerHTML }) {
    return {
      rows: [],
      async render() {
        setChrome({ title, search: true });
        const { data, error } = await sb.from(tbl).select("*").order("created_at", { ascending: false });
        if (error) { toast(error.message, "err"); return; }
        this.rows = data;
        this.paint();
      },
      paint() {
        const rows = this.rows.filter((r) =>
          !searchTerm || JSON.stringify(r).toLowerCase().includes(searchTerm));
        root.innerHTML = table(cols, rows.map((r) => rowHTML(r)).join(""),
          title === "Enquiries"
            ? "Contact-form submissions land here."
            : "Careers-page applications land here.");
        root.querySelector("tbody")?.addEventListener("click", async (e) => {
          const btn = e.target.closest("[data-act]");
          if (!btn) return;
          const row = this.rows.find((x) => x.id === btn.closest("tr").dataset.id);
          if (btn.dataset.act === "open") return this.open(row);
          if (btn.dataset.act === "del") {
            if (!(await confirmBox("Delete record?", "This CRM record will be permanently removed."))) return;
            const { error } = await sb.from(tbl).delete().eq("id", row.id);
            error ? toast(error.message, "err") : (toast("Deleted", "ok"), this.render());
          }
        });
        root.querySelector("tbody")?.addEventListener("change", async (e) => {
          const sel = e.target.closest(".status-select");
          if (!sel) return;
          const id = sel.closest("tr").dataset.id;
          const { error } = await sb.from(tbl).update({ status: sel.value }).eq("id", id);
          if (error) return toast(error.message, "err");
          sel.className = `status-select s-${sel.value}`;
          toast("Status updated", "ok");
          views.dashboard.render && null; // counts refresh next dashboard visit
        });
      },
      onSearch() { this.paint(); },
      open(row) {
        openDrawer(title.slice(0, -1) + " details");
        $("drawerBody").innerHTML = drawerHTML(row) + `
          ${fieldHTML("Internal notes", `<textarea name="notes" rows="4" placeholder="Only admins see this">${esc(row.notes || "")}</textarea>`)}`;
        $("drawerFoot").innerHTML = `
          <button class="btn btn-danger" id="dDel">Delete</button>
          <div class="grow"></div>
          <button class="btn btn-ghost" id="dCancel">Close</button>
          <button class="btn btn-accent" id="dSave">Save notes</button>`;
        $("dCancel").onclick = closeDrawer;
        $("dDel").onclick = async () => {
          if (!(await confirmBox("Delete record?", "This cannot be undone."))) return;
          const { error } = await sb.from(tbl).delete().eq("id", row.id);
          if (error) return toast(error.message, "err");
          closeDrawer(); toast("Deleted", "ok"); this.render();
        };
        $("dSave").onclick = async () => {
          const notes = $("drawerBody").querySelector("[name=notes]").value;
          const { error } = await sb.from(tbl).update({ notes }).eq("id", row.id);
          if (error) return toast(error.message, "err");
          closeDrawer(); toast("Notes saved", "ok"); this.render();
        };
      },
      statuses,
    };
  }

  const statusSel = (row, statuses) => `
    <select class="status-select s-${row.status}">
      ${statuses.map((s) => `<option ${row.status === s ? "selected" : ""}>${s}</option>`).join("")}
    </select>`;
  const detailRow = (k, v) => `<div><div class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.06em">${k}</div><div style="color:var(--ink);font-size:15px;margin-top:2px;word-break:break-word">${v || "—"}</div></div>`;

  views.enquiries = crmView({
    table: "enquiries", title: "Enquiries",
    statuses: ["new", "contacted", "quoted", "closed"],
    cols: ["From", "Division", "Message", "Status", "Received", ""],
    rowHTML: (r) => `<tr data-id="${r.id}">
      <td class="title-cell">${esc(r.name)}<div class="muted">${esc(r.contact)}</div></td>
      <td>${esc(r.division || "—")}</td>
      <td class="muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.message || "—")}</td>
      <td>${statusSel(r, ["new", "contacted", "quoted", "closed"])}</td>
      <td class="muted">${fmtT(r.created_at)}</td>
      <td><div class="row-actions">
        <button class="icon-btn" data-act="open" title="Open">${editIcon}</button>
        <button class="icon-btn danger" data-act="del" title="Delete">${trashIcon}</button>
      </div></td>
    </tr>`,
    drawerHTML: (r) => `
      ${detailRow("Name", esc(r.name))}
      ${detailRow("Contact", esc(r.contact))}
      ${detailRow("Division", esc(r.division))}
      ${detailRow("Message", esc(r.message))}
      ${detailRow("Received", fmtT(r.created_at))}`,
  });

  views.applications = crmView({
    table: "applications", title: "Applications",
    statuses: ["new", "shortlisted", "interview", "rejected", "hired"],
    cols: ["Candidate", "Role", "Link", "Status", "Received", ""],
    rowHTML: (r) => `<tr data-id="${r.id}">
      <td class="title-cell">${esc(r.name)}<div class="muted">${esc(r.contact)}</div></td>
      <td>${esc(r.role_title || "General")}</td>
      <td>${resumeLink(r.resume_url)}</td>
      <td>${statusSel(r, ["new", "shortlisted", "interview", "rejected", "hired"])}</td>
      <td class="muted">${fmtT(r.created_at)}</td>
      <td><div class="row-actions">
        <button class="icon-btn" data-act="open" title="Open">${editIcon}</button>
        <button class="icon-btn danger" data-act="del" title="Delete">${trashIcon}</button>
      </div></td>
    </tr>`,
    drawerHTML: (r) => `
      ${detailRow("Candidate", esc(r.name))}
      ${detailRow("Role", esc(r.role_title))}
      ${detailRow("Email", r.email ? `<a class="link" href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : esc(r.contact || "—"))}
      ${detailRow("Phone", r.phone ? `<a class="link" href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : "—")}
      ${detailRow("Location", esc(r.location || "—"))}
      ${detailRow("Experience", esc(r.experience || "—"))}
      ${detailRow("Notice period", esc(r.notice_period || "—"))}
      ${detailRow("Résumé", resumeLink(r.resume_url))}
      ${detailRow("Link", r.link_url ? `<a class="link" href="${esc(r.link_url)}" target="_blank" rel="noopener">${esc(r.link_url)}</a>` : "—")}
      ${detailRow("Message", esc(r.message))}
      ${detailRow("Received", fmtT(r.created_at))}`,
  });


  // Résumés live in a private bucket: build a short-lived signed URL rather
  // than exposing the object. A pasted http link is used as-is.
  async function openResume(ref) {
    if (!ref) return;
    if (/^https?:/i.test(ref)) { window.open(ref, "_blank", "noopener"); return; }
    const path = ref.replace(/^resumes\//, "");
    const { data, error } = await sb.storage.from("resumes").createSignedUrl(path, 120);
    if (error) { toast(error.message, "err"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }
  const resumeLink = (ref) => ref
    ? `<button class="link" data-resume="${esc(ref)}">${/^https?:/i.test(ref) ? "Open link ↗" : "Download CV ↓"}</button>`
    : "—";

  /* ================= PRODUCTS ================= */
  // specs are [label, value] pairs and uses a plain list; both are edited as
  // one-per-line text so the panel stays typable rather than JSON-shaped
  const specsToText = (v) => (Array.isArray(v) ? v : []).map((p) => `${p[0]}: ${p[1]}`).join("\n");
  const textToSpecs = (t) => t.split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => { const i = l.indexOf(":"); return i < 0 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]; });
  const listToText = (v) => (Array.isArray(v) ? v : []).join("\n");
  const textToList = (t) => t.split("\n").map((l) => l.trim()).filter(Boolean);

  views.products = {
    rows: [],
    async render() {
      setChrome({
        title: "Products",
        action: { label: "＋ New product", onClick: () => views.products.edit(null) },
      });
      const { data, error } = await sb.from("products").select("*").order("sort_order");
      if (error) { toast(error.message, "err"); return; }
      this.rows = data;
      root.innerHTML = table(
        ["", "Product", "Tag", "Order", "Status", ""],
        data.map((p, i) => `<tr data-id="${p.id}">
          <td style="width:76px"><img class="thumb" src="${p.cover_url || ""}" alt="" onerror="this.style.visibility='hidden'"></td>
          <td class="title-cell">${esc(p.title)}<div class="muted">/product?p=${esc(p.slug)}</div></td>
          <td>${esc(p.tag || "")}</td>
          <td><div class="row-actions" style="justify-content:flex-start">
            <button class="icon-btn" data-act="up" ${i === 0 ? "disabled style='opacity:.3'" : ""}>▲</button>
            <button class="icon-btn" data-act="down" ${i === data.length - 1 ? "disabled style='opacity:.3'" : ""}>▼</button>
          </div></td>
          <td><span class="pillstat ${p.published ? "pub" : "draft"}">${p.published ? "Live" : "Hidden"}</span></td>
          <td><div class="row-actions">
            <button class="icon-btn" data-act="edit">${editIcon}</button>
            <button class="icon-btn danger" data-act="del">${trashIcon}</button>
          </div></td>
        </tr>`).join(""),
        "Add the materials shown on the products page."
      );
      root.querySelector("tbody")?.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn || btn.disabled) return;
        const idx = this.rows.findIndex((r) => r.id === btn.closest("tr").dataset.id);
        const row = this.rows[idx];
        const act = btn.dataset.act;
        if (act === "edit") return this.edit(row);
        if (act === "del") {
          if (!(await confirmBox("Delete product?", `“${row.title}” will be removed.`))) return;
          const { error } = await sb.from("products").delete().eq("id", row.id);
          error ? toast(error.message, "err") : (toast("Product deleted", "ok"), this.render());
          return;
        }
        const other = this.rows[act === "up" ? idx - 1 : idx + 1];
        await Promise.all([
          sb.from("products").update({ sort_order: other.sort_order }).eq("id", row.id),
          sb.from("products").update({ sort_order: row.sort_order }).eq("id", other.id),
        ]);
        this.render();
      });
    },
    edit(row) {
      const isNew = !row;
      row = row || { title: "", slug: "", tag: "", summary: "", cover_url: "", gallery_url: "",
                     intro: "", body: "", specs: [], uses: [], published: true,
                     sort_order: (this.rows.at(-1)?.sort_order ?? 0) + 1 };
      openDrawer(isNew ? "New product" : "Edit product");
      const body = $("drawerBody");
      body.innerHTML = `
        ${inputF("title", row.title, "e.g. Plaster Sand")}
        ${inputF("slug", row.slug, "plaster-sand")}
        ${inputF("tag", row.tag || "", "Fine · Silt-free")}
        ${fieldHTML("Summary (one line, shown on the hero and cards)", `<textarea name="summary" rows="2">${esc(row.summary || "")}</textarea>`)}
        ${imageF("cover_url", row.cover_url, "Card and hero image")}
        ${imageF("gallery_url", row.gallery_url, "Wide image under the overview")}
        ${fieldHTML("Overview", `<textarea name="intro" rows="3">${esc(row.intro || "")}</textarea>`)}
        ${fieldHTML("Specifications — one per line, <b>Label: Value</b>", `<textarea name="specs" rows="5" style="font:13px/1.7 ui-monospace,Consolas,monospace">${esc(specsToText(row.specs))}</textarea>`)}
        ${fieldHTML("Where it's used — one per line", `<textarea name="uses" rows="4">${esc(listToText(row.uses))}</textarea>`)}
        ${fieldHTML("Body (markdown, optional)", `<textarea name="body" rows="6" style="font:13px/1.6 ui-monospace,Consolas,monospace">${esc(row.body || "")}</textarea>`)}
        <label class="switch"><input type="checkbox" name="published" ${row.published ? "checked" : ""}><span class="track"></span> Visible on site</label>`;

      // auto-slug from the title while the slug is untouched
      const titleEl = body.querySelector("[name=title]");
      const slugEl = body.querySelector("[name=slug]");
      titleEl.addEventListener("input", () => {
        if (!isNew && row.slug) return;
        slugEl.value = titleEl.value.toLowerCase().trim()
          .replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      });

      $("drawerFoot").innerHTML = `
        <div class="grow"></div>
        <button class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button class="btn btn-accent" id="saveBtn">${isNew ? "Create" : "Save"}</button>`;
      $("cancelBtn").onclick = closeDrawer;
      $("saveBtn").onclick = async () => {
        const rec = {
          title: body.querySelector("[name=title]").value.trim(),
          slug: body.querySelector("[name=slug]").value.trim(),
          tag: body.querySelector("[name=tag]").value.trim() || null,
          summary: body.querySelector("[name=summary]").value.trim() || null,
          cover_url: body.querySelector("[name=cover_url]").value.trim() || null,
          gallery_url: body.querySelector("[name=gallery_url]").value.trim() || null,
          intro: body.querySelector("[name=intro]").value.trim() || null,
          body: body.querySelector("[name=body]").value.trim() || null,
          specs: textToSpecs(body.querySelector("[name=specs]").value),
          uses: textToList(body.querySelector("[name=uses]").value),
          published: body.querySelector("[name=published]").checked,
          sort_order: row.sort_order,
        };
        if (!rec.title || !rec.slug) { toast("Title and slug are required", "err"); return; }
        const { error } = isNew
          ? await sb.from("products").insert(rec)
          : await sb.from("products").update(rec).eq("id", row.id);
        if (error) { toast(error.message, "err"); return; }
        toast(isNew ? "Product created" : "Product saved", "ok");
        closeDrawer();
        this.render();
      };
    },
  };

  /* ================= SUBSCRIBERS ================= */
  views.subscribers = {
    rows: [],
    async render() {
      setChrome({ title: "Subscribers", search: true });
      const { data, error } = await sb.from("subscribers").select("*").order("created_at", { ascending: false });
      if (error) { toast(error.message, "err"); return; }
      this.rows = data;
      this.paint();
    },
    paint() {
      const rows = this.rows.filter((r) =>
        !searchTerm || (r.email + (r.source || "")).toLowerCase().includes(searchTerm));
      root.innerHTML = table(
        ["Email", "Source", "Joined", ""],
        rows.map((r) => `<tr data-id="${r.id}">
          <td class="title-cell">${esc(r.email)}</td>
          <td>${esc(r.source || "—")}</td>
          <td class="muted">${fmtT(r.created_at)}</td>
          <td><div class="row-actions">
            <button class="icon-btn danger" data-act="del" title="Remove">${trashIcon}</button>
          </div></td>
        </tr>`).join(""),
        "Blog-page subscriptions land here."
      );
      root.querySelector("tbody")?.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        const row = this.rows.find((x) => x.id === btn.closest("tr").dataset.id);
        if (!(await confirmBox("Remove subscriber?", `${row.email} will be removed from the list.`))) return;
        const { error } = await sb.from("subscribers").delete().eq("id", row.id);
        error ? toast(error.message, "err") : (toast("Removed", "ok"), this.render());
      });
    },
    onSearch() { this.paint(); },
  };

  // any résumé button, in the list or the detail panel
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-resume]");
    if (b) { e.preventDefault(); openResume(b.dataset.resume); }
  });

  /* ---------------- boot ---------------- */
  gate().then((session) => {
    if (!session) return;
    const start = location.hash.replace("#", "");
    nav(views[start] ? start : "dashboard");
  });
})();
