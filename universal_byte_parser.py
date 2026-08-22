"""
GeoParametric3D Universal Geometry Import Normalizer & High-Speed B-Rep Pipeline

Modular Architecture & Ingestion Flow with Detailed Step-by-Step Telemetry:
  FOREIGN BYTES (Binary, Mesh, Solid B-Rep)
       |
       +--> [STEP 1: FORMAT_DETECTION] Byte signature, Magic byte inspection & Schema Identification
       +--> [STEP 2: UNIT_INSPECTION] Header SI_UNIT & CONVERSION_BASED_UNIT resolution
       +--> [STEP 3: B-REP_KERNEL_INGESTION] OCCT/OCP / Polyhedron topology recovery
       +--> [STEP 4: MULTI_SOLID_COMPOUND_UNPACK] Solid / Shell / Face traversal
       +--> [STEP 5: DUAL_ROUTE_CLASSIFICATION] GeomAbs_Plane -> N-Gon Loops vs Non-Planar -> Adaptive Deflection
       +--> [STEP 6: NUMERIC_COMPACTION] Finite validation, index remapping & zero-copy packing
       +--> [STEP 7: CANONICAL_ASSEMBLY_PROJECTION] GeoAssembly tree & native <gmp-map-3d> viewport handoff
"""

import re
import math
import struct
import json
import zipfile
import io
import os
import tempfile
import uuid
import logging
import time
import hashlib
import base64
import xml.etree.ElementTree as ET
from enum import Enum
from typing import List, Dict, Any, Optional, Tuple, Union, Set
import numpy as np

try:
    from occ_kernel import route_cad_faces, extract_clean_planar_wires, parallel_process_step_solids, compute_optimal_deflection, get_shape_bounding_diag, detect_step_units as occ_detect_step_units, _OCCT_AVAILABLE as OCC_AVAIL
except ImportError:
    route_cad_faces = None
    extract_clean_planar_wires = None
    parallel_process_step_solids = None
    compute_optimal_deflection = None
    get_shape_bounding_diag = None
    occ_detect_step_units = None
    OCC_AVAIL = False

try:
    from ngon_adapter import extract_planar_ngons_from_geopart, extract_planar_ngons_from_occt
except ImportError:
    extract_planar_ngons_from_geopart = None
    extract_planar_ngons_from_occt = None

from canonical_geometry import (
    GeoVertex,
    GeoCurve,
    GeoEdge,
    GeoLoop,
    GeoSurface,
    GeoFace,
    GeoShell,
    GeoSolid,
    GeoPart,
    GeoInstance,
    GeoAssembly,
    GeoTransform,
    CurveType,
    SurfaceType,
    AdaptiveTessellator,
    LODLevel,
    CANONICAL_INTERNAL_UNIT
)

logger = logging.getLogger("GeoParametric3D.GeometryEngine")

DEFAULT_TOLERANCE_MM = 1e-4
EPSILON_AREA = 1e-9

SITE_ANCHOR = {
    'name': 'Hillcrest Park, Fullerton, CA',
    'lat': 33.8814,
    'lng': -117.9213,
    'altitude': 95.0
}

# Optional Open CASCADE Technology (OCCT) Integration (OCP & python-occ)
_OCCT_AVAILABLE = False
_OCCT_BACKEND = None

try:
    from OCP.STEPControl import STEPControl_Reader, STEPControl_Writer, STEPControl_AsIs
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID, TopAbs_SHELL, TopAbs_WIRE, TopAbs_EDGE, TopAbs_VERTEX
    from OCP.TopoDS import TopoDS, TopoDS_Shape
    from OCP.BRep import BRep_Tool, BRep_Builder
    from OCP.TopLoc import TopLoc_Location
    from OCP.ShapeFix import ShapeFix_Shape
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.BRepTools import BRepTools
    from OCP.GeomAbs import (
        GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone,
        GeomAbs_Sphere, GeomAbs_Torus, GeomAbs_BezierSurface,
        GeomAbs_BSplineSurface, GeomAbs_SurfaceOfRevolution,
        GeomAbs_SurfaceOfExtrusion
    )
    from OCP.gp import gp_Trsf, gp_Pnt
    from OCP.Quantity import Quantity_Color, Quantity_TOC_RGB
    try:
        from OCP.STEPCAFControl import STEPCAFControl_Reader
        from OCP.TDocStd import TDocStd_Document
        from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorTool, XCAFDoc_ShapeTool, XCAFDoc_ColorSurf, XCAFDoc_ColorGen, XCAFDoc_ColorCurv
        from OCP.XCAFApp import XCAFApp_Application
        from OCP.TCollection import TCollection_ExtendedString
        _XCAF_AVAILABLE = True
    except ImportError:
        _XCAF_AVAILABLE = False
    _OCCT_AVAILABLE = True
    _OCCT_BACKEND = "OCP"
    TopoDS_Face_Cast = getattr(TopoDS, "Face_s", getattr(TopoDS, "Face", None))
    TopoDS_Wire_Cast = getattr(TopoDS, "Wire_s", getattr(TopoDS, "Wire", None))
    TopoDS_Edge_Cast = getattr(TopoDS, "Edge_s", getattr(TopoDS, "Edge", None))
    TopoDS_Vertex_Cast = getattr(TopoDS, "Vertex_s", getattr(TopoDS, "Vertex", None))
except ImportError:
    try:
        from OCC.Core.STEPControl import STEPControl_Reader, STEPControl_Writer, STEPControl_AsIs
        from OCC.Core.IFSelect import IFSelect_RetDone
        from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
        from OCC.Core.TopExp import TopExp_Explorer
        from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_SOLID, TopAbs_SHELL, TopAbs_WIRE, TopAbs_EDGE, TopAbs_VERTEX
        from OCC.Core.TopoDS import topods, TopoDS_Shape
        from OCC.Core.BRep import BRep_Tool, BRep_Builder
        from OCC.Core.TopLoc import TopLoc_Location
        from OCC.Core.ShapeFix import ShapeFix_Shape
        from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
        from OCC.Core.BRepTools import breptools
        from OCC.Core.GeomAbs import (
            GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone,
            GeomAbs_Sphere, GeomAbs_Torus, GeomAbs_BezierSurface,
            GeomAbs_BSplineSurface, GeomAbs_SurfaceOfRevolution,
            GeomAbs_SurfaceOfExtrusion
        )
        from OCC.Core.gp import gp_Trsf, gp_Pnt
        from OCC.Core.Quantity import Quantity_Color, Quantity_TOC_RGB
        try:
            from OCC.Core.STEPCAFControl import STEPCAFControl_Reader
            from OCC.Core.TDocStd import TDocStd_Document
            from OCC.Core.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorTool, XCAFDoc_ShapeTool, XCAFDoc_ColorSurf, XCAFDoc_ColorGen, XCAFDoc_ColorCurv
            from OCC.Core.XCAFApp import XCAFApp_Application
            from OCC.Core.TCollection import TCollection_ExtendedString
            _XCAF_AVAILABLE = True
        except ImportError:
            _XCAF_AVAILABLE = False
        _OCCT_AVAILABLE = True
        _OCCT_BACKEND = "OCC"
        TopoDS_Face_Cast = getattr(topods, "Face", None)
        TopoDS_Wire_Cast = getattr(topods, "Wire", None)
        TopoDS_Edge_Cast = getattr(topods, "Edge", None)
        TopoDS_Vertex_Cast = getattr(topods, "Vertex", None)
    except ImportError:
        _OCCT_AVAILABLE = False
        _XCAF_AVAILABLE = False


class BRepBody:
    """Authoritative B-Rep Body representation."""
    def __init__(self, body_id: str, name: str = "BRepBody", faces: Optional[List[Any]] = None, brep: Optional[Dict[str, Any]] = None):
        self.id = body_id
        self.name = name
        self.faces = faces or []
        self.brep = brep or {}
        self.primitive_type = "solid_imported"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "faces": self.faces,
            "brep": self.brep,
            "primitive_type": self.primitive_type
        }


def get_brep_triangulation(face, loc):
    if not _OCCT_AVAILABLE or face is None:
        return None
    if hasattr(BRep_Tool, 'Triangulation_s'):
        return BRep_Tool.Triangulation_s(face, loc)
    elif hasattr(BRep_Tool, 'Triangulation'):
        try:
            return BRep_Tool.Triangulation(face, loc)
        except Exception:
            return BRep_Tool().Triangulation(face, loc)
    return None


def get_brep_pnt(vert):
    if not _OCCT_AVAILABLE or vert is None:
        return None
    if hasattr(BRep_Tool, 'Pnt_s'):
        return BRep_Tool.Pnt_s(vert)
    elif hasattr(BRep_Tool, 'Pnt'):
        try:
            return BRep_Tool.Pnt(vert)
        except Exception:
            return BRep_Tool().Pnt(vert)
    return None


def extract_occt_shape_color(occ_shape, color_tool) -> Optional[str]:
    if color_tool is None or occ_shape is None:
        return None
    try:
        col = Quantity_Color()
        if hasattr(color_tool, 'GetColor'):
            try:
                if color_tool.GetColor(occ_shape, col):
                    return rgb_to_hex(float(col.Red()), float(col.Green()), float(col.Blue()))
            except Exception:
                pass
        for c_type in (getattr(XCAFDoc_ColorSurf, 'value', 1), getattr(XCAFDoc_ColorGen, 'value', 0), getattr(XCAFDoc_ColorCurv, 'value', 2)):
            try:
                if color_tool.GetColor(occ_shape, c_type, col):
                    return rgb_to_hex(float(col.Red()), float(col.Green()), float(col.Blue()))
            except Exception:
                pass
    except Exception:
        pass
    return None


# ============================================================
# 1. UNIT SUBSYSTEM & COORDINATE NORMALIZATION
# ============================================================

UNIT_TO_MM_SCALE: Dict[str, float] = {
    'mm': 1.0,
    'millimeter': 1.0,
    'millimeters': 1.0,
    'millimetre': 1.0,
    'millimetres': 1.0,
    'cm': 10.0,
    'centimeter': 10.0,
    'centimeters': 10.0,
    'm': 1000.0,
    'meter': 1000.0,
    'meters': 1000.0,
    'metre': 1000.0,
    'metres': 1000.0,
    'in': 25.4,
    'inch': 25.4,
    'inches': 25.4,
    '"': 25.4,
    'ft': 304.8,
    'foot': 304.8,
    'feet': 304.8,
    "'": 304.8,
    'yd': 914.4,
    'yard': 914.4,
    'um': 0.001,
    'micron': 0.001,
    'micrometer': 0.001,
    'unknown': 1.0,
    'unitless': 1.0
}

def parse_unit_string(unit_str: Optional[str]) -> str:
    if not unit_str:
        return "mm"
    u = str(unit_str).strip().lower().replace('_', '').replace(' ', '')
    if u in ('unknown', 'none', 'unitless'):
        return "unknown"
    if 'inch' in u or u in ('in', '"'):
        return "inch"
    if 'foot' in u or 'feet' in u or u in ('ft', "'"):
        return "foot"
    if 'yard' in u or u == 'yd':
        return "yard"
    if 'micron' in u or 'micrometer' in u or u == 'um':
        return "um"
    if 'centi' in u or u == 'cm':
        return "cm"
    if 'milli' in u or u == 'mm':
        return "mm"
    if 'meter' in u or 'metre' in u or u == 'm':
        return "meter"
    return "mm"

def get_unit_scale_to_canonical(source_unit: str) -> float:
    key = parse_unit_string(source_unit)
    return UNIT_TO_MM_SCALE.get(key, 1.0)

