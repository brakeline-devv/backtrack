"""Wireframe 'blueprint' 3D assets for the Backtrack site: white hairlines + lime accents on pure black.
Headless:
  D:/blender.exe -b -P scenes.py -- <scene> preview <frame> <out.png>
  D:/blender.exe -b -P scenes.py -- <scene> render <out_dir/f_>
scenes: hero (3D chart: candles + equity ribbon + trade nodes, slow turn), stack (exploded layers:
plain words -> rules -> 3 years of prices, gentle float), gate (the promotion gate on a grid, slow turn).
All loops are seamless. Rendered on black so the site can lay them over the page with mix-blend-mode: screen.
"""
import bpy, bmesh, math, sys, random
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SCENE, MODE = argv[0], argv[1]
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
FRAMES = {"hero": 240, "stack": 180, "gate": 240}[SCENE]
sc.frame_start, sc.frame_end, sc.render.fps = 0, FRAMES - 1, 30

def emit(name, color, strength):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission"); o = nt.nodes.new("ShaderNodeOutputMaterial")
    e.inputs["Color"].default_value = (*color, 1); e.inputs["Strength"].default_value = strength
    nt.links.new(e.outputs[0], o.inputs[0]); return m
def holdout(name="hold"):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    h = nt.nodes.new("ShaderNodeHoldout") if False else nt.nodes.new("ShaderNodeEmission"); h.inputs["Color"].default_value = (0, 0, 0, 1)
    o = nt.nodes.new("ShaderNodeOutputMaterial"); nt.links.new(h.outputs[0], o.inputs[0]); return m

WHITE = emit("white", (1, 1, 1), 1.6)
DIM = emit("dim", (1, 1, 1), 0.35)
LIME = emit("lime", (0.78, 1.0, 0.12), 3.0)
LIMEF = emit("limef", (0.78, 1.0, 0.12), 1.2)
BLACK = holdout()

def link(o): sc.collection.objects.link(o); return o
root = link(bpy.data.objects.new("root", None))

def wire(obj, thick=0.012, mat=WHITE, faces_black=True):
    """Keep the solid faces black (they hide lines behind them) and add thin emissive edges."""
    if faces_black: obj.data.materials.append(BLACK)
    w = bpy.data.objects.new(obj.name + "_w", obj.data.copy()); link(w)
    w.parent = obj  # rides along with the solid (and its animation)
    w.data.materials.clear(); w.data.materials.append(mat)
    m = w.modifiers.new("w", "WIREFRAME"); m.thickness = thick; m.use_replace = True; m.use_even_offset = True
    m.offset = 1.0  # lines sit just outside the black solid, so they are never hidden by their own faces
    if not faces_black: obj.hide_render = True
    return w

def box(name, loc, size, parent=None, thick=0.012, mat=WHITE, solid=True):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, verts=bm.verts, vec=size)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me)); o.location = loc; o.parent = parent or root
    wire(o, thick, mat, faces_black=solid); return o

def grid(name, sx, sy, nx, ny, z=0.0, mat=DIM, thick=0.006, parent=None):
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=nx, y_subdivisions=ny, size=1)
    g = bpy.context.active_object; g.name = name; g.scale = (sx, sy, 1); g.location.z = z; g.parent = parent or root
    bpy.ops.object.transform_apply(scale=True)
    wire(g, thick, mat, faces_black=False); return g

def tube(name, pts, r=0.02, mat=WHITE, parent=None):
    cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = r; cu.bevel_resolution = 2
    sp = cu.splines.new("POLY"); sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts): sp.points[i].co = (*p, 1)
    o = link(bpy.data.objects.new(name, cu)); o.data.materials.append(mat); o.parent = parent or root; return o

def dots(name, a, b, n=18, r=0.012, mat=WHITE, parent=None):
    for k in range(n):
        if k % 2: continue
        t0, t1 = k / n, (k + 1) / n
        tube(f"{name}{k}", [a.lerp(b, t0), a.lerp(b, t1)], r, mat, parent)

