import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

// Whole-line transforms avoid per-letter layout, SVG filters and paint on iOS.
export function initMobileType({ reduced, onExit }) {
  const sections = [...document.querySelectorAll('.sec')];
  const nav = document.querySelector('.progress');
  const bar = nav.querySelector('.progress__bar');
  const fill = nav.querySelector('.progress__fill');
  const label = nav.querySelector('.progress__lbl');
  const pct = nav.querySelector('.progress__pct');
  const exit = document.querySelector('.exit');
  let centers = [], max = 1, scheduled = false;
  const names = sections.map(s => s.querySelector('.idx').textContent.trim());
  const ticks = sections.map((s, i) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'progress__tick';
    button.setAttribute('aria-label', names[i]);
    button.addEventListener('click', () => window.scrollTo({ top: centers[i], behavior: reduced ? 'auto' : 'smooth' }));
    bar.append(button);
    const lines = s.querySelectorAll('h1, h2, .manifesto');
    const tl = gsap.timeline({ scrollTrigger: {
      trigger: s, start: i === 0 ? 'top top' : 'top bottom', end: 'bottom top', scrub: reduced ? true : .25,
    }});
    if (i) tl.fromTo(lines, { opacity: 0, y: reduced ? 0 : 24 }, { opacity: 1, y: 0, duration: .3 }, .15);
    else tl.fromTo(lines, { opacity: 0, y: reduced ? 0 : 24 }, { opacity: 1, y: 0, duration: .18 }, .06);
    if (i < sections.length - 1) tl.to(lines, { opacity: 0, y: reduced ? 0 : -20, duration: .25 }, .65);
    tl.to({}, { duration: 1 }, 0);
    return button;
  });
  function draw() {
    scheduled = false;
    const p = Math.max(0, Math.min(1, scrollY / max));
    let cur = 0;
    centers.forEach((c, i) => { if (Math.abs(scrollY - c) < Math.abs(scrollY - centers[cur])) cur = i; });
    fill.style.transform = `scaleX(${p})`; pct.textContent = `${Math.round(p * 100)}%`;
    label.textContent = names[cur]; nav.classList.toggle('warm', cur === 6);
    ticks.forEach((t, i) => { t.classList.toggle('on', i === cur); t.setAttribute('aria-current', i === cur ? 'step' : 'false'); });
    const showExit = p > .93;
    exit.style.opacity = showExit ? '1' : '0'; exit.style.pointerEvents = showExit ? 'auto' : 'none'; exit.tabIndex = showExit ? 0 : -1;
  }
  function layout() {
    max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    centers = sections.map((s, i) => i === 6 ? max : Math.max(0, s.offsetTop + s.offsetHeight / 2 - innerHeight / 2));
    centers[0] = 0;
    ticks.forEach((t, i) => { t.style.left = `${centers[i] / max * 100}%`; });
    draw();
  }
  addEventListener('scroll', () => { if (!scheduled) { scheduled = true; requestAnimationFrame(draw); } }, { passive: true });
  addEventListener('resize', layout, { passive: true });
  ScrollTrigger.addEventListener('refresh', layout);
  exit.addEventListener('click', onExit);
  document.fonts.ready.then(() => { layout(); ScrollTrigger.refresh(); });
  layout();
  return () => document.documentElement.classList.add('ready');
}
