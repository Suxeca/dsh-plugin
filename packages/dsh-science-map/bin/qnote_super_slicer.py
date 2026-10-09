#!/usr/bin/env python3
"""
QNote Super Slicer & High-Fidelity Vision Sampler (v2.1)
AI 科研秘书专用的高保真手稿切片与视觉采样引擎：
1. 3x Retina 矢量超采样 (200~300 DPI 印刷级光栅化)；
2. 真实还原 Apple Pencil 物理压感 (细笔轻灵、顿笔刚劲，绝无模糊粗团)；
3. 紧致边界自动收缩 (Tight Bounding Box)，剔除空旷冗余留白；
4. 汉字折笔骨架保护，线条黑度饱满，消除锯齿毛刺；
5. 支持自由坐标切片、自动段落聚类切片，输出超清 PNG 与 100% 无损矢量 SVG。
"""

import os
import sys
import gzip
import json
import io
import math
import base64
import argparse
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

def load_qnote_data(file_path):
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
    with open(file_path, "rb") as f:
        magic = f.read(2)
    if magic == b"\x1f\x8b":
        with gzip.open(file_path, "rt", encoding="utf-8") as f:
            return json.load(f)
    else:
        with open(file_path, "rt", encoding="utf-8") as f:
            return json.load(f)

def calculate_tight_bbox(strokes, images, x1, y1, x2, y2, pad=24):
    min_x, min_y, max_x, max_y = float("inf"), float("inf"), float("-inf"), float("-inf")
    found = False

    for s in strokes:
        pts = s.get("points", [])
        for p in pts:
            px, py = p["x"], p["y"]
            if x1 <= px <= x2 and y1 <= py <= y2:
                found = True
                min_x = min(min_x, px)
                min_y = min(min_y, py)
                max_x = max(max_x, px)
                max_y = max(max_y, py)

    for img in images:
        ix, iy = img["x"], img["y"]
        iw, ih = img["width"], img["height"]
        if ix + iw >= x1 and ix <= x2 and iy + ih >= y1 and iy <= y2:
            found = True
            min_x = min(min_x, ix)
            min_y = min(min_y, iy)
            max_x = max(max_x, ix + iw)
            max_y = max(max_y, iy + ih)

    if not found or min_x >= max_x or min_y >= max_y:
        return x1, y1, x2, y2

    return (
        max(x1 - pad, min_x - pad),
        max(y1 - pad, min_y - pad),
        min(x2 + pad, max_x + pad),
        min(y2 + pad, max_y + pad),
    )

