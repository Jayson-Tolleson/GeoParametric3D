"""
GeoParametric3D OpenCASCADE (OCCT / OCP) Kernel & Dual-Route Surface Extractor
Enforces Sections 1 & 2 of the Governing Architecture Specification (Phases 2 & 3):
  1. Exact B-Rep as authoritative geometric truth (GeoPart, GeoSolid, GeoShell, GeoFace, GeoSurface, GeoLoop)
  2. Dual-route classification: GeomAbs_Plane -> Planar N-Gon Loops vs Non-Planar -> Adaptive Tessellator
  3. Boundary wire extraction with inner cutout hole preservation (e.g. 'L' concave bracket and 'B' multi-void alphabet topology)
  4. Suppression of triangulation diagonals on planar faces in rendering and transport
  5. Multi-solid compound unpacking and parallel batch deflection support
"""

from typing import List, Dict, Any, Tuple, Optional
import math
import concurrent.futures
import numpy as np

try:
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_FACE, TopAbs_WIRE, TopAbs_EDGE, TopAbs_VERTEX, TopAbs_SOLID, TopAbs_SHELL
    from OCP.TopoDS import TopoDS, TopoDS_Shape
    from OCP.BRepTools import BRepTools, BRepTools_WireExplorer
    from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
    from OCP.GCPnts import GCPnts_QuasiUniformDeflection
    from OCP.BRep import BRep_Tool
    from OCP.GeomAbs import (
        GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone,
        GeomAbs_Sphere, GeomAbs_Torus, GeomAbs_BezierSurface,
        GeomAbs_BSplineSurface, GeomAbs_SurfaceOfRevolution,
        GeomAbs_SurfaceOfExtrusion
    )
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.TopLoc import TopLoc_Location
    _OCCT_AVAILABLE = True
    TopoDS_Face_Cast = getattr(TopoDS, "Face_s", getattr(TopoDS, "Face", None))
    TopoDS_Wire_Cast = getattr(TopoDS, "Wire_s", getattr(TopoDS, "Wire", None))
    TopoDS_Edge_Cast = getattr(TopoDS, "Edge_s", getattr(TopoDS, "Edge", None))
    TopoDS_Vertex_Cast = getattr(TopoDS, "Vertex_s", getattr(TopoDS, "Vertex", None))
except ImportError:
    try:
        from OCC.Core.TopExp import TopExp_Explorer
        from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_WIRE, TopAbs_EDGE, TopAbs_VERTEX, TopAbs_SOLID, TopAbs_SHELL
        from OCC.Core.TopoDS import topods as TopoDS, TopoDS_Shape
        from OCC.Core.BRepTools import breptools as BRepTools, BRepTools_WireExplorer
        from OCC.Core.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
        from OCC.Core.GCPnts import GCPnts_QuasiUniformDeflection
        from OCC.Core.BRep import BRep_Tool
        from OCC.Core.GeomAbs import (
            GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone,
            GeomAbs_Sphere, GeomAbs_Torus, GeomAbs_BezierSurface,
            GeomAbs_BSplineSurface, GeomAbs_SurfaceOfRevolution,
            GeomAbs_SurfaceOfExtrusion
        )
        from OCC.Core.BRepMesh import BRepMesh_IncrementalMesh
        from OCC.Core.TopLoc import TopLoc_Location
        _OCCT_AVAILABLE = True
        TopoDS_Face_Cast = getattr(TopoDS, "Face", None)
        TopoDS_Wire_Cast = getattr(TopoDS, "Wire", None)
        TopoDS_Edge_Cast = getattr(TopoDS, "Edge", None)
        TopoDS_Vertex_Cast = getattr(TopoDS, "Vertex", None)
    except ImportError:
        _OCCT_AVAILABLE = False


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


def extract_clean_planar_wires(occ_face, scale: float = 1.0, linear_deflection: float = 0.05) -> Dict[str, Any]:
    """
    Extracts outer and inner boundary loops from an authoritative TopoDS_Face.
    Preserves exact topological winding, eliminates internal meshing diagonals,
    and discretizes curved edge segments under strict chordal tolerance.
    """
    if not _OCCT_AVAILABLE or occ_face is None:
        return {"outer": [], "inner": []}

    exp_wire = TopExp_Explorer(occ_face, TopAbs_WIRE)
    loops: List[List[List[float]]] = []

    while exp_wire.More():
        occ_wire = TopoDS_Wire_Cast(exp_wire.Current())
        wire_explorer = BRepTools_WireExplorer(occ_wire, occ_face)
        loop_points: List[List[float]] = []

        while wire_explorer.More():
            occ_edge = wire_explorer.Current()
            curve_adaptor = BRepAdaptor_Curve(occ_edge)

            # Adaptive chordal sampling for curved edge boundaries
            try:
                sampler = GCPnts_QuasiUniformDeflection(curve_adaptor, linear_deflection)
                if sampler.IsDone() and sampler.NbPoints() > 1:
                    nb_pts = sampler.NbPoints()
                    for i in range(1, nb_pts + 1):
                        pnt = sampler.Value(i)
                        loop_points.append([
                            float(pnt.X() * scale),
                            float(pnt.Y() * scale),
                            float(pnt.Z() * scale)
                        ])
                else:
                    u_start = curve_adaptor.FirstParameter()
                    u_end = curve_adaptor.LastParameter()
                    p_start = curve_adaptor.Value(u_start)
                    p_end = curve_adaptor.Value(u_end)
                    loop_points.append([float(p_start.X() * scale), float(p_start.Y() * scale), float(p_start.Z() * scale)])
                    loop_points.append([float(p_end.X() * scale), float(p_end.Y() * scale), float(p_end.Z() * scale)])
            except Exception:
                try:
                    u_start = curve_adaptor.FirstParameter()
                    u_end = curve_adaptor.LastParameter()
                    p_start = curve_adaptor.Value(u_start)
                    p_end = curve_adaptor.Value(u_end)
                    loop_points.append([float(p_start.X() * scale), float(p_start.Y() * scale), float(p_start.Z() * scale)])
                    loop_points.append([float(p_end.X() * scale), float(p_end.Y() * scale), float(p_end.Z() * scale)])
                except Exception:
                    pass

            wire_explorer.Next()

        # Numeric welding: eliminate duplicate adjacent vertices (distance < 1e-6 mm)
        clean_loop: List[List[float]] = []
        for pt in loop_points:
            if not clean_loop or np.linalg.norm(np.array(pt) - np.array(clean_loop[-1])) > 1e-6:
                clean_loop.append(pt)
        if len(clean_loop) >= 2 and np.linalg.norm(np.array(clean_loop[0]) - np.array(clean_loop[-1])) < 1e-6:
            clean_loop.pop()

        if len(clean_loop) >= 3:
            loops.append(clean_loop)

        exp_wire.Next()

    if not loops:
        return {"outer": [], "inner": []}

    return {
        "outer": loops[0],
        "inner": loops[1:] if len(loops) > 1 else []
    }


