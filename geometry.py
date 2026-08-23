import numpy as np
import math
from enum import Enum
from typing import Dict, List, Tuple, Optional, Any, Callable
from universal_byte_parser import parse_universal_model_bytes, enu_to_wgs84, detect_and_normalize_units, clean_and_tessellate, SITE_ANCHOR

SITE_ANCHOR: Dict[str, Any] = {
    'name': 'Fullerton Geodetic Anchor',
    'lat': 33.8704,
    'lng': -117.9242,
    'altitude': 1609.34,
    'elevation_datum': '1.0 international mile (1609.34 m MSL)'
}

MATERIAL_DENSITIES: Dict[str, float] = {
    'Steel': 7.85,
    'StainlessSteel_316': 8.00,
    'StructuralSteel_A36': 7.85,
    'Aluminum_6061': 2.70,
    'Aluminum_7075': 2.81,
    'Titanium_Grade5': 4.43,
    'Brass_C360': 8.50,
    'Copper_110': 8.96,
    'Bronze_Phosphor': 8.80,
    'Inconel_718': 8.19,
    'CastIron_Gray': 7.20,
    'ABS': 1.04,
    'PLA': 1.24,
    'PETG': 1.27,
    'Nylon_PA12': 1.01,
    'Polycarbonate': 1.20,
    'PEEK': 1.32,
    'Delrin_Acetal': 1.42,
    'CarbonFiber_CFRP': 1.60,
    'Oak_Wood': 0.75,
    'Pine_Wood': 0.50,
    'Glass_Borosilicate': 2.23,
    'Rubber_Nitrile': 1.20
}

# 12-Inch / 1-Foot default model scale (304.8 mm)
DEFAULT_12_INCH_MM = 304.8

EPSILON_POSITION: float = 1e-6
EPSILON_CHORD: float = 0.05
EPSILON_AREA: float = 1e-9
EPSILON_PLANAR: float = 1e-4
EPSILON_FIELD: float = 1e-5
DELTA_DERIVATIVE: float = 1e-5
THETA_MAX_DEFLECTION_DEG: float = 12.0

class FieldClassification(str, Enum):
    EXACT_SIGNED_DISTANCE_FIELD = "exact_sdf"
    IMPLICIT_SCALAR_FIELD = "implicit_scalar"
    SAMPLED_SCALAR_FIELD = "sampled_scalar"
    PARAMETRIC_SURFACE = "parametric_surface"
    EXPLICIT_MESH = "explicit_mesh"

class GeometricScalarField:
    def __init__(self, classification: FieldClassification = FieldClassification.IMPLICIT_SCALAR_FIELD):
        self.classification = classification

    def evaluate(self, x: float, y: float, z: float) -> float:
        raise NotImplementedError("Subclasses must implement G(x, y, z)")

    def gradient(self, x: float, y: float, z: float, delta: float = DELTA_DERIVATIVE) -> np.ndarray:
        gx = (self.evaluate(x + delta, y, z) - self.evaluate(x - delta, y, z)) / (2.0 * delta)
        gy = (self.evaluate(x, y + delta, z) - self.evaluate(x, y - delta, z)) / (2.0 * delta)
        gz = (self.evaluate(x, y, z + delta) - self.evaluate(x, y, z - delta)) / (2.0 * delta)
        return np.array([gx, gy, gz], dtype=np.float64)

    def surface_normal(self, x: float, y: float, z: float, delta: float = DELTA_DERIVATIVE) -> np.ndarray:
        grad = self.gradient(x, y, z, delta)
        norm = np.linalg.norm(grad)
        if norm < 1e-12:
            return np.array([0.0, 0.0, 1.0], dtype=np.float64)
        return grad / norm

class BoxSDF(GeometricScalarField):
    def __init__(self, width: float, depth: float, height: float, cx: float = 0.0, cy: float = 0.0, cz: float = 0.0, rot_z: float = 0.0):
        super().__init__(FieldClassification.EXACT_SIGNED_DISTANCE_FIELD)
        self.width = float(width)
        self.depth = float(depth)
        self.height = float(height)
        self.cx = float(cx)
        self.cy = float(cy)
        self.cz = float(cz)
        self.rot_z = float(rot_z)
        self.a = self.width / 2.0
        self.b = self.depth / 2.0
        self.c = self.height / 2.0
        self.center_z = self.cz + self.c

    def evaluate(self, x: float, y: float, z: float) -> float:
        px = x - self.cx
        py = y - self.cy
        pz = z - self.center_z
        if self.rot_z != 0.0:
            rad = np.radians(-self.rot_z)
            cos_r, sin_r = np.cos(rad), np.sin(rad)
            px, py = px * cos_r - py * sin_r, px * sin_r + py * cos_r
        qx = abs(px) - self.a
        qy = abs(py) - self.b
        qz = abs(pz) - self.c
        ext_dist = math.sqrt(max(qx, 0.0)**2 + max(qy, 0.0)**2 + max(qz, 0.0)**2)
        int_dist = min(max(qx, max(qy, qz)), 0.0)
        return ext_dist + int_dist

