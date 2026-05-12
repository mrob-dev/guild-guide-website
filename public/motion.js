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
     4. Tiny: stamp the current year wherever data-year is present.
        Replaces the per-page inline scripts.
     --------------------------------------------------------------- */
  const year = new Date().getFullYear();
  document.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = year;
  });
})();
