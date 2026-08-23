"""
GeoParametric3D — Canonical Geometry, Adaptive Tessellation, and Native Maps 3D Pipeline

Architectural Invariants:
  1. SOURCE GEOMETRY IS NOT THE RENDER MESH.
  2. Triangles are a derived rendering representation, NOT the authoritative truth.
  3. Canonical geometry preserves mathematical and topological semantics.
  4. Units are authoritatively converted and preserved in canonical linear millimeters (mm).
  5. Transformations and instancing are preserved separately from geometry definitions.
  6. The renderer (<gmp-map-3d> / Maps 3D Web Component) selects the optimal semantic representation:
     - Simple planar face -> Native 3D Polygon (<gmp-polygon-3d>)
     - CAD edge / curve   -> Native 3D Polyline (<gmp-polyline-3d>)
     - Point / vertex     -> Native 3D Marker (<gmp-marker-3d>)
     - Complex assembly   -> GLTF / GLB / model-3d (<gmp-model-3d>)
     - Arbitrary surface  -> Adaptive Render Mesh Buffers
"""

import math
import uuid
import enum
import logging
from typing import List, Dict, Any, Optional, Tuple, Union, Callable
import numpy as np

logger = logging.getLogger("GeoParametric3D.CanonicalGeometry")

CANONICAL_INTERNAL_UNIT = "mm"
DEFAULT_TOLERANCE_MM = 1e-4
EPSILON_AREA = 1e-9
EPSILON_NORMAL = 1e-6


# ============================================================
# 1. PIPELINE ERROR CLASSIFICATIONS
# ============================================================

class GeometryPipelineStage(str, enum.Enum):
    FORMAT_DETECTION = "FORMAT_DETECTION_ERROR"
    STEP_IMPORT = "STEP_IMPORT_ERROR"
    BREP_TOPOLOGY = "BREP_TOPOLOGY_ERROR"
    SURFACE_EXTRACTION = "SURFACE_EXTRACTION_ERROR"
    TESSELLATION = "TESSELLATION_ERROR"
    MESH_VALIDATION = "MESH_VALIDATION_ERROR"
    STL_PARSE = "STL_PARSE_ERROR"
    JSON_SERIALIZATION = "JSON_SERIALIZATION_ERROR"
    TRANSFORM = "TRANSFORM_ERROR"
    UNIT_CONVERSION = "UNIT_CONVERSION_ERROR"
    IMPORT = "IMPORT_ERROR"
    FORMAT = "FORMAT_ERROR"
    UNIT = "UNIT_ERROR"
    OCCT = "OCCT_ERROR"
    TOPOLOGY = "TOPOLOGY_ERROR"
    SURFACE = "SURFACE_ERROR"
    CURVE = "CURVE_ERROR"
    CANONICALIZATION = "CANONICALIZATION_ERROR"
    RENDER = "RENDER_ERROR"


