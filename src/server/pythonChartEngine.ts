import { execFile } from 'node:child_process';
import type { AdaptiveVisualBlock, ParsedBook } from '../lib/bookTypes.ts';

/**
 * Real Python 3.11 scientific SVG plotting script executed via child_process.execFile.
 * Reads exhibit JSON from stdin (zero shell injection risk), computes smooth
 * Catmull-Rom / cubic splines & 3D isometric projections in Python 3, and outputs
 * a publication-grade Matplotlib-styled SVG string to stdout.
 */
const PYTHON_CHART_RENDERER_SCRIPT = String.raw`
import json
import math
import sys
from xml.sax.saxutils import escape

def clamp(v, lo, hi):
    return max(lo, min(hi, v))

def catmull_rom_svg(points, samples_per_seg=12):
    if not points:
        return ""
    if len(points) == 1:
        return f"M {points[0][0]:.2f} {points[0][1]:.2f}"
    dense = []
    n = len(points)
    for i in range(n - 1):
        p0 = points[max(0, i - 1)]
        p1 = points[i]
        p2 = points[i + 1]
        p3 = points[min(n - 1, i + 2)]
        for s in range(samples_per_seg):
            t = s / float(samples_per_seg)
            t2 = t * t
            t3 = t2 * t
            x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2*p0[0] - 5*p1[0] + 4*p2[0] - p3[0]) * t2 + (-p0[0] + 3*p1[0] - 3*p2[0] + p3[0]) * t3)
            y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2*p0[1] - 5*p1[1] + 4*p2[1] - p3[1]) * t2 + (-p0[1] + 3*p1[1] - 3*p2[1] + p3[1]) * t3)
            dense.append((x, y))
    dense.append(points[-1])
    cmds = [f"M {dense[0][0]:.2f} {dense[0][1]:.2f}"]
    for x, y in dense[1:]:
        cmds.append(f"L {x:.2f} {y:.2f}")
    return " ".join(cmds)

def heat_rgb(ratio):
    t = clamp(ratio, 0.0, 1.0)
    # Matplotlib-inspired Viridis/Turbo hybrid scientific ramp
    stops = [
        (0.00, (30, 58, 138)),
        (0.30, (14, 165, 233)),
        (0.58, (234, 179, 8)),
        (0.82, (234, 88, 12)),
        (1.00, (185, 28, 28)),
    ]
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        if t <= t1:
            u = (t - t0) / max(1e-6, t1 - t0)
            r = int(c0[0] + (c1[0] - c0[0]) * u)
            g = int(c0[1] + (c1[1] - c0[1]) * u)
            b = int(c0[2] + (c1[2] - c0[2]) * u)
            return f"rgb({r},{g},{b})"
    return "rgb(185,28,28)"

def render_dyno(title, payload):
    W, H = 960, 520
    pts = payload.get("points", [])
    if len(pts) < 2:
        return ""
    px, py, pw, ph = 82, 84, 780, 272
    ay, ah = 378, 76
    min_rpm = pts[0]["rpm"]
    max_rpm = pts[-1]["rpm"]
    max_hp = math.ceil(max(p["tunedHp"] for p in pts) * 1.15)
    max_tq = math.ceil(max(p["tunedTorqueNm"] for p in pts) * 1.15)

    def x_of(r):
        return px + ((r - min_rpm) / max(1.0, max_rpm - min_rpm)) * pw
    def y_hp(v):
        return py + ph - (v / max(1.0, max_hp)) * ph
    def y_tq(v):
        return py + ph - (v / max(1.0, max_tq)) * ph
    def y_afr(v):
        return ay + ah - ((clamp(v, 10.5, 16.0) - 10.5) / 5.5) * ah

    s_hp = [(x_of(p["rpm"]), y_hp(p["stockHp"])) for p in pts]
    t_hp = [(x_of(p["rpm"]), y_hp(p["tunedHp"])) for p in pts]
    s_tq = [(x_of(p["rpm"]), y_tq(p["stockTorqueNm"])) for p in pts]
    t_tq = [(x_of(p["rpm"]), y_tq(p["tunedTorqueNm"])) for p in pts]
    t_afr = [(x_of(p["rpm"]), y_afr(p.get("tunedAfr", 13.0))) for p in pts]

    peak_hp_pt = max(pts, key=lambda p: p["tunedHp"])
    peak_tq_pt = max(pts, key=lambda p: p["tunedTorqueNm"])
    gain_poly = " ".join(f"{x:.1f},{y:.1f}" for x, y in (t_hp + list(reversed(s_hp))))

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        '<rect width="100%" height="100%" fill="#FFFFFF"/>',
        f'<rect x="10" y="10" width="{W-20}" height="{H-20}" rx="6" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1"/>',
        f'<rect x="10" y="10" width="{W-20}" height="54" rx="6" fill="#0F172A"/>',
        f'<text x="{W-26}" y="34" text-anchor="end" direction="rtl" font-family="Vazirmatn, Tahoma, sans-serif" font-size="15" font-weight="700" fill="#FFFFFF">{escape(title[:62])}</text>',
        f'<text x="{W-26}" y="53" text-anchor="end" font-family="ui-monospace, monospace" font-size="10.5" fill="#94A3B8">Rendered by Python {sys.version_info.major}.{sys.version_info.minor} Spline Engine · HP = (Nm × RPM) / 7127</text>',
        f'<text x="26" y="38" text-anchor="start" font-family="ui-monospace, monospace" font-size="12" font-weight="700" fill="#38BDF8">+{round(payload.get("peakTunedHp",0)-payload.get("peakStockHp",0),1)} HP / +{round(payload.get("peakTunedTorqueNm",0)-payload.get("peakStockTorqueNm",0),1)} Nm</text>',
        f'<rect x="{px}" y="{py}" width="{pw}" height="{ph}" fill="#FFFFFF" stroke="#94A3B8" stroke-width="1"/>',
    ]

    for i in range(6):
        f = i / 5.0
        yy = py + ph * (1.0 - f)
        parts.append(f'<line x1="{px}" y1="{yy:.1f}" x2="{px+pw}" y2="{yy:.1f}" stroke="#E2E8F0" stroke-dasharray="3 3"/>')
        parts.append(f'<text x="{px-10}" y="{yy+4:.1f}" text-anchor="end" font-family="ui-monospace, monospace" font-size="10.5" fill="#1E3A5F">{int(round(max_hp*f))}</text>')
        parts.append(f'<text x="{px+pw+10}" y="{yy+4:.1f}" text-anchor="start" font-family="ui-monospace, monospace" font-size="10.5" fill="#B45309">{int(round(max_tq*f))}</text>')

    for idx, p in enumerate(pts):
        xx = x_of(p["rpm"])
        parts.append(f'<line x1="{xx:.1f}" y1="{py}" x2="{xx:.1f}" y2="{py+ph}" stroke="#F1F5F9"/>')
        if idx % 2 == 0 or idx == len(pts) - 1:
            parts.append(f'<text x="{xx:.1f}" y="{ay+ah+18}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="10.5" fill="#334155">{p["rpm"]}</text>')

    if min_rpm <= 5252 <= max_rpm:
        cx = x_of(5252)
        parts.append(f'<line x1="{cx:.1f}" y1="{py}" x2="{cx:.1f}" y2="{py+ph}" stroke="#DC2626" stroke-dasharray="5 4" stroke-width="1.3" opacity="0.75"/>')
        parts.append(f'<text x="{cx-6:.1f}" y="{py+16}" text-anchor="end" font-family="ui-monospace, monospace" font-size="10" font-weight="700" fill="#DC2626">5252 RPM Crossover</text>')

    parts.append(f'<polygon points="{gain_poly}" fill="#2563EB" opacity="0.13"/>')
    parts.append(f'<path d="{catmull_rom_svg(s_hp)}" fill="none" stroke="#64748B" stroke-width="2" stroke-dasharray="5 4"/>')
    parts.append(f'<path d="{catmull_rom_svg(t_hp)}" fill="none" stroke="#1E3A5F" stroke-width="3.2"/>')
    parts.append(f'<path d="{catmull_rom_svg(s_tq)}" fill="none" stroke="#D97706" stroke-width="1.8" stroke-dasharray="3 3" opacity="0.72"/>')
    parts.append(f'<path d="{catmull_rom_svg(t_tq)}" fill="none" stroke="#D97706" stroke-width="2.8"/>')

    # Peak markers
    phx, phy = x_of(peak_hp_pt["rpm"]), y_hp(peak_hp_pt["tunedHp"])
    ptx, pty = x_of(peak_tq_pt["rpm"]), y_tq(peak_tq_pt["tunedTorqueNm"])
    parts.append(f'<circle cx="{phx:.1f}" cy="{phy:.1f}" r="5" fill="#1E3A5F" stroke="#FFFFFF" stroke-width="2"/>')
    parts.append(f'<text x="{phx-8:.1f}" y="{max(py+16, phy-10):.1f}" text-anchor="end" font-family="ui-monospace, monospace" font-size="10.5" font-weight="700" fill="#1E3A5F">Peak {peak_hp_pt["tunedHp"]} HP @ {peak_hp_pt["rpm"]}</text>')
    parts.append(f'<circle cx="{ptx:.1f}" cy="{pty:.1f}" r="5" fill="#D97706" stroke="#FFFFFF" stroke-width="2"/>')
    parts.append(f'<text x="{ptx+8:.1f}" y="{max(py+16, pty-10):.1f}" text-anchor="start" font-family="ui-monospace, monospace" font-size="10.5" font-weight="700" fill="#B45309">Peak {peak_tq_pt["tunedTorqueNm"]} Nm @ {peak_tq_pt["rpm"]}</text>')

    parts.append(f'<text x="22" y="{py+ph/2:.1f}" text-anchor="middle" transform="rotate(-90 22 {py+ph/2:.1f})" font-family="ui-monospace, monospace" font-size="11" font-weight="700" fill="#1E3A5F">HORSEPOWER (HP)</text>')
    parts.append(f'<text x="{W-22}" y="{py+ph/2:.1f}" text-anchor="middle" transform="rotate(90 {W-22} {py+ph/2:.1f})" font-family="ui-monospace, monospace" font-size="11" font-weight="700" fill="#B45309">TORQUE (Nm)</text>')

    # AFR Sub-chart
    parts.append(f'<rect x="{px}" y="{ay}" width="{pw}" height="{ah}" fill="#FFFFFF" stroke="#94A3B8" stroke-width="1"/>')
    sy = y_afr(14.7)
    parts.append(f'<line x1="{px}" y1="{sy:.1f}" x2="{px+pw}" y2="{sy:.1f}" stroke="#64748B" stroke-dasharray="3 3"/>')
    parts.append(f'<path d="{catmull_rom_svg(t_afr)}" fill="none" stroke="#059669" stroke-width="2.6"/>')
    parts.append(f'<text x="{px-10}" y="{ay+22}" text-anchor="end" font-family="ui-monospace, monospace" font-size="10.5" font-weight="700" fill="#059669">AFR</text>')
    parts.append(f'<text x="{px+pw-8}" y="{sy-4:.1f}" text-anchor="end" font-family="ui-monospace, monospace" font-size="9.5" fill="#475569">Stoich 14.7:1</text>')

    parts.append(f'<text x="{px+pw/2:.1f}" y="494" text-anchor="middle" font-family="ui-monospace, monospace" font-size="11" fill="#334155">Engine Speed (RPM) · Python 3.11 Publication Plot</text>')
    parts.append('</svg>')
    return "".join(parts)

def render_winols(title, payload):
    W, H = 960, 520
    rpms = payload.get("rpmAxis", [])
    loads = payload.get("loadAxis", [])
    stock = payload.get("stockMatrix", [])
    tuned = payload.get("tunedMatrix", [])
    if not rpms or not loads or not tuned:
        return ""
    flat = [v for row in tuned for v in row]
    mn, mx = min(flat), max(flat)
    span = max(1e-6, mx - mn)

    gx, gy, cw, ch = 84, 100, 72, 46
    rows, cols = len(loads), len(rpms)
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        '<rect width="100%" height="100%" fill="#FFFFFF"/>',
        f'<rect x="10" y="10" width="{W-20}" height="{H-20}" rx="6" fill="#F8FAFC" stroke="#CBD5E1"/>',
        f'<rect x="10" y="10" width="{W-20}" height="56" rx="6" fill="#0F172A"/>',
        f'<text x="{W-26}" y="35" text-anchor="end" direction="rtl" font-family="Vazirmatn, Tahoma, sans-serif" font-size="14.5" font-weight="700" fill="#FFFFFF">{escape(payload.get("mapNameFa", title)[:58])}</text>',
        f'<text x="{W-26}" y="53" text-anchor="end" font-family="ui-monospace, monospace" font-size="10" fill="#94A3B8">Python {sys.version_info.major}.{sys.version_info.minor} Thermal + 3D Surface Projection</text>',
        f'<text x="26" y="36" text-anchor="start" font-family="ui-monospace, monospace" font-size="12" font-weight="700" fill="#F59E0B">{escape(payload.get("mapCode",""))} @ {escape(payload.get("hexAddress",""))}</text>',
        f'<text x="26" y="54" text-anchor="start" font-family="ui-monospace, monospace" font-size="10" fill="#94A3B8">{escape(payload.get("factorOffset",""))}</text>',
    ]

    for r in range(rows):
        for c in range(cols):
            val = tuned[r][c]
            st = stock[r][c] if r < len(stock) and c < len(stock[r]) else val
            delta = round(val - st, 2)
            ratio = (val - mn) / span
            x = gx + c * cw
            y = gy + (rows - 1 - r) * ch
            fill = heat_rgb(ratio)
            fg = "#0F172A" if 0.35 <= ratio <= 0.65 else "#FFFFFF"
            parts.append(f'<rect x="{x+1}" y="{y+1}" width="{cw-2}" height="{ch-2}" rx="3" fill="{fill}"/>')
            parts.append(f'<text x="{x+cw/2:.1f}" y="{y+21}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="12" font-weight="700" fill="{fg}">{val}</text>')
            if delta != 0:
                sign = "+" if delta > 0 else ""
                parts.append(f'<text x="{x+cw/2:.1f}" y="{y+37}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="9.5" fill="{fg}" opacity="0.92">{sign}{delta}</text>')

    for c, rpm in enumerate(rpms):
        parts.append(f'<text x="{gx + c*cw + cw/2:.1f}" y="{gy + rows*ch + 20}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="11" font-weight="700" fill="#334155">{rpm}</text>')
    for r, ld in enumerate(loads):
        parts.append(f'<text x="{gx-10}" y="{gy + (rows-1-r)*ch + ch/2 + 4:.1f}" text-anchor="end" font-family="ui-monospace, monospace" font-size="11" font-weight="700" fill="#334155">{ld}%</text>')

    # Filled isometric 3D quads on right panel
    parts.append('<rect x="612" y="100" width="322" height="276" rx="5" fill="#0B1220" stroke="#334155"/>')
    parts.append('<text x="773" y="124" text-anchor="middle" font-family="ui-monospace, monospace" font-size="11" font-weight="700" fill="#E2E8F0">3D SURFACE MESH (PYTHON)</text>')
    ox, oy = 773, 304
    def proj(r, c):
        z = ((tuned[r][c] - mn) / span) * 96.0
        return (ox + (c - r) * 20.0, oy + (c + r) * 9.5 - z - 44.0)
    for r in range(rows - 1):
        for c in range(cols - 1):
            p1, p2, p3, p4 = proj(r, c), proj(r, c+1), proj(r+1, c+1), proj(r+1, c)
            avg = (tuned[r][c] + tuned[r][c+1] + tuned[r+1][c+1] + tuned[r+1][c]) / 4.0
            fill = heat_rgb((avg - mn) / span)
            pts_str = " ".join(f"{p[0]:.1f},{p[1]:.1f}" for p in (p1, p2, p3, p4))
            parts.append(f'<polygon points="{pts_str}" fill="{fill}" fill-opacity="0.86" stroke="#0F172A" stroke-width="0.9"/>')

    parts.append(f'<text x="{W/2:.1f}" y="490" text-anchor="middle" direction="rtl" font-family="Vazirmatn, Tahoma, sans-serif" font-size="11" fill="#475569">{escape(payload.get("highlightZoneLabel",""))}</text>')
    parts.append('</svg>')
    return "".join(parts)

def render_waveform(title, payload):
    W, H = 960, 500
    samples = payload.get("samples", [])
    if len(samples) < 2:
        return ""
    px, py, pw, ph = 80, 92, 826, 290
    max_t = max(s["tMs"] for s in samples) or 1
    th = payload.get("thresholdValue", 1.0)
    max_v = max(max(s["nominal"], s["faulty"]) for s in samples)
    max_v = max(max_v, th) * 1.18
    def x_of(t): return px + (t / float(max_t)) * pw
    def y_of(v): return py + ph - (v / max(0.1, max_v)) * ph
    nom = [(x_of(s["tMs"]), y_of(s["nominal"])) for s in samples]
    flt = [(x_of(s["tMs"]), y_of(s["faulty"])) for s in samples]
    thy = y_of(th)
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        '<rect width="100%" height="100%" fill="#FFFFFF"/>',
        f'<rect x="10" y="10" width="{W-20}" height="{H-20}" rx="6" fill="#F8FAFC" stroke="#CBD5E1"/>',
        f'<rect x="10" y="10" width="{W-20}" height="56" rx="6" fill="#0F172A"/>',
        f'<text x="{W-26}" y="35" text-anchor="end" direction="rtl" font-family="Vazirmatn, Tahoma, sans-serif" font-size="14.5" font-weight="700" fill="#FFFFFF">{escape(title[:58])}</text>',
        f'<text x="{W-26}" y="53" text-anchor="end" font-family="ui-monospace, monospace" font-size="10" fill="#94A3B8">Python {sys.version_info.major}.{sys.version_info.minor} Oscilloscope Plot</text>',
        f'<text x="26" y="42" text-anchor="start" font-family="ui-monospace, monospace" font-size="12" font-weight="700" fill="#F87171">DTC: {escape(" / ".join(payload.get("dtcCodes", [])))}</text>',
        f'<rect x="{px}" y="{py}" width="{pw}" height="{ph}" fill="#090F1A" stroke="#334155" stroke-width="1.2"/>',
        f'<line x1="{px}" y1="{thy:.1f}" x2="{px+pw}" y2="{thy:.1f}" stroke="#F59E0B" stroke-dasharray="6 4" stroke-width="1.5"/>',
        f'<path d="{catmull_rom_svg(nom)}" fill="none" stroke="#10B981" stroke-width="3"/>',
        f'<path d="{catmull_rom_svg(flt)}" fill="none" stroke="#EF4444" stroke-width="2.5" stroke-dasharray="6 4"/>',
        f'<text x="{px+pw/2:.1f}" y="468" text-anchor="middle" font-family="ui-monospace, monospace" font-size="11" fill="#334155">Time Base: 0 — {max_t} ms · Green = Nominal · Red Dashed = Faulty</text>',
        '</svg>'
    ]
    return "".join(parts)

def render_afr_ignition(title, payload):
    W, H = 960, 500
    pts = payload.get("points", [])
    if len(pts) < 2:
        return ""
    px, py, pw, ph = 80, 90, 824, 268
    min_r, max_r = pts[0]["rpm"], pts[-1]["rpm"]
    max_deg = max(p["knockLimitDeg"] for p in pts) * 1.15
    def x_of(r): return px + ((r - min_r) / max(1.0, max_r - min_r)) * pw
    def y_of(d): return py + ph - (d / max(1.0, max_deg)) * ph
    st = [(x_of(p["rpm"]), y_of(p["stockAdvanceDeg"])) for p in pts]
    tu = [(x_of(p["rpm"]), y_of(p["tunedAdvanceDeg"])) for p in pts]
    kn = [(x_of(p["rpm"]), y_of(p["knockLimitDeg"])) for p in pts]
    poly = " ".join(f"{x:.1f},{y:.1f}" for x, y in (kn + list(reversed(tu))))
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        '<rect width="100%" height="100%" fill="#FFFFFF"/>',
        f'<rect x="10" y="10" width="{W-20}" height="{H-20}" rx="6" fill="#F8FAFC" stroke="#CBD5E1"/>',
        f'<rect x="10" y="10" width="{W-20}" height="56" rx="6" fill="#0F172A"/>',
        f'<text x="{W-26}" y="35" text-anchor="end" direction="rtl" font-family="Vazirmatn, Tahoma, sans-serif" font-size="14.5" font-weight="700" fill="#FFFFFF">{escape(title[:58])}</text>',
        f'<text x="{W-26}" y="53" text-anchor="end" font-family="ui-monospace, monospace" font-size="10" fill="#94A3B8">Python {sys.version_info.major}.{sys.version_info.minor} Combustion &amp; Knock Plot</text>',
        f'<text x="26" y="42" text-anchor="start" font-family="ui-monospace, monospace" font-size="12" font-weight="700" fill="#34D399">WOT AFR: {payload.get("targetWotAfr", 12.6)}:1</text>',
        f'<rect x="{px}" y="{py}" width="{pw}" height="{ph}" fill="#FFFFFF" stroke="#94A3B8"/>',
        f'<polygon points="{poly}" fill="#F59E0B" opacity="0.18"/>',
        f'<path d="{catmull_rom_svg(kn)}" fill="none" stroke="#DC2626" stroke-width="2.4" stroke-dasharray="6 4"/>',
        f'<path d="{catmull_rom_svg(st)}" fill="none" stroke="#64748B" stroke-width="2" stroke-dasharray="4 4"/>',
        f'<path d="{catmull_rom_svg(tu)}" fill="none" stroke="#1E3A5F" stroke-width="3.2"/>',
        f'<text x="{px+pw/2:.1f}" y="468" text-anchor="middle" font-family="ui-monospace, monospace" font-size="11" fill="#334155">Ignition Advance (° BTDC) vs Knock Limit · Python 3.11</text>',
        '</svg>'
    ]
    return "".join(parts)

def render_numeric_telemetry(title, payload):
    W, H = 960, 500
    pts = payload.get("points", [])
    if len(pts) < 2:
        return ""
    px, py, pw, ph = 86, 92, 774, 304
    xs = [float(p.get("xNumeric", i)) for i, p in enumerate(pts)]
    y1s = [float(p.get("primaryValue", 0.0)) for p in pts]
    has_sec = any(p.get("secondaryValue") is not None for p in pts)
    y2s = [float(p.get("secondaryValue", 0.0)) for p in pts] if has_sec else []

    min_x, max_x = min(xs), max(xs)
    safe_lim = payload.get("safeLimitValue")
    max_y1 = max(max(y1s), float(safe_lim) if safe_lim is not None else max(y1s)) * 1.15
    min_y1 = min(0.0, min(y1s) * 0.9)
    span_y1 = max(0.1, max_y1 - min_y1)

    max_y2 = (max(y2s) * 1.15) if has_sec else 1.0
    min_y2 = (min(y2s) * 0.85) if has_sec else 0.0
    span_y2 = max(0.1, max_y2 - min_y2)

    def x_of(v): return px + ((v - min_x) / max(1e-6, max_x - min_x)) * pw
    def y1_of(v): return py + ph - ((v - min_y1) / span_y1) * ph
    def y2_of(v): return py + ph - ((v - min_y2) / span_y2) * ph

    p1 = [(x_of(xs[i]), y1_of(y1s[i])) for i in range(len(pts))]
    p2 = [(x_of(xs[i]), y2_of(y2s[i])) for i in range(len(pts))] if has_sec else []
    area_pts = [(px, py + ph)] + p1 + [(px + pw, py + ph)]
    area_poly = " ".join(f"{x:.1f},{y:.1f}" for x, y in area_pts)

    peak_idx = max(range(len(y1s)), key=lambda i: y1s[i])
    unit1 = payload.get("primaryUnit", "")
    unit2 = payload.get("secondaryUnit", "")
    cat_label = str(payload.get("metricCategory", "telemetry")).replace("_", " ").upper()

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        '<rect width="100%" height="100%" fill="#FFFFFF"/>',
        f'<rect x="10" y="10" width="{W-20}" height="{H-20}" rx="6" fill="#F8FAFC" stroke="#CBD5E1"/>',
        f'<rect x="10" y="10" width="{W-20}" height="56" rx="6" fill="#0F172A"/>',
        f'<text x="{W-26}" y="35" text-anchor="end" direction="rtl" font-family="Vazirmatn, Tahoma, sans-serif" font-size="14.5" font-weight="700" fill="#FFFFFF">{escape(title[:58])}</text>',
        f'<text x="{W-26}" y="53" text-anchor="end" direction="ltr" font-family="ui-monospace, monospace" font-size="10" fill="#94A3B8">Python {sys.version_info.major}.{sys.version_info.minor} Auto-Activated Plotter · {escape(cat_label)}</text>',
        f'<text x="26" y="38" text-anchor="start" font-family="ui-monospace, monospace" font-size="12" font-weight="700" fill="#38BDF8">Peak {payload.get("peakPrimary", 0)} {escape(unit1)} · Avg {payload.get("avgPrimary", 0)}</text>',
        f'<rect x="{px}" y="{py}" width="{pw}" height="{ph}" fill="#FFFFFF" stroke="#94A3B8"/>',
    ]

    for i in range(6):
        f = i / 5.0
        yy = py + ph * (1.0 - f)
        v1 = round(min_y1 + span_y1 * f, 1)
        parts.append(f'<line x1="{px}" y1="{yy:.1f}" x2="{px+pw}" y2="{yy:.1f}" stroke="#E2E8F0" stroke-dasharray="3 3"/>')
        parts.append(f'<text x="{px-10}" y="{yy+4:.1f}" text-anchor="end" font-family="ui-monospace, monospace" font-size="10.5" fill="#1E3A5F">{v1}</text>')
        if has_sec:
            v2 = round(min_y2 + span_y2 * f, 1)
            parts.append(f'<text x="{px+pw+10}" y="{yy+4:.1f}" text-anchor="start" font-family="ui-monospace, monospace" font-size="10.5" fill="#B45309">{v2}</text>')

    for idx, p in enumerate(pts):
        xx = x_of(xs[idx])
        parts.append(f'<line x1="{xx:.1f}" y1="{py}" x2="{xx:.1f}" y2="{py+ph}" stroke="#F1F5F9"/>')
        parts.append(f'<text x="{xx:.1f}" y="{py+ph+20}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="10.5" fill="#334155">{escape(str(p.get("xLabel", xs[idx])))}</text>')

    if safe_lim is not None:
        sy = y1_of(float(safe_lim))
        parts.append(f'<line x1="{px}" y1="{sy:.1f}" x2="{px+pw}" y2="{sy:.1f}" stroke="#DC2626" stroke-dasharray="6 4" stroke-width="1.6"/>')
        parts.append(f'<text x="{px+pw-10}" y="{max(py+15, sy-6):.1f}" text-anchor="end" direction="ltr" font-family="ui-monospace, monospace" font-size="10" font-weight="700" fill="#DC2626">Safe Limit: {escape(str(safe_lim))} {escape(unit1)}</text>')

    parts.append(f'<polygon points="{area_poly}" fill="#2563EB" opacity="0.11"/>')
    parts.append(f'<path d="{catmull_rom_svg(p1)}" fill="none" stroke="#1E3A5F" stroke-width="3.0"/>')
    for cx, cy in p1:
        parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="3.5" fill="#1E3A5F" stroke="#FFFFFF" stroke-width="1.5"/>')

    if has_sec:
        parts.append(f'<path d="{catmull_rom_svg(p2)}" fill="none" stroke="#D97706" stroke-width="2.5" stroke-dasharray="5 3"/>')
        for cx, cy in p2:
            parts.append(f'<rect x="{cx-3:.1f}" y="{cy-3:.1f}" width="6" height="6" fill="#D97706" stroke="#FFFFFF" stroke-width="1"/>')

    pkx, pky = p1[peak_idx]
    parts.append(f'<circle cx="{pkx:.1f}" cy="{pky:.1f}" r="5.5" fill="#0F766E" stroke="#FFFFFF" stroke-width="2"/>')
    parts.append(f'<text x="{min(px+pw-10, max(px+70, pkx)):.1f}" y="{max(py+18, pky-11):.1f}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="10.5" font-weight="700" fill="#0F766E">Max {y1s[peak_idx]} {escape(unit1)}</text>')

    parts.append(f'<text x="22" y="{py+ph/2:.1f}" text-anchor="middle" transform="rotate(-90 22 {py+ph/2:.1f})" font-family="ui-monospace, monospace" font-size="11" font-weight="700" fill="#1E3A5F">{escape(unit1)}</text>')
    if has_sec:
        parts.append(f'<text x="{W-22}" y="{py+ph/2:.1f}" text-anchor="middle" transform="rotate(90 {W-22} {py+ph/2:.1f})" font-family="ui-monospace, monospace" font-size="11" font-weight="700" fill="#B45309">{escape(unit2)}</text>')

    parts.append(f'<text x="{px+pw/2:.1f}" y="470" text-anchor="middle" font-family="ui-monospace, monospace" font-size="11" fill="#334155">{escape(str(payload.get("xAxisLabel", "RPM")))} · Python {sys.version_info.major}.{sys.version_info.minor} Publication Telemetry</text>')
    parts.append('</svg>')
    return "".join(parts)

def main():
    raw = sys.stdin.read()
    data = json.loads(raw)
    title = data.get("title", "")
    payload = data.get("payload", {})
    kind = payload.get("kind", "")
    if kind == "dyno_chart":
        svg = render_dyno(title, payload)
    elif kind == "winols_heatmap":
        svg = render_winols(title, payload)
    elif kind == "diagnostic_waveform":
        svg = render_waveform(title, payload)
    elif kind == "afr_ignition_curve":
        svg = render_afr_ignition(title, payload)
    elif kind == "numeric_telemetry_chart":
        svg = render_numeric_telemetry(title, payload)
    else:
        svg = ""
    sys.stdout.write(json.dumps({"svg": svg, "engine": f"Python {sys.version_info.major}.{sys.version_info.minor} Scientific SVG Plotter"}))

if __name__ == "__main__":
    main()
`;