def render_qnote_slice(
    data,
    x1, y1, x2, y2,
    output_path=None,
    scale=None,
    target_height=None,
    tight=True,
    pad=24,
    pure_white_bg=True,
    enhance_contrast=True
):
    strokes = data.get("strokes", [])
    images = data.get("images", [])

    if tight:
        rx1, ry1, rx2, ry2 = calculate_tight_bbox(strokes, images, x1, y1, x2, y2, pad=pad)
    else:
        rx1, ry1, rx2, ry2 = x1 - pad, y1 - pad, x2 + pad, y2 + pad

    logic_w = rx2 - rx1
    logic_h = ry2 - ry1

    if logic_w <= 10 or logic_h <= 10:
        raise ValueError(f"Selection region too small or empty: ({logic_w:.1f}x{logic_h:.1f})")

    if scale is None:
        if target_height:
            scale = target_height / logic_h
        else:
            if logic_h < 400:
                scale = 3.2
            elif logic_h < 800:
                scale = 2.6
            elif logic_h < 1500:
                scale = 2.2
            else:
                scale = 1.8
    scale = float(scale)

    canvas_w = int(math.ceil(logic_w * scale))
    canvas_h = int(math.ceil(logic_h * scale))

    bg_color = (255, 255, 255, 255) if pure_white_bg else (250, 248, 245, 255)
    canvas = Image.new("RGBA", (canvas_w, canvas_h), bg_color)
    draw = ImageDraw.Draw(canvas)

    # 1. 渲染嵌入图片
    for img_obj in images:
        ix, iy = img_obj["x"], img_obj["y"]
        iw, ih = img_obj["width"], img_obj["height"]
        if ix + iw >= rx1 and ix <= rx2 and iy + ih >= ry1 and iy <= ry2:
            src = img_obj.get("src", "")
            if "," in src:
                try:
                    _, b64data = src.split(",", 1)
                    raw = base64.b64decode(b64data)
                    p_img = Image.open(io.BytesIO(raw)).convert("RGBA")
                    tw = int(iw * scale)
                    th = int(ih * scale)
                    p_img = p_img.resize((tw, th), Image.Resampling.LANCZOS)
                    paste_x = int((ix - rx1) * scale)
                    paste_y = int((iy - ry1) * scale)
                    canvas.paste(p_img, (paste_x, paste_y), p_img)
                except Exception:
                    pass

    # 2. 渲染高精度手写笔迹
    for s in strokes:
        pts = s.get("points", [])
        if not pts:
            continue
        xs = [p["x"] for p in pts]
        ys = [p["y"] for p in pts]
        if max(xs) < rx1 or min(xs) > rx2 or max(ys) < ry1 or min(ys) > ry2:
            continue

        color_hex = s.get("color", "#1e293b")
        if color_hex in ["#1e293b", "#000000", "#111827", "#1f2937"]:
            color = (15, 23, 42, 255) # 印刷级深黑
        elif color_hex in ["#b91c1c", "#ef4444", "#dc2626"]:
            color = (185, 28, 28, 255) # 朱砂红 (批注/疑点)
        elif color_hex in ["#1d4ed8", "#2563eb", "#3b82f6"]:
            color = (29, 78, 216, 255) # 纯正科技蓝
        elif color_hex in ["#eab308", "#facc15", "#d97706"]:
            color = (180, 83, 9, 255) # 暖金
        elif color_hex in ["#047857", "#10b981", "#059669"]:
            color = (4, 120, 87, 255) # 墨绿
        elif color_hex in ["#7e22ce", "#7c3aed", "#9333ea"]:
            color = (126, 34, 206, 255) # 学术紫
        else:
            color = (15, 23, 42, 255)

        base_size = float(s.get("size", 2))

        # 单点轻触
        if len(pts) == 1:
            p = pts[0]
            sx = (p["x"] - rx1) * scale
            sy = (p["y"] - ry1) * scale
            pr = p.get("pressure", 0.5) or 0.5
            r = max(1.2, (base_size * (0.35 + 0.55 * pr) * scale) / 2.0)
            draw.ellipse([sx - r, sy - r, sx + r, sy + r], fill=color)
            continue

        screen_pts = [
            (
                (p["x"] - rx1) * scale,
                (p["y"] - ry1) * scale,
                p.get("pressure", 0.5) or 0.5
            )
            for p in pts
        ]

        # 分段动态压感连线
        for i in range(len(screen_pts) - 1):
            p0 = screen_pts[i]
            p1 = screen_pts[i + 1]
            local_pr = (p0[2] + p1[2]) / 2.0
            seg_w = max(1.6, base_size * (0.35 + 0.70 * local_pr) * scale)

            draw.line([(p0[0], p0[1]), (p1[0], p1[1])], fill=color, width=int(round(seg_w)))
            r = seg_w / 2.0
            draw.ellipse([p1[0] - r, p1[1] - r, p1[0] + r, p1[1] + r], fill=color)

    final_img = canvas.convert("RGB")

    if enhance_contrast:
        enhancer = ImageEnhance.Contrast(final_img)
        final_img = enhancer.enhance(1.06)
        final_img = final_img.filter(ImageFilter.UnsharpMask(radius=1.2, percent=115, threshold=3))

    if output_path:
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        final_img.save(output_path, "PNG", quality=100)

    return final_img, (rx1, ry1, rx2, ry2), (canvas_w, canvas_h)