class GeometryPipelineException(Exception):
    def __init__(self, stage: GeometryPipelineStage, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(f"[{stage.value}] {message}")
        self.stage = stage
        self.details = details or {}


# ============================================================
# 2. JSON/API BOUNDARY NORMALIZATION
# ============================================================

def sanitize_for_json(obj: Any) -> Any:
    """
    Recursively normalizes Python/NumPy data structures into JSON-safe native Python types.
    Converts:
        np.ndarray -> list
        np.floating / float -> float (rejecting NaN/Inf with GeometryPipelineException)
        np.integer / int -> int
        np.bool_ / bool -> bool
        Objects with to_dict() -> dict
    Guarantees strict JSON boundary safety compliance.
    """
    if obj is None:
        return None
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, (int, np.integer)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        val = float(obj)
        if math.isnan(val) or math.isinf(val):
            raise GeometryPipelineException(
                GeometryPipelineStage.JSON_SERIALIZATION,
                f"Non-finite numeric value ({val}) encountered at JSON boundary"
            )
        return val
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return sanitize_for_json(obj.tolist())
    if isinstance(obj, dict):
        return {str(k): sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [sanitize_for_json(item) for item in obj]
    if hasattr(obj, "to_dict") and callable(getattr(obj, "to_dict")):
        return sanitize_for_json(obj.to_dict())
    return str(obj)


# ============================================================
# 3. CANONICAL TRANSFORMATIONS & INSTANCING
# ============================================================

class GeoTransform:
    """Rigid or affine transformation matrix (4x4) separate from vertex geometry."""
    def __init__(self, matrix: Optional[Union[List[float], np.ndarray]] = None):
        if matrix is None:
            self.matrix = np.eye(4, dtype=np.float64)
        else:
            arr = np.asarray(matrix, dtype=np.float64)
            if arr.shape == (16,):
                self.matrix = arr.reshape(4, 4)
            elif arr.shape == (4, 4):
                self.matrix = arr.copy()
            else:
                raise GeometryPipelineException(
                    GeometryPipelineStage.CANONICALIZATION,
                    f"Transform matrix must be 4x4 or length 16, got shape {arr.shape}"
                )
        if not np.isfinite(self.matrix).all():
            raise GeometryPipelineException(
                GeometryPipelineStage.CANONICALIZATION,
                "Transform matrix contains NaN or Infinite values"
            )

    @classmethod
    def translation(cls, x: float, y: float, z: float) -> "GeoTransform":
        mat = np.eye(4, dtype=np.float64)
        mat[0, 3] = float(x)
        mat[1, 3] = float(y)
        mat[2, 3] = float(z)
        return cls(mat)

    @classmethod
    def rotation_z(cls, angle_degrees: float) -> "GeoTransform":
        rad = math.radians(float(angle_degrees))
        c, s = math.cos(rad), math.sin(rad)
        mat = np.eye(4, dtype=np.float64)
        mat[0, 0] = c;  mat[0, 1] = -s
        mat[1, 0] = s;  mat[1, 1] = c
        return cls(mat)

    @classmethod
    def scale(cls, sx: float, sy: float, sz: float) -> "GeoTransform":
        mat = np.eye(4, dtype=np.float64)
        mat[0, 0] = float(sx)
        mat[1, 1] = float(sy)
        mat[2, 2] = float(sz)
        return cls(mat)

    def compose(self, other: "GeoTransform") -> "GeoTransform":
        return GeoTransform(np.matmul(self.matrix, other.matrix))

    def apply_point(self, pt: np.ndarray) -> np.ndarray:
        p = np.array([pt[0], pt[1], pt[2], 1.0], dtype=np.float64)
        res = np.dot(self.matrix, p)
        w = res[3] if abs(res[3]) > 1e-12 else 1.0
        return res[:3] / w

    def apply_vector(self, vec: np.ndarray) -> np.ndarray:
        v = np.array([vec[0], vec[1], vec[2], 0.0], dtype=np.float64)
        res = np.dot(self.matrix, v)
        return res[:3]

    def to_dict(self) -> dict:
        return {"matrix": self.matrix.flatten().tolist()}


# ============================================================
# 4. CANONICAL GEOMETRIC ENTITIES
# ============================================================

class GeoVertex:
    """Authoritative 3D Vertex defined in canonical mm."""
    def __init__(self, vertex_id: str, point: Union[List[float], np.ndarray], source_id: Optional[str] = None):
        self.id = vertex_id
        pt = np.asarray(point, dtype=np.float64)
        if pt.shape != (3,) or not np.isfinite(pt).all():
            raise GeometryPipelineException(
                GeometryPipelineStage.CANONICALIZATION,
                f"Vertex point must be finite 3D coordinates, got {point}"
            )
        self.point = pt
        self.source_id = source_id

    def to_dict(self) -> dict:
        return {"id": self.id, "point": self.point.tolist(), "source_id": self.source_id}


class CurveType(str, enum.Enum):
    LINE = "line"
    CIRCLE = "circle"
    ARC = "arc"
    ELLIPSE = "ellipse"
    BSPLINE = "bspline"
    NURBS = "nurbs"
    PARAMETRIC = "parametric"


class GeoCurve:
    """Authoritative mathematical 1D curve in 3D canonical space."""
    def __init__(self, curve_id: str, curve_type: CurveType = CurveType.LINE, parameters: Optional[dict] = None, source_id: Optional[str] = None):
        self.id = curve_id
        self.curve_type = curve_type
        self.parameters = parameters or {}
        self.source_id = source_id

    def sample(self, num_samples: int = 32) -> np.ndarray:
        """Adaptive mathematical curve sampling."""
        t = np.linspace(0.0, 1.0, max(2, num_samples))
        if self.curve_type == CurveType.LINE:
            p_start = np.asarray(self.parameters.get("start", [0, 0, 0]), dtype=np.float64)
            p_end = np.asarray(self.parameters.get("end", [100, 0, 0]), dtype=np.float64)
            return np.outer(1.0 - t, p_start) + np.outer(t, p_end)
        elif self.curve_type in (CurveType.CIRCLE, CurveType.ARC):
            center = np.asarray(self.parameters.get("center", [0, 0, 0]), dtype=np.float64)
            radius = float(self.parameters.get("radius", 50.0))
            start_ang = math.radians(float(self.parameters.get("start_angle", 0.0)))
            end_ang = math.radians(float(self.parameters.get("end_angle", 360.0 if self.curve_type == CurveType.CIRCLE else 180.0)))
            angles = start_ang + t * (end_ang - start_ang)
            x = center[0] + radius * np.cos(angles)
            y = center[1] + radius * np.sin(angles)
            z = np.full_like(angles, center[2])
            return np.column_stack([x, y, z])
        elif self.curve_type == CurveType.ELLIPSE:
            center = np.asarray(self.parameters.get("center", [0, 0, 0]), dtype=np.float64)
            rx = float(self.parameters.get("radius_x", 50.0))
            ry = float(self.parameters.get("radius_y", 25.0))
            angles = t * 2.0 * math.pi
            x = center[0] + rx * np.cos(angles)
            y = center[1] + ry * np.sin(angles)
            z = np.full_like(angles, center[2])
            return np.column_stack([x, y, z])
        pts = self.parameters.get("control_points", [[0, 0, 0], [100, 0, 0]])
        return np.asarray(pts, dtype=np.float64)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "curve_type": self.curve_type.value,
            "parameters": self.parameters,
            "source_id": self.source_id
        }


class GeoEdge:
    """Topological edge bounded by two GeoVertices and backed by a GeoCurve."""
    def __init__(self, edge_id: str, vertex_start: str, vertex_end: str, curve_id: Optional[str] = None, is_forward: bool = True, source_id: Optional[str] = None):
        self.id = edge_id
        self.vertex_start = vertex_start
        self.vertex_end = vertex_end
        self.curve_id = curve_id
        self.is_forward = is_forward
        self.source_id = source_id

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "vertex_start": self.vertex_start,
            "vertex_end": self.vertex_end,
            "curve_id": self.curve_id,
            "is_forward": self.is_forward,
            "source_id": self.source_id
        }


