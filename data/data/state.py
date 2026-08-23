"""
GeoParametric3D Authoritative CAD Document & Assembly State Store
"""
import time
import copy
import uuid
from typing import Dict, List, Any, Optional
import numpy as np
from geometry import generate_geometry, compute_object_volume, MATERIAL_DENSITIES, DEFAULT_12_INCH_MM
from universal_byte_parser import CANONICAL_INTERNAL_UNIT, compute_bounding_box


class CADObject:
    def __init__(
        self,
        object_id: str,
        name: str,
        primitive_type: str,
        parameters: Optional[dict] = None,
        position: Optional[list] = None,
        rotation: Optional[list] = None,
        scale: Optional[list] = None,
        color: str = '#38bdf8',
        visible: bool = True,
        material: str = 'Steel',
        faces: Optional[list] = None,
        opacity: float = 1.0,
        sub_elements: Optional[dict] = None,
        brep: Optional[dict] = None,
        bounding_box: Optional[dict] = None
    ):
        self.object_id = object_id
        self.manifest_id = object_id
        self.name = name
        self.primitive_type = primitive_type
        self.parameters = parameters or {}
        self.position = position or [0.0, 0.0, 0.0]
        self.rotation = rotation or [0.0, 0.0, 0.0]
        self.scale = scale or [1.0, 1.0, 1.0]
        self.color = color
        self.visible = visible
        self.material = material
        self.opacity = float(opacity)
        self.created_at = time.time()
        self.updated_at = time.time()
        self.faces = faces if faces is not None else generate_geometry(primitive_type, self.parameters, self.position, self.rotation)
        self.sub_elements = sub_elements or {"vertices": [], "edges": [], "loops": []}
        self.brep = brep or {}
        self.bounding_box = bounding_box or {}

    def get_volume_cm3(self) -> float:
        return float(compute_object_volume(self.primitive_type, self.parameters) / 1000.0)

    def get_mass_grams(self) -> float:
        return float(self.get_volume_cm3() * MATERIAL_DENSITIES.get(self.material, 7.85))

    def compute_bounds(self) -> dict:
        if self.faces:
            pts = [[p.get('x', 0.0), p.get('y', 0.0), p.get('z', 0.0)] for f in self.faces for p in f]
            if pts:
                self.bounding_box = compute_bounding_box(np.array(pts, dtype=np.float64))
        return self.bounding_box

    def to_dict(self) -> dict:
        return {
            "id": self.object_id,
            "object_id": self.object_id,
            "manifest_id": self.manifest_id,
            "name": self.name,
            "primitive_type": self.primitive_type,
            "geometry_type": self.primitive_type,
            "parameters": self.parameters,
            "position": self.position,
            "rotation": self.rotation,
            "scale": self.scale,
            "color": self.color,
            "visible": self.visible,
            "material": self.material,
            "opacity": self.opacity,
            "volume_cm3": round(self.get_volume_cm3(), 2),
            "mass_grams": round(self.get_mass_grams(), 2),
            "faces": self.faces,
            "sub_elements": self.sub_elements,
            "brep": self.brep,
            "bounding_box": self.bounding_box or self.compute_bounds(),
            "canonical_unit": CANONICAL_INTERNAL_UNIT,
            "created_at": self.created_at,
            "updated_at": self.updated_at
        }