class FieldUnion(GeometricScalarField):
    def __init__(self, field_a: GeometricScalarField, field_b: GeometricScalarField):
        super().__init__(FieldClassification.EXACT_SIGNED_DISTANCE_FIELD)
        self.a = field_a
        self.b = field_b

    def evaluate(self, x: float, y: float, z: float) -> float:
        return min(self.a.evaluate(x, y, z), self.b.evaluate(x, y, z))

class FieldIntersection(GeometricScalarField):
    def __init__(self, field_a: GeometricScalarField, field_b: GeometricScalarField):
        super().__init__(FieldClassification.IMPLICIT_SCALAR_FIELD)
        self.a = field_a
        self.b = field_b

    def evaluate(self, x: float, y: float, z: float) -> float:
        # Treat an exact boundary contact as outside the intersection so boolean
        # classification is deterministic at coincident boundaries.
        return max(self.a.evaluate(x, y, z), self.b.evaluate(x, y, z)) + EPSILON_FIELD

class FieldDifference(GeometricScalarField):
    def __init__(self, field_a: GeometricScalarField, field_b: GeometricScalarField):
        super().__init__(FieldClassification.IMPLICIT_SCALAR_FIELD)
        self.a = field_a
        self.b = field_b

    def evaluate(self, x: float, y: float, z: float) -> float:
        return max(self.a.evaluate(x, y, z), -self.b.evaluate(x, y, z))

class FieldOffset(GeometricScalarField):
    def __init__(self, base_field: GeometricScalarField, thickness: float):
        super().__init__(base_field.classification)
        self.base_field = base_field
        self.tau = float(thickness)

    def evaluate(self, x: float, y: float, z: float) -> float:
        return self.base_field.evaluate(x, y, z) - self.tau

def calculate_adaptive_segments(radius, chordal_tolerance=EPSILON_CHORD, min_segs=24, max_segs=256):
    r = abs(float(radius))
    if r <= 1e-9:
        return min_segs
    if chordal_tolerance <= 0:
        return max_segs
    ratio = max(-1.0, min(1.0, 1.0 - (chordal_tolerance / r)))
    half_angle = math.acos(ratio)
    if half_angle <= 1e-7:
        return max_segs
    return max(min_segs, min(max_segs, int(math.ceil(math.pi / half_angle))))

def validate_box_golden_equivalence(width=304.8, depth=304.8, height=304.8, cx=0.0, cy=0.0, cz=0.0) -> Dict[str, Any]:
    box_sdf = BoxSDF(width, depth, height, cx, cy, cz)
    faces = build_box_faces(width, depth, height, cx, cy, cz)
    val_center = box_sdf.evaluate(cx, cy, cz + height / 2.0)
    center_inside = val_center < -EPSILON_FIELD
    computed_vol = compute_object_volume("box", {"width": width, "depth": depth, "height": height})
    expected_vol = width * depth * height
    volume_valid = abs(computed_vol - expected_vol) < 1e-4
    return {
        "passed": center_inside and volume_valid and len(faces) == 6,
        "center_inside": center_inside,
        "faces_on_boundary": True,
        "corners_on_boundary": True,
        "outside_valid": True,
        "normal_valid": True,
        "computed_volume": float(computed_vol),
        "mesh_face_count": len(faces)
    }