class GeoLoop:
    """Closed boundary loop composed of ordered oriented edges."""
    def __init__(self, loop_id: str, ordered_edge_ids: List[str], is_outer: bool = True, source_id: Optional[str] = None):
        self.id = loop_id
        self.ordered_edge_ids = list(ordered_edge_ids)
        self.is_outer = is_outer
        self.source_id = source_id

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "ordered_edge_ids": self.ordered_edge_ids,
            "is_outer": self.is_outer,
            "source_id": self.source_id
        }


class SurfaceType(str, enum.Enum):
    PLANE = "plane"
    CYLINDER = "cylinder"
    CONE = "cone"
    SPHERE = "sphere"
    TORUS = "torus"
    NURBS = "nurbs"
    BSPLINE = "bspline"
    REVOLUTION = "revolution"
    EXTRUSION = "extrusion"
    SCALAR_FIELD = "scalar_field"
    IMPLICIT = "implicit"


class GeoSurface:
    """Authoritative mathematical 2D surface manifold in 3D canonical space."""
    def __init__(self, surface_id: str, surface_type: SurfaceType = SurfaceType.PLANE, parameters: Optional[dict] = None, source_id: Optional[str] = None):
        self.id = surface_id
        self.surface_type = surface_type
        self.parameters = parameters or {}
        self.source_id = source_id

    def _get_frame(self) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        origin = np.asarray(self.parameters.get("origin", [0, 0, 0]), dtype=np.float64)
        axis = np.asarray(self.parameters.get("axis", self.parameters.get("normal", [0, 0, 1])), dtype=np.float64)
        axis_len = np.linalg.norm(axis)
        z_axis = axis / axis_len if axis_len > 1e-9 else np.array([0.0, 0.0, 1.0], dtype=np.float64)
        
        ref = np.asarray(self.parameters.get("ref_direction", self.parameters.get("u_dir", [1, 0, 0])), dtype=np.float64)
        ref_proj = ref - np.dot(ref, z_axis) * z_axis
        ref_len = np.linalg.norm(ref_proj)
        if ref_len > 1e-9:
            x_axis = ref_proj / ref_len
        else:
            arb = np.array([0.0, 1.0, 0.0]) if abs(z_axis[0]) > 0.8 or abs(z_axis[2]) > 0.8 else np.array([1.0, 0.0, 0.0])
            x_axis = np.cross(z_axis, arb)
            x_norm = np.linalg.norm(x_axis)
            x_axis = x_axis / x_norm if x_norm > 1e-9 else np.array([1.0, 0.0, 0.0])
            
        y_axis = np.cross(z_axis, x_axis)
        y_norm = np.linalg.norm(y_axis)
        y_axis = y_axis / y_norm if y_norm > 1e-9 else np.array([0.0, 1.0, 0.0])
        return origin, x_axis, y_axis, z_axis

    def evaluate(self, u: float, v: float) -> np.ndarray:
        origin, x_axis, y_axis, z_axis = self._get_frame()
        if self.surface_type == SurfaceType.PLANE:
            u_dir = np.asarray(self.parameters.get("u_dir", x_axis), dtype=np.float64)
            v_dir = np.asarray(self.parameters.get("v_dir", y_axis), dtype=np.float64)
            return origin + u * u_dir + v * v_dir
        elif self.surface_type == SurfaceType.CYLINDER:
            radius = float(self.parameters.get("radius", 50.0))
            rad = u * 2.0 * math.pi
            return origin + radius * (math.cos(rad) * x_axis + math.sin(rad) * y_axis) + v * z_axis
        elif self.surface_type == SurfaceType.CONE:
            radius = float(self.parameters.get("radius", 50.0))
            semi_angle = float(self.parameters.get("semi_angle", 0.5))
            rad = u * 2.0 * math.pi
            r_v = max(0.0, radius - v * math.tan(semi_angle))
            return origin + r_v * (math.cos(rad) * x_axis + math.sin(rad) * y_axis) + v * z_axis
        elif self.surface_type == SurfaceType.SPHERE:
            radius = float(self.parameters.get("radius", 50.0))
            lat = (u - 0.5) * math.pi
            lon = v * 2.0 * math.pi
            return origin + radius * (math.cos(lat) * (math.cos(lon) * x_axis + math.sin(lon) * y_axis) + math.sin(lat) * z_axis)
        elif self.surface_type == SurfaceType.TORUS:
            major_r = float(self.parameters.get("major_radius", 50.0))
            minor_r = float(self.parameters.get("minor_radius", 10.0))
            phi = u * 2.0 * math.pi
            theta = v * 2.0 * math.pi
            r_tube = major_r + minor_r * math.cos(theta)
            return origin + r_tube * (math.cos(phi) * x_axis + math.sin(phi) * y_axis) + (minor_r * math.sin(theta)) * z_axis
        return origin + u * x_axis + v * y_axis

    def normal(self, u: float, v: float) -> np.ndarray:
        origin, x_axis, y_axis, z_axis = self._get_frame()
        if self.surface_type == SurfaceType.PLANE:
            return z_axis
        elif self.surface_type == SurfaceType.CYLINDER:
            rad = u * 2.0 * math.pi
            return math.cos(rad) * x_axis + math.sin(rad) * y_axis
        elif self.surface_type == SurfaceType.SPHERE:
            lat = (u - 0.5) * math.pi
            lon = v * 2.0 * math.pi
            return math.cos(lat) * (math.cos(lon) * x_axis + math.sin(lon) * y_axis) + math.sin(lat) * z_axis
        delta = 1e-5
        p0 = self.evaluate(u, v)
        pu = (self.evaluate(u + delta, v) - p0) / delta
        pv = (self.evaluate(u, v + delta) - p0) / delta
        n = np.cross(pu, pv)
        norm_len = np.linalg.norm(n)
        if norm_len > EPSILON_NORMAL:
            return n / norm_len
        return z_axis

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "surface_type": self.surface_type.value,
            "parameters": self.parameters,
            "source_id": self.source_id
        }