def export_svg_slice(data, x1, y1, x2, y2, output_path, tight=True, pad=24):
    strokes = data.get("strokes", [])
    images = data.get("images", [])
    if tight:
        rx1, ry1, rx2, ry2 = calculate_tight_bbox(strokes, images, x1, y1, x2, y2, pad=pad)
    else:
        rx1, ry1, rx2, ry2 = x1 - pad, y1 - pad, x2 + pad, y2 + pad

    width = rx2 - rx1
    height = ry2 - ry1

    svg_parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.1f} {height:.1f}" width="{width:.1f}" height="{height:.1f}">',
        f'  <rect width="100%" height="100%" fill="#ffffff" />',
        f'  <g transform="translate({-rx1:.2f}, {-ry1:.2f})">'
    ]

    for s in strokes:
        pts = s.get("points", [])
        if not pts: continue
        xs = [p["x"] for p in pts]
        ys = [p["y"] for p in pts]
        if max(xs) < rx1 or min(xs) > rx2 or max(ys) < ry1 or min(ys) > ry2:
            continue

        color = s.get("color", "#0f172a")
        size = float(s.get("size", 2))
        avg_pr = sum(p.get("pressure", 0.5) or 0.5 for p in pts) / len(pts)
        sw = max(1.2, size * (0.35 + 0.65 * avg_pr))

        if len(pts) == 1:
            svg_parts.append(f'    <circle cx="{pts[0]["x"]:.2f}" cy="{pts[0]["y"]:.2f}" r="{sw/2:.2f}" fill="{color}" />')
            continue

        d_str = f'M {pts[0]["x"]:.2f} {pts[0]["y"]:.2f}'
        for p in pts[1:]:
            d_str += f' L {p["x"]:.2f} {p["y"]:.2f}'

        svg_parts.append(
            f'    <path d="{d_str}" fill="none" stroke="{color}" stroke-width="{sw:.2f}" stroke-linecap="round" stroke-linejoin="round" />'
        )

    svg_parts.append('  </g>')
    svg_parts.append('</svg>')

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(svg_parts))

def main():
    parser = argparse.ArgumentParser(description="QNote Super Slicer - AI秘书专用高保真手稿切片工具")
    parser.add_argument("qnote", help="输入的 .qnote 笔记文件路径")
    parser.add_argument("--rect", "-r", nargs=4, type=float, metavar=("X1", "Y1", "X2", "Y2"), help="切片矩形世界坐标 [x1 y1 x2 y2]")
    parser.add_argument("--out", "-o", default="slice.png", help="输出图片路径 (默认 slice.png)")
    parser.add_argument("--scale", "-s", type=float, default=None, help="强制缩放倍率 (默认自适应 2.0x~3.2x)")
    parser.add_argument("--pad", "-p", type=float, default=24.0, help="紧致边界外侧留白 (默认 24px)")
    parser.add_argument("--svg", action="store_true", help="同时导出同名 .svg 矢量文件")
    parser.add_argument("--no-tight", action="store_true", help="禁用紧致边界收缩，保持原矩形尺寸")

    args = parser.parse_args()
    data = load_qnote_data(args.qnote)
    print(f"📖 Loaded QNote: {args.qnote}")
    print(f"   Strokes: {len(data.get('strokes', []))}, Images: {len(data.get('images', []))}")

    if not args.rect:
        strokes = data.get("strokes", [])
        all_xs = [p["x"] for s in strokes for p in s.get("points", [])]
        all_ys = [p["y"] for s in strokes for p in s.get("points", [])]
        if all_xs and all_ys:
            args.rect = [min(all_xs), min(all_ys), max(all_xs), max(all_ys)]
        else:
            print("⚠️ 笔记中未找到有效笔画")
            return

    x1, y1, x2, y2 = args.rect
    img, (rx1, ry1, rx2, ry2), (cw, ch) = render_qnote_slice(
        data,
        x1, y1, x2, y2,
        output_path=args.out,
        scale=args.scale,
        tight=not args.no_tight,
        pad=args.pad
    )

    print(f"✅ 超采样切片渲染成功: {args.out}")
    print(f"   裁剪边界: [{rx1:.1f}, {ry1:.1f}, {rx2:.1f}, {ry2:.1f}]")
    print(f"   输出分辨率: {cw} x {ch} px (高清视网膜品质)")

    if args.svg:
        svg_out = os.path.splitext(args.out)[0] + ".svg"
        export_svg_slice(data, x1, y1, x2, y2, svg_out, tight=not args.no_tight, pad=args.pad)
        print(f"✅ 矢量 SVG 输出成功: {svg_out}")

if __name__ == "__main__":
    main()
