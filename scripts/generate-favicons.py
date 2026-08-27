import os
from PIL import Image, ImageDraw

def create_svg():
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <!-- Brand Teal Gradient Background -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f8b86" />
      <stop offset="60%" stop-color="#0b6e6b" />
      <stop offset="100%" stop-color="#064643" />
    </linearGradient>

    <!-- Warm Radiant Sun/Heat Gradient (온: 溫) -->
    <linearGradient id="warmGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ff9142" />
      <stop offset="50%" stop-color="#f05023" />
      <stop offset="100%" stop-color="#c0261b" />
    </linearGradient>

    <!-- Shelter Canopy Highlight -->
    <linearGradient id="roofGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#e8f5f4" />
    </linearGradient>

    <!-- Subtle Glow / Shadow -->
    <filter id="coreGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="12" flood-color="#032524" flood-opacity="0.45" />
    </filter>
  </defs>

  <!-- Background Squircle -->
  <rect width="512" height="512" rx="120" fill="url(#bgGrad)" />
  <rect width="504" height="504" x="4" y="4" rx="116" fill="none" stroke="#4dd4c8" stroke-width="4" stroke-opacity="0.3" />

  <!-- Protective Shelter Canopy (대피 쉼터 지붕 & 방패) -->
  <path d="M 256 76 L 420 188 C 426 192 422 202 414 202 L 358 202 L 256 132 L 154 202 L 98 202 C 90 202 86 192 92 188 Z"
        fill="url(#roofGrad)" filter="url(#coreGlow)" />
  <!-- Roof Ridge Cap -->
  <circle cx="256" cy="76" r="14" fill="#ffffff" />

  <!-- Warm Sun / Heat Hazard Sensor Core (온) -->
  <circle cx="256" cy="316" r="92" fill="url(#warmGrad)" filter="url(#coreGlow)" />

  <!-- Blockchain Attestation Verification Seal Ring (증) -->
  <circle cx="256" cy="316" r="64" fill="none" stroke="#ffffff" stroke-width="9" stroke-opacity="0.9" />

  <!-- Central Diamond / Verification Spark -->
  <polygon points="256,280 268,304 292,316 268,328 256,352 244,328 220,316 244,304" fill="#ffffff" />

  <!-- Network / Attestation Nodes & Connecting Links -->
  <g stroke="#4dd4c8" stroke-width="7" stroke-linecap="round">
    <!-- Top connector to shelter roof -->
    <line x1="256" y1="202" x2="256" y2="224" />
    <!-- Bottom anchor node -->
    <line x1="256" y1="408" x2="256" y2="436" />
    <!-- Left anchor node -->
    <line x1="164" y1="316" x2="136" y2="316" />
    <!-- Right anchor node -->
    <line x1="348" y1="316" x2="376" y2="316" />
  </g>

  <!-- Connection Node Dots -->
  <circle cx="256" cy="224" r="8" fill="#4dd4c8" />
  <circle cx="256" cy="436" r="10" fill="#4dd4c8" />
  <circle cx="136" cy="316" r="10" fill="#4dd4c8" />
  <circle cx="376" cy="316" r="10" fill="#4dd4c8" />
