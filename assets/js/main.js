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
      document.body.classList.add("cursor-on");
    }, { passive: true });

    document.querySelectorAll("[data-cursor]").forEach((el) => {
      el.addEventListener("mouseenter", () => document.body.classList.add("cursor-hover"));
      el.addEventListener("mouseleave", () => document.body.classList.remove("cursor-hover"));
    });
    document.querySelectorAll("[data-cursor-view]").forEach((el) => {
      el.addEventListener("mouseenter", () => document.body.classList.add("cursor-viewing"));
      el.addEventListener("mouseleave", () => document.body.classList.remove("cursor-viewing"));
    });
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
  const heroVideo = document.getElementById("heroVideo");
  const navBrand = document.querySelector(".nav .brand");
  let heroP = 0, heroTarget = 0, videoStarted = false, seamFrac = 0.55;

  function measureHero() {
    if (!hero) return;
    seamFrac = (parseFloat(getComputedStyle(hero).getPropertyValue("--seam")) || 55) / 100;
    if (forcedHeroP !== null) { heroTarget = forcedHeroP; return; }
    const r = hero.getBoundingClientRect();
    const total = hero.offsetHeight - innerHeight;
    heroTarget = clamp(-r.top / total, 0, 1);
  }

  function renderHero() {
    heroP = (reduceMotion || staticJump || forcedHeroP !== null) ? heroTarget : lerp(heroP, heroTarget, 0.09);
    const p = heroP;

    const reveal = clamp(p / 0.55, 0, 1);
    const e = reveal * reveal * (3 - 2 * reveal); // smoothstep — even curtain pacing
    const seam = innerWidth * seamFrac;

    // clipping window sweeps left, video counter-shifts so it stays put
    const tail = clamp((reveal - 0.72) / 0.28, 0, 1);
    const desktop = innerWidth > 760;
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
      const gap = lerp(14, 0, tail);
      const rad = lerp(26, 0, tail);
      const frameTop = lerp(58, 0, e);           // percent
      heroFrame.style.left = "0px";
      heroFrame.style.top = `${frameTop}%`;
      heroFrame.style.right = `${gap}px`;
      heroFrame.style.bottom = `${gap}px`;
      heroFrame.style.borderRadius = `0 ${rad}px ${rad}px 0`;
      heroFrame.style.transform = "none";
      heroVideo.style.transform = "none";
      // text moves up by exactly the same pixels the frame-top drops,
      // so they travel together like Bright Edge
      heroContent.style.transform = `translateY(${-e * innerHeight * 0.58}px)`;
    } else {
      // curtains: video edge sweeps left over the bottom strip, text exits left
      const x = seam * (1 - e);
      heroFrame.style.left = "0px";
      heroFrame.style.right = "0px";
      heroFrame.style.bottom = `${lerp(28, 0, tail)}px`;
      heroFrame.style.transform = `translateX(${x}px)`;
      heroFrame.style.borderRadius = `0 0 ${lerp(40, 0, tail)}px ${lerp(60, 0, tail)}px`;
      heroVideo.style.transform = `translateX(${-x}px) scale(${lerp(1.05, 1, e)})`;
      heroContent.style.transform = `translateX(${-e * innerWidth * 0.92}px)`;
    }
    // desktop: caption exits sideways with the curtain
    // mobile:  caption exits downward as the video goes full-bleed
    heroPanel.style.transform = desktop
      ? `translateX(${e * innerWidth * 0.78}px)`
      : `translateY(${e * innerHeight * 0.5}px)`;

    // The advancing video edge physically pushes the rail and top bar off
    // screen — both are driven by the edge's x position, not by raw progress.
    if (rail && desktop) {
      const railW = rail.offsetWidth || 82;
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
      // offsets, not getBoundingClientRect: the rect includes our own transform
      const brandRight = (navBrand.offsetLeft + navBrand.offsetWidth) || 380;
      navBrand.style.transform = `translateX(${-e * (brandRight + 80)}px)`;
      navBrand.style.opacity = String(1 - clamp(e * 1.5, 0, 1));
      nav.classList.toggle("in-hero", e > 0.02);
    } else {
      if (navBrand) { navBrand.style.transform = ""; navBrand.style.opacity = ""; }
      // on a phone the floating burger clears out once the video takes over,
      // and returns as the dark bar after the hero
      nav.classList.toggle("in-hero", !desktop && !heroDone && e > 0.3);
    }

    // video is on screen from the start
    if (!videoStarted) {
      videoStarted = true;
      heroVideo.play().catch(() => { videoStarted = false; });
    }
  }

  /* ---------------- DIVISIONS : accordion + slot-reel cursor preview ---------------- */
  const svcList = document.getElementById("svcList");
  const preview = document.getElementById("svcPreview");
  const pvTrack = document.getElementById("svcPreviewTrack");
  let pvx = 0, pvy = 0, pvOn = false;

  // build the reel: one frame per division, in row order
  svcList?.querySelectorAll(".svc").forEach((svc) => {
    const im = document.createElement("img");
    im.src = svc.dataset.img;
    im.alt = "";
    pvTrack.appendChild(im);
  });

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
        svc.classList.add("open");
        top.setAttribute("aria-expanded", "true");
        preview.classList.remove("on");
        pvOn = false;
      }
    });

    if (fine) {
      svc.addEventListener("mouseenter", () => {
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
    return state;
  });

  function renderTestimonials(dt) {
    tstTracks.forEach((s) => {
      const set = s.track.querySelector(".tst-set");
      if (!set) return;
      const span = set.offsetWidth + GAP;
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

  function renderApproach() {
    if (!stepsWrap) return;
    const r = stepsWrap.getBoundingClientRect();
    const p = clamp((innerHeight * 0.55 - r.top) / r.height, 0, 1);
    fill.style.height = `${p * 100}%`;
    const lineY = r.top + p * r.height;
    steps.forEach((s) => {
      const sr = s.getBoundingClientRect();
      s.classList.toggle("active", sr.top + 30 <= lineY);
    });
  }

  /* ---------------- STATS : count-up ---------------- */
  const stats = document.querySelectorAll(".stat-num");
  const counted = new WeakSet();
  const statObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting || counted.has(entry.target)) return;
      counted.add(entry.target);
      const el = entry.target;
      const end = parseInt(el.dataset.count, 10);
      const t0 = performance.now();
      const dur = 1600;
      (function tick(now) {
        const t = clamp((now - t0) / dur, 0, 1);
        el.textContent = String(Math.round(end * (1 - Math.pow(1 - t, 3))));
        if (t < 1) requestAnimationFrame(tick);
      })(t0);
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

  /* ---------------- QUOTE FORM → WhatsApp ---------------- */
  const form = document.getElementById("quoteForm");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const msg =
      `Hello Capitan! I'd like a quote.%0A` +
      `Name: ${encodeURIComponent(data.get("name") || "")}%0A` +
      `Contact: ${encodeURIComponent(data.get("contact") || "")}%0A` +
      `Division: ${encodeURIComponent(data.get("division") || "")}%0A` +
      `Details: ${encodeURIComponent(data.get("message") || "")}`;
    window.open(`https://wa.me/918793085551?text=${msg}`, "_blank", "noopener");
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
        preview.style.top = `${pvy - preview.offsetHeight / 2}px`;
      }
    }
    renderHero();
    renderApproach();
    renderTestimonials(dt);
    pollPreview();
    requestAnimationFrame(frame);
  }

  addEventListener("scroll", measureHero, { passive: true });
  addEventListener("resize", measureHero, { passive: true });
  measureHero();
  requestAnimationFrame(frame);
})();
