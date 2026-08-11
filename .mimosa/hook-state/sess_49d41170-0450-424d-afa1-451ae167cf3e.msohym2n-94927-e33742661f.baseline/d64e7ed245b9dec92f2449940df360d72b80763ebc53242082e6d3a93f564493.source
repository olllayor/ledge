const root = document.documentElement;
const video = document.querySelector('#demo-video');
const revealNodes = document.querySelectorAll('[data-reveal]');
const tiltNodes = document.querySelectorAll('[data-tilt]');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

document.addEventListener(
  'pointermove',
  (event) => {
    root.style.setProperty('--x', `${event.clientX}px`);
    root.style.setProperty('--y', `${event.clientY}px`);
  },
  { passive: true },
);

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { rootMargin: '0px 0px -12% 0px', threshold: 0.16 },
);

revealNodes.forEach((node) => revealObserver.observe(node));

if (video) {
  video.muted = true;
  video.playsInline = true;
  video.removeAttribute('controls');

  const videoObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          void video.play().catch(() => {});
        } else {
          video.pause();
        }
      });
    },
    { threshold: 0.35 },
  );

  videoObserver.observe(video);
}

if (!prefersReducedMotion) {
  tiltNodes.forEach((node) => {
    node.addEventListener(
      'pointermove',
      (event) => {
        const rect = node.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        node.style.setProperty('--ry', `${x * 6}deg`);
        node.style.setProperty('--rx', `${y * -6}deg`);
      },
      { passive: true },
    );

    node.addEventListener('pointerleave', () => {
      node.style.setProperty('--ry', '0deg');
      node.style.setProperty('--rx', '0deg');
    });
  });
}
