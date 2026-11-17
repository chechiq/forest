import { strict as assert } from 'node:assert';
import { renderProfile } from '../js/render-profile.js';

const mac = renderProfile({ platform: 'MacIntel', width: 1440, touch: false });
assert.equal(mac.compatible, true, 'M1 reports MacIntel too; never rely on CPU name');
assert.equal(mac.mobile, false, 'Mac keeps desktop layout and typography');
assert.equal(mac.fps, 60);
for (const platform of ['iPhone', 'iPad', 'MacIntel']) {
  const phone = renderProfile({ platform, width: 390, touch: true });
  assert.equal(phone.mobile, true);
  assert.equal(phone.compatible, true);
  assert.equal(phone.fps, 30);
}
assert.equal(renderProfile({ platform: 'Win32', width: 1440, touch: false }).compatible, false);
assert.equal(renderProfile({ platform: 'Linux armv8l', width: 844, touch: true }).mobile, true);
assert.equal(renderProfile({ platform: 'Win32', width: 1440, touch: false, forceCompatible: true }).compatible, true);
console.log('PASS: Apple desktop, iPhone/iPad, Android landscape, Windows and compatibility preview');