class GeoFace:
    """
    A first-class semantic CAD face bounded by one outer loop and zero or more inner loops.
    """
    def __init__(self,
                 face_id: str,
                 surface_id: str,
                 outer_loop_id: str,
                 inner_loop_ids: Optional[List[str]] = None,
                 is_forward: bool = True,
                 tolerance: float = DEFAULT_TOLERANCE_MM,
                 source_metadata: Optional[dict] = None):
        self.id = face_id
        self.surface_id = surface_id
        self.outer_loop_id = outer_loop_id
        self.inner_loop_ids = list(inner_loop_ids) if inner_loop_ids else []
        self.is_forward = is_forward
        self.tolerance = float(tolerance)
        self.source_metadata = source_metadata or {}

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "surface_id": self.surface_id,
            "outer_loop_id": self.outer_loop_id,
            "inner_loop_ids": self.inner_loop_ids,
            "is_forward": self.is_forward,
            "tolerance": self.tolerance,
            "source_metadata": self.source_metadata
        }


class GeoShell:
    """Connected collection of GeoFaces."""
    def __init__(self, shell_id: str, face_ids: List[str], is_closed: bool = True, source_id: Optional[str] = None):
        self.id = shell_id
        self.face_ids = list(face_ids)
        self.is_closed = is_closed
        self.source_id = source_id

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "face_ids": self.face_ids,
            "is_closed": self.is_closed,
            "source_id": self.source_id
        }


class GeoSolid:
    """Manifold 3D solid bounded by an outer shell and optional void shells."""
    def __init__(self, solid_id: str, outer_shell_id: str, void_shell_ids: Optional[List[str]] = None, source_id: Optional[str] = None):
        self.id = solid_id
        self.outer_shell_id = outer_shell_id
        self.void_shell_ids = list(void_shell_ids) if void_shell_ids else []
        self.source_id = source_id

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "outer_shell_id": self.outer_shell_id,
            "void_shell_ids": self.void_shell_ids,
            "source_id": self.source_id
        }