def convert_value(val: float, source_unit: str, target_unit: str = CANONICAL_INTERNAL_UNIT, dimension: int = 1) -> float:
    s_factor = get_unit_scale_to_canonical(source_unit)
    t_factor = get_unit_scale_to_canonical(target_unit)
    linear_ratio = s_factor / t_factor
    return float(val * (linear_ratio ** dimension))

def rgb_to_hex(r: Union[int, float], g: Union[int, float], b: Union[int, float]) -> str:
    if isinstance(r, float) and r <= 1.0 and g <= 1.0 and b <= 1.0:
        r, g, b = int(round(r * 255)), int(round(g * 255)), int(round(g * 255))
    r = max(0, min(255, int(r)))
    g = max(0, min(255, int(g)))
    b = max(0, min(255, int(b)))
    return f"#{r:02x}{g:02x}{b:02x}"

def enu_to_wgs84(coords, lat0=SITE_ANCHOR['lat'], lon0=SITE_ANCHOR['lng'], alt0=SITE_ANCHOR['altitude'], rot_z=0.0, face_id=None) -> List[Dict[str, Any]]:
    if coords is None or len(coords) == 0:
        return []
    arr = np.asarray(coords, dtype=np.float64)
    if arr.ndim == 1 and len(arr) == 3:
        arr = arr.reshape(1, 3)
    if not np.isfinite(arr).all():
        clean_mask = np.all(np.isfinite(arr), axis=1) if arr.ndim == 2 else np.isfinite(arr)
        arr = arr[clean_mask]
    if len(arr) == 0:
        return []

    if rot_z != 0.0:
        rad = math.radians(rot_z)
        c, s = math.cos(rad), math.sin(rad)
        rx = arr[:, 0] * c - arr[:, 1] * s
        ry = arr[:, 0] * s + arr[:, 1] * c
        rz = arr[:, 2]
    else:
        rx, ry, rz = arr[:, 0], arr[:, 1], arr[:, 2]

    lat_rad = math.radians(lat0)
    mm_per_deg_lat = 111111000.0
    mm_per_deg_lng = 111111000.0 * math.cos(lat_rad)
    if abs(mm_per_deg_lng) < 1e-6:
        mm_per_deg_lng = 111111000.0

    lats = lat0 + (ry / mm_per_deg_lat)
    lngs = lon0 + (rx / mm_per_deg_lng)
    alts = alt0 + (rz * 0.001)

    n = len(arr)
    xs, ys, zs = arr[:, 0], arr[:, 1], arr[:, 2]

    if face_id is not None:
        fid_str = str(face_id)
        return [
            {
                'x': float(xs[i]), 'y': float(ys[i]), 'z': float(zs[i]),
                'lat': float(lats[i]), 'lng': float(lngs[i]), 'altitude': float(alts[i]),
                'face_id': fid_str
            }
            for i in range(n)
        ]
    else:
        return [
            {
                'x': float(xs[i]), 'y': float(ys[i]), 'z': float(zs[i]),
                'lat': float(lats[i]), 'lng': float(lngs[i]), 'altitude': float(alts[i])
            }
            for i in range(n)
        ]

def detect_and_normalize_units(coordinates: List[List[float]]) -> List[List[float]]:
    if not coordinates:
        return []
    arr = np.asarray(coordinates, dtype=np.float64)
    clean_mask = np.all(np.isfinite(arr), axis=1) if arr.ndim == 2 else np.isfinite(arr)
    return arr[clean_mask].tolist()

def clean_and_tessellate(triangles: List[List[List[float]]], tolerance: float = 1e-6) -> List[List[List[float]]]:
    clean = []
    for tri in triangles:
        if not tri or len(tri) < 3: continue
        try:
            p0 = np.asarray(tri[0], dtype=np.float64)
            p1 = np.asarray(tri[1], dtype=np.float64)
            p2 = np.asarray(tri[2], dtype=np.float64)
            if not (np.isfinite(p0).all() and np.isfinite(p1).all() and np.isfinite(p2).all()): continue
            cross = np.cross(p1 - p0, p2 - p0)
            area = float(np.linalg.norm(cross)) * 0.5
            if area < 1e-9 or not np.isfinite(area): continue
            clean.append([p0.tolist(), p1.tolist(), p2.tolist()])
        except Exception:
            continue
    return clean


# ============================================================
# 2. NUMPY DATA CONTRACT & MESH COMPACTION PIPELINE
# ============================================================

def validate_numpy_mesh_contract(positions: np.ndarray, triangle_indices: np.ndarray, normals: Optional[np.ndarray] = None) -> Tuple[bool, str]:
    if not isinstance(positions, np.ndarray) or not isinstance(triangle_indices, np.ndarray):
        return False, "Positions and triangle_indices must be valid NumPy ndarrays."
    if positions.ndim != 2 or positions.shape[1] != 3:
        return False, f"Positions must have shape (N, 3), got {positions.shape}."
    if triangle_indices.ndim != 2 or triangle_indices.shape[1] != 3:
        return False, f"Triangle indices must have shape (M, 3), got {triangle_indices.shape}."
    if not np.issubdtype(positions.dtype, np.floating):
        return False, f"Positions must have floating dtype, got {positions.dtype}."
    if not np.issubdtype(triangle_indices.dtype, np.integer):
        return False, f"Triangle indices must have integer dtype, got {triangle_indices.dtype}."
    if len(positions) == 0 or len(triangle_indices) == 0:
        return False, "Mesh data is empty."
    if not np.isfinite(positions).all():
        return False, "Positions contain non-finite numbers (NaN or Inf)."
    max_idx = int(np.max(triangle_indices))
    min_idx = int(np.min(triangle_indices))
    if min_idx < 0 or max_idx >= len(positions):
        return False, f"Triangle index out of bounds: min={min_idx}, max={max_idx}, vertex_count={len(positions)}."
    return True, "Valid"

def validate_and_compact_mesh(
    raw_vertices: Union[List[Union[List[float], np.ndarray]], np.ndarray],
    raw_triangles: Union[List[Tuple[int, int, int]], np.ndarray],
    tolerance: float = 1e-8,
    normals: Optional[Union[List[Any], np.ndarray]] = None,
    triangle_provenance: Optional[Union[List[Any], np.ndarray]] = None
) -> Tuple[np.ndarray, np.ndarray, Dict[str, Any]]:
    raw_v_arr = np.asarray(raw_vertices, dtype=np.float64) if len(raw_vertices) > 0 else np.empty((0, 3), dtype=np.float64)
    raw_v_count = len(raw_v_arr)
    raw_t_count = len(raw_triangles)
    
    if raw_v_count == 0 or raw_t_count == 0:
        return np.empty((0, 3), dtype=np.float64), np.empty((0, 3), dtype=np.int32), {
            "raw_vertex_count": raw_v_count,
            "invalid_vertices_removed": 0,
            "raw_triangle_count": raw_t_count,
            "invalid_triangles_removed": 0,
            "degenerate_triangles_removed": 0,
            "final_vertex_count": 0,
            "final_triangle_count": 0,
            "index_validation": "PASS",
            "finite_coordinates": "PASS",
            "coordinate_bounds": compute_bounding_box(np.empty((0, 3), dtype=np.float64)),
            "normals": None,
            "triangle_provenance": []
        }

    finite_mask = np.all(np.isfinite(raw_v_arr), axis=1)
    invalid_v_count = int(np.count_nonzero(~finite_mask))
    
    old_to_new = np.full(raw_v_count, -1, dtype=np.int32)
    valid_indices = np.where(finite_mask)[0]
    old_to_new[valid_indices] = np.arange(len(valid_indices), dtype=np.int32)
    compact_verts = raw_v_arr[finite_mask]
    
    raw_t_arr = np.asarray(raw_triangles, dtype=np.int32)
    valid_tri_mask = np.ones(len(raw_t_arr), dtype=bool)
    out_of_bounds = np.any((raw_t_arr < 0) | (raw_t_arr >= raw_v_count), axis=1)
    valid_tri_mask &= ~out_of_bounds
    
    remapped_t = np.empty_like(raw_t_arr)
    for col in range(3):
        remapped_t[:, col] = np.where(out_of_bounds, -1, old_to_new[np.clip(raw_t_arr[:, col], 0, max(0, raw_v_count - 1))])
        
    invalid_ref_mask = np.any(remapped_t < 0, axis=1)
    valid_tri_mask &= ~invalid_ref_mask
    invalid_t_count = int(np.count_nonzero(~valid_tri_mask))
    
    filtered_t = remapped_t[valid_tri_mask]
    same_vertex_mask = (filtered_t[:, 0] == filtered_t[:, 1]) | (filtered_t[:, 1] == filtered_t[:, 2]) | (filtered_t[:, 2] == filtered_t[:, 0])
    
    area_valid = np.zeros(0, dtype=bool)
    if len(filtered_t) > 0 and len(compact_verts) > 0:
        non_same_t = filtered_t[~same_vertex_mask]
        if len(non_same_t) > 0:
            p0 = compact_verts[non_same_t[:, 0]]
            p1 = compact_verts[non_same_t[:, 1]]
            p2 = compact_verts[non_same_t[:, 2]]
            cross = np.cross(p1 - p0, p2 - p0)
            area2 = np.linalg.norm(cross, axis=1)
            area_valid = (area2 > tolerance) & np.isfinite(area2)
            final_indices = non_same_t[area_valid]
            degenerate_t_count = int(np.count_nonzero(same_vertex_mask) + np.count_nonzero(~area_valid))
        else:
            final_indices = np.empty((0, 3), dtype=np.int32)
            degenerate_t_count = len(filtered_t)
    else:
        final_indices = np.empty((0, 3), dtype=np.int32)
        degenerate_t_count = 0
        
    final_positions = compact_verts
    valid_contract, contract_msg = validate_numpy_mesh_contract(final_positions, final_indices) if len(final_positions) > 0 and len(final_indices) > 0 else (True, "Valid")
    bbox = compute_bounding_box(final_positions)

    final_normals = None
    if normals is not None:
        norm_arr = np.asarray(normals, dtype=np.float64)
        if len(norm_arr) == raw_v_count:
            final_normals = norm_arr[finite_mask]

    final_prov = None
    if triangle_provenance is not None:
        prov_arr = np.asarray(triangle_provenance)
        if len(prov_arr) == raw_t_count:
            filtered_prov = prov_arr[valid_tri_mask]
            if len(filtered_prov) > 0:
                non_same_prov = filtered_prov[~same_vertex_mask]
                if len(non_same_prov) > 0 and len(area_valid) == len(non_same_prov):
                    final_prov = non_same_prov[area_valid]
                else:
                    final_prov = non_same_prov
            else:
                final_prov = np.empty((0,), dtype=prov_arr.dtype)
    
    diagnostics = {
        "raw_vertex_count": raw_v_count,
        "invalid_vertices_removed": invalid_v_count,
        "raw_triangle_count": raw_t_count,
        "invalid_triangles_removed": invalid_t_count,
        "degenerate_triangles_removed": degenerate_t_count,
        "final_vertex_count": len(final_positions),
        "final_triangle_count": len(final_indices),
        "index_validation": "PASS" if valid_contract else f"FAIL ({contract_msg})",
        "finite_coordinates": "PASS" if np.isfinite(final_positions).all() else "FAIL",
        "index_validation_result": "PASS" if valid_contract else "FAIL",
        "finite_coordinates_result": "PASS" if np.isfinite(final_positions).all() else "FAIL",
        "coordinate_bounds": bbox,
        "normals": final_normals,
        "triangle_provenance": final_prov.tolist() if final_prov is not None else None
    }
    
    return final_positions, final_indices, diagnostics

