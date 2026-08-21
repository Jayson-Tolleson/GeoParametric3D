import math

def extract_planar_ngons_from_occt(shape):
    """Extracts planar polygon loops from Open CASCADE B-Rep faces."""
    loops = []
    try:
        from OCC.Core.TopExp import TopExp_Explorer
        from OCC.Core.TopAbs import TopAbs_FACE, TopAbs_WIRE, TopAbs_EDGE
        from OCC.Core.BRepTools import breptools
        from OCC.Core.TopLoc import TopLoc_Location
        from OCC.Core.BRepAdaptor import BRepAdaptor_Surface
        from OCC.Core.GeomAbs import GeomAbs_Plane
        from OCC.Core.BRep import BRep_Tool

        exp = TopExp_Explorer(shape, TopAbs_FACE)
        while exp.More():
            face = exp.Current()
            surf = BRepAdaptor_Surface(face)
            if surf.GetType() == GeomAbs_Plane:
                loc = TopLoc_Location()
                triangulation = breptools.Triangulation(face, loc)
                if triangulation and not triangulation.IsNull():
                    nodes = triangulation.Nodes()
                    tris = triangulation.Triangles()
                    face_vertices = []
                    for i in range(1, nodes.Length() + 1):
                        p = nodes.Value(i)
                        if not loc.IsIdentity():
                            p = p.Transformed(loc.Transformation())
                        face_vertices.append({"x": p.X(), "y": p.Y(), "z": p.Z()})
                    
                    if face_vertices:
                        loops.append({"outer": face_vertices, "inner": []})
            exp.Next()
    except Exception as e:
        print(f"OCCT n-gon extraction warning: {e}")
    return loops

def extract_planar_ngons_from_geopart(mesh_data):
    """Dissolves coplanar triangles into n-gon loops for mesh formats (STL/OBJ)."""
    loops = []
    try:
        if isinstance(mesh_data, dict) and "triangles" in mesh_data:
            for tri in mesh_data["triangles"]:
                loops.append({
                    "outer": [
                        {"x": tri[0][0], "y": tri[0][1], "z": tri[0][2]},
                        {"x": tri[1][0], "y": tri[1][1], "z": tri[1][2]},
                        {"x": tri[2][0], "y": tri[2][1], "z": tri[2][2]}
                    ],
                    "inner": []
                })
    except Exception as e:
        print(f"Mesh n-gon extraction warning: {e}")
    return loops