</svg>
"""

def render_high_res_image(size=512):
    scale = 2
    dim = size * scale
    img = Image.new('RGBA', (dim, dim), (0, 0, 0, 0))
    
    bg_top = (15, 139, 134, 255)
    bg_mid = (11, 110, 107, 255)
    bg_bot = (6, 70, 67, 255)
    
    mask = Image.new('L', (dim, dim), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle([0, 0, dim, dim], radius=int(120 * scale * (size / 512)), fill=255)
    
    grad = Image.new('RGBA', (dim, dim), (0, 0, 0, 0))
    grad_draw = ImageDraw.Draw(grad)
    for y in range(dim):
        t = y / dim
        if t < 0.5:
            factor = t * 2
            r = int(bg_top[0] + (bg_mid[0] - bg_top[0]) * factor)
            g = int(bg_top[1] + (bg_mid[1] - bg_top[1]) * factor)
            b = int(bg_top[2] + (bg_mid[2] - bg_top[2]) * factor)
        else:
            factor = (t - 0.5) * 2
            r = int(bg_mid[0] + (bg_bot[0] - bg_mid[0]) * factor)
            g = int(bg_mid[1] + (bg_bot[1] - bg_mid[1]) * factor)
            b = int(bg_mid[2] + (bg_bot[2] - bg_mid[2]) * factor)
        grad_draw.line([(0, y), (dim, y)], fill=(r, g, b, 255))
        
    img.paste(grad, (0, 0), mask)
    draw = ImageDraw.Draw(img)
    
    def s(v):
        return int(v * scale * (size / 512))
    
    # Border
    draw.rounded_rectangle(
        [s(4), s(4), dim - s(4), dim - s(4)],
        radius=s(116),
        outline=(77, 212, 200, 80),
        width=max(1, s(4))
    )
                           
    # Shelter Roof Canopy
    roof_pts = [
        (s(256), s(76)),
        (s(420), s(188)),
        (s(360), s(202)),
        (s(256), s(132)),
        (s(152), s(202)),
        (s(92), s(188))
    ]
    draw.polygon(roof_pts, fill=(255, 255, 255, 255))
    draw.ellipse([s(256 - 14), s(76 - 14), s(256 + 14), s(76 + 14)], fill=(255, 255, 255, 255))
    
    # Warm Sun / Heat core
    cx, cy, radius = s(256), s(316), s(92)
    for r in range(radius, 0, -1):
        t = r / radius
        red = int(255 * t + 192 * (1 - t))
        green = int(145 * t + 38 * (1 - t))
        blue = int(66 * t + 27 * (1 - t))
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(red, green, blue, 255))
        
    # Attestation Ring
    ring_r = s(64)
    ring_w = max(2, s(9))
    draw.ellipse([cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r], outline=(255, 255, 255, 230), width=ring_w)
    
    # Spark Diamond
    sp_h, sp_w = s(36), s(36)
    spark_pts = [
        (cx, cy - sp_h),
        (cx + s(12), cy - s(12)),
        (cx + sp_w, cy),
        (cx + s(12), cy + s(12)),
        (cx, cy + sp_h),
        (cx - s(12), cy + s(12)),
        (cx - sp_w, cy),
        (cx - s(12), cy - s(12))
    ]
    draw.polygon(spark_pts, fill=(255, 255, 255, 255))
    
    # Blockchain links (cyan)
    cyan = (77, 212, 200, 240)
    lw = max(2, s(7))
    draw.line([(cx, s(202)), (cx, s(224))], fill=cyan, width=lw)
    draw.line([(cx, s(408)), (cx, s(436))], fill=cyan, width=lw)
    draw.line([(s(164), cy), (s(136), cy)], fill=cyan, width=lw)
    draw.line([(s(348), cy), (s(376), cy)], fill=cyan, width=lw)
    
    # Dots
    def dot(px, py, pr):
        draw.ellipse([px - pr, py - pr, px + pr, py + pr], fill=cyan)
        
    dot(cx, s(224), s(8))
    dot(cx, s(436), s(10))
    dot(s(136), cy, s(10))
    dot(s(376), cy, s(10))
    
    return img.resize((size, size), Image.Resampling.LANCZOS)

def main():
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    public_dir = os.path.join(root, "public")
    os.makedirs(public_dir, exist_ok=True)
    
    # 1. Write SVG
    svg_path = os.path.join(public_dir, "favicon.svg")
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(create_svg())
    print(f"Created {svg_path}")
    
    # 2. Render 512x512
    img512 = render_high_res_image(512)
    img512.save(os.path.join(public_dir, "icon-512.png"), "PNG")
    print("Created icon-512.png")
    
    # 3. Render 192x192
    img192 = render_high_res_image(192)
    img192.save(os.path.join(public_dir, "icon-192.png"), "PNG")
    print("Created icon-192.png")

    # 4. Render Apple Touch Icon (180x180)
    img180 = render_high_res_image(180)
    img180.save(os.path.join(public_dir, "apple-touch-icon.png"), "PNG")
    print("Created apple-touch-icon.png")

    # 5. Render 96x96
    img96 = render_high_res_image(96)
    img96.save(os.path.join(public_dir, "favicon-96x96.png"), "PNG")
    print("Created favicon-96x96.png")

    # 6. Render Multi-size ICO
    ico_sizes = [16, 32, 48, 64, 128, 256]
    ico_images = [render_high_res_image(s) for s in ico_sizes]
    
    ico_path = os.path.join(public_dir, "favicon.ico")
    ico_images[0].save(
        ico_path,
        format="ICO",
        sizes=[(s, s) for s in ico_sizes],
        append_images=ico_images[1:]
    )
    print(f"Created {ico_path} with sizes: {ico_sizes}")

    # 7. Write site.webmanifest
    manifest_content = """{
  "name": "온중 溫證 — 대구 폭염 위험 예측·대피·증명",
  "short_name": "온중 溫證",
  "description": "대구 폭염 취약 어르신의 위험을 예측하고 안전한 쉼터 안내와 돌봄 기록 증명을 제공하는 온중 서비스입니다.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f1f5f6",
  "theme_color": "#0b6e6b",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
"""
    manifest_path = os.path.join(public_dir, "site.webmanifest")
    with open(manifest_path, "w", encoding="utf-8") as f:
        f.write(manifest_content)
    print(f"Created {manifest_path}")

if __name__ == "__main__":
    main()
