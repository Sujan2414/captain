/* ============================================================
   CAPITAN — interactions
   hero video scroll-expand · custom cursor · division accordion
   cursor-chasing preview · sticky project stack · step progress
   count-up stats · reveal on scroll · nav behavior · quote form
   ============================================================ */
(() => {
  "use strict";

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // deep-link / QA: ?y=<px> jumps to an exact offset with animations disabled
  const qs = new URLSearchParams(location.search);
  const staticJump = qs.has("y");
  if (staticJump) {
    document.documentElement.classList.add("insta");
    const jump = () => scrollTo(0, parseInt(qs.get("y"), 10) || 0);
    jump();
    addEventListener("load", () => { jump(); requestAnimationFrame(jump); });
  }
  // QA: ?off=<px> shifts the page up without scrolling; ?p=<0..1> forces hero progress
  if (qs.has("off")) {
    document.documentElement.classList.add("insta");
    document.body.style.marginTop = `-${parseInt(qs.get("off"), 10) || 0}px`;
  }
  const forcedHeroP = qs.has("p") ? clamp(parseFloat(qs.get("p")), 0, 1) : null;

  /* ---------------- NAV : blur on scroll, hide on scroll-down ---------------- */
  const nav = document.getElementById("nav");
  const burger = document.getElementById("navBurger");
  let lastY = window.scrollY;

  // `scrolled` / `in-hero` are driven by hero progress in renderHero — this
  // only handles hide-on-scroll-down once the hero is behind us.
  function onNavScroll() {
    const y = window.scrollY;
    if (!nav.classList.contains("menu-open")) {
      const pastHero = hero ? y > hero.offsetHeight - innerHeight : true;
      nav.classList.toggle("hidden", pastHero && y > lastY && y > 300);
    }
    lastY = y;
  }
  window.addEventListener("scroll", onNavScroll, { passive: true });

  // the phone burger drives the same overlay menu as the desktop rail button
  burger?.addEventListener("click", () =>
    setMenu(!document.body.classList.contains("menu-open"))
  );

  /* ---------------- LEFT RAIL + SLIDE-OUT MENU ---------------- */
  const rail = document.getElementById("rail");
  const railBtn = document.getElementById("railBtn");
  const slideMenu = document.getElementById("slideMenu");
  const menuScrim = document.getElementById("menuScrim");

  function setMenu(open) {
    document.body.classList.toggle("menu-open", open);
    railBtn?.setAttribute("aria-expanded", String(open));
    railBtn?.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    if (menuScrim) menuScrim.hidden = !open;
    if (slideMenu) {
      if (open) slideMenu.removeAttribute("inert");
      else slideMenu.setAttribute("inert", "");
    }
    document.body.style.overflow = open ? "hidden" : "";
  }

  railBtn?.addEventListener("click", () =>
    setMenu(!document.body.classList.contains("menu-open"))
  );
  menuScrim?.addEventListener("click", () => setMenu(false));
  slideMenu?.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => setMenu(false))
  );
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("menu-open")) setMenu(false);
  });

  /* ---------------- CUSTOM CURSOR ---------------- */
  const dot = document.querySelector(".cursor-dot");
  const viewBubble = document.querySelector(".cursor-view");
  const fine = window.matchMedia("(pointer: fine)").matches;
  let mx = innerWidth / 2, my = innerHeight / 2;
  let dx = mx, dy = my, vx = mx, vy = my;

  if (fine) {
    addEventListener("mousemove", (e) => {
      mx = e.clientX; my = e.clientY;
      const cls = document.body.classList;
      cls.add("cursor-on");
      /* Read off the pointer's target rather than binding each card: the blog
         rail, the product grid and "more materials" are all injected after
         this runs, so a one-shot querySelectorAll would miss them. */
      cls.toggle("cursor-viewing", !!e.target.closest?.("[data-cursor-view]"));
      cls.toggle("cursor-hover", !!e.target.closest?.("[data-cursor]"));
    }, { passive: true });

  }

  /* ---------------- HERO : curtain reveal ----------------
     The video owns the right side of the viewport from the start.
     Progress 0→0.55: text slides out left, panel & badge slide out right,
     and the video's left edge sweeps across until it fills the screen.
     0.55→1: full-bleed hold while the section scrolls out.
  --------------------------------------------------------- */
  const hero = document.querySelector(".hero");
  const heroContent = document.getElementById("heroContent");
  const heroFrame = document.getElementById("heroMediaFrame");
  const heroPanel = document.querySelector(".hero-panel");
  const heroPanelClip = document.getElementById("heroPanelClip");
  const heroVideo = document.getElementById("heroVideo");
  const navBrand = document.querySelector(".nav .brand");
  let heroP = 0, heroTarget = 0, videoStarted = false, seamFrac = 0.55;
  /* Visibility gates: without these the loop restyled the hero, the marquee
     and the step rail on every frame even when they were far off-screen,
     which dominated main-thread Style & Layout time. */
  let heroVisible = true, tstVisible = false, approachVisible = false;
  const gate = (el, set) => {
    if (!el) return;
    new IntersectionObserver(([e]) => set(e.isIntersecting),
      { rootMargin: "200px" }).observe(el);
  };
  // layout values cached at load/resize so the rAF loop never reads geometry
  let cachedRailW = 82, cachedBrandRight = 380, cachedPreviewH = 200;

  function measureHero() {
    if (!hero) return;
    seamFrac = (parseFloat(getComputedStyle(hero).getPropertyValue("--seam")) || 55) / 100;
    if (forcedHeroP !== null) { heroTarget = forcedHeroP; return; }
    const r = hero.getBoundingClientRect();
    const total = hero.offsetHeight - innerHeight;
    heroTarget = clamp(-r.top / total, 0, 1);
  }

  function renderHero() {
    // once the hero is well behind us its transforms are already at their end
    // state — no need to keep rewriting them every frame
    if (!heroVisible && heroP > 0.999) return;
    heroP = (reduceMotion || staticJump || forcedHeroP !== null) ? heroTarget : lerp(heroP, heroTarget, 0.09);
    const p = heroP;

    const reveal = clamp(p / 0.55, 0, 1);
    const e = reveal * reveal * (3 - 2 * reveal); // smoothstep — even curtain pacing
    const seam = innerWidth * seamFrac;

    // clipping window sweeps left, video counter-shifts so it stays put
    const tail = clamp((reveal - 0.72) / 0.28, 0, 1);
    const desktop = innerWidth > 760;
    // hoisted: the caption-clip sync below reads these after the branch
    const gap = lerp(14, 0, tail);
    const rad = lerp(46, 0, tail);
    const edgeX = desktop ? seam * (1 - e) : innerWidth;
    const heroDone = p > 0.985;
    if (!desktop) {
      // Bright Edge–style curtain reveal on mobile:
      // • The video is absolutely positioned at full viewport size, anchored
      //   to the bottom-left of the frame. It never moves or scales.
      // • The frame starts with its top at 58% and rises to 0%, revealing
      //   the video like a curtain being raised.
      // • The text translates up by exactly the same distance (58% of vh)
      //   so the text bottom edge and frame top edge stay synchronised —
      //   the text appears to be pushed up by the rising video border.
      // • Right/bottom gaps and border-radius close in the final 28%.
      const frameTop = lerp(48, 0, e);           // percent
      heroFrame.style.left = "0px";
      heroFrame.style.top = `${frameTop}%`;
      heroFrame.style.right = `${gap}px`;
      heroFrame.style.bottom = `${gap}px`;
      heroFrame.style.borderRadius = `0 ${rad}px ${rad}px 0`;
      heroFrame.style.transform = "none";
      /* Fills the frame (see the CSS note). `cover` alone tightens the framing
         as the card grows, which reads as an accidental zoom-in, so ease a
         counter push-out over it — the motion then feels deliberate and the
         end state settles on the natural framing. */
      // the video is pinned to the viewport in CSS and must not be touched
      // here — scaling it was what turned the reveal into a zoom
      heroVideo.style.top = "";
      heroVideo.style.transform = "";
      // keep the caption glued to the card's corner as the gap closes, so its
      // concave fillets stay welded to the video edge on the way down
      // the corner is tied to --fillet in CSS so it stays in step with the
      // concave fillets either side of it — don't override it from here
      heroPanel.style.borderTopLeftRadius = "";
      // text moves up by exactly the same pixels the frame-top drops,
      // so they travel together like Bright Edge
      heroContent.style.transform = `translateY(${-e * innerHeight * 0.48}px)`;
      // the clip is already inset by the card gap, so the card edge is right:0
      heroPanel.style.right = "0px";
    } else {
      // curtains: video edge sweeps left over the bottom strip, text exits left
      const x = seam * (1 - e);
      heroFrame.style.left = "0px";
      heroFrame.style.right = "0px";
      heroFrame.style.bottom = `${lerp(28, 0, tail)}px`;
      heroFrame.style.transform = `translateX(${x}px)`;
      heroFrame.style.borderRadius = `0 0 ${lerp(40, 0, tail)}px ${lerp(60, 0, tail)}px`;
      // pure counter-translate, no scale: the window sweeps across a video
      // that never moves, so it reveals rather than zooms
      heroVideo.style.top = "";
      heroVideo.style.transform = `translateX(${-x}px)`;
      heroContent.style.transform = `translateX(${-e * innerWidth * 0.92}px)`;
      heroPanel.style.borderTopLeftRadius = "";
      // the clip carries the frame's +x shift, so pull the caption back by the
      // same amount to keep it on the viewport's right edge
      heroPanel.style.right = `${x}px`;
    }

    // keep the clip welded to the card so the caption is cut at its edge
    if (heroPanelClip) {
      const f = heroFrame.style;
      const c = heroPanelClip.style;
      c.left = f.left; c.right = f.right; c.top = f.top; c.bottom = f.bottom;
      c.transform = f.transform;   // radius stays square — see the CSS note
      // On phones the caption belongs to the card, so the clip mirrors the
      // card exactly (set above). Stretching it to the viewport left the
      // plate hanging below the card's foot as a separate slab.
      // the caption draws the card's outer corner itself, so there is exactly
      // one antialiased edge there instead of two stacked ones
      // desktop: the plate meets the screen edge, so square it. mobile: the
      // plate really is in the card's rounded corner, so it keeps the radius.
      // desktop: the plate meets the screen edge, where the card's own corner
      // is off-screen behind the curtain, so square is right. phones: the
      // plate sits in the card's rounded corner and must repeat its radius,
      // or the two outlines disagree at the same corner.
      // a touch tighter than the card's corner, like .plate: equal radii leave
      // two half-covered edges on the same pixel and the video greys the seam
      heroPanel.style.borderBottomRightRadius = desktop ? "0px" : `${Math.max(0, rad - 8)}px`;
    }
    // desktop: caption exits sideways with the curtain.
    // mobile:  it stays nested in the video's corner and rides the expansion,
    //          the way the reference does — it must not slide off the card.
    // desktop: caption exits to the right; mobile: it exits downward. Either
    // way the clip above cuts it at the card edge as it leaves.
    // the px term carries .f-above-panel, which sits a fillet's height above
    // the plate and so is still on screen when a pure % exit finishes
    heroPanel.style.transform = desktop
      ? `translateX(${e * innerWidth * 0.78}px)`
      : `translateY(calc(${e * 130}% + ${e * 52}px))`;


    // The advancing video edge physically pushes the rail and top bar off
    // screen — both are driven by the edge's x position, not by raw progress.
    if (rail && desktop) {
      const railW = cachedRailW;
      const push = clamp((railW - edgeX) / railW, 0, 1);
      rail.style.transform = `translateX(${-push * 100}%)`;
      rail.style.opacity = String(1 - push);
      const gone = push > 0.97;
      rail.classList.toggle("away", gone);
      if (gone && document.body.classList.contains("menu-open")) setMenu(false);
    }

    // top bar: full logo at rest; the logo slides out to the left with the
    // headline as the video edge reaches it, then the compact bar takes over
    nav.classList.toggle("scrolled", heroDone);
    if (desktop && !heroDone && navBrand) {
      // the logo leaves with the headline, on the same easing — it does not
      // wait for the video edge to reach it
      // cached: reading offsets here forced a layout on every frame
      const brandRight = cachedBrandRight;
      navBrand.style.transform = `translateX(${-e * (brandRight + 80)}px)`;
      navBrand.style.opacity = String(1 - clamp(e * 1.5, 0, 1));
      nav.classList.toggle("in-hero", e > 0.02);
    } else {
      if (navBrand) { navBrand.style.transform = ""; navBrand.style.opacity = ""; }
      // on a phone the floating burger clears out once the video takes over,
      // and returns as the dark bar after the hero
      nav.classList.toggle("in-hero", !desktop && !heroDone && e > 0.3);
    }

  }

  /* Attach the video source only after first paint, and pick the tier by
     viewport. Loading it up front cost ~10 MB and pushed LCP past 9 s. */
  function startHeroVideo() {
    if (videoStarted || !heroVideo) return;
    videoStarted = true;
    const small = innerWidth <= 760;
    const src = small ? heroVideo.dataset.srcSm : heroVideo.dataset.srcLg;
    if (!src) return;
    // phones get a portrait cut, so the poster has to match or the first
    // painted frame is a landscape crop that then jumps
    if (small && heroVideo.dataset.posterSm) {
      heroVideo.poster = heroVideo.dataset.posterSm;
    }
    heroVideo.src = src;
    heroVideo.load();
    heroVideo.play().catch(() => {});
  }
  if (document.readyState === "complete") {
    requestAnimationFrame(startHeroVideo);
  } else {
    addEventListener("load", () => setTimeout(startHeroVideo, 150), { once: true });
  }

  /* ---------------- DIVISIONS : accordion + slot-reel cursor preview ---------------- */
  const svcList = document.getElementById("svcList");
  const preview = document.getElementById("svcPreview");
  const pvTrack = document.getElementById("svcPreviewTrack");
  let pvx = 0, pvy = 0, pvOn = false;

  /* Build the hover reel only for real pointers, and only once the section is
     near. It was eagerly fetching ~460 KB of full-size frames on phones, where
     the preview is display:none and can never be shown. */
  let reelBuilt = false;
  function buildReel() {
    if (reelBuilt || !fine || !svcList || !pvTrack) return;
    reelBuilt = true;
    svcList.querySelectorAll(".svc").forEach((svc) => {
      const im = document.createElement("img");
      im.src = svc.dataset.img;
      im.alt = "";
      im.decoding = "async";
      pvTrack.appendChild(im);
    });
  }
  if (fine) gate(document.getElementById("divisions"), (v) => { if (v) buildReel(); });

  const svcArr = svcList ? [...svcList.querySelectorAll(".svc")] : [];

  // The card is position:fixed, so scrolling moves rows under a stationary
  // cursor without firing mouseenter/leave. Re-hit-test on scroll so the reel
  // follows the row actually under the pointer — and hides when none is.
  function syncPreviewToCursor() {
    if (!fine || !preview) return;
    const under = document.elementFromPoint(mx, my);
    const svc = under && under.closest ? under.closest(".svc") : null;
    const i = svc ? svcArr.indexOf(svc) : -1;
    const active = i >= 0 && !svc.classList.contains("open") ? svc : null;
    svcArr.forEach((s) => s.classList.toggle("hot", s === active));
    if (active) {
      pvTrack.style.transform = `translateY(-${i * 100}%)`;
      preview.classList.add("on");
      pvOn = true;
    } else {
      preview.classList.remove("on");
      pvOn = false;
    }
  }
  addEventListener("scroll", syncPreviewToCursor, { passive: true });

  // Polled backstop at ~10Hz, gated to when the section is actually on screen,
  // so the card also self-corrects on layout shifts, zoom and momentum scroll.
  let divisionsVisible = false;
  const divisionsSection = document.getElementById("divisions");
  if (divisionsSection) {
    new IntersectionObserver(([e]) => {
      divisionsVisible = e.isIntersecting;
      // leaving the section gates the poll off, so hide here or the card sticks
      if (!divisionsVisible) {
        svcArr.forEach((s) => s.classList.remove("hot"));
        preview.classList.remove("on");
        pvOn = false;
      }
    }).observe(divisionsSection);
  }
  let syncTick = 0;
  function pollPreview() {
    if (!fine || !divisionsVisible) return;
    if (++syncTick % 6) return;
    syncPreviewToCursor();
  }

  svcArr.forEach((svc, i) => {
    const top = svc.querySelector(".svc-top");
    top.addEventListener("click", () => {
      const isOpen = svc.classList.contains("open");
      svcList.querySelectorAll(".svc.open").forEach((o) => {
        o.classList.remove("open");
        o.querySelector(".svc-top").setAttribute("aria-expanded", "false");
      });
      if (!isOpen) {
        // the body was collapsed to 0px, so its image was never worth fetching
        const lazyImg = svc.querySelector(".svc-grid img[data-src]");
        if (lazyImg) {
          if (lazyImg.dataset.srcset) lazyImg.srcset = lazyImg.dataset.srcset;
          lazyImg.src = lazyImg.dataset.src;
          lazyImg.removeAttribute("data-src");
        }
        svc.classList.add("open");
        top.setAttribute("aria-expanded", "true");
        preview.classList.remove("on");
        pvOn = false;
      }
    });

    if (fine) {
      svc.addEventListener("mouseenter", () => {
        buildReel();                      // safety net if the gate hasn't fired
        if (svc.classList.contains("open")) return;
        pvTrack.style.transform = `translateY(-${i * 100}%)`;
        preview.classList.add("on");
        pvOn = true;
      });
      svc.addEventListener("mouseleave", () => {
        svc.classList.remove("hot");
        preview.classList.remove("on");
        pvOn = false;
      });
    }
  });

  /* ---------------- TESTIMONIALS : eased marquee ----------------
     Driven here rather than by a CSS keyframe so hovering can ease the speed
     down to a crawl instead of hard-stopping it. */
  const GAP = 22;
  const tstTracks = [...document.querySelectorAll(".tst-track")].map((track) => {
    const dir = Number(track.dataset.dir) || 1;
    const state = { track, dir, x: null, speed: 46, hovered: false };
    track.addEventListener("mouseenter", () => { state.hovered = true; });
    track.addEventListener("mouseleave", () => { state.hovered = false; });
    state.span = 0;
    return state;
  });

  function renderTestimonials(dt) {
    if (!tstVisible) return;
    tstTracks.forEach((s) => {
      const span = s.span;              // cached; measuring here forced layout
      if (!span) return;
      if (s.x === null) s.x = s.dir === 1 ? 0 : -span;
      // 46 px/s cruising, ~8 px/s while hovered — eased, never fully stopped
      s.speed = lerp(s.speed, s.hovered ? 8 : 46, 0.05);
      s.x -= s.dir * s.speed * dt;
      if (s.x <= -span) s.x += span;
      if (s.x >= 0) s.x -= span;
      s.track.style.transform = `translateX(${s.x}px)`;
    });
  }

  /* ---------------- APPROACH : progress line + active steps ---------------- */
  const stepsWrap = document.getElementById("approachSteps");
  const fill = document.getElementById("approachFill");
  const steps = stepsWrap ? [...stepsWrap.querySelectorAll(".step")] : [];

  /* Geometry is cached and refreshed on resize. Reading offsets every frame
     forced a synchronous layout on each rAF tick, which Lighthouse flagged. */
  let apTop = 0, apH = 1, stepTops = [];
  function measureApproach() {
    if (!stepsWrap) return;
    const r = stepsWrap.getBoundingClientRect();
    apTop = r.top + scrollY;
    apH = r.height || 1;
    stepTops = steps.map((s) => s.getBoundingClientRect().top + scrollY);
  }

  function renderApproach() {
    if (!stepsWrap || !approachVisible) return;
    const top = apTop - scrollY;                 // no layout read
    const p = clamp((innerHeight * 0.55 - top) / apH, 0, 1);
    fill.style.height = `${p * 100}%`;
    const lineY = top + p * apH;
    for (let i = 0; i < steps.length; i++) {
      steps[i].classList.toggle("active", stepTops[i] - scrollY + 30 <= lineY);
    }
  }

  /* ---------------- STATS : count-up ---------------- */
  // Re-runs on every entry rather than once per page load: reset to zero on
  // the way out, re-count on the way back in. The in-flight frame is
  // cancelled first so a quick scroll-out-and-back can't leave two
  // animations fighting over the same element.
  const stats = document.querySelectorAll(".stat-num");
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
    entries.forEach((entry) => {
      const el = entry.target;
      if (entry.isIntersecting) countUp(el);
      else { cancelAnimationFrame(frames.get(el)); el.textContent = "0"; }
    });
  }, { threshold: 0.6 });
  stats.forEach((s) => statObserver.observe(s));

  /* ---------------- REVEAL on scroll ---------------- */
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  document.querySelectorAll(".rv").forEach((el) => revealObserver.observe(el));

  /* ---------------- QUOTE FORM → CRM (Supabase enquiries) ---------------- */
  const form = document.getElementById("quoteForm");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const btn = form.querySelector('button[type="submit"]');
    const toastEl = document.getElementById("toast");
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
      form.reset();
      say("Enquiry received — our sales desk will reach out within one working day.", "ok");
    } catch (err) {
      say("Couldn't send right now — please try WhatsApp instead.", "err");
    } finally {
      btn.disabled = false;
      btn.firstChild.textContent = prev;
    }
  });

  /* ---------------- master rAF loop ---------------- */
  let lastT = 0;
  function frame(now) {
    const dt = lastT ? Math.min((now - lastT) / 1000, 0.05) : 0;
    lastT = now;
    // cursor chase
    if (fine) {
      dx = lerp(dx, mx, 0.28); dy = lerp(dy, my, 0.28);
      vx = lerp(vx, mx, 0.16); vy = lerp(vy, my, 0.16);
      dot.style.transform = `translate(${dx}px, ${dy}px) translate(-50%,-50%)`;
      viewBubble.style.transform =
        `translate(${vx}px, ${vy}px) translate(-50%,-50%) scale(${document.body.classList.contains("cursor-viewing") ? 1 : 0.4})`;
      if (pvOn) {
        pvx = lerp(pvx, mx, 0.12); pvy = lerp(pvy, my, 0.12);
        preview.style.left = `${pvx + 30}px`;
        preview.style.top = `${pvy - cachedPreviewH / 2}px`;
      }
    }
    renderHero();
    renderApproach();
    renderTestimonials(dt);
    pollPreview();
    requestAnimationFrame(frame);
  }

  addEventListener("scroll", measureHero, { passive: true });
  /* One batched geometry read. Everything the rAF loop needs is captured here
     and refreshed only on resize / after fonts settle, so no frame triggers a
     synchronous layout. */
  /* The caption's concave fillet sits on the card's foot and its convex
     corner rounds down from the plate's top, so both eat into the same left
     edge: fillet + radius must fit inside the plate's height or a wedge of
     video spikes through between the two arcs. The CSS picks 38px, which
     suits a 390px phone; this keeps it true on any other. */
  function fitCaptionFillet() {
    if (!heroPanel) return;
    const kids = heroPanel.querySelectorAll(".fillet");
    if (innerWidth > 760) {
      heroPanel.style.removeProperty("--fillet");
      kids.forEach((el) => el.style.removeProperty("--fillet"));
      return;
    }
    const f = clamp(Math.floor(heroPanel.offsetHeight / 2) - 2, 14, 38);
    heroPanel.style.setProperty("--fillet", f + "px");
    kids.forEach((el) => el.style.setProperty("--fillet", f + "px"));
  }

  function measureAll() {
    measureHero();
    fitCaptionFillet();
    measureApproach();
    if (rail) cachedRailW = rail.offsetWidth || 82;
    if (navBrand) cachedBrandRight = (navBrand.offsetLeft + navBrand.offsetWidth) || 380;
    if (preview) cachedPreviewH = preview.offsetHeight || 200;
    tstTracks.forEach((s) => {
      const set = s.track.querySelector(".tst-set");
      if (set) s.span = set.offsetWidth + GAP;
    });
  }

  let resizeTimer;
  addEventListener("resize", () => {
    measureHero();                       // cheap, needed for scroll accuracy
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(measureAll, 150);
  }, { passive: true });

  gate(hero, (v) => { heroVisible = v; });
  gate(document.querySelector(".tst-rows"), (v) => { tstVisible = v; });
  gate(stepsWrap, (v) => { approachVisible = v; });

  measureAll();
  addEventListener("load", measureAll, { once: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureAll);
  requestAnimationFrame(frame);

  /* ---------- parallax on the dark contact band ----------
     Offset is a fraction of how far the band's centre sits from the
     viewport's, so the plate drifts against the page. Composited transform
     only, and it runs on phones as well — the reason it was removed before
     was background-attachment, not the effect itself. */
  const parLayers = [...document.querySelectorAll(".sd-par")];
  if (parLayers.length && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const paintPar = () => {
      /* desktop uses real background-attachment:fixed — nothing to drive */
      if (innerWidth > 760) return;
      for (const el of parLayers) {
        const host = el.parentElement;
        const r = host.getBoundingClientRect();
        if (r.bottom < -200 || r.top > innerHeight + 200) continue;
        el.style.transform = `translate3d(0, ${(-r.top).toFixed(1)}px, 0)`;
      }
    };
    /* synchronous on purpose: queueing through rAF paints one frame behind
       the scroller, which reads as shake */
    addEventListener("scroll", paintPar, { passive: true });
    addEventListener("resize", paintPar, { passive: true });
    paintPar();
  }

})();
