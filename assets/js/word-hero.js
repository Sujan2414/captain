/* ============================================================
   Capitan — shared chrome for inner pages:
   giant-word reveal hero, rail + slide menu, cursor dot,
   subnav burger, footer year. Pages opt in by markup ids.
   QA: ?p=<0..1> forces hero progress (same hook as homepage).
   ============================================================ */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // innerWidth includes the scrollbar; clientWidth is the real drawable width
  const vw = () => document.documentElement.clientWidth;

  document.querySelectorAll("[data-year]").forEach((el) => {
    el.textContent = new Date().getFullYear();
  });

  /* ---------- cursor dot + "View" bubble ----------
     Same behaviour as the homepage: the dot trails the pointer, and over
     anything marked [data-cursor-view] it blooms into the View bubble.
     Delegated so cards rendered later from the DB are covered too. */
  const dot = document.querySelector(".cursor-dot");
  const bubble = document.querySelector(".cursor-view");
  if (dot && matchMedia("(pointer: fine)").matches) {
    let mx = innerWidth / 2, my = innerHeight / 2;
    let dx = mx, dy = my, vx = mx, vy = my;
    addEventListener("mousemove", (e) => {
      mx = e.clientX; my = e.clientY;
      document.body.classList.add("cursor-on");
      const cls = document.body.classList;
      cls.toggle("cursor-viewing", !!e.target.closest?.("[data-cursor-view]"));
      cls.toggle("cursor-hover", !!e.target.closest?.("[data-cursor]"));
    }, { passive: true });
    (function tick() {
      dx = lerp(dx, mx, 0.28); dy = lerp(dy, my, 0.28);
      dot.style.transform = `translate(${dx}px,${dy}px) translate(-50%,-50%)`;
      if (bubble) {
        vx = lerp(vx, mx, 0.16); vy = lerp(vy, my, 0.16);
        const on = document.body.classList.contains("cursor-viewing");
        bubble.style.transform =
          `translate(${vx}px,${vy}px) translate(-50%,-50%) scale(${on ? 1 : 0.4})`;
      }
      requestAnimationFrame(tick);
    })();
  }

  /* ---------- rail slide-menu ---------- */
  const menu = $("slideMenu"), scrim = $("menuScrim"), railBtn = $("railBtn");
  function setMenu(open) {
    if (!menu) return;
    document.body.classList.toggle("menu-open", open);
    railBtn?.setAttribute("aria-expanded", String(open));
    if (scrim) scrim.hidden = !open;
    open ? menu.removeAttribute("inert") : menu.setAttribute("inert", "");
  }
  railBtn?.addEventListener("click", () => setMenu(!document.body.classList.contains("menu-open")));
  scrim?.addEventListener("click", () => setMenu(false));
  addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

  /* ---------- subnav burger ---------- */
  const subnav = $("subnav");
  const after = document.querySelector(".after-hero");
  // the app-bar burger opens the same slide-menu as the rail, so the
  // mobile menu is identical on every page
  $("subBurger")?.addEventListener("click", () => setMenu(!document.body.classList.contains("menu-open")));

  /* ---------- reveal-on-scroll + count-up stats ----------
     Inner pages don't load main.js, so they need their own copy. Counters
     reset and re-run each time they scroll back into view. */
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("in"); });
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  document.querySelectorAll(".rv").forEach((el) => revealObserver.observe(el));

  const frames = new WeakMap();
  const countUp = (el) => {
    const end = parseInt(el.dataset.count, 10);
    if (!Number.isFinite(end)) return;
    cancelAnimationFrame(frames.get(el));
    const t0 = performance.now(), dur = 1600;
    const tick = (now) => {
      const t = clamp((now - t0) / dur, 0, 1);
      el.textContent = String(Math.round(end * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frames.set(el, requestAnimationFrame(tick));
    };
    frames.set(el, requestAnimationFrame(tick));
  };
  const statObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) countUp(e.target);
      else { cancelAnimationFrame(frames.get(e.target)); e.target.textContent = "0"; }
    });
  }, { threshold: 0.6 });
  document.querySelectorAll(".stat-num").forEach((el) => statObserver.observe(el));

  /* ---------- enquiry form ----------
     Lives here rather than main.js so any inner page carrying the section
     (contact) posts to the CRM, not just the homepage. */
  const quote = $("quoteForm");
  quote?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(quote);
    const btn = quote.querySelector('button[type="submit"]');
    const toastEl = $("toast");
    const say = (msg, kind) => {
      if (!toastEl) return alert(msg);
      toastEl.textContent = msg;
      toastEl.className = `toast on ${kind || ""}`;
      setTimeout(() => toastEl.classList.remove("on"), 4500);
    };
    if (!window.CapitanDB) { say("Form is unavailable right now.", "err"); return; }
    btn.disabled = true;
    const prev = btn.firstChild.textContent;
    btn.firstChild.textContent = "Sending… ";
    try {
      await window.CapitanDB.submitEnquiry({
        name: data.get("name"),
        contact: data.get("contact"),
        division: data.get("division"),
        message: data.get("message") || null,
      });
      quote.reset();
      say("Enquiry received — our sales desk will reach out within one working day.", "ok");
    } catch (err) {
      say("Couldn't send right now — please try WhatsApp instead.", "err");
    } finally {
      btn.disabled = false;
      btn.firstChild.textContent = prev;
    }
  });

  /* ---------- why-choose-us reel (divisions) ----------
     The stage is (n+1) screens tall; each screen owns one item. The card
     stays pinned while the copy alternates sides and the image rolls over,
     the same slot idiom as the homepage division reel. */
  const stage = document.querySelector(".why-stage");
  if (stage) {
    const track = stage.querySelector(".why-track");
    const copy = [...stage.querySelectorAll(".why-copy")];
    const n = copy.length;
    let wasMobile = false;
    const paintWhy = () => {
      /* phones render these as a plain stacked list — clear anything the reel
         wrote on the way down so CSS is left in charge */
      if (innerWidth <= 900) {
        if (!wasMobile) {
          wasMobile = true;
          if (track) track.style.transform = "";
          copy.forEach((el) => {
            el.style.opacity = ""; el.style.transform = ""; el.classList.remove("on");
          });
        }
        return;
      }
      wasMobile = false;
      const travel = stage.offsetHeight - innerHeight;
      if (travel <= 0) return;
      const p = clamp(-stage.getBoundingClientRect().top / travel, 0, 1);

      /* One shared position drives both the image column and the copy, so a
         block reaching the centre and its image landing are the same moment.
         Starting at -0.6 buys the intro: image already in place while the
         first block is still climbing from below the fold.
         Each unit rests for the first 45% of its segment, then travels. */
      const raw = -0.6 + p * n;
      const seg = Math.floor(raw);
      const f = raw - seg;

      // Copy tracks the scroll one-to-one — it never parks mid-screen, it
      // keeps climbing for as long as you keep scrolling. Only the final
      // block settles, so the section doesn't end on empty space.
      const pos = Math.min(raw, n - 1);

      // The image holds on the outgoing frame while that climb happens and
      // only pushes through at the very end — so the picture changes as the
      // incoming block lands in the middle, not halfway up its travel.
      if (track) {
        const imgPos = seg + smooth(clamp((f - 0.80) / 0.20, 0, 1));
        track.style.transform = `translateY(${-clamp(imgPos, 0, n - 1) * 100}%)`;
      }

      const flank = innerWidth > 900;
      // desktop: full-screen travel past the pinned card. mobile: the copy is
      // a centred overlay — short travel plus a crossfade reads cleanly there
      const H = innerHeight * (flank ? 0.92 : 0.34);
      copy.forEach((el, k) => {
        const off = k - pos;
        if (Math.abs(off) > 1.15) {
          if (el.style.opacity !== "0") { el.style.opacity = "0"; el.classList.remove("on"); }
          return;
        }
        const y = off * H;
        el.style.opacity = flank ? "1" : String(clamp(1 - Math.abs(off) * 1.5, 0, 1));
        el.style.transform = flank
          ? `translateY(-50%) translateY(${y}px)`
          : `translateX(-50%) translateY(${y}px)`;
        el.classList.toggle("on", Math.abs(off) < 0.3);
      });
    };
    addEventListener("scroll", paintWhy, { passive: true });
    addEventListener("resize", paintWhy, { passive: true });
    (function whyLoop() { paintWhy(); requestAnimationFrame(whyLoop); })();
  }

  /* ---------- milestone timeline (about) ----------
     Each row fills its own slice of the rule, so the accent reads as one
     continuous line across rows, and the marker lights as it passes the
     reading line. Runs on scroll AND rAF — scroll alone stalls when frames
     are throttled, rAF alone misses when the tab wakes mid-scroll. */
  const tl = document.querySelector(".tl");
  if (tl) {
    const rows = [...tl.querySelectorAll(".tl-row")];
    const paintTl = () => {
      const line = innerHeight * 0.5;
      rows.forEach((row) => {
        const mid = row.querySelector(".tl-mid");
        const fill = row.querySelector(".tl-fill");
        const r = mid.getBoundingClientRect();
        if (fill) fill.style.height = `${clamp(line - r.top, 0, r.height)}px`;
        const dot = row.querySelector(".tl-dot").getBoundingClientRect();
        row.classList.toggle("on", dot.top <= line);
      });
    };
    addEventListener("scroll", paintTl, { passive: true });
    addEventListener("resize", paintTl, { passive: true });
    (function tlLoop() { paintTl(); requestAnimationFrame(tlLoop); })();
  }

  /* ---------- project-detail hero ----------
     A pinned full-screen cover with the content sheet rising over it.
     Same chrome rules as the word heroes: the rail belongs to the hero
     and leaves as the sheet arrives; the nav only returns on scroll-up
     once the sheet has taken the screen. */
  const pdHero = $("pdhero");
  if (pdHero) {
    const sheet = document.querySelector(".pd-sheet");
    const railEl = $("rail");
    const veil = $("pdVeil");
    const brand = document.querySelector(".pdhero-brand");
    let lastPd = scrollY, pdNav = false;
    const pdChrome = () => {
      const heroRect = pdHero.getBoundingClientRect();
      const travel = pdHero.offsetHeight - innerHeight;
      const prog = travel > 0 ? clamp(-heroRect.top / travel, 0, 1) : 0;
      // phase 1: the frosted screen retracts clean off the top, so the
      // sharp cover is fully uncovered before the sheet starts rising
      const e = smooth(clamp(prog / 0.48, 0, 1));
      if (veil) {
        veil.style.height = `${(1 - e) * 100}%`;
        if (brand) {
          brand.style.transform = `translateY(${-e * 30}px)`;
          brand.style.opacity = String(1 - clamp(prog / 0.34, 0, 1));
        }
      }
      const sheetTop = sheet ? sheet.getBoundingClientRect().top : Infinity;
      const heroOn = pdHero.getBoundingClientRect().bottom > innerHeight * 0.55;
      if (railEl) {
        // leaves the moment the veil finishes retracting — once the cover is
        // fully revealed the frame is clean, nothing overlaying the image
        const live = heroOn && e < 0.98 && sheetTop > innerHeight * 0.25;
        railEl.classList.toggle("rail-live", live);
        // only the rail's own disappearance should close the menu. On phones
        // the rail is display:none and goes inactive past the hero, which was
        // slamming the menu shut on the very next frame after the app-bar
        // burger opened it.
        if (!live && innerWidth > 760 && document.body.classList.contains("menu-open")) setMenu(false);
      }
      if (subnav) {
        if (innerWidth <= 760) { subnav.classList.add("show"); return; }
        const y = scrollY;
        if (sheetTop > 0) pdNav = false;
        else if (y < lastPd - 2) pdNav = true;
        else if (y > lastPd + 2) { pdNav = false; subnav.classList.remove("open"); }
        lastPd = y;
        subnav.classList.toggle("show", pdNav);
      }
    };
    addEventListener("scroll", pdChrome, { passive: true });
    addEventListener("resize", pdChrome, { passive: true });
    (function loop() { pdChrome(); requestAnimationFrame(loop); })();
    return;
  }

  /* ---------- word reveal hero ----------
     0→0.7 image strip grows through the word; word fades late;
     tagline rises in over the darkened image. The rail rides the hero
     and slides away with it, exactly like the homepage. */
  const hero = $("bhero");
  if (!hero) return;
  const frame = $("bheroFrame"), word = $("bheroWord"),
        tag = $("bheroTag"), shade = $("bheroShade"), rail = $("rail"),
        logo = $("bheroLogo");
  const halfL = word.querySelector(".bw-l"), halfR = word.querySelector(".bw-r");
  // how far the lockup must travel to clear the left edge; measured because
  // its size is clamp()-based and changes with the viewport
  let logoExit = 460;
  function measureLogo() {
    if (!logo) return;
    const prev = logo.style.transform;
    logo.style.transform = "none";
    logoExit = logo.getBoundingClientRect().right + 30;
    logo.style.transform = prev;
  }
  const qs = new URLSearchParams(location.search);
  const forcedP = qs.has("p") ? clamp(parseFloat(qs.get("p")), 0, 1) : null;
  const railW = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--rail-w")
  ) || 82;
  let p = 0, target = 0;

  /* Phones: fit the word to the viewport by measuring it. A CSS formula
     can't do this — per-character advance varies by word ("DIVISIONS"
     is narrow, "CAREERS" wide), so anything fixed either overflows or
     under-fills. The CSS clamp stays as the pre-JS fallback. */
  function fitWord() {
    const mobile = innerWidth <= 760;
    // justify-items:center means the h1 is max-content sized, so a long word
    // overflows its own padding and slides under the rail. Measure and scale.
    const cs = getComputedStyle(word);
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const avail = mobile ? vw() * 0.88 : vw() - pad;
    word.style.fontSize = "100px";
    const natural = (halfL || word).getBoundingClientRect().width;
    if (!natural) return;
    const cap = mobile ? 96 : 250;   // matches the CSS clamp ceiling
    word.style.fontSize = `${Math.min((avail * 100) / natural, cap)}px`;
  }

  /* The nav is not a header on these pages — it only comes back when the
     hero is fully behind you and you scroll UP, then leaves on scroll down.
     Phones keep it pinned instead (see the mobile rule in the stylesheet). */
  let lastY = scrollY, navShown = false;
  function updateNav() {
    if (!subnav) return;
    if (innerWidth <= 760) { subnav.classList.add("show"); return; }
    const y = scrollY;
    // Gate on the content block, not the hero box: the hero extends a full
    // viewport BELOW the point the curtain covers it, so testing the hero
    // hid the nav long before the hero was actually back in view.
    const heroInView = after
      ? after.getBoundingClientRect().top > 0
      : hero.getBoundingClientRect().bottom > 0;
    if (heroInView) navShown = false;
    else if (y < lastY - 2) navShown = true;
    else if (y > lastY + 2) { navShown = false; subnav.classList.remove("open"); }
    lastY = y;
    subnav.classList.toggle("show", navShown);
  }

  function syncVw() {
    hero.style.setProperty("--vw", vw() + "px");
  }

  function measure() {
    if (forcedP !== null) { target = forcedP; return; }
    const r = hero.getBoundingClientRect();
    target = clamp(-r.top / (hero.offsetHeight - innerHeight), 0, 1);
  }
  /* Timings live in the first ~55% of travel so the reveal is complete and
     the tagline has settled before the content curtain starts rising. */
  function render() {
    p = (reduceMotion || forcedP !== null) ? target : lerp(p, target, 0.1);
    const grow = smooth(clamp(p / 0.42, 0, 1));
    // fully hide the zero-width frame — at rest its edge antialiases
    // into a visible hairline down the centre of the word
    frame.style.visibility = grow > 0.004 ? "visible" : "hidden";
    // phones open the strip vertically — the halves ride the top and bottom
    // edges; desktop keeps the horizontal split
    const vert = innerWidth <= 760;
    if (vert) {
      frame.style.width = "";
      frame.style.height = `${grow * innerHeight}px`;
    } else {
      frame.style.height = "";
      frame.style.width = `${grow * vw()}px`;
    }
    const part = (grow * (vert ? innerHeight : vw())) / 2;
    if (halfL) halfL.style.transform = vert ? `translateY(${-part}px)` : `translateX(${-part}px)`;
    if (halfR) halfR.style.transform = vert ? `translateY(${part}px)` : `translateX(${part}px)`;
    shade.style.opacity = String(clamp((p - 0.15) / 0.27, 0, 1) * 0.52);
    if (logo) {
      // exits left with the reveal, the same gesture as the homepage copy
      const e = smooth(clamp(p / 0.34, 0, 1));
      logo.style.transform = `translateX(${-e * logoExit}px)`;
      logo.style.opacity = String(1 - clamp((p - 0.16) / 0.16, 0, 1));
    }
    const t = smooth(clamp((p - 0.27) / 0.18, 0, 1));
    tag.style.opacity = String(t);
    tag.style.transform = `translateY(${(1 - t) * 26}px)`;
    if (rail) {
      // Same retreat as the homepage: the growing image pushes the rail out.
      // The frame is centred, so its left edge sits at (1-grow)*50vw — once
      // that reaches the rail column the rail slides away, and it also goes
      // when the hero itself scrolls off.
      const edgeX = ((1 - grow) * vw()) / 2;
      const heroOn = hero.getBoundingClientRect().bottom > innerHeight * 0.55;
      const live = heroOn && edgeX > railW - 4;
      rail.classList.toggle("rail-live", live);
      if (!live && innerWidth > 760 && document.body.classList.contains("menu-open")) setMenu(false);
    }
    requestAnimationFrame(render);
  }
  // Nav state is driven off the scroll event rather than the rAF loop so it
  // still responds when frames are throttled (background tabs, low power).
  addEventListener("scroll", () => { measure(); updateNav(); }, { passive: true });
  addEventListener("resize", () => { syncVw(); measure(); fitWord(); measureLogo(); }, { passive: true });
  syncVw();
  measure();
  updateNav();
  fitWord();
  measureLogo();
  document.fonts?.ready.then(measureLogo);
  // Archivo loads async — re-fit once the real metrics are in
  document.fonts?.ready.then(fitWord);
  requestAnimationFrame(render);
})();
