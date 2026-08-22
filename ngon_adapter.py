"""
GeoParametric3D N-Gon Adapter & Planar Boundary Dissolver
Converts planar B-Rep topological faces and coplanar polygonal meshes
into clean N-Gon perimeter and inner cutout loops for direct <gmp-polygon-3d> rendering
and zero-diagonal canvas visualization.
"""

import math
from typing import List, Dict, Any, Optional, Tuple, Set
import numpy as np

try:
    from occ_kernel import route_cad_faces, extract_clean_planar_wires, _OCCT_AVAILABLE
except ImportError:
    _OCCT_AVAILABLE = False
    route_cad_faces = None
    extract_clean_planar_wires = None


def extract_planar_ngons_from_occt(shape: Any, scale: float = 1.0, color: str = "#38bdf8") -> List[Dict[str, Any]]:
    """
    Extracts exact planar boundary loops with outer and inner cutout wires
    directly from OpenCASCADE TopoDS_Shape faces (GeomAbs_Plane).
    Eliminates all internal triangulation diagonals.
    """
    if not _OCCT_AVAILABLE or shape is None:
        return []
    
    if route_cad_faces is not None:
        try:
            planar_faces, _ = route_cad_faces(shape, scale=scale)
            ngon_loops = []
            for pf in planar_faces:
                ngon_loops.append({
                    "face_id": pf.get("face_id", "Face_Planar"),
                    "type": "N_GON_POLYGON_3D",
                    "color": color,
                    "normal": pf.get("normal", [0.0, 0.0, 1.0]),
                    "origin": pf.get("origin", [0.0, 0.0, 0.0]),
                    "outer": pf.get("outer", []),
                    "inner": pf.get("inner", []),
                    "outer_coordinates": pf.get("outer_coordinates", pf.get("outer", [])),
                    "inner_coordinates": pf.get("inner_coordinates", pf.get("inner", [])),
                    "has_holes": pf.get("has_holes", False)
                })
            return ngon_loops
        except Exception:
            pass
            
    return []


def dissolve_coplanar_triangles(vertices: np.ndarray, triangles: np.ndarray, normal_tolerance: float = 0.01) -> List[Dict[str, Any]]:
    """
    Dissolves adjacent coplanar triangles into clean outer/inner N-Gon boundary loops.
    Useful for imported mesh bodies to remove internal triangle diagonals on flat faces.
    """
    if len(vertices) == 0 or len(triangles) == 0:
        return []

    # 1. Compute per-triangle face normals and centroids
    p0 = vertices[triangles[:, 0]]
    p1 = vertices[triangles[:, 1]]
    p2 = vertices[triangles[:, 2]]
    cross = np.cross(p1 - p0, p2 - p0)
    areas = np.linalg.norm(cross, axis=1) * 0.5
    
    valid_tri_mask = areas > 1e-9
    if not np.any(valid_tri_mask):
        return []

    triangles = triangles[valid_tri_mask]
    cross = cross[valid_tri_mask]
    areas = areas[valid_tri_mask]
    normals = cross / (2.0 * areas[:, np.newaxis])
    
    # 2. Cluster coplanar connected triangles
    # Quantize normals for fast grouping
    normal_keys = np.round(normals, 2)
    clusters: Dict[Tuple[float, float, float], List[int]] = {}
    for idx, n_key in enumerate(normal_keys):
        key = (float(n_key[0]), float(n_key[1]), float(n_key[2]))
        clusters.setdefault(key, []).append(idx)

    ngon_results = []
    ngon_counter = 1

    for n_key, tri_indices in clusters.items():
        if len(tri_indices) == 0:
            continue

        cluster_tris = triangles[tri_indices]
        # Find boundary edges (edges that appear exactly once in the cluster)
        edge_counts: Dict[Tuple[int, int], int] = {}
        directed_edges: List[Tuple[int, int]] = []

        for tri in cluster_tris:
            for i in range(3):
                u, v = int(tri[i]), int(tri[(i + 1) % 3])
                undirected = tuple(sorted([u, v]))
                edge_counts[undirected] = edge_counts.get(undirected, 0) + 1
                directed_edges.append((u, v))

        boundary_directed = [e for e in directed_edges if edge_counts[tuple(sorted(e))] == 1]
        if not boundary_directed:
            continue

        # Build adjacency for boundary wire reconstruction
        adj: Dict[int, List[int]] = {}
        for u, v in boundary_directed:
            adj.setdefault(u, []).append(v)

        # Trace closed loops
        visited_edges: Set[Tuple[int, int]] = set()
        loops: List[List[List[float]]] = []

        for start_node in adj:
            for next_node in adj[start_node]:
                if (start_node, next_node) in visited_edges:
                    continue
                loop = [start_node]
                curr = next_node
                visited_edges.add((start_node, next_node))
                loop_closed = False

                while curr in adj:
                    loop.append(curr)
                    if curr == start_node:
                        loop_closed = True
                        break
                    found_next = False
                    for candidate in adj[curr]:
                        if (curr, candidate) not in visited_edges:
                            visited_edges.add((curr, candidate))
                            curr = candidate
                            found_next = True
                            break
                    if not found_next:
                        break

                if loop_closed and len(loop) >= 4:
                    # Remove duplicated closing vertex
                    loop_pts = vertices[loop[:-1]].tolist()
                    if len(loop_pts) >= 3:
                        loops.append(loop_pts)

        if loops:
            # Sort loops by bounding area (largest is outer, remainder are inner voids)
            loops.sort(key=lambda lp: len(lp), reverse=True)
            ngon_results.append({
                "face_id": f"Face_Planar_NGon_{ngon_counter}",
                "type": "N_GON_POLYGON_3D",
                "normal": list(n_key),
                "outer": loops[0],
                "inner": loops[1:] if len(loops) > 1 else [],
                "outer_coordinates": loops[0],
                "inner_coordinates": loops[1:] if len(loops) > 1 else [],
                "has_holes": len(loops) > 1
            })
            ngon_counter += 1

    return ngon_results


def extract_planar_ngons_from_geopart(mesh_data: Any, color: str = "#38bdf8") -> List[Dict[str, Any]]:
    """
    Extracts coplanar polygon loops from mesh structures or GeoPart dictionaries.
    """
    loops: List[Dict[str, Any]] = []
    try:
        if isinstance(mesh_data, dict):
            if "planar_polygons" in mesh_data and mesh_data["planar_polygons"]:
                return mesh_data["planar_polygons"]
            if "vertices" in mesh_data and "indices" in mesh_data:
                v = np.asarray(mesh_data["vertices"], dtype=np.float64)
                t = np.asarray(mesh_data["indices"], dtype=np.int32)
                dissolved = dissolve_coplanar_triangles(v, t)
                for d in dissolved:
                    d["color"] = color
                return dissolved
    except Exception:
        pass
    return loops