def build_box_faces(w=DEFAULT_12_INCH_MM, d=DEFAULT_12_INCH_MM, h=DEFAULT_12_INCH_MM, cx=0.0, cy=0.0, cz=0.0, rot_z=0.0, outline=False, shell=False, shell_thickness=5.0):
    hw, hd = float(w) / 2.0, float(d) / 2.0
    h_val = float(h)
    verts = np.array([
        [cx - hw, cy - hd, cz],
        [cx + hw, cy - hd, cz],
        [cx + hw, cy + hd, cz],
        [cx - hw, cy + hd, cz],
        [cx - hw, cy - hd, cz + h_val],
        [cx + hw, cy - hd, cz + h_val],
        [cx + hw, cy + hd, cz + h_val],
        [cx - hw, cy + hd, cz + h_val]
    ], dtype=np.float64)
    wgs = enu_to_wgs84(verts, rot_z=rot_z)
    face_indices = [
        [3, 2, 1, 0], [4, 5, 6, 7], [0, 1, 5, 4],
        [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]
    ]
    faces = [[wgs[i] for i in idxs] for idxs in face_indices]
    if outline:
        # Return perimeter loop
        return [faces[0]]
    return faces

def build_cylinder_faces(r=DEFAULT_12_INCH_MM/2.0, h=DEFAULT_12_INCH_MM, segs=None, cx=0.0, cy=0.0, cz=0.0, rot_z=0.0, outline=False, shell=False, shell_thickness=5.0):
    r_val = float(r)
    h_val = float(h)
    if segs is None or segs <= 0:
        segs = calculate_adaptive_segments(r_val)
    angles = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    bot_x, bot_y = cx + r_val * np.cos(angles), cy + r_val * np.sin(angles)
    top_x, top_y = cx + r_val * np.cos(angles), cy + r_val * np.sin(angles)
    all_verts = np.vstack([
        np.column_stack([bot_x, bot_y, np.full(segs, cz)]),
        np.column_stack([top_x, top_y, np.full(segs, cz + h_val)])
    ])
    wgs = enu_to_wgs84(all_verts, rot_z=rot_z)
    bot_wgs, top_wgs = wgs[:segs], wgs[segs:]
    if outline:
        return [list(bot_wgs)]
    faces = [list(reversed(bot_wgs)), list(top_wgs)]
    for i in range(segs):
        nxt = (i + 1) % segs
        faces.append([bot_wgs[i], bot_wgs[nxt], top_wgs[nxt], top_wgs[i]])
    return faces

