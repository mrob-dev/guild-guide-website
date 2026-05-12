/* motion.js — atmospheric interaction layer.
   Plain vanilla. No build step. Fails open. */
(() => {
  'use strict';

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(pointer: fine)').matches;

  /* ---------------------------------------------------------------
     1. Smooth scroll — Lenis (loaded from CDN before this file).
        If Lenis is missing or the user wants reduced motion,
        native scroll is used — everything else still works.
     --------------------------------------------------------------- */
  if (!reduceMotion && typeof window.Lenis === 'function') {
    const lenis = new window.Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      smoothTouch: false,
    });
    const raf = (time) => {
      lenis.raf(time);
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);

    // Hash-link smoothing — Lenis exposes scrollTo for anchored links.
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href');
        if (id && id.length > 1) {
          const target = document.querySelector(id);
          if (target) {
            e.preventDefault();
            lenis.scrollTo(target, { offset: -64 });
          }
        }
      });
    });
  }

  /* ---------------------------------------------------------------
     2. Scroll reveal — once-only fade-up.
        Drives [data-reveal] elements and section dividers.
     --------------------------------------------------------------- */
  const revealEls = document.querySelectorAll('[data-reveal]');
  if (revealEls.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -6%' }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-in'));
  }

  /* ---------------------------------------------------------------
     3. Magnetic — translate toward cursor within radius.
        Fine-pointer only, motion-respecting.
     --------------------------------------------------------------- */
  if (!reduceMotion && finePointer) {
    const STRENGTH = 0.28;
    const RADIUS = 140;
    document.querySelectorAll('[data-magnetic]').forEach((el) => {
      const reset = () => {
        el.style.transform = '';
      };
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const dist = Math.hypot(dx, dy);
        if (dist < RADIUS * 1.6) {
          el.style.transform =
            'translate3d(' + dx * STRENGTH + 'px,' + dy * STRENGTH + 'px,0)';
        } else {
          reset();
        }
      });
      el.addEventListener('pointerleave', reset);
    });
  }

  /* ---------------------------------------------------------------
     4. Parallax — [data-parallax] elements drift vertically as the
        viewport scrolls past them. The attribute value is the speed
        multiplier (0 = no motion, 0.5 = half scroll speed in the
        opposite direction, etc). Motion is gated on reduce-motion
        and uses rAF + IntersectionObserver so off-screen elements
        don't waste cycles.
     --------------------------------------------------------------- */
  const parallaxEls = Array.from(document.querySelectorAll('[data-parallax]'));
  if (!reduceMotion && parallaxEls.length && 'IntersectionObserver' in window) {
    const visible = new Set();
    const visibilityIo = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        });
      },
      { rootMargin: '120px 0px' }
    );
    parallaxEls.forEach((el) => visibilityIo.observe(el));

    let frame = 0;
    const applyParallax = () => {
      frame = 0;
      const viewportH = window.innerHeight;
      visible.forEach((el) => {
        const speed = parseFloat(el.dataset.parallax) || 0.2;
        const rect = el.getBoundingClientRect();
        // Distance of element's centre from viewport's centre, as a
        // fraction of viewport height. 0 = perfectly centred, ±1 = at
        // the edge. We move the element opposite to that distance so
        // it appears to "stick" slightly as the page scrolls.
        const elCentre = rect.top + rect.height / 2;
        const vpCentre = viewportH / 2;
        const offset = (vpCentre - elCentre) * speed;
        // Target the first child element if there is one (for the
        // band-divider pattern where the inner strip is what moves);
        // otherwise transform the element directly.
        const target = el.firstElementChild || el;
        target.style.transform = 'translate3d(0,' + offset.toFixed(1) + 'px,0)';
      });
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(applyParallax);
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    schedule();
  }

  /* ---------------------------------------------------------------
     5. Tiny: stamp the current year wherever data-year is present.
        Replaces the per-page inline scripts.
     --------------------------------------------------------------- */
  const year = new Date().getFullYear();
  document.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = year;
  });
})();