class CADState:
    def __init__(self, project_id: Optional[str] = None, name: str = "CascadeCAD Document"):
        self.project_id = project_id or str(uuid.uuid4())
        self.name = name
        self.objects: Dict[str, CADObject] = {}
        self.assembly_tree: List[dict] = []
        self.canonical_unit: str = CANONICAL_INTERNAL_UNIT
        self.user_display_unit: str = "mm"
        self.updated_at = time.time()
        self.undo_stack: List[dict] = []
        self.redo_stack: List[dict] = []
        self.metadata: Dict[str, Any] = {}
        self._init_defaults()

    def _init_defaults(self):
        box = CADObject(
            "obj_box_1",
            "Base Solid (12-Inch Block)",
            "box",
            {"width": DEFAULT_12_INCH_MM, "height": DEFAULT_12_INCH_MM, "depth": DEFAULT_12_INCH_MM},
            [0.0, 0.0, 0.0],
            color="#38bdf8",
            material="Steel",
            opacity=1.0
        )
        self.objects[box.object_id] = box
        self.assembly_tree = [{
            "id": box.object_id,
            "manifest_id": box.object_id,
            "name": box.name,
            "objectId": box.object_id,
            "type": "PartInstance",
            "structure_type": "SOURCE_BODY",
            "children": []
        }]

    def _capture_snapshot(self) -> dict:
        return {
            "objects": {oid: copy.deepcopy(obj) for oid, obj in self.objects.items()},
            "assembly_tree": copy.deepcopy(self.assembly_tree),
            "metadata": copy.deepcopy(self.metadata)
        }

    def _restore_snapshot(self, snapshot: dict):
        self.objects = snapshot["objects"]
        self.assembly_tree = snapshot.get("assembly_tree", [])
        self.metadata = snapshot.get("metadata", {})
        self.updated_at = time.time()

    def save_snapshot(self):
        self.undo_stack.append(self._capture_snapshot())
        if len(self.undo_stack) > 50:
            self.undo_stack.pop(0)
        self.redo_stack.clear()

    def undo(self) -> bool:
        if not self.undo_stack:
            return False
        self.redo_stack.append(self._capture_snapshot())
        self._restore_snapshot(self.undo_stack.pop())
        return True

    def redo(self) -> bool:
        if not self.redo_stack:
            return False
        self.undo_stack.append(self._capture_snapshot())
        self._restore_snapshot(self.redo_stack.pop())
        return True

    def add_object(self, obj: CADObject) -> CADObject:
        self.objects[obj.object_id] = obj
        self.updated_at = time.time()
        if not any(node.get('objectId') == obj.object_id for node in self.assembly_tree):
            self.assembly_tree.append({
                "id": obj.object_id,
                "manifest_id": obj.object_id,
                "name": obj.name,
                "objectId": obj.object_id,
                "type": "PartInstance",
                "structure_type": obj.parameters.get("structure_type", "SOURCE_BODY"),
                "children": []
            })
        return obj

    def remove_object(self, object_id: str) -> bool:
        if object_id in self.objects:
            del self.objects[object_id]
            def filter_tree(nodes):
                res = []
                for n in nodes:
                    nid = n.get('objectId') or n.get('id') or n.get('manifest_id')
                    if nid == object_id:
                        continue
                    if 'children' in n and isinstance(n['children'], list):
                        n['children'] = filter_tree(n['children'])
                    res.append(n)
                return res
            self.assembly_tree = filter_tree(self.assembly_tree)
            self.updated_at = time.time()
            return True
        return False

    def get_object(self, object_id: str) -> Optional[CADObject]:
        return self.objects.get(object_id)

    def clear(self):
        self.objects.clear()
        self.assembly_tree = []
        self.metadata = {}
        self.updated_at = time.time()

    def from_dict(self, doc: dict):
        if not doc:
            return
        self.project_id = doc.get("project_id", str(uuid.uuid4()))
        self.name = doc.get("name", "CascadeCAD Document")
        self.canonical_unit = doc.get("canonical_unit", CANONICAL_INTERNAL_UNIT)
        self.user_display_unit = doc.get("user_display_unit", "mm")
        self.metadata = doc.get("metadata", doc.get("headers", {}))
        self.clear()
        for obj_dict in doc.get("objects", []):
            oid = obj_dict.get("id") or obj_dict.get("manifest_id") or f"obj_{uuid.uuid4().hex[:6]}"
            cad_obj = CADObject(
                object_id=oid,
                name=obj_dict.get("name", "Part"),
                primitive_type=obj_dict.get("primitive_type", "box"),
                parameters=obj_dict.get("parameters", {}),
                position=obj_dict.get("position", [0, 0, 0]),
                rotation=obj_dict.get("rotation", [0, 0, 0]),
                scale=obj_dict.get("scale", [1, 1, 1]),
                color=obj_dict.get("color", "#38bdf8"),
                visible=obj_dict.get("visible", True),
                material=obj_dict.get("material", "Steel"),
                faces=obj_dict.get("faces"),
                opacity=obj_dict.get("opacity", 1.0),
                sub_elements=obj_dict.get("sub_elements"),
                brep=obj_dict.get("brep"),
                bounding_box=obj_dict.get("bounding_box")
            )
            self.objects[oid] = cad_obj
        self.assembly_tree = doc.get("assemblyTree", doc.get("assembly_tree", []))
        self.updated_at = time.time()

    def to_dict(self) -> dict:
        return {
            "project_id": self.project_id,
            "name": self.name,
            "canonical_unit": self.canonical_unit,
            "user_display_unit": self.user_display_unit,
            "updated_at": self.updated_at,
            "metadata": self.metadata,
            "objects": [obj.to_dict() for obj in self.objects.values()],
            "assemblyTree": self.assembly_tree
        }


global_cad_state = CADState()