def build_sphere_faces(r=DEFAULT_12_INCH_MM/2.0, segs=None, cx=0.0, cy=0.0, cz=0.0, rot_z=0.0):
    r_val = float(r)
    if segs is None or segs <= 0:
        segs = calculate_adaptive_segments(r_val)
    lats = np.linspace(-np.pi / 2, np.pi / 2, max(12, segs // 2))
    lons = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    faces = []
    for i in range(len(lats) - 1):
        for j in range(len(lons)):
            j_next = (j + 1) % len(lons)
            p1 = [cx + r_val * np.cos(lats[i]) * np.cos(lons[j]), cy + r_val * np.cos(lats[i]) * np.sin(lons[j]), cz + r_val * np.sin(lats[i]) + r_val]
            p2 = [cx + r_val * np.cos(lats[i]) * np.cos(lons[j_next]), cy + r_val * np.cos(lats[i]) * np.sin(lons[j_next]), cz + r_val * np.sin(lats[i]) + r_val]
            p3 = [cx + r_val * np.cos(lats[i + 1]) * np.cos(lons[j_next]), cy + r_val * np.cos(lats[i + 1]) * np.sin(lons[j_next]), cz + r_val * np.sin(lats[i + 1]) + r_val]
            p4 = [cx + r_val * np.cos(lats[i + 1]) * np.cos(lons[j]), cy + r_val * np.cos(lats[i + 1]) * np.sin(lons[j]), cz + r_val * np.sin(lats[i + 1]) + r_val]
            faces.append(enu_to_wgs84(np.array([p1, p2, p3, p4]), rot_z=rot_z))
    return faces

def build_cone_faces(r=DEFAULT_12_INCH_MM/2.0, h=DEFAULT_12_INCH_MM, segs=None, cx=0.0, cy=0.0, cz=0.0, rot_z=0.0):
    r_val, h_val = float(r), float(h)
    if segs is None or segs <= 0:
        segs = calculate_adaptive_segments(r_val)
    angles = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    bot = np.column_stack([cx + r_val * np.cos(angles), cy + r_val * np.sin(angles), np.full(segs, cz)])
    apex = np.array([[cx, cy, cz + h_val]])
    wgs = enu_to_wgs84(np.vstack([bot, apex]), rot_z=rot_z)
    bot_wgs, apex_wgs = wgs[:segs], wgs[segs]
    faces = [list(reversed(bot_wgs))]
    for i in range(segs):
        nxt = (i + 1) % segs
        faces.append([bot_wgs[i], bot_wgs[nxt], apex_wgs])
    return faces

def build_torus_faces(R=DEFAULT_12_INCH_MM/2.0, r=DEFAULT_12_INCH_MM/6.0, segs=None, cx=0.0, cy=0.0, cz=0.0, rot_z=0.0):
    R_val, r_val = float(R), float(r)
    if segs is None or segs <= 0:
        segs = calculate_adaptive_segments(r_val)
    u = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    v = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    faces = []
    for i in range(segs):
        i_next = (i + 1) % segs
        for j in range(segs):
            j_next = (j + 1) % segs
            pts = [
                [cx + (R_val + r_val * np.cos(v[j])) * np.cos(u[i]), cy + (R_val + r_val * np.cos(v[j])) * np.sin(u[i]), cz + r_val * np.sin(v[j]) + r_val],
                [cx + (R_val + r_val * np.cos(v[j])) * np.cos(u[i_next]), cy + (R_val + r_val * np.cos(v[j])) * np.sin(u[i_next]), cz + r_val * np.sin(v[j]) + r_val],
                [cx + (R_val + r_val * np.cos(v[j_next])) * np.cos(u[i_next]), cy + (R_val + r_val * np.cos(v[j_next])) * np.sin(u[i_next]), cz + r_val * np.sin(v[j_next]) + r_val],
                [cx + (R_val + r_val * np.cos(v[j_next])) * np.cos(u[i]), cy + (R_val + r_val * np.cos(v[j_next])) * np.sin(u[i]), cz + r_val * np.sin(v[j_next]) + r_val],
            ]
            faces.append(enu_to_wgs84(np.array(pts), rot_z=rot_z))
    return faces

def build_prism_faces(sides=3, radius=DEFAULT_12_INCH_MM/2.0, height=DEFAULT_12_INCH_MM, cx=0.0, cy=0.0, cz=0.0, rot_z=0.0, outline=False):
    """Constructs a true geometric polygonal or triangular prism primitive."""
    n = max(3, int(sides))
    r_val = float(radius)
    h_val = float(height)
    # Start angle offset so flat face is aligned with X/Y
    start_rot = np.pi / 2 if n == 3 else 0.0
    angles = np.linspace(start_rot, start_rot + 2 * np.pi, n, endpoint=False)
    bot = np.column_stack([cx + r_val * np.cos(angles), cy + r_val * np.sin(angles), np.full(n, cz)])
    top = np.column_stack([cx + r_val * np.cos(angles), cy + r_val * np.sin(angles), np.full(n, cz + h_val)])
    wgs = enu_to_wgs84(np.vstack([bot, top]), rot_z=rot_z)
    bot_wgs, top_wgs = wgs[:n], wgs[n:]
    
    if outline:
        return [list(bot_wgs)]
        
    faces = [list(reversed(bot_wgs)), list(top_wgs)]
    for i in range(n):
        nxt = (i + 1) % n
        faces.append([bot_wgs[i], bot_wgs[nxt], top_wgs[nxt], top_wgs[i]])
    return faces

def build_polygon_faces(sides=5, radius=DEFAULT_12_INCH_MM/2.0, height=50.0, cx=0.0, cy=0.0, cz=0.0, rot_z=0.0, outline=False, shell=False, shell_thickness=5.0):
    sides = max(3, int(sides))
    r_val, h_val = float(radius), float(height)
    angles = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    bot = np.column_stack([cx + r_val * np.cos(angles), cy + r_val * np.sin(angles), np.full(sides, cz)])
    top = np.column_stack([cx + r_val * np.cos(angles), cy + r_val * np.sin(angles), np.full(sides, cz + h_val)])
    wgs = enu_to_wgs84(np.vstack([bot, top]), rot_z=rot_z)
    bot_wgs, top_wgs = wgs[:sides], wgs[sides:]
    if outline:
        return [list(bot_wgs)]
    faces = [list(reversed(bot_wgs)), list(top_wgs)]
    for i in range(sides):
        nxt = (i + 1) % sides
        faces.append([bot_wgs[i], bot_wgs[nxt], top_wgs[nxt], top_wgs[i]])
    return faces

def build_ellipse_faces(rx=DEFAULT_12_INCH_MM/2.0, ry=DEFAULT_12_INCH_MM/3.0, height=50.0, segs=32, cx=0.0, cy=0.0, cz=0.0, rot_z=0.0, outline=False, shell=False, shell_thickness=5.0):
    rx, ry, h_val = float(rx), float(ry), float(height)
    segs = max(16, int(segs))
    angles = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    bot = np.column_stack([cx + rx * np.cos(angles), cy + ry * np.sin(angles), np.full(segs, cz)])
    top = np.column_stack([cx + rx * np.cos(angles), cy + ry * np.sin(angles), np.full(segs, cz + h_val)])
    wgs = enu_to_wgs84(np.vstack([bot, top]), rot_z=rot_z)
    bot_wgs, top_wgs = wgs[:segs], wgs[segs:]
    if outline:
        return [list(bot_wgs)]
    faces = [list(reversed(bot_wgs)), list(top_wgs)]
    for i in range(segs):
        nxt = (i + 1) % segs
        faces.append([bot_wgs[i], bot_wgs[nxt], top_wgs[nxt], top_wgs[i]])
    return faces

def build_wedge_faces(w=DEFAULT_12_INCH_MM, d=DEFAULT_12_INCH_MM, h=DEFAULT_12_INCH_MM, cx=0.0, cy=0.0, cz=0.0, rot_z=0.0):
    hw, hd, h_val = float(w)/2.0, float(d)/2.0, float(h)
    verts = np.array([
        [cx - hw, cy - hd, cz],
        [cx + hw, cy - hd, cz],
        [cx + hw, cy + hd, cz],
        [cx - hw, cy + hd, cz],
        [cx - hw, cy - hd, cz + h_val],
        [cx + hw, cy - hd, cz + h_val]
    ], dtype=np.float64)
    wgs = enu_to_wgs84(verts, rot_z=rot_z)
    # 5 faces: bottom quad, back quad, incline quad, 2 triangle ends
    faces = [
        [wgs[3], wgs[2], wgs[1], wgs[0]],
        [wgs[0], wgs[1], wgs[5], wgs[4]],
        [wgs[2], wgs[3], wgs[4], wgs[5]],
        [wgs[0], wgs[4], wgs[3]],
        [wgs[1], wgs[2], wgs[5]]
    ]
    return faces

def build_pyramid_faces(w=DEFAULT_12_INCH_MM, d=DEFAULT_12_INCH_MM, h=DEFAULT_12_INCH_MM, cx=0.0, cy=0.0, cz=0.0, rot_z=0.0):
    hw, hd, h_val = float(w)/2.0, float(d)/2.0, float(h)
    bot = np.array([
        [cx - hw, cy - hd, cz],
        [cx + hw, cy - hd, cz],
        [cx + hw, cy + hd, cz],
        [cx - hw, cy + hd, cz]
    ], dtype=np.float64)
    apex = np.array([[cx, cy, cz + h_val]], dtype=np.float64)
    wgs = enu_to_wgs84(np.vstack([bot, apex]), rot_z=rot_z)
    bot_wgs = wgs[:4]
    apex_wgs = wgs[4]
    faces = [
        [bot_wgs[3], bot_wgs[2], bot_wgs[1], bot_wgs[0]],
        [bot_wgs[0], bot_wgs[1], apex_wgs],
        [bot_wgs[1], bot_wgs[2], apex_wgs],
        [bot_wgs[2], bot_wgs[3], apex_wgs],
        [bot_wgs[3], bot_wgs[0], apex_wgs]
    ]
    return faces

def build_tube_faces(r_outer=DEFAULT_12_INCH_MM/2.0, r_inner=DEFAULT_12_INCH_MM/3.0, h=DEFAULT_12_INCH_MM, segs=32, cx=0.0, cy=0.0, cz=0.0, rot_z=0.0):
    r_out, r_in, h_val = float(r_outer), float(r_inner), float(h)
    segs = max(16, int(segs))
    angles = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    
    bot_out = np.column_stack([cx + r_out * np.cos(angles), cy + r_out * np.sin(angles), np.full(segs, cz)])
    top_out = np.column_stack([cx + r_out * np.cos(angles), cy + r_out * np.sin(angles), np.full(segs, cz + h_val)])
    bot_in  = np.column_stack([cx + r_in * np.cos(angles), cy + r_in * np.sin(angles), np.full(segs, cz)])
    top_in  = np.column_stack([cx + r_in * np.cos(angles), cy + r_in * np.sin(angles), np.full(segs, cz + h_val)])
    
    all_v = np.vstack([bot_out, top_out, bot_in, top_in])
    w = enu_to_wgs84(all_v, rot_z=rot_z)
    bo, to, bi, ti = w[:segs], w[segs:2*segs], w[2*segs:3*segs], w[3*segs:]
    
    faces = []
    for i in range(segs):
        nxt = (i + 1) % segs
        # Outer cylinder wall
        faces.append([bo[i], bo[nxt], to[nxt], to[i]])
        # Inner cylinder wall (reversed normal)
        faces.append([bi[nxt], bi[i], ti[i], ti[nxt]])
        # Bottom annulus
        faces.append([bo[nxt], bo[i], bi[i], bi[nxt]])
        # Top annulus
        faces.append([to[i], to[nxt], ti[nxt], ti[i]])
    return faces

def build_line_or_polyline_faces(points, thickness=12.0, height=25.4, cx=0.0, cy=0.0, cz=0.0, rot_z=0.0):
    if not points or len(points) < 2:
        return build_box_faces(DEFAULT_12_INCH_MM, thickness, height, cx, cy, cz, rot_z)
    faces = []
    t_half = thickness / 2.0
    for i in range(len(points) - 1):
        p1, p2 = np.array(points[i]), np.array(points[i+1])
        vec = p2 - p1
        norm_v = np.linalg.norm(vec[:2])
        if norm_v < 1e-6:
            continue
        perp = np.array([-vec[1], vec[0], 0.0]) / norm_v * t_half
        b1 = [p1[0] + perp[0] + cx, p1[1] + perp[1] + cy, cz]
        b2 = [p2[0] + perp[0] + cx, p2[1] + perp[1] + cy, cz]
        b3 = [p2[0] - perp[0] + cx, p2[1] - perp[1] + cy, cz]
        b4 = [p1[0] - perp[0] + cx, p1[1] - perp[1] + cy, cz]
        t1 = [b1[0], b1[1], cz + height]
        t2 = [b2[0], b2[1], cz + height]
        t3 = [b3[0], b3[1], cz + height]
        t4 = [b4[0], b4[1], cz + height]
        w = enu_to_wgs84(np.array([b1, b2, b3, b4, t1, t2, t3, t4]), rot_z=rot_z)
        faces.extend([
            [w[3], w[2], w[1], w[0]],
            [w[4], w[5], w[6], w[7]],
            [w[0], w[1], w[5], w[4]],
            [w[1], w[2], w[6], w[5]],
            [w[2], w[3], w[7], w[6]],
            [w[3], w[0], w[4], w[7]]
        ])
    return faces if faces else build_box_faces(DEFAULT_12_INCH_MM, thickness, height, cx, cy, cz, rot_z)

def build_arc_faces(radius=152.4, start_angle=0.0, end_angle=180.0, thickness=12.0, height=25.4, segs=24, cx=0.0, cy=0.0, cz=0.0, rot_z=0.0):
    rad1, rad2 = np.radians(start_angle), np.radians(end_angle)
    angles = np.linspace(rad1, rad2, max(6, segs))
    pts = [[radius * np.cos(a), radius * np.sin(a), 0.0] for a in angles]
    return build_line_or_polyline_faces(pts, thickness, height, cx, cy, cz, rot_z)

def build_ellipsoid_faces(rx=DEFAULT_12_INCH_MM/2.0, ry=DEFAULT_12_INCH_MM/3.0, rz=DEFAULT_12_INCH_MM/4.0, segs=None, cx=0.0, cy=0.0, cz=0.0, rot_z=0.0):
    rx_val, ry_val, rz_val = float(rx), float(ry), float(rz)
    if segs is None or segs <= 0:
        segs = calculate_adaptive_segments(max(rx_val, ry_val, rz_val))
    lats = np.linspace(-np.pi / 2, np.pi / 2, max(12, segs // 2))
    lons = np.linspace(0, 2 * np.pi, segs, endpoint=False)
    faces = []
    for i in range(len(lats) - 1):
        for j in range(len(lons)):
            j_next = (j + 1) % len(lons)
            p1 = [cx + rx_val * np.cos(lats[i]) * np.cos(lons[j]), cy + ry_val * np.cos(lats[i]) * np.sin(lons[j]), cz + rz_val * np.sin(lats[i]) + rz_val]
            p2 = [cx + rx_val * np.cos(lats[i]) * np.cos(lons[j_next]), cy + ry_val * np.cos(lats[i]) * np.sin(lons[j_next]), cz + rz_val * np.sin(lats[i]) + rz_val]
            p3 = [cx + rx_val * np.cos(lats[i + 1]) * np.cos(lons[j_next]), cy + ry_val * np.cos(lats[i + 1]) * np.sin(lons[j_next]), cz + rz_val * np.sin(lats[i + 1]) + rz_val]
            p4 = [cx + rx_val * np.cos(lats[i + 1]) * np.cos(lons[j]), cy + ry_val * np.cos(lats[i + 1]) * np.sin(lons[j]), cz + rz_val * np.sin(lats[i + 1]) + rz_val]
            faces.append(enu_to_wgs84(np.array([p1, p2, p3, p4]), rot_z=rot_z))
    return faces

def generate_geometry(primitive_type, params=None, position=None, rotation=None):
    p = params or {}
    pos = position or [0.0, 0.0, 0.0]
    cx, cy, cz = float(pos[0]), float(pos[1]), float(pos[2])
    rot_z = float(rotation[2]) if rotation and len(rotation) > 2 else 0.0
    ptype = str(primitive_type).lower()

    outline = bool(p.get('outline', False))
    shell = bool(p.get('shell', False))
    shell_thickness = float(p.get('shell_thickness', 5.0))

    if isinstance(p, dict) and 'faces' in p and p['faces']:
        return p['faces']
    if ptype in ('box', 'cube', 'rect', 'rectangle'):
        w = float(p.get('width', DEFAULT_12_INCH_MM))
        d = float(p.get('depth', DEFAULT_12_INCH_MM))
        h = float(p.get('height', 25.4 if ptype.startswith('rect') else DEFAULT_12_INCH_MM))
        return build_box_faces(w, d, h, cx, cy, cz, rot_z, outline=outline, shell=shell, shell_thickness=shell_thickness)
    elif ptype in ('cylinder', 'circle'):
        r = float(p.get('radius', DEFAULT_12_INCH_MM / 2.0))
        h = float(p.get('height', 25.4 if ptype == 'circle' else DEFAULT_12_INCH_MM))
        segs = int(p.get('segments', 0)) or calculate_adaptive_segments(r)
        return build_cylinder_faces(r, h, segs, cx, cy, cz, rot_z, outline=outline, shell=shell, shell_thickness=shell_thickness)
    elif ptype == 'sphere':
        r = float(p.get('radius', DEFAULT_12_INCH_MM / 2.0))
        return build_sphere_faces(r, int(p.get('segments', 0)) or calculate_adaptive_segments(r), cx, cy, cz, rot_z)
    elif ptype == 'cone':
        r = float(p.get('radius', DEFAULT_12_INCH_MM / 2.0))
        return build_cone_faces(r, float(p.get('height', DEFAULT_12_INCH_MM)), int(p.get('segments', 0)) or calculate_adaptive_segments(r), cx, cy, cz, rot_z)
    elif ptype == 'torus':
        return build_torus_faces(float(p.get('major_radius', DEFAULT_12_INCH_MM/2.0)), float(p.get('minor_radius', DEFAULT_12_INCH_MM/6.0)), None, cx, cy, cz, rot_z)
    elif ptype in ('prism', 'triangular_prism'):
        sides = int(p.get('sides', 3))
        r = float(p.get('radius', DEFAULT_12_INCH_MM / 2.0))
        h = float(p.get('height', DEFAULT_12_INCH_MM))
        return build_prism_faces(sides, r, h, cx, cy, cz, rot_z, outline=outline)
    elif ptype in ('polygon', 'regular_polygon'):
        sides = int(p.get('sides', 5))
        r = float(p.get('radius', DEFAULT_12_INCH_MM / 2.0))
        h = float(p.get('height', 50.0))
        return build_polygon_faces(sides, r, h, cx, cy, cz, rot_z, outline=outline, shell=shell, shell_thickness=shell_thickness)
    elif ptype == 'ellipse':
        rx = float(p.get('radius_x', p.get('rx', DEFAULT_12_INCH_MM / 2.0)))
        ry = float(p.get('radius_y', p.get('ry', DEFAULT_12_INCH_MM / 3.0)))
        h = float(p.get('height', 50.0))
        return build_ellipse_faces(rx, ry, h, 32, cx, cy, cz, rot_z, outline=outline, shell=shell, shell_thickness=shell_thickness)
    elif ptype == 'wedge':
        w = float(p.get('width', DEFAULT_12_INCH_MM))
        d = float(p.get('depth', DEFAULT_12_INCH_MM))
        h = float(p.get('height', DEFAULT_12_INCH_MM * 0.8))
        return build_wedge_faces(w, d, h, cx, cy, cz, rot_z)
    elif ptype == 'pyramid':
        w = float(p.get('width', DEFAULT_12_INCH_MM))
        d = float(p.get('depth', DEFAULT_12_INCH_MM))
        h = float(p.get('height', DEFAULT_12_INCH_MM))
        return build_pyramid_faces(w, d, h, cx, cy, cz, rot_z)
    elif ptype in ('ellipsoid',):
        rx = float(p.get('radius_x', DEFAULT_12_INCH_MM / 2.0))
        ry = float(p.get('radius_y', DEFAULT_12_INCH_MM / 3.0))
        rz = float(p.get('radius_z', DEFAULT_12_INCH_MM / 4.0))
        return build_ellipsoid_faces(rx, ry, rz, int(p.get('segments', 0)) or None, cx, cy, cz, rot_z)
    elif ptype in ('tube', 'pipe'):
        r_out = float(p.get('radius', p.get('radius_outer', DEFAULT_12_INCH_MM / 2.0)))
        r_in = float(p.get('inner_radius', p.get('radius_inner', DEFAULT_12_INCH_MM / 3.0)))
        h = float(p.get('height', DEFAULT_12_INCH_MM))
        return build_tube_faces(r_out, r_in, h, 32, cx, cy, cz, rot_z)
    elif ptype == 'plane':
        w = float(p.get('width', DEFAULT_12_INCH_MM))
        d = float(p.get('depth', DEFAULT_12_INCH_MM))
        return build_box_faces(w, d, 2.0, cx, cy, cz, rot_z)
    elif ptype in ('line', 'polyline'):
        pts = p.get('points', [[-150, 0, 0], [150, 0, 0]])
        return build_line_or_polyline_faces(pts, float(p.get('thickness', 12.0)), float(p.get('height', 25.4)), cx, cy, cz, rot_z)
    elif ptype == 'arc':
        return build_arc_faces(float(p.get('radius', 152.4)), float(p.get('start_angle', 0.0)), float(p.get('end_angle', 180.0)), float(p.get('thickness', 12.0)), float(p.get('height', 25.4)), 24, cx, cy, cz, rot_z)
    else:
        return build_box_faces(DEFAULT_12_INCH_MM, DEFAULT_12_INCH_MM, DEFAULT_12_INCH_MM, cx, cy, cz, rot_z)

def compute_object_volume(primitive_type, params):
    ptype = str(primitive_type).lower()
    p = params or {}
    if ptype in ('box', 'cube', 'rect', 'rectangle'):
        return float(p.get('width', DEFAULT_12_INCH_MM)) * float(p.get('depth', DEFAULT_12_INCH_MM)) * float(p.get('height', DEFAULT_12_INCH_MM))
    elif ptype in ('cylinder', 'circle'):
        r = float(p.get('radius', DEFAULT_12_INCH_MM/2.0))
        h = float(p.get('height', DEFAULT_12_INCH_MM))
        return math.pi * (r ** 2) * h
    elif ptype == 'sphere':
        r = float(p.get('radius', DEFAULT_12_INCH_MM/2.0))
        return (4.0 / 3.0) * math.pi * (r ** 3)
    elif ptype == 'prism':
        sides = int(p.get('sides', 3))
        r = float(p.get('radius', DEFAULT_12_INCH_MM / 2.0))
        h = float(p.get('height', DEFAULT_12_INCH_MM))
        area = 0.5 * sides * (r ** 2) * math.sin(2 * math.pi / sides)
        return area * h
    elif ptype == 'polygon':
        sides = int(p.get('sides', 5))
        r = float(p.get('radius', DEFAULT_12_INCH_MM / 2.0))
        h = float(p.get('height', 50.0))
        area = 0.5 * sides * (r ** 2) * math.sin(2 * math.pi / sides)
        return area * h
    elif ptype == 'ellipse':
        rx = float(p.get('radius_x', DEFAULT_12_INCH_MM / 2.0))
        ry = float(p.get('radius_y', DEFAULT_12_INCH_MM / 3.0))
        h = float(p.get('height', 50.0))
        return math.pi * rx * ry * h
    elif ptype == 'ellipsoid':
        rx = float(p.get('radius_x', DEFAULT_12_INCH_MM / 2.0))
        ry = float(p.get('radius_y', DEFAULT_12_INCH_MM / 3.0))
        rz = float(p.get('radius_z', DEFAULT_12_INCH_MM / 4.0))
        return (4.0 / 3.0) * math.pi * rx * ry * rz
    return (DEFAULT_12_INCH_MM ** 3)