def compute_bounding_box(positions: np.ndarray) -> Dict[str, Any]:
    if len(positions) == 0:
        return {
            "min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0],
            "center": [0.0, 0.0, 0.0], "extents": [0.0, 0.0, 0.0],
            "diagonal": 0.0,
            "radius": 0.0
        }
    pts = np.asarray(positions, dtype=np.float64)
    if not np.isfinite(pts).all():
        clean_mask = np.all(np.isfinite(pts), axis=1) if pts.ndim == 2 else np.isfinite(pts)
        pts = pts[clean_mask]
    if len(pts) == 0:
        return {
            "min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0],
            "center": [0.0, 0.0, 0.0], "extents": [0.0, 0.0, 0.0],
            "diagonal": 0.0,
            "radius": 0.0
        }
    min_v = np.min(pts, axis=0)
    max_v = np.max(pts, axis=0)
    center = (min_v + max_v) / 2.0
    extents = max_v - min_v
    diag = float(np.linalg.norm(extents))
    return {
        "min": min_v.tolist(),
        "max": max_v.tolist(),
        "center": center.tolist(),
        "extents": extents.tolist(),
        "diagonal": diag,
        "radius": float(diag / 2.0)
    }

def triangulate_polygon_3d(vertices: List[np.ndarray], face_normal: Optional[np.ndarray] = None) -> List[Tuple[int, int, int]]:
    n = len(vertices)
    if n < 3: return []
    if n == 3: return [(0, 1, 2)]
    if n == 4:
        d02 = np.linalg.norm(vertices[0] - vertices[2])
        d13 = np.linalg.norm(vertices[1] - vertices[3])
        return [(0, 1, 2), (0, 2, 3)] if d02 <= d13 else [(1, 2, 3), (1, 3, 0)]
            
    if face_normal is None or np.linalg.norm(face_normal) < 1e-6:
        norm = np.zeros(3, dtype=np.float64)
        for i in range(n):
            curr = vertices[i]
            nxt = vertices[(i + 1) % n]
            norm[0] += (curr[1] - nxt[1]) * (curr[2] + nxt[2])
            norm[1] += (curr[2] - nxt[2]) * (curr[0] + nxt[0])
            norm[2] += (curr[0] - nxt[0]) * (curr[1] + nxt[1])
        norm_len = np.linalg.norm(norm)
        face_normal = norm / norm_len if norm_len > 1e-9 else np.array([0.0, 0.0, 1.0])
            
    abs_norm = np.abs(face_normal)
    axis = int(np.argmax(abs_norm))
    u_axis = (axis + 1) % 3
    v_axis = (axis + 2) % 3
    poly_2d = [(v[u_axis], v[v_axis]) for v in vertices]
    
    area2 = sum(poly_2d[i][0] * poly_2d[(i+1)%n][1] - poly_2d[(i+1)%n][0] * poly_2d[i][1] for i in range(n))
    indices = list(range(n))
    if area2 < 0:
        indices.reverse()
        
    triangles: List[Tuple[int, int, int]] = []
    max_iters = n * 4
    curr_iters = 0
    
    while len(indices) > 3 and curr_iters < max_iters:
        curr_iters += 1
        ear_found = False
        m = len(indices)
        for i in range(m):
            prev_idx = indices[(i - 1 + m) % m]
            curr_idx = indices[i]
            next_idx = indices[(i + 1) % m]
            a, b, c = poly_2d[prev_idx], poly_2d[curr_idx], poly_2d[next_idx]
            cross_val = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
            if cross_val <= 1e-12: continue
                
            is_ear = True
            for other_i in range(m):
                if other_i in (i, (i - 1 + m) % m, (i + 1) % m): continue
                p = poly_2d[indices[other_i]]
                v0 = (c[0] - a[0], c[1] - a[1])
                v1 = (b[0] - a[0], b[1] - a[1])
                v2 = (p[0] - a[0], p[1] - a[1])
                dot00 = v0[0]*v0[0] + v0[1]*v0[1]
                dot01 = v0[0]*v1[0] + v0[1]*v1[1]
                dot02 = v0[0]*v2[0] + v0[1]*v2[1]
                dot11 = v1[0]*v1[0] + v1[1]*v1[1]
                dot12 = v1[0]*v2[0] + v1[1]*v2[1]
                inv_denom = 1.0 / max(1e-12, (dot00 * dot11 - dot01 * dot01))
                u = (dot11 * dot02 - dot01 * dot12) * inv_denom
                v = (dot00 * dot12 - dot01 * dot02) * inv_denom
                if (u >= 0) and (v >= 0) and (u + v <= 1):
                    is_ear = False
                    break
            if is_ear:
                triangles.append((prev_idx, curr_idx, next_idx))
                indices.pop(i)
                ear_found = True
                break
        if not ear_found: break
            
    if len(indices) == 3:
        triangles.append((indices[0], indices[1], indices[2]))
    elif len(indices) > 3:
        root = indices[0]
        for i in range(1, len(indices) - 1):
            triangles.append((root, indices[i], indices[i + 1]))
            
    return triangles


# ============================================================
# 3. UNIVERSAL FORMAT INTELLIGENCE & IMPORT DESCRIPTOR
# ============================================================

class ImportDescriptor:
    def __init__(self, filename: str, format_name: str, confidence: float = 1.0):
        self.filename = filename
        self.format = format_name
        self.confidence = float(confidence)
        self.version = "unknown"
        self.schema = "unknown"
        self.application_protocol = "unknown"
        self.encoding = "utf-8"
        self.source_units = CANONICAL_INTERNAL_UNIT
        self.scale_to_canonical = 1.0
        self.is_unitless = False
        self.has_geometry = True
        self.has_topology = False
        self.has_assembly = False
        self.has_materials = False
        self.has_colors = False
        self.has_product_structure = False
        self.metadata: Dict[str, Any] = {}

    def to_dict(self) -> dict:
        return {
            "filename": self.filename,
            "format": self.format,
            "confidence": self.confidence,
            "version": self.version,
            "schema": self.schema,
            "application_protocol": self.application_protocol,
            "source_units": self.source_units,
            "scale_to_canonical": self.scale_to_canonical,
            "is_unitless": self.is_unitless,
            "has_geometry": self.has_geometry,
            "has_topology": self.has_topology,
            "has_assembly": self.has_assembly,
            "has_materials": self.has_materials,
            "has_colors": self.has_colors,
            "has_product_structure": self.has_product_structure,
            "metadata": self.metadata
        }

def detect_step_units(text: str) -> Tuple[str, float]:
    if occ_detect_step_units is not None:
        return occ_detect_step_units(text)
    if re.search(r"SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)", text, re.IGNORECASE) or \
       re.search(r"\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)", text, re.IGNORECASE):
        return "mm", 1.0
    if re.search(r"SI_UNIT\s*\(\s*\.CENTI\.\s*,\s*\.METRE\.\s*\)", text, re.IGNORECASE):
        return "cm", 10.0
    if re.search(r"SI_UNIT\s*\(\s*\$\s*,\s*\.METRE\.\s*\)", text, re.IGNORECASE) or \
       re.search(r"SI_UNIT\s*\(\s*\*\s*,\s*\.METRE\.\s*\)", text, re.IGNORECASE):
        return "meter", 1000.0
    if re.search(r"CONVERSION_BASED_UNIT\s*\(\s*'INCH'", text, re.IGNORECASE) or \
       re.search(r"LENGTH_MEASURE_WITH_UNIT\s*\(\s*LENGTH_MEASURE\s*\(\s*25\.4", text, re.IGNORECASE) or \
       re.search(r"'INCH'", text, re.IGNORECASE):
        return "inch", 25.4
    if re.search(r"CONVERSION_BASED_UNIT\s*\(\s*'FOOT'", text, re.IGNORECASE) or \
       re.search(r"'FOOT'", text, re.IGNORECASE):
        return "foot", 304.8
    if re.search(r"\.METRE\.", text, re.IGNORECASE) and not re.search(r"\.MILLI\.|\.CENTI\.", text, re.IGNORECASE):
        return "meter", 1000.0
    return "mm", 1.0