def sphere(name, loc, r, mat, parent=None, ring=True):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=16, ring_count=8)
    s = bpy.context.active_object; s.name = name; s.data.materials.append(mat); s.parent = parent or root
    if ring:
        bpy.ops.mesh.primitive_torus_add(major_radius=r * 2.2, minor_radius=r * 0.18, location=loc, major_segments=40, minor_segments=6)
        t = bpy.context.active_object; t.data.materials.append(WHITE); t.parent = parent or root
    return s

def camera(loc, target, lens=50, ortho=None):
    cam = link(bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))); cam.location = loc
    if ortho: cam.data.type = "ORTHO"; cam.data.ortho_scale = ortho
    else: cam.data.lens = lens
    t = link(bpy.data.objects.new("tgt", None)); t.location = target
    c = cam.constraints.new("TRACK_TO"); c.target = t; c.track_axis = "TRACK_NEGATIVE_Z"; c.up_axis = "UP_Y"
    sc.camera = cam; return cam

def spin(obj, turns=1.0, axis=2, start=0.0):
    obj.rotation_euler[axis] = start; obj.keyframe_insert("rotation_euler", index=axis, frame=0)
    obj.rotation_euler[axis] = start + math.tau * turns; obj.keyframe_insert("rotation_euler", index=axis, frame=FRAMES)
    for fc in obj.animation_data.action.fcurves:
        for kp in fc.keyframe_points: kp.interpolation = "LINEAR"

# ─────────────────────────────── scenes ───────────────────────────────
if SCENE == "hero":
    # a 3D price chart on a disc: candles (wire boxes) around a circle-ish path, an equity ribbon, lime trade nodes
    base = link(bpy.data.objects.new("base", None)); base.parent = root
    grid("floor", 7.0, 7.0, 28, 28, z=0, parent=base)
    bpy.ops.mesh.primitive_circle_add(vertices=128, radius=3.4); c = bpy.context.active_object; c.parent = base
    tube_pts = [Vector((3.4 * math.cos(a), 3.4 * math.sin(a), 0)) for a in [i / 128 * math.tau for i in range(129)]]
    bpy.data.objects.remove(c); tube("rim", tube_pts, 0.012, WHITE, base)
    # price walk -> candles
    n, price, prices = 40, 1.0, []
    for i in range(n):
        o = price; price *= math.exp(random.gauss(0.012, 0.06)); prices.append((o, price))
    lo, hi = min(min(p) for p in prices), max(max(p) for p in prices)
    H = lambda v: 0.25 + (v - lo) / (hi - lo) * 2.6
    xs = [-3.0 + i * 6.0 / (n - 1) for i in range(n)]
    for i, (o, c2) in enumerate(prices):
        y0, y1 = H(o), H(c2); mid = (y0 + y1) / 2; hgt = max(abs(y1 - y0), 0.05)
        up = c2 >= o
        box(f"c{i}", (xs[i], 0.0, mid), (0.09, 0.09, hgt), base, 0.01, WHITE if up else DIM)
        tube(f"wk{i}", [Vector((xs[i], 0, min(y0, y1) - 0.12)), Vector((xs[i], 0, max(y0, y1) + 0.12))], 0.006, DIM, base)
    # equity ribbon behind the candles, and trade nodes
    eq = [Vector((xs[i], 0.9, H(prices[i][1]) * 0.85 + 0.3)) for i in range(n)]
    tube("equity", eq, 0.022, LIMEF, base)
    trades = [4, 11, 17, 26, 33]
    for k, i in enumerate(trades):
        p = Vector((xs[i], 0.9, eq[i].z)); sphere(f"t{k}", p, 0.07, LIME, base)
        tube(f"stem{k}", [Vector((xs[i], 0.9, 0)), p], 0.006, DIM, base)
    for a, b in zip(trades, trades[1:]): dots(f"d{a}", Vector((xs[a], 0.9, eq[a].z)), Vector((xs[b], 0.9, eq[b].z)), 22, 0.008, WHITE, base)
    # two orbit rings, like the reference's satellites
    for k, (rad, tilt) in enumerate([(4.1, 0.35), (4.6, -0.22)]):
        pts = [Vector((rad * math.cos(a), rad * math.sin(a) * math.cos(tilt), rad * math.sin(a) * math.sin(tilt) + 1.4)) for a in [i / 160 * math.tau for i in range(161)]]
        tube(f"orb{k}", pts, 0.006, DIM, base)
    base.scale = (1.25, 1.25, 1.35)
    spin(base, 0.5, 2, math.radians(-20))  # half a turn per loop; the chart is symmetric enough front/back
    camera((0, -11.0, 5.0), (0, 0, 1.6), lens=40)
    RES = (1400, 1100)

