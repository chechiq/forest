export function renderProfile({ platform = '', width, touch, forceCompatible = false }) {
  const mobile = touch || width <= 760;
  // Includes Apple Silicon Macs (which also identify as MacIntel) and iPadOS.
  const apple = /Mac|iPhone|iPad|iPod/i.test(platform);
  return { mobile, compatible: mobile || apple || forceCompatible, fps: mobile ? 30 : 60 };
}