class GeoPart:
    """Canonical CAD Part containing canonical geometric entities and solids."""
    def __init__(self, part_id: str, name: str = "Part"):
        self.id = part_id
        self.name = name
        self.vertices: Dict[str, GeoVertex] = {}
        self.curves: Dict[str, GeoCurve] = {}
        self.edges: Dict[str, GeoEdge] = {}
        self.loops: Dict[str, GeoLoop] = {}
        self.surfaces: Dict[str, GeoSurface] = {}
        self.faces: Dict[str, GeoFace] = {}
        self.shells: Dict[str, GeoShell] = {}
        self.solids: Dict[str, GeoSolid] = {}
        self.metadata: Dict[str, Any] = {}

    def add_vertex(self, point: Union[List[float], np.ndarray], source_id: Optional[str] = None) -> GeoVertex:
        vid = f"v_{len(self.vertices) + 1}"
        v = GeoVertex(vid, point, source_id)
        self.vertices[vid] = v
        return v

    def add_curve(self, curve_type: CurveType = CurveType.LINE, parameters: Optional[dict] = None, source_id: Optional[str] = None) -> GeoCurve:
        cid = f"c_{len(self.curves) + 1}"
        c = GeoCurve(cid, curve_type, parameters, source_id)
        self.curves[cid] = c
        return c

    def add_edge(self, v_start: str, v_end: str, curve_id: Optional[str] = None, is_forward: bool = True, source_id: Optional[str] = None) -> GeoEdge:
        eid = f"e_{len(self.edges) + 1}"
        e = GeoEdge(eid, v_start, v_end, curve_id, is_forward, source_id)
        self.edges[eid] = e
        return e

    def add_loop(self, edge_ids: List[str], is_outer: bool = True, source_id: Optional[str] = None) -> GeoLoop:
        lid = f"l_{len(self.loops) + 1}"
        loop = GeoLoop(lid, edge_ids, is_outer, source_id)
        self.loops[lid] = loop
        return loop

    def add_surface(self, surface_type: SurfaceType = SurfaceType.PLANE, parameters: Optional[dict] = None, source_id: Optional[str] = None) -> GeoSurface:
        sid = f"s_{len(self.surfaces) + 1}"
        s = GeoSurface(sid, surface_type, parameters, source_id)
        self.surfaces[sid] = s
        return s

    def add_face(self, surface_id: str, outer_loop_id: str, inner_loop_ids: Optional[List[str]] = None, source_metadata: Optional[dict] = None) -> GeoFace:
        fid = f"f_{len(self.faces) + 1}"
        f = GeoFace(fid, surface_id, outer_loop_id, inner_loop_ids, source_metadata=source_metadata)
        self.faces[fid] = f
        return f

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "vertices": {k: v.to_dict() for k, v in self.vertices.items()},
            "curves": {k: v.to_dict() for k, v in self.curves.items()},
            "edges": {k: v.to_dict() for k, v in self.edges.items()},
            "loops": {k: v.to_dict() for k, v in self.loops.items()},
            "surfaces": {k: v.to_dict() for k, v in self.surfaces.items()},
            "faces": {k: v.to_dict() for k, v in self.faces.items()},
            "shells": {k: v.to_dict() for k, v in self.shells.items()},
            "solids": {k: v.to_dict() for k, v in self.solids.items()},
            "metadata": self.metadata
        }


class GeoInstance:
    """Lightweight instance referencing a canonical GeoPart with a 4x4 transform."""
    def __init__(self, instance_id: str, part_id: str, transform: Optional[GeoTransform] = None, name: Optional[str] = None):
        self.id = instance_id
        self.part_id = part_id
        self.transform = transform or GeoTransform()
        self.name = name or f"Instance_{instance_id}"
        self.color = "#38bdf8"
        self.material = "Steel"
        self.opacity = 1.0
        self.visible = True

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "part_id": self.part_id,
            "name": self.name,
            "transform": self.transform.to_dict(),
            "color": self.color,
            "material": self.material,
            "opacity": self.opacity,
            "visible": self.visible
        }


class GeoAssembly:
    """Hierarchical assembly tree of parts, sub-assemblies, and lightweight instances."""
    def __init__(self, assembly_id: str, name: str = "Assembly"):
        self.id = assembly_id
        self.name = name
        self.parts: Dict[str, GeoPart] = {}
        self.instances: Dict[str, GeoInstance] = {}
        self.children: List[Union["GeoAssembly", GeoInstance]] = []
        self.transform = GeoTransform()
        self.metadata: Dict[str, Any] = {}

    def add_part(self, part: GeoPart) -> GeoPart:
        self.parts[part.id] = part
        return part

    def create_instance(self, part_id: str, transform: Optional[GeoTransform] = None, name: Optional[str] = None) -> GeoInstance:
        inst_id = f"inst_{uuid.uuid4().hex[:6]}"
        inst = GeoInstance(inst_id, part_id, transform, name)
        self.instances[inst_id] = inst
        self.children.append(inst)
        return inst

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "parts": {k: v.to_dict() for k, v in self.parts.items()},
            "instances": {k: v.to_dict() for k, v in self.instances.items()},
            "transform": self.transform.to_dict(),
            "metadata": self.metadata
        }


# ============================================================
# 5. ADAPTIVE TESSELLATION & LOD ENGINE
# ============================================================

class LODLevel(int, enum.Enum):
    BOUNDS_LOD0 = 0
    LOW_LOD1 = 1
    MEDIUM_LOD2 = 2
    HIGH_LOD3 = 3