export async function renderAdaptiveVisualWithPython(
  block: AdaptiveVisualBlock
): Promise<{ svg: string; engineLabel: string } | null> {
  if (block.payload.kind === 'ecu_pinout') {
    return null;
  }

  return new Promise((resolve) => {
    const child = execFile(
      'python3',
      ['-c', PYTHON_CHART_RENDERER_SCRIPT],
      { timeout: 4500, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as { svg?: string; engine?: string };
          if (parsed.svg && parsed.svg.startsWith('<svg')) {
            resolve({
              svg: parsed.svg,
              engineLabel: parsed.engine || 'Python 3 Scientific SVG Plotter',
            });
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      }
    );

    if (child.stdin) {
      child.stdin.write(
        JSON.stringify({
          title: block.title,
          payload: block.payload,
        })
      );
      child.stdin.end();
    }
  });
}

/**
 * Executes Python 3 across all adaptive visual blocks in a ParsedBook (bounded concurrency)
 * so Dyno curves, WinOLS 3D surfaces, diagnostic waveforms, and AFR/ignition graphs
 * carry genuine Python-rendered publication SVGs alongside interactive data.
 */
export async function enrichBookAdaptiveVisualsWithPython(
  book: ParsedBook
): Promise<{ renderedCount: number; totalExhibits: number }> {
  const blocks: AdaptiveVisualBlock[] = [];
  for (const ch of book.chapters) {
    for (const b of ch.introBlocks) {
      if (b.type === 'adaptive_visual') blocks.push(b);
    }
    for (const sec of ch.sections) {
      for (const b of sec.blocks) {
        if (b.type === 'adaptive_visual') blocks.push(b);
      }
    }
  }

  let renderedCount = 0;
  const concurrency = 3;
  for (let i = 0; i < blocks.length; i += concurrency) {
    const batch = blocks.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (blk) => {
        const result = await renderAdaptiveVisualWithPython(blk);
        if (result?.svg) {
          blk.pythonRenderedSvg = result.svg;
          blk.svgMarkup = result.svg;
          blk.renderedByPython = true;
          blk.pythonEngineLabel = result.engineLabel;
          renderedCount += 1;
        }
      })
    );
  }

  return { renderedCount, totalExhibits: blocks.length };
}
