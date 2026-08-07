/* ============================================================
   Homepage ↔ Supabase: swaps the static insights and projects
   markup for live content once it arrives. The static markup
   stays as the fallback if the network or API is unavailable.
   ============================================================ */
(() => {
  "use strict";
  if (!window.CapitanDB || !window.CapitanMD) return;
  const { fmtDate, esc } = window.CapitanMD;

  // ---- latest three insights ----
  const grid = document.getElementById("homeBlogGrid");
  if (grid) {
    window.CapitanDB.posts(3).then((posts) => {
      if (!posts.length) return;                 // keep static fallback
      grid.innerHTML = posts.map((p, i) => `
        <a class="blog rv in" ${i ? `style="--d:.0${i * 8}s"` : ""} href="/blog?slug=${encodeURIComponent(p.slug)}" data-cursor-view>
          <figure>${p.cover_url ? `<img loading="lazy" src="${esc(p.cover_url)}" alt="">` : ""}</figure>
          <p class="blog-meta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg> ${fmtDate(p.published_at)} <em>/</em> ${esc(p.category)}</p>
          <h3>${esc(p.title)}</h3>
        </a>`).join("");
    }).catch(() => {});
  }

  // ---- projects stack ----
  const stack = document.querySelector(".proj-stack");
  if (stack) {
    window.CapitanDB.projects().then((rows) => {
      if (!rows.length) return;
      const cards = [...stack.querySelectorAll(".proj")];
      rows.slice(0, cards.length).forEach((r, i) => {
        const card = cards[i];
        const img = card.querySelector("img");
        if (img && r.image_url && img.src !== r.image_url) {
          img.removeAttribute("srcset"); img.removeAttribute("sizes");
          img.src = r.image_url;
        }
        card.querySelector(".pill").textContent = r.tag;
        card.querySelector("h3").textContent = r.title;
        card.querySelector(".proj-meta").textContent = r.meta || "";
        card.href = r.link_url || (r.id ? `/project?id=${r.id}` : card.href);
      });
    }).catch(() => {});
  }
})();