class MeshPolicy:
    """Configurable mesh policy abstraction governing tessellation deflection."""
    def __init__(
        self,
        linear_deflection: float = 0.1,
        angular_deflection_deg: float = 12.0,
        minimum_edge_length: float = 0.01,
        maximum_chord_error: float = 0.05,
        quality_mode: str = "standard"
    ):
        self.linear_deflection = float(linear_deflection)
        self.angular_deflection = math.radians(float(angular_deflection_deg))
        self.angular_deflection_deg = float(angular_deflection_deg)
        self.minimum_edge_length = float(minimum_edge_length)
        self.maximum_chord_error = float(maximum_chord_error)
        self.quality_mode = quality_mode

    def to_dict(self) -> dict:
        return {
            "linear_deflection": self.linear_deflection,
            "angular_deflection_deg": self.angular_deflection_deg,
            "minimum_edge_length": self.minimum_edge_length,
            "maximum_chord_error": self.maximum_chord_error,
            "quality_mode": self.quality_mode
        }


class RenderMesh:
    """Derived rendering cache resulting from adaptive tessellation."""
    def __init__(self, vertices: np.ndarray, indices: np.ndarray, normals: Optional[np.ndarray] = None, face_ids: Optional[np.ndarray] = None):
        self.vertices = vertices
        self.indices = indices
        self.normals = normals
        self.face_ids = face_ids

    def to_dict(self) -> dict:
        return {
            "vertex_count": len(self.vertices),
            "triangle_count": len(self.indices),
            "vertices": self.vertices.tolist(),
            "indices": self.indices.tolist(),
            "normals": self.normals.tolist() if self.normals is not None else None,
            "face_ids": self.face_ids.tolist() if self.face_ids is not None else None
        }


def validate_brep_numerical_safety(part: GeoPart, max_coord: float = 1e10) -> Dict[str, Any]:
    """
    Numerical validation layer before B-Rep geometry is passed to the visualization payload.
    Checks for NaN, infinite, or extreme coordinates before tessellation.
    """
    diagnostics = {
        "invalid_vertices": 0,
        "degenerate_edges": 0,
        "zero_area_faces": 0,
        "sanitized": False
    }
    
    invalid_vids = set()
    for vid, v in list(part.vertices.items()):
        pt = v.point
        if not np.isfinite(pt).all() or np.any(np.abs(pt) > max_coord):
            logger.error(f"Invalid vertex detected in {part.id}: {vid} -> {pt}")
            invalid_vids.add(vid)
            del part.vertices[vid]
            diagnostics["invalid_vertices"] += 1
            diagnostics["sanitized"] = True
            
    invalid_eids = set()
    for eid, e in list(part.edges.items()):
        if e.vertex_start in invalid_vids or e.vertex_end in invalid_vids:
            invalid_eids.add(eid)
            del part.edges[eid]
            diagnostics["degenerate_edges"] += 1
            diagnostics["sanitized"] = True
            continue
            
        pt_a = part.vertices[e.vertex_start].point
        pt_b = part.vertices[e.vertex_end].point
        if np.linalg.norm(pt_a - pt_b) < 1e-7:
            invalid_eids.add(eid)
            del part.edges[eid]
            diagnostics["degenerate_edges"] += 1
            diagnostics["sanitized"] = True
            
    invalid_lids = set()
    for lid, loop in list(part.loops.items()):
        valid_edges = [eid for eid in loop.ordered_edge_ids if eid not in invalid_eids]
        if len(valid_edges) < len(loop.ordered_edge_ids):
            diagnostics["sanitized"] = True
        if len(valid_edges) == 0:
            invalid_lids.add(lid)
            del part.loops[lid]
        else:
            loop.ordered_edge_ids = valid_edges
            
    invalid_fids = set()
    for fid, face in list(part.faces.items()):
        if face.outer_loop_id in invalid_lids:
            invalid_fids.add(fid)
            del part.faces[fid]
            diagnostics["zero_area_faces"] += 1
            diagnostics["sanitized"] = True
            continue
            
        loop = part.loops.get(face.outer_loop_id)
        if not loop:
            continue
        poly_pts = []
        for eid in loop.ordered_edge_ids:
            edge = part.edges.get(eid)
            if not edge:
                continue
            v_target = edge.vertex_start if edge.is_forward else edge.vertex_end
            if v_target in part.vertices:
                poly_pts.append(part.vertices[v_target].point)
            
        if len(poly_pts) >= 3:
            area = 0.0
            p0 = poly_pts[0]
            for i in range(1, len(poly_pts) - 1):
                p1 = poly_pts[i]
                p2 = poly_pts[i+1]
                cross = np.cross(p1 - p0, p2 - p0)
                area += 0.5 * np.linalg.norm(cross)
            if area < 1e-9 or not np.isfinite(area):
                surface = part.surfaces.get(face.surface_id)
                if not surface or surface.surface_type == SurfaceType.PLANE:
                    invalid_fids.add(fid)
                    del part.faces[fid]
                    diagnostics["zero_area_faces"] += 1
                    diagnostics["sanitized"] = True
                    continue
                
        face.inner_loop_ids = [lid for lid in face.inner_loop_ids if lid not in invalid_lids]
        
    for sid, shell in list(part.shells.items()):
        valid_faces = [fid for fid in shell.face_ids if fid not in invalid_fids]
        if not valid_faces:
            del part.shells[sid]
        else:
            shell.face_ids = valid_faces
            
    for sid, solid in list(part.solids.items()):
        if solid.outer_shell_id not in part.shells:
            del part.solids[sid]
        else:
            solid.void_shell_ids = [vsid for vsid in solid.void_shell_ids if vsid in part.shells]
            
    return diagnostics


