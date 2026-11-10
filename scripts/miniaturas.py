import json, sys
from pathlib import Path
from PIL import Image, ImageOps
pub = Path(sys.argv[1])
d = json.loads((pub/'local-fotos.js').read_text().split('=',1)[1].strip().rstrip(';'))
urls = sorted({p['url'] for v in d.values() for p in v})
tot = [0,0,0]
for u in urls:
    src = pub/u
    stem = Path(u).stem
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im).convert('RGB')
        for pasta, lado, q, curto in (('mini', 480, 72, True), ('tela', 1600, 80, False)):
            out = pub/'fotos-web'/pasta/f'{stem}.webp'; out.parent.mkdir(parents=True, exist_ok=True)
            w, h = im.size
            ref = min(w, h) if curto else max(w, h)
            esc = min(1, lado/ref)
            im.resize((round(w*esc), round(h*esc)), Image.LANCZOS).save(out, 'WEBP', quality=q, method=6)
    tot[0]+=src.stat().st_size; tot[1]+=(pub/'fotos-web/mini'/f'{stem}.webp').stat().st_size; tot[2]+=(pub/'fotos-web/tela'/f'{stem}.webp').stat().st_size
print(len(urls), 'fotos | original %.0f MB | mini %.1f MB | tela %.1f MB' % tuple(x/1048576 for x in tot))