elif SCENE == "stack":
    # exploded isometric layers: plain words (card) -> rules (strategy.md slab) -> 3 years of prices (block grid)
    st = link(bpy.data.objects.new("stack", None)); st.parent = root
    grid("floor", 9, 9, 18, 18, z=-0.05, parent=st)
    # layer 3: price-history blocks (some lime = trades)
    lime_cells = {(1, 1), (2, 1), (1, 2), (2, 2), (6, 4)}
    for i in range(8):
        for j in range(6):
            h = 0.12 + 0.18 * (math.sin(i * 0.9 + j * 0.6) * 0.5 + 0.5)
            m = LIMEF if (i, j) in lime_cells else WHITE
            b = box(f"b{i}{j}", (-2.8 + i * 0.8, -2.0 + j * 0.8, h / 2), (0.62, 0.62, h), st, 0.01, m)
            if (i, j) in lime_cells: b.data.materials.clear(); b.data.materials.append(LIMEF)
    # layer 2: rules slab with rule rows
    slab = box("rules", (0, 0, 1.55), (6.6, 4.8, 0.22), st, 0.014, WHITE)
    for k in range(5):
        w = [4.6, 3.2, 3.8, 2.4, 3.0][k]
        r = box(f"row{k}", (-3.0 + w / 2 + 0.3, 1.7 - k * 0.8, 0.13), (w, 0.26, 0.04), slab, 0.008, LIME if k in (0, 2) else WHITE)
        if k in (0, 2): r.data.materials.clear(); r.data.materials.append(LIMEF)
    # layer 1: the plain-words card (a speech bubble with text lines)
    card = box("card", (1.0, 1.3, 3.6), (3.8, 2.2, 0.12), st, 0.014, WHITE)
    for k, w in enumerate([3.0, 3.3, 2.1]): box(f"txt{k}", (-0.7 + w / 2, 1.95 - k * 0.5, 3.68), (w, 0.13, 0.02), st, 0.006, WHITE)
    tube("tail", [Vector((-0.4, 0.2, 3.6)), Vector((-0.9, -0.5, 3.6)), Vector((0.2, 0.2, 3.6))], 0.014, WHITE, st)
    # vertical guide lines (dotted) between layers
    for (x, y) in [(-3.3, -2.4), (3.3, -2.4), (-3.3, 2.4), (3.3, 2.4)]: dots(f"g{x}{y}", Vector((x, y, 0.4)), Vector((x, y, 1.44)), 10, 0.008, DIM, st)
    for (x, y) in [(-0.9, 0.2), (2.9, 2.4)]: dots(f"h{x}{y}", Vector((x, y, 1.68)), Vector((x, y, 3.5)), 12, 0.008, DIM, st)
    # gentle float, seamless (one full sine per loop)
    for f in range(0, FRAMES + 1, 6):
        ph = f / FRAMES * math.tau
        card.location.z = 3.6 + 0.12 * math.sin(ph); card.keyframe_insert("location", index=2, frame=f)
        slab.location.z = 1.55 + 0.06 * math.sin(ph + 1.2); slab.keyframe_insert("location", index=2, frame=f)
    camera((9.5, -9.5, 8.6), (0, 0, 1.8), ortho=10.8)
    RES = (1400, 1150)