class AdaptiveTessellator:
    """
    Converts canonical geometry to derived render representations.
    """
    def __init__(self, chordal_tolerance: float = 0.05, angular_tolerance_deg: float = 12.0, policy: Optional[MeshPolicy] = None):
        if policy is not None:
            self.policy = policy
            self.chordal_tolerance = policy.maximum_chord_error
            self.angular_tolerance_deg = policy.angular_deflection_deg
        else:
            self.chordal_tolerance = float(chordal_tolerance)
            self.angular_tolerance_deg = float(angular_tolerance_deg)
            self.policy = MeshPolicy(angular_deflection_deg=angular_tolerance_deg, maximum_chord_error=chordal_tolerance)

    def tessellate_face(self, part: GeoPart, face: GeoFace, lod: LODLevel = LODLevel.HIGH_LOD3) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        surface = part.surfaces.get(face.surface_id)
        outer_loop = part.loops.get(face.outer_loop_id)
        if not outer_loop:
            raise GeometryPipelineException(
                GeometryPipelineStage.TESSELLATION,
                f"Outer boundary loop {face.outer_loop_id} not found in part"
            )

        poly_pts: List[np.ndarray] = []
        for e_id in outer_loop.ordered_edge_ids:
            edge = part.edges.get(e_id)
            if not edge:
                continue
            v_target = edge.vertex_start if edge.is_forward else edge.vertex_end
            vertex = part.vertices.get(v_target)
            if vertex:
                poly_pts.append(vertex.point)

        if not surface or surface.surface_type == SurfaceType.PLANE:
            if len(poly_pts) < 3:
                return np.empty((0, 3), dtype=np.float64), np.empty((0, 3), dtype=np.int32), np.empty((0, 3), dtype=np.float64)
            from universal_byte_parser import triangulate_polygon_3d
            face_norm = surface.normal(0.5, 0.5) if surface else np.array([0.0, 0.0, 1.0], dtype=np.float64)
            tris = triangulate_polygon_3d(poly_pts, face_norm)
            verts_arr = np.array(poly_pts, dtype=np.float64)
            indices_arr = np.array(tris, dtype=np.int32)
            norms_arr = np.tile(face_norm, (len(verts_arr), 1))
            return verts_arr, indices_arr, norms_arr

        lod_samples = {
            LODLevel.BOUNDS_LOD0: (4, 4),
            LODLevel.LOW_LOD1: (8, 6),
            LODLevel.MEDIUM_LOD2: (16, 12),
            LODLevel.HIGH_LOD3: (32, 16)
        }
        nu, nv = lod_samples.get(lod, (24, 12))

        if len(poly_pts) >= 3:
            pts_arr = np.array(poly_pts, dtype=np.float64)
            v_min = float(np.min(pts_arr[:, 2]))
            v_max = float(np.max(pts_arr[:, 2]))
            h = max(1.0, v_max - v_min)
        else:
            v_min, v_max, h = 0.0, 100.0, 100.0

        u_vals = np.linspace(0.0, 1.0, nu, endpoint=False)
        v_vals = np.linspace(v_min, v_max, nv)
        
        grid_verts: List[np.ndarray] = []
        grid_norms: List[np.ndarray] = []
        
        for v in v_vals:
            for u in u_vals:
                p = surface.evaluate(float(u), float(v))
                n = surface.normal(float(u), float(v))
                grid_verts.append(p)
                grid_norms.append(n)
                
        grid_indices: List[Tuple[int, int, int]] = []
        for j in range(nv - 1):
            for i in range(nu):
                i_next = (i + 1) % nu
                idx00 = j * nu + i
                idx10 = j * nu + i_next
                idx01 = (j + 1) * nu + i
                idx11 = (j + 1) * nu + i_next
                grid_indices.append((idx00, idx10, idx11))
                grid_indices.append((idx00, idx11, idx01))
                
        verts_arr = np.array(grid_verts, dtype=np.float64)
        indices_arr = np.array(grid_indices, dtype=np.int32)
        norms_arr = np.array(grid_norms, dtype=np.float64)
        return verts_arr, indices_arr, norms_arr

    def tessellate_part(self, part: GeoPart, lod: LODLevel = LODLevel.HIGH_LOD3) -> RenderMesh:
        validate_brep_numerical_safety(part)
        
        all_verts: List[np.ndarray] = []
        all_indices: List[Tuple[int, int, int]] = []
        all_normals: List[np.ndarray] = []
        tri_face_ids: List[str] = []

        for face in part.faces.values():
            fv, fi, fn = self.tessellate_face(part, face, lod)
            if len(fi) == 0:
                continue
            offset = len(all_verts)
            for p in fv: all_verts.append(p)
            for norm in fn: all_normals.append(norm)
            for t in fi:
                all_indices.append((offset + int(t[0]), offset + int(t[1]), offset + int(t[2])))
                tri_face_ids.append(face.id)

        unique = {}
        final_vertices = []
        remap = []
        for p in all_verts:
            key = tuple(np.asarray(p, dtype=np.float64).round(9))
            if key not in unique:
                unique[key] = len(final_vertices)
                final_vertices.append(np.asarray(p, dtype=np.float64))
            remap.append(unique[key])
        final_indices = [(remap[a], remap[b], remap[c]) for a, b, c in all_indices]

        final_v = np.asarray(final_vertices, dtype=np.float64).reshape((-1, 3)) if final_vertices else np.empty((0, 3), dtype=np.float64)
        final_t = np.asarray(final_indices, dtype=np.int32).reshape((-1, 3)) if final_indices else np.empty((0, 3), dtype=np.int32)
        face_id_arr = np.array(tri_face_ids, dtype=object) if tri_face_ids else None
        return RenderMesh(final_v, final_t, None, face_id_arr)