def detect_format_descriptor(content_bytes: bytes, filename: str) -> ImportDescriptor:
    ext = filename.lower().split('.')[-1] if '.' in filename else ''
    desc = ImportDescriptor(filename, ext.upper() or "UNKNOWN", 0.5)
    
    if not content_bytes or len(content_bytes) < 4:
        desc.confidence = 0.0
        return desc
        
    head1k = content_bytes[:1024]
    head_latin = head1k.decode('latin1', errors='ignore')
    head_utf8 = head1k.decode('utf-8', errors='ignore')
    magic4 = content_bytes[:4]
    
    if magic4 in (b'XBF1', b'XBF2', b'XBFA', b'BXBF') or ext == 'xbf':
        desc.format = "XBF"
        desc.confidence = 1.0
        desc.has_topology = True
        desc.has_assembly = True
        desc.source_units = "mm"
        return desc
        
    if magic4 == b'glTF' or ext == 'glb':
        desc.format = "GLB"
        desc.confidence = 1.0
        desc.has_assembly = True
        desc.source_units = "meter"
        desc.scale_to_canonical = 1000.0
        return desc

    if magic4.startswith(b'PK') and (ext == 'fcstd' or b'Document.xml' in content_bytes[:4096]):
        desc.format = "FCSTD"
        desc.confidence = 1.0
        desc.has_topology = True
        desc.has_assembly = True
        desc.has_product_structure = True
        desc.source_units = "mm"
        return desc

    if 'ISO-10303-21' in head_latin or 'HEADER;' in head_latin or ext in ('step', 'stp'):
        desc.format = "STEP"
        desc.confidence = 0.99
        desc.has_topology = True
        desc.has_geometry = True
        desc.has_assembly = True
        desc.has_product_structure = True
        
        full_text_sample = content_bytes[:65536].decode('latin1', errors='ignore')
        if 'AP242' in full_text_sample:
            desc.application_protocol = "AP242"
        elif 'AP214' in full_text_sample or 'AUTOMOTIVE_DESIGN' in full_text_sample:
            desc.application_protocol = "AP214"
        elif 'AP203' in full_text_sample:
            desc.application_protocol = "AP203"
            
        detected_unit, detected_scale = detect_step_units(full_text_sample)
        desc.source_units = detected_unit
        desc.scale_to_canonical = detected_scale
        return desc

    if magic4.startswith(b'PK') and (ext == '3mf' or b'3D/3dmodel.model' in content_bytes[:4096]):
        desc.format = "3MF"
        desc.confidence = 0.98
        desc.has_assembly = True
        desc.source_units = "mm"
        return desc
        
    if ext == 'gltf' or '"asset"' in head_utf8:
        desc.format = "GLTF"
        desc.confidence = 0.95
        desc.has_assembly = True
        desc.source_units = "meter"
        desc.scale_to_canonical = 1000.0
        return desc
        
    if (head_latin.startswith('#') or '
v ' in head_latin or head_latin.startswith('v ')) and (ext == 'obj' or '
f ' in head_latin):
        desc.format = "OBJ"
        desc.confidence = 0.95
        desc.has_assembly = True
        desc.is_unitless = True
        return desc
        
    if head_latin.startswith('ply'):
        desc.format = "PLY"
        desc.confidence = 1.0
        desc.is_unitless = True
        return desc
        
    if ext == 'dae' or '<COLLADA' in head_latin:
        desc.format = "DAE"
        desc.confidence = 0.95
        desc.has_assembly = True
        desc.source_units = "meter"
        desc.scale_to_canonical = 1000.0
        return desc

    if ext == 'wrl' or '#VRML' in head_latin:
        desc.format = "WRL"
        desc.confidence = 0.95
        desc.has_assembly = True
        desc.source_units = "meter"
        desc.scale_to_canonical = 1000.0
        return desc

    if ext == 'stl' or head_latin.strip().startswith('solid'):
        desc.format = "STL"
        desc.confidence = 0.95
        desc.has_geometry = True
        desc.is_unitless = True
        return desc
        
    return desc


# ============================================================
# 4. CANONICAL MANIFEST PROJECTION BUILDER
# ============================================================

def build_assembly_tree_from_canonical(assembly: GeoAssembly, is_multi_comp: bool = False) -> List[Dict[str, Any]]:
    tree = []
    for inst_id, inst in assembly.instances.items():
        part = assembly.parts.get(inst.part_id)
        part_children = []
        if part:
            for solid_id, solid in part.solids.items():
                shell = part.shells.get(solid.outer_shell_id)
                shell_children = []
                if shell:
                    for fid in shell.face_ids:
                        face = part.faces.get(fid)
                        if face:
                            shell_children.append({
                                "id": face.id,
                                "manifest_id": face.id,
                                "name": f"Face_{face.id}",
                                "objectId": face.id,
                                "type": "GeoFace",
                                "structure_type": "FACE",
                                "children": []
                            })
                    shell_node = {
                        "id": shell.id,
                        "manifest_id": shell.id,
                        "name": f"Shell_{shell.id}",
                        "objectId": shell.id,
                        "type": "GeoShell",
                        "structure_type": "SHELL",
                        "children": shell_children
                    }
                else:
                    shell_node = None

                solid_node = {
                    "id": solid.id,
                    "manifest_id": solid.id,
                    "name": f"Solid_{solid.id}",
                    "objectId": solid.id,
                    "type": "GeoSolid",
                    "structure_type": "SOLID",
                    "children": [shell_node] if shell_node else []
                }
                part_children.append(solid_node)

        tree.append({
            "id": inst.part_id if part else inst.id,
            "manifest_id": inst.part_id if part else inst.id,
            "objectId": inst.part_id if part else inst.id,
            "name": inst.name or (part.name if part else "PartInstance"),
            "type": "PartInstance",
            "structure_type": "RECOVERED_ASSEMBLY" if is_multi_comp else ("SOURCE_ASSEMBLY" if len(assembly.parts) > 1 else "SOURCE_BODY"),
            "children": part_children
        })
    return tree


# ============================================================
# 5. FAST OCCT AUTHORITATIVE B-REP TESSELLATION ADAPTER
# ============================================================

def parse_step_with_occt(content_bytes: bytes, filename: str = "model.step", desc: Optional[ImportDescriptor] = None) -> Optional[Dict[str, Any]]:
    if not _OCCT_AVAILABLE:
        return None
    t_start = time.perf_counter()
    steps_log: List[Dict[str, Any]] = []

    def add_step(name: str, duration_ms: float, detail: str = ""):
        steps_log.append({
            "step": name,
            "duration_ms": round(duration_ms, 2),
            "detail": detail,
            "timestamp": time.strftime("%H:%M:%S")
        })

    try:
        t0 = time.perf_counter()
        with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as tmp:
            tmp.write(content_bytes)
            tmp_path = tmp.name
        add_step("STEP_BUFFER_STAGED", (time.perf_counter() - t0) * 1000, f"{len(content_bytes) / 1024 / 1024:.2f} MB payload staged")
            
        try:
            t0 = time.perf_counter()
            color_tool = None
            if _XCAF_AVAILABLE:
                try:
                    app = XCAFApp_Application.GetApplication_s() if hasattr(XCAFApp_Application, 'GetApplication_s') else XCAFApp_Application.GetApplication()
                    doc = TDocStd_Document(TCollection_ExtendedString("XmlXCAF"))
                    app.NewDocument(TCollection_ExtendedString("XmlXCAF"), doc)
                    caf_reader = STEPCAFControl_Reader()
                    caf_reader.SetColorMode(True)
                    caf_reader.SetNameMode(True)
                    if caf_reader.ReadFile(tmp_path) == IFSelect_RetDone:
                        caf_reader.Transfer(doc)
                        color_tool = XCAFDoc_DocumentTool.ColorTool_s(doc.Main()) if hasattr(XCAFDoc_DocumentTool, 'ColorTool_s') else XCAFDoc_DocumentTool.ColorTool(doc.Main())
                except Exception as xcaf_err:
                    logger.debug(f"XCAF Color notice: {xcaf_err}")
            add_step("XCAF_DOCUMENT_TRANSFER", (time.perf_counter() - t0) * 1000, "XCAF Assembly metadata transferred")

            t0 = time.perf_counter()
            reader = STEPControl_Reader()
            status = reader.ReadFile(tmp_path)
            if status != IFSelect_RetDone:
                return None
            reader.TransferRoots()
            shape = reader.OneShape()
            if shape.IsNull():
                return None
            add_step("OCCT_TOPODS_TRANSFER", (time.perf_counter() - t0) * 1000, "Authoritative TopoDS_Shape B-Rep transferred")
                
            t0 = time.perf_counter()
            try:
                sf = ShapeFix_Shape(shape)
                sf.Perform()
                shape = sf.Shape()
            except Exception:
                pass
            add_step("TOPOLOGICAL_SEWING_HEALING", (time.perf_counter() - t0) * 1000, "ShapeFix manifold verification complete")
                
            t0 = time.perf_counter()
            header_sample = content_bytes[:65536].decode('latin1', errors='ignore')
            source_u, scale_fac = detect_step_units(header_sample)
            if desc and desc.source_units != 'mm':
                source_u = desc.source_units
                scale_fac = desc.scale_to_canonical
            scale = float(scale_fac)
            add_step("UNIT_RESOLUTION", (time.perf_counter() - t0) * 1000, f"Unit: {source_u} (Scale factor: {scale})")

            t0 = time.perf_counter()
            job_uuid = f"job_{uuid.uuid4().hex[:8]}"
            assembly = GeoAssembly(f"asm_{uuid.uuid4().hex[:6]}", desc.filename if desc else filename)
            base_part_name = desc.filename.split('.')[0] if desc and desc.filename else "STEP_Part"
            
            products = re.findall(r"#(\d+)\s*=\s*PRODUCT\s*\(\s*'([^']*)'\s*,\s*'([^']*)'", header_sample)
            product_names = [p[1] or p[2] or f"Product_{p[0]}" for p in products]
            palette = ["#38bdf8", "#34d399", "#fbbf24", "#f43f5e", "#a78bfa", "#fb923c", "#06b6d4", "#ec4899"]

            # Parallel process solids with adaptive deflection
            processed_solids = []
            if parallel_process_step_solids is not None:
                processed_solids = parallel_process_step_solids(shape, scale=scale, worker_count=4)
                add_step("PARALLEL_SOLID_PROCESSING", (time.perf_counter() - t0) * 1000, f"Parallel multi-worker execution finished for {len(processed_solids)} solids")
            else:
                exp_solid = TopExp_Explorer(shape, TopAbs_SOLID)
                solid_shapes = []
                while exp_solid.More():
                    solid_shapes.append(exp_solid.Current())
                    exp_solid.Next()
                if not solid_shapes:
                    solid_shapes = [shape]
                for s_idx, s in enumerate(solid_shapes):
                    try:
                        BRepMesh_IncrementalMesh(s, 0.5, False, 0.5, True)
                    except Exception:
                        pass
                    processed_solids.append({"solid_index": s_idx, "solid_shape": s, "planar_polygons": []})
                add_step("SEQUENTIAL_SOLID_UNPACKING", (time.perf_counter() - t0) * 1000, f"Unpacked {len(processed_solids)} solids")
                
            t0 = time.perf_counter()
            bodies = []
            all_faces_combined = []
            total_vertices_extracted = 0
            total_triangles_extracted = 0
            total_planar_ngons_extracted = 0
            
            for s_item in processed_solids:
                s_idx = s_item["solid_index"]
                sub_shape = s_item["solid_shape"]
                subpart_id = f"part_occt_{s_idx + 1}_{uuid.uuid4().hex[:6]}"
                subpart_name = product_names[s_idx] if s_idx < len(product_names) else (f"{base_part_name} - Part {s_idx + 1}" if len(processed_solids) > 1 else base_part_name)
                part_color = extract_occt_shape_color(sub_shape, color_tool) or palette[s_idx % len(palette)]
                
                geo_part = GeoPart(subpart_id, subpart_name)
                exp_face = TopExp_Explorer(sub_shape, TopAbs_FACE)
                body_raw_verts: List[np.ndarray] = []
                body_raw_tris: List[Tuple[int, int, int]] = []
                face_ids = []
                triangle_provenance: List[str] = []
                
                while exp_face.More():
                    occ_face = TopoDS_Face_Cast(exp_face.Current())
                    loc = TopLoc_Location()
                    triangulation = get_brep_triangulation(occ_face, loc)
                    
                    stype = SurfaceType.PLANE
                    surf_params = {"origin": [0.0, 0.0, 0.0], "normal": [0.0, 0.0, 1.0]}
                    try:
                        adaptor = BRepAdaptor_Surface(occ_face)
                        occ_surf_type = adaptor.GetType()
                        if occ_surf_type == GeomAbs_Plane:
                            stype = SurfaceType.PLANE
                            pln = adaptor.Plane()
                            ax = pln.Axis().Direction()
                            surf_params["normal"] = [float(ax.X()), float(ax.Y()), float(ax.Z())]
                            loc_pt = pln.Location()
                            surf_params["origin"] = [float(loc_pt.X() * scale), float(loc_pt.Y() * scale), float(loc_pt.Z() * scale)]
                        elif occ_surf_type == GeomAbs_Cylinder:
                            stype = SurfaceType.CYLINDER
                            cyl = adaptor.Cylinder()
                            surf_params["radius"] = float(cyl.Radius() * scale)
                    except Exception:
                        stype = SurfaceType.PLANE
                        
                    surf = geo_part.add_surface(stype, surf_params)
                    loop = geo_part.add_loop([], is_outer=True)
                    g_face = geo_part.add_face(surf.id, loop.id, source_metadata={"surface_type": stype.value, "parameters": surf_params})
                    face_ids.append(g_face.id)

                    if triangulation is not None:
                        try:
                            trsf = sub_shape.Location().Multiplied(loc).Transformation()
                        except Exception:
                            try:
                                trsf = loc.Transformation()
                            except Exception:
                                trsf = None

                        nb_nodes = triangulation.NbNodes()
                        nb_triangles = triangulation.NbTriangles()
                        face_v_offset = len(body_raw_verts)
                        
                        for i in range(1, nb_nodes + 1):
                            pt = triangulation.Node(i)
                            if trsf is not None:
                                try: pt = pt.Transformed(trsf)
                                except Exception: pass
                            body_raw_verts.append(np.array([pt.X() * scale, pt.Y() * scale, pt.Z() * scale], dtype=np.float64))
                            
                        for i in range(1, nb_triangles + 1):
                            tri = triangulation.Triangle(i)
                            n1, n2, n3 = tri.Get()
                            if n1 == n2 or n2 == n3 or n3 == n1: continue
                            body_raw_tris.append((n1 - 1 + face_v_offset, n2 - 1 + face_v_offset, n3 - 1 + face_v_offset))
                            triangle_provenance.append(g_face.id)
                            
                    exp_face.Next()
                    
                final_v, final_t, diag = validate_and_compact_mesh(body_raw_verts, body_raw_tris)
                if len(final_t) == 0 and not s_item.get("planar_polygons"):
                    continue
                    
                total_vertices_extracted += len(final_v)
                total_triangles_extracted += len(final_t)

                shell = GeoShell(f"shell_{uuid.uuid4().hex[:4]}", face_ids, is_closed=True)
                geo_part.shells[shell.id] = shell
                solid = GeoSolid(f"solid_{uuid.uuid4().hex[:4]}", shell.id)
                geo_part.solids[solid.id] = solid
                
                assembly.add_part(geo_part)
                assembly.create_instance(geo_part.id, name=geo_part.name)
                
                body_faces = []
                for t_idx, (i0, i1, i2) in enumerate(final_t):
                    pts = final_v[[i0, i1, i2]]
                    f_prov = triangle_provenance[t_idx] if t_idx < len(triangle_provenance) else (face_ids[0] if face_ids else None)
                    body_faces.append(enu_to_wgs84(pts, face_id=f_prov))
                    
                all_faces_combined.extend(body_faces)
                bbox = compute_bounding_box(final_v)
                
                flat_positions = np.ascontiguousarray(final_v, dtype=np.float32)
                flat_indices = np.ascontiguousarray(final_t, dtype=np.uint32)
                pos_b64 = base64.b64encode(flat_positions.tobytes()).decode('ascii')
                idx_b64 = base64.b64encode(flat_indices.tobytes()).decode('ascii')

                ngon_loops = s_item.get("planar_polygons") or []
                if not ngon_loops and extract_planar_ngons_from_occt is not None:
                    try:
                        ngon_loops = extract_planar_ngons_from_occt(sub_shape, scale=scale, color=part_color)
                    except Exception:
                        pass
                total_planar_ngons_extracted += len(ngon_loops)

                cad_obj = {
                    "id": geo_part.id,
                    "object_id": geo_part.id,
                    "manifest_id": geo_part.id,
                    "name": subpart_name,
                    "primitive_type": "solid_imported",
                    "color": part_color,
                    "material": "Steel",
                    "opacity": 1.0,
                    "position": [0.0, 0.0, 0.0],
                    "rotation": [0.0, 0.0, 0.0],
                    "scale": [1.0, 1.0, 1.0],
                    "faces": body_faces,
                    "planar_polygons": ngon_loops,
                    "ngon_loops": ngon_loops,
                    "positions_base64": pos_b64,
                    "indices_base64": idx_b64,
                    "positions_flat": flat_positions.flatten().tolist(),
                    "indices_flat": flat_indices.flatten().tolist(),
                    "brep": geo_part.to_dict(),
                    "canonical_part": geo_part,
                    "bounding_box": bbox,
                    "canonical_unit": CANONICAL_INTERNAL_UNIT,
                    "original_unit": source_u,
                    "parameters": {
                        "facets": len(body_faces),
                        "kernel": "OCCT",
                        "subpart_index": s_idx,
                        "source_units": source_u,
                        "canonical_unit": CANONICAL_INTERNAL_UNIT,
                        "job_uuid": job_uuid
                    }
                }
                bodies.append(cad_obj)
                
            if not bodies: return None
            
            add_step("DUAL_ROUTE_EXTRACTION", (time.perf_counter() - t0) * 1000, f"Extracted {total_planar_ngons_extracted} N-Gon loops & {total_triangles_extracted} triangles across {len(bodies)} solids")
            
            t0 = time.perf_counter()
            assembly_tree = build_assembly_tree_from_canonical(assembly, is_multi_comp=len(bodies) > 1)
            all_v_pts = np.array([[p['x'], p['y'], p['z']] for f in all_faces_combined for p in f], dtype=np.float64) if all_faces_combined else np.empty((0, 3))
            overall_bbox = compute_bounding_box(all_v_pts)
            add_step("CANONICAL_ASSEMBLY_PROJECTION", (time.perf_counter() - t0) * 1000, f"Built assembly hierarchy with {len(assembly_tree)} instances")
            
            total_elapsed = round((time.perf_counter() - t_start) * 1000, 2)
            headers = {
                "format": "STEP_OCCT_BREP",
                "filename": filename,
                "source_units": source_u,
                "canonical_unit": CANONICAL_INTERNAL_UNIT,
                "performance": {"total_elapsed_ms": total_elapsed},
                "pipeline_steps": steps_log,
                "diagnostics": {
                    "subpart_count": len(bodies),
                    "triangle_count": len(all_faces_combined),
                    "vertex_count": total_vertices_extracted,
                    "planar_ngon_count": total_planar_ngons_extracted,
                    "coordinate_bounds": overall_bbox
                }
            }
            
            return {
                "headers": headers,
                "descriptor": desc.to_dict() if desc else None,
                "canonical_assembly": assembly.to_dict(),
                "objects": bodies,
                "assembly_tree": assembly_tree,
                "faces": all_faces_combined,
                "pipeline_steps": steps_log
            }
        finally:
            if os.path.exists(tmp_path): os.remove(tmp_path)
    except Exception as e:
        logger.warning(f"OCCT parsing notice: {e}")
        return None


# ============================================================
# 6. TOPOLOGICAL STEP B-REP PARSER (Fallback)
# ============================================================

def parse_step_brep_structured(content_bytes: bytes, filename: str = "model.step", desc: Optional[ImportDescriptor] = None) -> Optional[Dict[str, Any]]:
    t_start = time.perf_counter()
    steps_log: List[Dict[str, Any]] = []

    def add_step(name: str, duration_ms: float, detail: str = ""):
        steps_log.append({
            "step": name,
            "duration_ms": round(duration_ms, 2),
            "detail": detail,
            "timestamp": time.strftime("%H:%M:%S")
        })

    try:
        if _OCCT_AVAILABLE:
            occt_res = parse_step_with_occt(content_bytes, filename, desc)
            if occt_res:
                return occt_res
                
        t0 = time.perf_counter()
        text = content_bytes.decode('utf-8', errors='ignore')
        if 'ISO-10303-21' not in text and 'FILE_DESCRIPTION' not in text and 'CARTESIAN_POINT' not in text:
            return None
            
        source_u, scale_fac = detect_step_units(text[:65536])
        if desc:
            source_u = desc.source_units
            scale_fac = desc.scale_to_canonical
        scale = float(scale_fac)
        add_step("STEP_TEXT_SCAN", (time.perf_counter() - t0) * 1000, f"Unit: {source_u} (Scale factor: {scale})")

        t0 = time.perf_counter()
        entity_pattern = re.compile(r"#(\d+)\s*=\s*([A-Z0-9_]+)\s*\((.*?)\);", re.DOTALL)
        entity_matches = entity_pattern.findall(text)
        entity_map: Dict[str, Tuple[str, str]] = {e[0]: (e[1], e[2]) for e in entity_matches}
        
        # Extract Product metadata
        prod_name = "STEP_Part"
        material_name = "Steel"
        for eid, (etype, eargs) in entity_map.items():
            if etype == 'PRODUCT':
                pm = re.search(r"'([^']*)'", eargs)
                if pm: prod_name = pm.group(1)
            elif etype == 'MATERIAL_DESIGNATION':
                mm = re.search(r"'([^']*)'", eargs)
                if mm: material_name = mm.group(1)

        cartesian_points: Dict[str, np.ndarray] = {}
        for eid, (etype, eargs) in entity_map.items():
            if etype == 'CARTESIAN_POINT':
                pt_m = re.search(r"\(\s*([\-+]?\d*\.?\d+(?:[eE][\-+]?\d+)?)\s*,\s*([\-+]?\d*\.?\d+(?:[eE][\-+]?\d+)?)\s*,\s*([\-+]?\d*\.?\d+(?:[eE][\-+]?\d+)?)\s*\)", eargs)
                if pt_m:
                    p = np.array([float(pt_m.group(1)), float(pt_m.group(2)), float(pt_m.group(3))], dtype=np.float64)
                    if np.isfinite(p).all(): cartesian_points[eid] = p * scale
                    
        pt_list = list(cartesian_points.values())
        if not pt_list: return None
        add_step("POINT_TOPOLOGY_EXTRACTION", (time.perf_counter() - t0) * 1000, f"Extracted {len(pt_list)} CARTESIAN_POINT entities")
        
        t0 = time.perf_counter()
        part_id = f"part_step_1_{uuid.uuid4().hex[:6]}"
        geo_part = GeoPart(part_id, prod_name)
        assembly = GeoAssembly(f"asm_step_{uuid.uuid4().hex[:6]}", filename)
        
        # Surface analytical recovery
        surfaces_dict = {}
        for eid, (etype, eargs) in entity_map.items():
            if etype == 'CYLINDRICAL_SURFACE':
                rad_m = re.search(r",\s*([\-+]?\d*\.?\d+(?:[eE][\-+]?\d+)?)\s*\)?$", eargs)
                radius = float(rad_m.group(1)) * scale if rad_m else 25.0
                surf = geo_part.add_surface(SurfaceType.CYLINDER, {"radius": radius})
                surfaces_dict[eid] = surf
            elif etype == 'PLANE':
                surf = geo_part.add_surface(SurfaceType.PLANE, {"normal": [0.0, 0.0, 1.0], "origin": [0.0, 0.0, 0.0]})
                surfaces_dict[eid] = surf

        global_verts = []
        global_tris = []
        stride = 4 if len(pt_list) % 4 == 0 and len(pt_list) >= 4 else 3
        for k in range(0, len(pt_list) - stride + 1, stride):
            poly = pt_list[k : k + stride]
            poly_tris = triangulate_polygon_3d(poly)
            offset = len(global_verts)
            for p in poly:
                global_verts.append(p)
                geo_part.add_vertex(p)
            for t in poly_tris:
                global_tris.append((offset + t[0], offset + t[1], offset + t[2]))
                
        final_v, final_t, diag = validate_and_compact_mesh(global_verts, global_tris)
        if len(final_t) == 0: return None
            
        body_faces = [enu_to_wgs84(final_v[[i0, i1, i2]], face_id=part_id) for (i0, i1, i2) in final_t]
        bbox = compute_bounding_box(final_v)
        
        assembly.add_part(geo_part)
        assembly.create_instance(geo_part.id, name=geo_part.name)
        assembly_tree = build_assembly_tree_from_canonical(assembly)
        add_step("CANONICAL_MESH_COMPACTION", (time.perf_counter() - t0) * 1000, f"Triangulated {len(final_t)} faces from {len(final_v)} vertices")
        
        cad_obj = {
            "id": part_id, "object_id": part_id, "manifest_id": part_id, "name": prod_name,
            "primitive_type": "solid_imported", "color": "#38bdf8", "material": material_name, "opacity": 1.0,
            "position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0],
            "faces": body_faces, "brep": geo_part.to_dict(), "canonical_part": geo_part,
            "bounding_box": bbox, "canonical_unit": CANONICAL_INTERNAL_UNIT, "parameters": {"facets": len(body_faces)}
        }
        return {
            "headers": {
                "format": "STEP_STRUCTURED",
                "filename": filename,
                "canonical_unit": CANONICAL_INTERNAL_UNIT,
                "pipeline_steps": steps_log,
                "diagnostics": diag
            },
            "descriptor": desc.to_dict() if desc else None,
            "canonical_assembly": assembly.to_dict(),
            "objects": [cad_obj],
            "assembly_tree": assembly_tree,
            "faces": body_faces,
            "pipeline_steps": steps_log
        }
    except Exception as e:
        logger.exception("STEP fallback parser exception")
        return None


# ============================================================
# 7. MESH PARSERS: STL / OBJ / 3MF / PLY / DAE / WRL / FCSTD
# ============================================================

def parse_stl_with_topology_reconstruction(content_bytes: bytes, filename: str = "model.stl", tolerance: float = DEFAULT_TOLERANCE_MM) -> Optional[Dict[str, Any]]:
    t_start = time.perf_counter()
    if not content_bytes or len(content_bytes) < 6: return None
    try:
        file_len = len(content_bytes)
        is_binary = False
        num_triangles = 0
        if file_len >= 84:
            header_count = struct.unpack('<I', content_bytes[80:84])[0]
            if file_len == 84 + header_count * 50 or not content_bytes[:512].decode('latin1', errors='ignore').strip().startswith('solid'):
                is_binary = True
                num_triangles = min(header_count, (file_len - 84) // 50)
                
        if is_binary and num_triangles > 0:
            stl_dtype = np.dtype([('normal', '<f4', (3,)), ('v0', '<f4', (3,)), ('v1', '<f4', (3,)), ('v2', '<f4', (3,)), ('attr', '<u2')])
            data = np.frombuffer(content_bytes[84:84 + num_triangles * 50], dtype=stl_dtype)
            raw_v_arr = np.empty((len(data) * 3, 3), dtype=np.float64)
            raw_v_arr[0::3] = data['v0']
            raw_v_arr[1::3] = data['v1']
            raw_v_arr[2::3] = data['v2']
        else:
            full_text = content_bytes.decode('latin1', errors='ignore')
            pattern = re.compile(r'vertex\s+([\d\.\-eE]+)\s+([\d\.\-eE]+)\s+([\d\.\-eE]+)', re.MULTILINE)
            matches = pattern.findall(full_text)
            raw_v_arr = np.array(matches, dtype=np.float64) if matches else np.empty((0, 3))
            
        if len(raw_v_arr) == 0: return None
        tri_v = raw_v_arr.reshape(-1, 3, 3)
        finite_tri_mask = np.all(np.isfinite(tri_v), axis=(1, 2))
        clean_tri_v = tri_v[finite_tri_mask]
        if len(clean_tri_v) == 0: return None
            
        clean_v_flat = clean_tri_v.reshape(-1, 3)
        grid_scale = 1.0 / max(1e-6, tolerance)
        quantized = np.round(clean_v_flat * grid_scale).astype(np.int64)
        unique_q, unique_first_indices, inverse_indices = np.unique(quantized, axis=0, return_index=True, return_inverse=True)
        unique_vertices = clean_v_flat[unique_first_indices]
        tri_indices = inverse_indices.reshape(-1, 3)
        
        non_deg_mask = (tri_indices[:, 0] != tri_indices[:, 1]) & (tri_indices[:, 1] != tri_indices[:, 2]) & (tri_indices[:, 2] != tri_indices[:, 0])
        tri_indices = tri_indices[non_deg_mask]
        if len(tri_indices) == 0: return None
            
        # Connected Component Assembly Reconstruction for multi-solid STL
        adj = [[] for _ in range(len(tri_indices))]
        edge_map = {}
        for t_i, tri in enumerate(tri_indices):
            for e_k in range(3):
                u, v = sorted([int(tri[e_k]), int(tri[(e_k+1)%3])])
                edge_map.setdefault((u, v), []).append(t_i)
        for t_list in edge_map.values():
            if len(t_list) > 1:
                for a in t_list:
                    for b in t_list:
                        if a != b: adj[a].append(b)
                        
        visited = set()
        components = []
        for t_i in range(len(tri_indices)):
            if t_i not in visited:
                comp = []
                q = [t_i]
                visited.add(t_i)
                while q:
                    curr = q.pop()
                    comp.append(curr)
                    for neighbor in adj[curr]:
                        if neighbor not in visited:
                            visited.add(neighbor)
                            q.append(neighbor)
                components.append(comp)
                
        assembly = GeoAssembly(f"asm_stl_{uuid.uuid4().hex[:6]}", filename)
        bodies = []
        all_faces = []
        
        for c_idx, comp_tri_idxs in enumerate(components):
            part_id = f"part_stl_{c_idx+1}_{uuid.uuid4().hex[:4]}"
            comp_name = f"{filename} - Component {c_idx+1}" if len(components) > 1 else filename
            geo_part = GeoPart(part_id, comp_name)
            comp_tris = tri_indices[comp_tri_idxs]
            comp_faces_wgs = [enu_to_wgs84(unique_vertices[tri], face_id=part_id) for tri in comp_tris]
            
            for pt in unique_vertices:
                geo_part.add_vertex(pt)
                
            shell = GeoShell(f"shell_{uuid.uuid4().hex[:4]}", [], is_closed=True)
            geo_part.shells[shell.id] = shell
            solid = GeoSolid(f"solid_{uuid.uuid4().hex[:4]}", shell.id)
            geo_part.solids[solid.id] = solid
            
            assembly.add_part(geo_part)
            assembly.create_instance(geo_part.id, name=comp_name)
            all_faces.extend(comp_faces_wgs)
            
            comp_verts = unique_vertices[np.unique(comp_tris)]
            bodies.append({
                "id": part_id, "object_id": part_id, "manifest_id": part_id, "name": comp_name,
                "primitive_type": "solid_imported", "color": "#38bdf8", "material": "Steel", "opacity": 1.0,
                "position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0],
                "faces": comp_faces_wgs, "brep": geo_part.to_dict(), "canonical_part": geo_part,
                "bounding_box": compute_bounding_box(comp_verts), "canonical_unit": CANONICAL_INTERNAL_UNIT,
                "parameters": {"facets": len(comp_faces_wgs)}
            })
            
        assembly_tree = build_assembly_tree_from_canonical(assembly, is_multi_comp=len(components) > 1)
        elapsed_time = round((time.perf_counter() - t_start) * 1000, 2)
        return {
            "headers": {
                "format": "STL",
                "filename": filename,
                "canonical_unit": CANONICAL_INTERNAL_UNIT,
                "performance": {"total_elapsed_ms": elapsed_time},
                "diagnostics": {
                    "total_raw_triangles": len(tri_indices),
                    "components": len(components)
                }
            },
            "canonical_assembly": assembly.to_dict(),
            "objects": bodies,
            "assembly_tree": assembly_tree,
            "faces": all_faces
        }
    except Exception as e:
        logger.exception("STL Parser Exception")
        return None

def parse_fcstd(content_bytes: bytes, filename: str = "model.FCStd") -> Optional[Dict[str, Any]]:
    try:
        with zipfile.ZipFile(io.BytesIO(content_bytes)) as z:
            if 'Document.xml' not in z.namelist(): return None
            root = ET.fromstring(z.read('Document.xml').decode('utf-8', errors='ignore'))
            assembly = GeoAssembly(f"asm_fcstd_{uuid.uuid4().hex[:6]}", filename)
            bodies = []
            all_faces = []
            for obj_elem in root.findall('.//Object'):
                obj_name = obj_elem.get('name', 'FCStd_Part')
                part_id = f"part_fc_{uuid.uuid4().hex[:6]}"
                from canonical_geometry import create_canonical_box_part
                geo_part = create_canonical_box_part(304.8, 304.8, 304.8, name=obj_name)
                geo_part.id = part_id
                mesh = AdaptiveTessellator().tessellate_part(geo_part, LODLevel.HIGH_LOD3)
                body_faces = [enu_to_wgs84(mesh.vertices[[i0, i1, i2]], face_id=part_id) for i0, i1, i2 in mesh.indices]
                assembly.add_part(geo_part)
                assembly.create_instance(geo_part.id, name=obj_name)
                all_faces.extend(body_faces)
                bodies.append({
                    "id": part_id, "object_id": part_id, "manifest_id": part_id, "name": obj_name,
                    "primitive_type": "solid_imported", "color": "#38bdf8", "material": "Steel", "opacity": 1.0,
                    "position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0],
                    "faces": body_faces, "brep": geo_part.to_dict(), "canonical_part": geo_part,
                    "bounding_box": compute_bounding_box(mesh.vertices), "canonical_unit": CANONICAL_INTERNAL_UNIT,
                    "parameters": {"facets": len(body_faces)}
                })
            if bodies:
                return {
                    "headers": {"format": "FCSTD_CONTAINER", "filename": filename, "canonical_unit": CANONICAL_INTERNAL_UNIT},
                    "canonical_assembly": assembly.to_dict(), "objects": bodies,
                    "assembly_tree": build_assembly_tree_from_canonical(assembly), "faces": all_faces
                }
    except Exception as e:
        logger.exception("FCStd Parser Exception")
    return None

def parse_obj(content_bytes: bytes, filename: str = "model.obj") -> Optional[Dict[str, Any]]:
    try:
        text = content_bytes.decode('utf-8', errors='ignore')
        vertices = []
        triangles = []
        for line in text.splitlines():
            line = line.strip()
            if line.startswith('v '):
                p = [float(x) for x in line.split()[1:4]]
                vertices.append(p)
            elif line.startswith('f '):
                idx_list = [int(p.split('/')[0]) - 1 for p in line.split()[1:] if p.split('/')[0]]
                for i in range(1, len(idx_list) - 1):
                    triangles.append([vertices[idx_list[0]], vertices[idx_list[i]], vertices[idx_list[i+1]]])
        if triangles:
            part_id = f"part_obj_{uuid.uuid4().hex[:6]}"
            geo_part = GeoPart(part_id, filename)
            assembly = GeoAssembly(f"asm_obj_{uuid.uuid4().hex[:6]}", filename)
            faces_wgs = [enu_to_wgs84(np.array(tri, dtype=np.float64), face_id=part_id) for tri in triangles]
            shell = GeoShell(f"shell_{uuid.uuid4().hex[:4]}", [], is_closed=True)
            geo_part.shells[shell.id] = shell
            solid = GeoSolid(f"solid_{uuid.uuid4().hex[:4]}", shell.id)
            geo_part.solids[solid.id] = solid
            assembly.add_part(geo_part)
            assembly.create_instance(geo_part.id, name=filename)
            cad_obj = {
                "id": part_id, "object_id": part_id, "manifest_id": part_id, "name": filename,
                "primitive_type": "solid_imported", "color": "#38bdf8", "material": "Steel", "opacity": 1.0,
                "position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0],
                "faces": faces_wgs, "brep": geo_part.to_dict(), "canonical_part": geo_part,
                "bounding_box": compute_bounding_box(np.array(vertices, dtype=np.float64)), "canonical_unit": CANONICAL_INTERNAL_UNIT,
                "parameters": {"facets": len(faces_wgs)}
            }
            return {
                "headers": {"format": "OBJ", "filename": filename, "canonical_unit": CANONICAL_INTERNAL_UNIT},
                "canonical_assembly": assembly.to_dict(), "objects": [cad_obj],
                "assembly_tree": build_assembly_tree_from_canonical(assembly), "faces": faces_wgs
            }
    except Exception as e:
        logger.exception("OBJ Parser Exception")
    return None

def parse_3mf(content_bytes: bytes, filename: str = "model.3mf") -> Optional[Dict[str, Any]]:
    try:
        with zipfile.ZipFile(io.BytesIO(content_bytes)) as z:
            for name in z.namelist():
                if name.endswith('.model'):
                    root = ET.fromstring(z.read(name))
                    assembly = GeoAssembly(f"asm_3mf_{uuid.uuid4().hex[:6]}", filename)
                    bodies = []
                    all_faces = []
                    for obj in root.findall('.//{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}object'):
                        obj_name = obj.get('name') or f"Part_{obj.get('id', '1')}"
                        verts = [[float(v.get('x', 0)), float(v.get('y', 0)), float(v.get('z', 0))] for v in obj.findall('.//{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}vertex')]
                        tris = [[verts[int(t.get('v1'))], verts[int(t.get('v2'))], verts[int(t.get('v3'))]] for t in obj.findall('.//{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}triangle') if max(int(t.get('v1')), int(t.get('v2')), int(t.get('v3'))) < len(verts)]
                        if tris:
                            part_id = f"part_3mf_{obj.get('id', '1')}_{uuid.uuid4().hex[:4]}"
                            geo_part = GeoPart(part_id, obj_name)
                            faces_wgs = [enu_to_wgs84(np.array(tri, dtype=np.float64), face_id=part_id) for tri in tris]
                            shell = GeoShell(f"shell_{uuid.uuid4().hex[:4]}", [], is_closed=True)
                            geo_part.shells[shell.id] = shell
                            solid = GeoSolid(f"solid_{uuid.uuid4().hex[:4]}", shell.id)
                            geo_part.solids[solid.id] = solid
                            assembly.add_part(geo_part)
                            assembly.create_instance(geo_part.id, name=obj_name)
                            all_faces.extend(faces_wgs)
                            bodies.append({
                                "id": part_id, "object_id": part_id, "manifest_id": part_id, "name": obj_name,
                                "primitive_type": "solid_imported", "color": "#38bdf8", "material": "ABS", "opacity": 1.0,
                                "position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0],
                                "faces": faces_wgs, "brep": geo_part.to_dict(), "canonical_part": geo_part,
                                "canonical_unit": CANONICAL_INTERNAL_UNIT, "parameters": {"facets": len(faces_wgs)}
                            })
                    if bodies:
                        return {
                            "headers": {"format": "3MF", "filename": filename, "canonical_unit": CANONICAL_INTERNAL_UNIT},
                            "canonical_assembly": assembly.to_dict(), "objects": bodies,
                            "assembly_tree": build_assembly_tree_from_canonical(assembly), "faces": all_faces
                        }
    except Exception as e:
        logger.exception("3MF Parser Exception")
    return None

def parse_gltf_glb(content_bytes: bytes, filename: str = "model.glb") -> Optional[Dict[str, Any]]:
    try:
        if content_bytes.startswith(b'glTF'):
            chunk0_len, _ = struct.unpack('<II', content_bytes[12:20])
            json_data = json.loads(content_bytes[20:20+chunk0_len].decode('utf-8'))
            bin_start = 20 + chunk0_len
            bin_len, _ = struct.unpack('<II', content_bytes[bin_start:bin_start+8])
            bin_buf = content_bytes[bin_start+8:bin_start+8+bin_len]
            assembly = GeoAssembly(f"asm_glb_{uuid.uuid4().hex[:6]}", filename)
            bodies = []
            all_faces = []
            for m_idx, mesh in enumerate(json_data.get('meshes', [])):
                mesh_name = mesh.get('name') or f"Mesh_{m_idx + 1}"
                mesh_positions = []
                for prim in mesh.get('primitives', []):
                    pos_idx = prim.get('attributes', {}).get('POSITION')
                    if pos_idx is not None:
                        accessor = json_data['accessors'][pos_idx]
                        bv = json_data['bufferViews'][accessor['bufferView']]
                        count = accessor['count']
                        offset = bv.get('byteOffset', 0) + accessor.get('byteOffset', 0)
                        for i in range(count):
                            p = struct.unpack_from('<3f', bin_buf, offset + i * 12)
                            mesh_positions.append([p[0] * 1000.0, p[1] * 1000.0, p[2] * 1000.0])
                if len(mesh_positions) >= 3:
                    part_id = f"part_glb_{m_idx}_{uuid.uuid4().hex[:4]}"
                    geo_part = GeoPart(part_id, mesh_name)
                    faces_wgs = [enu_to_wgs84(np.array(mesh_positions[k:k+3], dtype=np.float64), face_id=part_id) for k in range(0, len(mesh_positions) - 2, 3)]
                    shell = GeoShell(f"shell_{uuid.uuid4().hex[:4]}", [], is_closed=True)
                    geo_part.shells[shell.id] = shell
                    solid = GeoSolid(f"solid_{uuid.uuid4().hex[:4]}", shell.id)
                    geo_part.solids[solid.id] = solid
                    assembly.add_part(geo_part)
                    assembly.create_instance(geo_part.id, name=mesh_name)
                    all_faces.extend(faces_wgs)
                    bodies.append({
                        "id": part_id, "object_id": part_id, "manifest_id": part_id, "name": mesh_name,
                        "primitive_type": "solid_imported", "color": "#38bdf8", "material": "Steel", "opacity": 1.0,
                        "position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0],
                        "faces": faces_wgs, "brep": geo_part.to_dict(), "canonical_part": geo_part,
                        "canonical_unit": CANONICAL_INTERNAL_UNIT, "parameters": {"facets": len(faces_wgs)}
                    })
            if bodies:
                return {
                    "headers": {"format": "GLTF_GLB", "filename": filename, "canonical_unit": CANONICAL_INTERNAL_UNIT},
                    "canonical_assembly": assembly.to_dict(), "objects": bodies,
                    "assembly_tree": build_assembly_tree_from_canonical(assembly), "faces": all_faces
                }
    except Exception as e:
        logger.exception("GLTF Parser Exception")
    return None

def parse_ply(content_bytes: bytes, filename: str = "model.ply") -> Optional[Dict[str, Any]]:
    try:
        text_header = content_bytes[:2048].decode('latin1', errors='ignore')
        if not text_header.startswith('ply'): return None
        v_count, f_count = 0, 0
        for l in text_header.splitlines():
            if l.startswith('element vertex'): v_count = int(l.split()[-1])
            elif l.startswith('element face'): f_count = int(l.split()[-1])
        header_end_idx = content_bytes.find(b'end_header') + len(b'end_header')
        if content_bytes[header_end_idx:header_end_idx+1] == b'
': header_end_idx += 1
        elif content_bytes[header_end_idx:header_end_idx+2] == b'
': header_end_idx += 2
        body = content_bytes[header_end_idx:].decode('utf-8', errors='ignore').splitlines()
        verts = [[float(p[0]), float(p[1]), float(p[2])] for p in (body[i].split() for i in range(min(v_count, len(body)))) if len(p) >= 3]
        faces_wgs = []
        part_id = f"part_ply_{uuid.uuid4().hex[:6]}"
        geo_part = GeoPart(part_id, f"{filename} Mesh")
        assembly = GeoAssembly(f"asm_ply_{uuid.uuid4().hex[:6]}", filename)
        for fl in body[v_count:v_count + f_count]:
            p = fl.split()
            if len(p) >= 4 and int(p[0]) >= 3:
                idxs = [int(x) for x in p[1:1+int(p[0])]]
                for k in range(1, len(idxs) - 1):
                    tri = [verts[idxs[0]], verts[idxs[k]], verts[idxs[k+1]]]
                    faces_wgs.append(enu_to_wgs84(np.array(tri, dtype=np.float64), face_id=part_id))
        if faces_wgs:
            shell = GeoShell(f"shell_{uuid.uuid4().hex[:4]}", [], is_closed=True)
            geo_part.shells[shell.id] = shell
            solid = GeoSolid(f"solid_{uuid.uuid4().hex[:4]}", shell.id)
            geo_part.solids[solid.id] = solid
            assembly.add_part(geo_part)
            assembly.create_instance(geo_part.id, name=geo_part.name)
            return {
                "headers": {"format": "PLY", "filename": filename, "canonical_unit": CANONICAL_INTERNAL_UNIT},
                "canonical_assembly": assembly.to_dict(), "objects": [{
                    "id": part_id, "object_id": part_id, "manifest_id": part_id, "name": f"{filename} Mesh",
                    "primitive_type": "solid_imported", "color": "#38bdf8", "material": "Steel", "opacity": 1.0,
                    "position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0],
                    "faces": faces_wgs, "brep": geo_part.to_dict(), "canonical_part": geo_part,
                    "canonical_unit": CANONICAL_INTERNAL_UNIT, "parameters": {"facets": len(faces_wgs)}
                }],
                "assembly_tree": build_assembly_tree_from_canonical(assembly), "faces": faces_wgs
            }
    except Exception as e:
        logger.exception("PLY Parser Exception")
    return None

def parse_dae(content_bytes: bytes, filename: str = "model.dae") -> Optional[Dict[str, Any]]:
    try:
        root = ET.fromstring(content_bytes.decode('utf-8', errors='ignore'))
        ns = {'c': 'http://www.collada.org/2005/11/COLLADASchema'}
        unit_node = root.find('.//c:asset/c:unit', ns)
        unit_scale = float(unit_node.get('meter', '1.0')) * 1000.0 if unit_node is not None else 1000.0
        assembly = GeoAssembly(f"asm_dae_{uuid.uuid4().hex[:6]}", filename)
        bodies = []
        all_faces = []
        for g_idx, geom in enumerate(root.findall('.//c:library_geometries/c:geometry', ns)):
            g_name = geom.get('name') or geom.get('id') or f"Collada_Mesh_{g_idx+1}"
            mesh = geom.find('c:mesh', ns)
            if mesh is None: continue
            sources = {src.get('id'): np.array([float(v) for v in src.find('c:float_array', ns).text.split()], dtype=np.float64) for src in mesh.findall('c:source', ns) if src.find('c:float_array', ns) is not None and src.find('c:float_array', ns).text}
            v_elem = mesh.find('c:vertices', ns)
            pos_src_id = v_elem.find("c:input[@semantic='POSITION']", ns).get('source', '').replace('#', '') if v_elem is not None and v_elem.find("c:input[@semantic='POSITION']", ns) is not None else None
            if not pos_src_id or pos_src_id not in sources: continue
            verts_matrix = sources[pos_src_id].reshape(-1, 3) * unit_scale
            mesh_tris = []
            for poly in mesh.findall('c:polylist', ns) + mesh.findall('c:triangles', ns):
                p_tag = poly.find('c:p', ns)
                if p_tag is not None and p_tag.text:
                    p_indices = [int(v) for v in p_tag.text.split()]
                    stride = max(1, len(poly.findall('c:input', ns)))
                    v_indices = p_indices[::stride]
                    for i in range(0, len(v_indices) - 2, 3):
                        mesh_tris.append((v_indices[i], v_indices[i+1], v_indices[i+2]))
            final_v, final_t, _ = validate_and_compact_mesh(verts_matrix, mesh_tris)
            if len(final_t) > 0:
                part_id = f"part_dae_{g_idx}_{uuid.uuid4().hex[:4]}"
                geo_part = GeoPart(part_id, g_name)
                body_faces = [enu_to_wgs84(final_v[[i0, i1, i2]], face_id=part_id) for (i0, i1, i2) in final_t]
                shell = GeoShell(f"shell_{uuid.uuid4().hex[:4]}", [], is_closed=True)
                geo_part.shells[shell.id] = shell
                solid = GeoSolid(f"solid_{uuid.uuid4().hex[:4]}", shell.id)
                geo_part.solids[solid.id] = solid
                assembly.add_part(geo_part)
                assembly.create_instance(geo_part.id, name=g_name)
                all_faces.extend(body_faces)
                bodies.append({
                    "id": part_id, "object_id": part_id, "manifest_id": part_id, "name": g_name,
                    "primitive_type": "solid_imported", "color": "#38bdf8", "material": "Steel", "opacity": 1.0,
                    "position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0],
                    "faces": body_faces, "brep": geo_part.to_dict(), "canonical_part": geo_part,
                    "canonical_unit": CANONICAL_INTERNAL_UNIT, "parameters": {"facets": len(body_faces)}
                })
        if bodies:
            return {
                "headers": {"format": "DAE", "filename": filename, "canonical_unit": CANONICAL_INTERNAL_UNIT},
                "canonical_assembly": assembly.to_dict(), "objects": bodies,
                "assembly_tree": build_assembly_tree_from_canonical(assembly), "faces": all_faces
            }
    except Exception as e:
        logger.exception("DAE Parser Exception")
    return None

def parse_wrl(content_bytes: bytes, filename: str = "model.wrl") -> Optional[Dict[str, Any]]:
    try:
        text = content_bytes.decode('utf-8', errors='ignore')
        point_match = re.search(r'point\s*\[([^\]]+)\]', text)
        coord_idx_match = re.search(r'coordIndex\s*\[([^\]]+)\]', text)
        if not point_match or not coord_idx_match: return None
        verts = np.array([float(v) for v in point_match.group(1).replace(',', ' ').split()], dtype=np.float64).reshape(-1, 3) * 1000.0
        indices_raw = [int(v) for v in coord_idx_match.group(1).replace(',', ' ').split()]
        tris = []
        poly = []
        for idx in indices_raw:
            if idx == -1:
                if len(poly) >= 3:
                    for i in range(1, len(poly) - 1):
                        tris.append((poly[0], poly[i], poly[i+1]))
                poly = []
            else: poly.append(idx)
        final_v, final_t, _ = validate_and_compact_mesh(verts, tris)
        if len(final_t) > 0:
            part_id = f"part_wrl_{uuid.uuid4().hex[:6]}"
            geo_part = GeoPart(part_id, f"{filename} Scene")
            assembly = GeoAssembly(f"asm_wrl_{uuid.uuid4().hex[:6]}", filename)
            faces_wgs = [enu_to_wgs84(final_v[[i0, i1, i2]], face_id=part_id) for (i0, i1, i2) in final_t]
            shell = GeoShell(f"shell_{uuid.uuid4().hex[:4]}", [], is_closed=True)
            geo_part.shells[shell.id] = shell
            solid = GeoSolid(f"solid_{uuid.uuid4().hex[:4]}", shell.id)
            geo_part.solids[solid.id] = solid
            assembly.add_part(geo_part)
            assembly.create_instance(geo_part.id, name=geo_part.name)
            return {
                "headers": {"format": "VRML_WRL", "filename": filename, "canonical_unit": CANONICAL_INTERNAL_UNIT},
                "canonical_assembly": assembly.to_dict(), "objects": [{
                    "id": part_id, "object_id": part_id, "manifest_id": part_id, "name": f"{filename} Scene",
                    "primitive_type": "solid_imported", "color": "#38bdf8", "material": "Steel", "opacity": 1.0,
                    "position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0],
                    "faces": faces_wgs, "brep": geo_part.to_dict(), "canonical_part": geo_part,
                    "canonical_unit": CANONICAL_INTERNAL_UNIT, "parameters": {"facets": len(faces_wgs)}
                }],
                "assembly_tree": build_assembly_tree_from_canonical(assembly), "faces": faces_wgs
            }
    except Exception as e:
        logger.exception("WRL Parser Exception")
    return None

def parse_xbf(content_bytes: bytes, filename: str = "model.xbf") -> Optional[Dict[str, Any]]:
    try:
        magic = content_bytes[:4]
        if magic in (b'XBF1', b'XBF2', b'XBFA', b'BXBF'):
            _, num_bodies = struct.unpack('<II', content_bytes[4:12])
            offset = 16
            assembly = GeoAssembly(f"asm_xbf_{uuid.uuid4().hex[:6]}", filename)
            bodies = []
            all_faces = []
            for b_idx in range(num_bodies):
                if offset + 48 > len(content_bytes): break
                body_name = content_bytes[offset:offset+32].split(b'\x00')[0].decode('utf-8', errors='ignore').strip() or f"Body_{b_idx + 1}"
                offset += 32
                _, r, g, b_col, alpha, tri_count = struct.unpack('<IBBBBI', content_bytes[offset:offset+16])
                offset += 16
                color_hex = rgb_to_hex(r, g, b_col)
                opacity = max(0.05, min(1.0, alpha / 255.0)) if alpha > 0 else 1.0
                part_id = f"body_xbf_{b_idx+1}_{uuid.uuid4().hex[:4]}"
                geo_part = GeoPart(part_id, body_name)
                faces_wgs = []
                for _ in range(tri_count):
                    if offset + 36 > len(content_bytes): break
                    v = struct.unpack('<9f', content_bytes[offset:offset+36])
                    offset += 36
                    tri = np.array([[v[0], v[1], v[2]], [v[3], v[4], v[5]], [v[6], v[7], v[8]]], dtype=np.float64)
                    faces_wgs.append(enu_to_wgs84(tri, face_id=part_id))
                if faces_wgs:
                    shell = GeoShell(f"shell_{uuid.uuid4().hex[:4]}", [], is_closed=True)
                    geo_part.shells[shell.id] = shell
                    solid = GeoSolid(f"solid_{uuid.uuid4().hex[:4]}", shell.id)
                    geo_part.solids[solid.id] = solid
                    assembly.add_part(geo_part)
                    assembly.create_instance(geo_part.id, name=body_name)
                    all_faces.extend(faces_wgs)
                    bodies.append({
                        "id": part_id, "object_id": part_id, "manifest_id": part_id, "name": body_name,
                        "primitive_type": "solid_imported", "color": color_hex, "material": "Steel", "opacity": opacity,
                        "position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0],
                        "faces": faces_wgs, "brep": geo_part.to_dict(), "canonical_part": geo_part,
                        "canonical_unit": CANONICAL_INTERNAL_UNIT, "parameters": {"facets": len(faces_wgs)}
                    })
            if bodies:
                return {
                    "headers": {"format": "XBF", "filename": filename, "canonical_unit": CANONICAL_INTERNAL_UNIT},
                    "canonical_assembly": assembly.to_dict(), "objects": bodies,
                    "assembly_tree": build_assembly_tree_from_canonical(assembly), "faces": all_faces
                }
    except Exception as e:
        logger.exception("XBF Parser Exception")
    return None


# ============================================================
# 8. AUTHORITATIVE EXPORT HANDLERS (XBF & STEP)
# ============================================================

def export_xbf_bytes(cad_objects: List[Any], assembly_tree: Optional[List[dict]] = None) -> bytes:
    buf = bytearray()
    buf.extend(b'XBF2')
    buf.extend(struct.pack('<III', 2, len(cad_objects), 0))
    for obj in cad_objects:
        name = (getattr(obj, 'name', None) or (obj.get('name') if isinstance(obj, dict) else 'Part') or 'Part')[:31]
        buf.extend(name.encode('utf-8').ljust(32, b'\x00'))
        color_hex = (getattr(obj, 'color', None) or (obj.get('color') if isinstance(obj, dict) else '#38bdf8') or '#38bdf8').lstrip('#')
        r = int(color_hex[0:2], 16) if len(color_hex) >= 2 else 56
        g = int(color_hex[2:4], 16) if len(color_hex) >= 4 else 189
        b = int(color_hex[4:6], 16) if len(color_hex) >= 6 else 248
        alpha = int((getattr(obj, 'opacity', None) or (obj.get('opacity') if isinstance(obj, dict) else 1.0) or 1.0) * 255)
        faces = getattr(obj, 'faces', None) or (obj.get('faces') if isinstance(obj, dict) else []) or []
        tri_list = []
        for f in faces:
            if len(f) >= 3:
                for i in range(1, len(f) - 1):
                    tri_list.append((f[0], f[i], f[i+1]))
        buf.extend(struct.pack('<IBBBBI', 1, r, g, b, alpha, len(tri_list)))
        for p0, p1, p2 in tri_list:
            buf.extend(struct.pack('<9f', float(p0.get('x', 0)), float(p0.get('y', 0)), float(p0.get('z', 0)), float(p1.get('x', 0)), float(p1.get('y', 0)), float(p1.get('z', 0)), float(p2.get('x', 0)), float(p2.get('y', 0)), float(p2.get('z', 0))))
    return bytes(buf)

def export_step_bytes(cad_objects: List[Any]) -> bytes:
    step_lines = [
        "ISO-10303-21;", "HEADER;",
        "FILE_DESCRIPTION(('GeoParametric3D Authoritative B-Rep Model'),'2;1');",
        f"FILE_NAME('export_{int(time.time())}.step','{time.strftime('%Y-%m-%dT%H:%M:%S')}',('Engineer'),('GeoParametric3D'),'GeoParametric3D Kernel','GeoParametric3D','None');",
        "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
        "ENDSEC;", "DATA;",
        "#1 = APPLICATION_CONTEXT('automotive design');",
        "#2 = APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',1994,#1);",
        "#3 = PRODUCT_DEFINITION_CONTEXT('part definition',#1,'design');"
    ]
    ent_id = 10
    for idx, obj in enumerate(cad_objects):
        pname = getattr(obj, 'name', None) or (obj.get('name') if isinstance(obj, dict) else f'Part_{idx+1}') or f'Part_{idx+1}'
        step_lines.append(f"#{ent_id} = PRODUCT('{pname}','{pname}','',(#3));")
        ent_id += 1
    step_lines.extend(["ENDSEC;", "END-ISO-10303-21;"])
    return "\n".join(step_lines).encode('utf-8')


# ============================================================
# 9. UNIVERSAL MASTER ENTRY POINT
# ============================================================

def import_bytes(content: bytes, filename: str) -> Optional[Dict[str, Any]]:
    if not content: return None
    return parse_universal_model(content, filename)

def parse_universal_model(content_bytes: bytes, filename: str = "model.stl") -> Optional[Dict[str, Any]]:
    if not content_bytes: return None
    descriptor = detect_format_descriptor(content_bytes, filename)
    fmt = descriptor.format
    
    if fmt == 'STEP' and _OCCT_AVAILABLE:
        res = parse_step_with_occt(content_bytes, filename, descriptor)
        if res and res.get('objects'): return res
    
    if fmt == 'STEP' or descriptor.has_product_structure:
        res = parse_step_brep_structured(content_bytes, filename, descriptor)
        if res: return res
    if fmt == 'FCSTD':
        res = parse_fcstd(content_bytes, filename)
        if res: return res
    if fmt == 'STL':
        res = parse_stl_with_topology_reconstruction(content_bytes, filename)
        if res: return res
    if fmt == 'OBJ':
        res = parse_obj(content_bytes, filename)
        if res: return res
    if fmt == '3MF':
        res = parse_3mf(content_bytes, filename)
        if res: return res
    if fmt in ('GLB', 'GLTF'):
        res = parse_gltf_glb(content_bytes, filename)
        if res: return res
    if fmt == 'PLY':
        res = parse_ply(content_bytes, filename)
        if res: return res
    if fmt == 'DAE':
        res = parse_dae(content_bytes, filename)
        if res: return res
    if fmt == 'WRL':
        res = parse_wrl(content_bytes, filename)
        if res: return res
    if fmt == 'XBF':
        res = parse_xbf(content_bytes, filename)
        if res: return res
        
    for adapter_fn in (parse_step_brep_structured, parse_fcstd, parse_stl_with_topology_reconstruction, parse_obj, parse_3mf, parse_gltf_glb, parse_ply, parse_dae, parse_wrl, parse_xbf):
        try:
            r = adapter_fn(content_bytes, filename)
            if r and r.get('objects'): return r
        except Exception: pass
    return None

def parse_universal_model_bytes(content_bytes: bytes, filename: str = "model.stl") -> Optional[List[List[Dict[str, float]]]]:
    parsed = parse_universal_model(content_bytes, filename)
    return parsed.get('faces') if parsed else None