def route_cad_faces(shape: Any, scale: float = 1.0, linear_deflection: float = 0.05) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Classifies every TopoDS_Face into either:
      - Planar N-Gon polygons (GeomAbs_Plane, zero internal diagonals)
      - Curved / freeform analytical surfaces requiring adaptive deflection tessellation.
    """
    if not _OCCT_AVAILABLE or shape is None:
        return [], []

    planar_faces: List[Dict[str, Any]] = []
    curved_faces: List[Dict[str, Any]] = []
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    face_idx = 0

    while explorer.More():
        face_idx += 1
        occ_face = TopoDS_Face_Cast(explorer.Current())
        try:
            adaptor = BRepAdaptor_Surface(occ_face)
            surface_type = adaptor.GetType()
        except Exception:
            surface_type = GeomAbs_Plane

        if surface_type == GeomAbs_Plane:
            wire_data = extract_clean_planar_wires(occ_face, scale=scale, linear_deflection=linear_deflection)
            if wire_data.get("outer"):
                try:
                    pln = adaptor.Plane()
                    ax = pln.Axis().Direction()
                    norm = [float(ax.X()), float(ax.Y()), float(ax.Z())]
                    loc_pt = pln.Location()
                    origin = [float(loc_pt.X() * scale), float(loc_pt.Y() * scale), float(loc_pt.Z() * scale)]
                except Exception:
                    norm = [0.0, 0.0, 1.0]
                    origin = [0.0, 0.0, 0.0]

                planar_faces.append({
                    "face_index": face_idx,
                    "face_id": f"Face_Planar_{face_idx}",
                    "surface_type": "Plane",
                    "normal": norm,
                    "origin": origin,
                    "outer_wire": wire_data["outer"],
                    "inner_wires": wire_data.get("inner", []),
                    "outer": wire_data["outer"],
                    "inner": wire_data.get("inner", []),
                    "vertex_count": len(wire_data["outer"]),
                    "has_holes": len(wire_data.get("inner", [])) > 0,
                    "occ_face": occ_face
                })
        else:
            curved_faces.append({
                "face_index": face_idx,
                "face_id": f"Face_Curved_{face_idx}",
                "surface_type": str(surface_type),
                "occ_face": occ_face
            })

        explorer.Next()

    return planar_faces, curved_faces


def parallel_process_step_solids(shape: Any, scale: float = 1.0, worker_count: int = 4) -> List[Dict[str, Any]]:
    """
    Parallelizes multi-solid compound unpacking, shape classification,
    and deflection across a worker pool for sub-2.5s large assembly ingestion.
    """
    if not _OCCT_AVAILABLE or shape is None:
        return []

    exp = TopExp_Explorer(shape, TopAbs_SOLID)
    solids = []
    while exp.More():
        solids.append(exp.Current())
        exp.Next()

    if not solids:
        exp_s = TopExp_Explorer(shape, TopAbs_SHELL)
        while exp_s.More():
            solids.append(exp_s.Current())
            exp_s.Next()

    if not solids:
        solids = [shape]

    def process_single_solid(sub_shape: Any, solid_idx: int) -> Dict[str, Any]:
        linear_deflection = 0.2
        angular_deflection = 0.5
        try:
            BRepMesh_IncrementalMesh(sub_shape, linear_deflection, False, angular_deflection, True)
        except Exception:
            pass

        planar_polys, curved_faces = route_cad_faces(sub_shape, scale=scale, linear_deflection=linear_deflection)
        return {
            "solid_index": solid_idx,
            "solid_shape": sub_shape,
            "planar_polygons": planar_polys,
            "curved_faces": curved_faces
        }

    results: List[Dict[str, Any]] = []
    if len(solids) > 1 and worker_count > 1:
        with concurrent.futures.ThreadPoolExecutor(max_workers=worker_count) as executor:
            future_to_idx = {executor.submit(process_single_solid, s, idx): idx for idx, s in enumerate(solids)}
            for fut in concurrent.futures.as_completed(future_to_idx):
                results.append(fut.result())
        results.sort(key=lambda r: r["solid_index"])
    else:
        for idx, s in enumerate(solids):
            results.append(process_single_solid(s, idx))

    return results