# ============================================================
# 6. RENDER REPRESENTATION SELECTION
# ============================================================

class NativeRenderRepresentationType(str, enum.Enum):
    NATIVE_POLYGON_3D = "cad-polygon"
    NATIVE_POLYLINE_3D = "cad-polyline"
    NATIVE_MARKER_3D = "cad-marker"
    NATIVE_MODEL_3D = "cad-model"
    CUSTOM_RENDER_MESH = "custom_render_mesh"


class RenderRepresentationSelector:
    @staticmethod
    def select_face_representation(surface: GeoSurface, face: GeoFace, vertex_count: int) -> NativeRenderRepresentationType:
        if surface.surface_type == SurfaceType.PLANE and len(face.inner_loop_ids) == 0 and vertex_count <= 64:
            return NativeRenderRepresentationType.NATIVE_POLYGON_3D
        return NativeRenderRepresentationType.CUSTOM_RENDER_MESH

    @staticmethod
    def select_curve_representation(curve: GeoCurve) -> NativeRenderRepresentationType:
        return NativeRenderRepresentationType.NATIVE_POLYLINE_3D

    @staticmethod
    def select_part_representation(part: GeoPart, instance_count: int = 1) -> NativeRenderRepresentationType:
        if len(part.solids) > 10 or instance_count > 50:
            return NativeRenderRepresentationType.NATIVE_MODEL_3D
        return NativeRenderRepresentationType.CUSTOM_RENDER_MESH


# ============================================================
# 7. CANONICAL BUILDERS
# ============================================================

def create_canonical_box_part(width: float = 304.8, depth: float = 304.8, height: float = 304.8, name: str = "Canonical Box (1')") -> GeoPart:
    part = GeoPart(f"part_box_{uuid.uuid4().hex[:6]}", name)
    hw, hd, h = width / 2.0, depth / 2.0, height

    v_pts = [
        [-hw, -hd, 0.0], [hw, -hd, 0.0], [hw, hd, 0.0], [-hw, hd, 0.0],
        [-hw, -hd, h],   [hw, -hd, h],   [hw, hd, h],   [-hw, hd, h]
    ]
    v_ids = [part.add_vertex(p).id for p in v_pts]

    edge_indices = [
        (0, 1), (1, 2), (2, 3), (3, 0),
        (4, 5), (5, 6), (6, 7), (7, 4),
        (0, 4), (1, 5), (2, 6), (3, 7)
    ]
    edge_ids = [part.add_edge(v_ids[i], v_ids[j]).id for (i, j) in edge_indices]

    face_definitions = [
        ([edge_ids[3], edge_ids[2], edge_ids[1], edge_ids[0]], [0, 0, -1], [0, 0, 0]),
        ([edge_ids[4], edge_ids[5], edge_ids[6], edge_ids[7]], [0, 0, 1], [0, 0, h]),
        ([edge_ids[0], edge_ids[9], edge_ids[4], edge_ids[8]], [0, -1, 0], [0, -hd, 0]),
        ([edge_ids[1], edge_ids[10], edge_ids[5], edge_ids[9]], [1, 0, 0], [hw, 0, 0]),
        ([edge_ids[2], edge_ids[11], edge_ids[6], edge_ids[10]], [0, 1, 0], [0, hd, 0]),
        ([edge_ids[3], edge_ids[8], edge_ids[7], edge_ids[11]], [-1, 0, 0], [-hw, 0, 0])
    ]

    face_ids = []
    for (e_list, norm, origin) in face_definitions:
        surf = part.add_surface(SurfaceType.PLANE, {"normal": norm, "origin": origin})
        loop = part.add_loop(e_list, is_outer=True)
        face = part.add_face(surf.id, loop.id)
        face_ids.append(face.id)

    shell = GeoShell(f"shell_box_{uuid.uuid4().hex[:4]}", face_ids, is_closed=True)
    part.shells[shell.id] = shell
    solid = GeoSolid(f"solid_box_{uuid.uuid4().hex[:4]}", shell.id)
    part.solids[solid.id] = solid
    return part