elif SCENE == "gate":
    # the promotion gate: a wireframe arch on a perspective grid, a lime light passing through, slow turn
    g = link(bpy.data.objects.new("gate", None)); g.parent = root
    grid("floor", 14, 14, 28, 28, z=0, parent=g)
    for side in (-1, 1):
        box(f"post{side}", (side * 1.35, 0, 1.6), (0.38, 0.38, 3.2), g, 0.014, WHITE)
        box(f"base{side}", (side * 1.35, 0, 0.12), (0.7, 0.7, 0.24), g, 0.012, WHITE)
    box("beam", (0, 0, 3.35), (3.4, 0.46, 0.34), g, 0.014, WHITE)
    box("sign", (0, 0, 3.85), (1.6, 0.12, 0.5), g, 0.012, WHITE)
    box("signL", (0, -0.07, 3.85), (1.1, 0.02, 0.12), g, 0.01, LIME)
    # checks on the posts (rows of small lime ticks)
    for side in (-1, 1):
        for k in range(5): box(f"tick{side}{k}", (side * 1.35 - side * 0.2, -0.2, 0.7 + k * 0.5), (0.02, 0.02, 0.18), g, 0.006, LIME if k < 4 else DIM)
    # a path through the gate: dotted in front, solid lime behind (passed)
    dots("pathA", Vector((0, -6, 0.02)), Vector((0, -0.4, 0.02)), 24, 0.02, WHITE, g)
    tube("pathB", [Vector((0, -0.4, 0.02)), Vector((0, 6, 0.02))], 0.025, LIMEF, g)
    # the candidate strategy: a small block travelling through the gate (loops)
    pk = box("probe", (0, -5, 0.35), (0.5, 0.5, 0.5), g, 0.012, LIME)
    for f in range(0, FRAMES + 1, 4):
        t = f / FRAMES; pk.location.y = -5.5 + 11 * t; pk.keyframe_insert("location", index=1, frame=f)
    spin(g, 0.25, 2, math.radians(-12))
    camera((0, -11.5, 4.6), (0, 0, 1.9), lens=40)
    RES = (1600, 1000)

w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND"); bg.inputs["Color"].default_value = (0, 0, 0, 1); bg.inputs["Strength"].default_value = 0
sc.render.engine = "CYCLES"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for t in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = t; prefs.get_devices()
            if any(d.type == t for d in prefs.devices):
                for d in prefs.devices: d.use = True
                sc.cycles.device = "GPU"; break
        except Exception: pass
except Exception: pass
sc.cycles.samples = 24; sc.cycles.use_denoising = True; sc.cycles.max_bounces = 0
sc.render.resolution_x, sc.render.resolution_y = RES
sc.render.image_settings.file_format = "PNG"
try: sc.view_settings.view_transform = "Standard"
except Exception: pass
# light bloom on the lime parts
sc.use_nodes = True; tree = sc.node_tree
for nd in list(tree.nodes): tree.nodes.remove(nd)
rl = tree.nodes.new("CompositorNodeRLayers"); comp = tree.nodes.new("CompositorNodeComposite"); gl = tree.nodes.new("CompositorNodeGlare")
try: gl.glare_type = "BLOOM"
except Exception: gl.glare_type = "FOG_GLOW"
gl.quality = "HIGH"; gl.threshold = 1.5
try: gl.size = 6
except Exception: pass
tree.links.new(rl.outputs["Image"], gl.inputs["Image"]); tree.links.new(gl.outputs["Image"], comp.inputs["Image"])

if MODE == "preview":
    sc.frame_set(int(argv[2])); sc.render.filepath = argv[3]; sc.render.resolution_percentage = 50
    bpy.ops.render.render(write_still=True)
else:
    sc.render.filepath = argv[2]; bpy.ops.render.render(animation=True)
print("done", SCENE, MODE)
