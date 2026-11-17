"""Build and verify mobile textures. Requires Pillow. Run from any directory.

python tools/mobile-assets.py          # check committed assets
python tools/mobile-assets.py --build  # regenerate, then check
"""
from pathlib import Path
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / 'assets'
NAMES = [f'L{i}' for i in range(6)] + ['06-final', '06-final-m']

def source(name, depth):
    if name.startswith('L'):
        folder = ROOT / 'chain' / ('depth' if depth else '')
    else:
        folder = ROOT / ('depth' if depth else 'keyframes')
    return folder / (name + ('.depth' if depth else '') + '.webp')

def check():
    total = gpu = 0
    for name in NAMES:
        for depth in (False, True):
            original = source(name, depth)
            dest = ROOT / 'mobile' / original.name
            with Image.open(original) as src, Image.open(dest) as im:
                im.load()
                assert im.mode == 'RGB', dest
                assert max(im.size) <= (512 if depth else 1536), dest
                assert abs(im.width / im.height - src.width / src.height) < .003, dest
                if name != '06-final':
                    total += dest.stat().st_size
                    gpu += im.width * im.height * 4
    assert total < 2_500_000, total
    assert gpu < 50 * 1024 * 1024, gpu
    with Image.open(ROOT / 'mobile/H2.webp') as studio:
        studio.load()
        assert max(studio.size) <= 512
    print(f'PASS: 16 assets; portrait download {total / 1e6:.2f} MB; RGBA textures {gpu / 1048576:.2f} MiB')

if '--build' in sys.argv:
    (ROOT / 'mobile').mkdir(exist_ok=True)
    for name in NAMES:
        for depth in (False, True):
            src = source(name, depth)
            with Image.open(src) as original:
                im = original.convert('RGB')
                edge = 512 if depth else 1536
                im.thumbnail((edge, edge), Image.Resampling.LANCZOS)
                im.save(ROOT / 'mobile' / src.name, quality=85, method=6)
    with Image.open(ROOT / 'chain/H2.webp') as original:
        im = original.convert('RGB')
        im.thumbnail((512, 512), Image.Resampling.LANCZOS)
        im.save(ROOT / 'mobile/H2.webp', quality=85, method=6)
check()
