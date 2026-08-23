"""
GeoParametric3D Command Engine
Processes CAD operations, parametric mutations, B-Rep instantiations, script execution, and Universal Imports.
"""
import uuid
import time
import json
import math
import copy
from typing import Dict, Any, Optional
from state import global_cad_state, CADObject
from geometry import generate_geometry, compute_object_volume, DEFAULT_12_INCH_MM
from universal_byte_parser import (
    import_bytes,
    export_xbf_bytes,
    export_step_bytes,
    parse_universal_model,
    parse_universal_model_bytes,
    CANONICAL_INTERNAL_UNIT
)
from canonical_geometry import GeometryPipelineException, GeometryPipelineStage

CAD_ALIASES = {
    'l': {'action': 'draft_tool', 'tool': 'line', 'description': 'Line'},
    'line': {'action': 'draft_tool', 'tool': 'line', 'description': 'Line'},
    'c': {'action': 'draft_tool', 'tool': 'circle', 'description': 'Circle'},
    'circle': {'action': 'draft_tool', 'tool': 'circle', 'description': 'Circle'},
    'rec': {'action': 'draft_tool', 'tool': 'rect', 'description': 'Rectangle'},
    'rect': {'action': 'draft_tool', 'tool': 'rect', 'description': 'Rectangle'},
    'rectangle': {'action': 'draft_tool', 'tool': 'rect', 'description': 'Rectangle'},
    'pl': {'action': 'draft_tool', 'tool': 'polyline', 'description': 'Polyline'},
    'pline': {'action': 'draft_tool', 'tool': 'polyline', 'description': 'Polyline'},
    'polyline': {'action': 'draft_tool', 'tool': 'polyline', 'description': 'Polyline'},
    'a': {'action': 'draft_tool', 'tool': 'arc', 'description': 'Arc'},
    'arc': {'action': 'draft_tool', 'tool': 'arc', 'description': 'Arc'},
    'el': {'action': 'draft_tool', 'tool': 'ellipse', 'description': 'Ellipse'},
    'ellipse': {'action': 'draft_tool', 'tool': 'ellipse', 'description': 'Ellipse'},
    'm': {'action': 'transform', 'transform': 'move', 'description': 'Move'},
    'move': {'action': 'transform', 'transform': 'move', 'description': 'Move'},
    'co': {'action': 'transform', 'transform': 'duplicate', 'description': 'Copy / Duplicate'},
    'cp': {'action': 'transform', 'transform': 'duplicate', 'description': 'Copy / Duplicate'},
    'copy': {'action': 'transform', 'transform': 'duplicate', 'description': 'Copy / Duplicate'},
    'ro': {'action': 'transform', 'transform': 'rotate', 'description': 'Rotate'},
    'rotate': {'action': 'transform', 'transform': 'rotate', 'description': 'Rotate'},
    'sc': {'action': 'transform', 'transform': 'scale', 'description': 'Scale'},
    'scale': {'action': 'transform', 'transform': 'scale', 'description': 'Scale'},
    'e': {'action': 'delete', 'description': 'Erase / Delete'},
    'erase': {'action': 'delete', 'description': 'Erase / Delete'},
    'del': {'action': 'delete', 'description': 'Delete'},
    'delete': {'action': 'delete', 'description': 'Delete'},
    'z': {'action': 'view', 'preset': 'fit', 'description': 'Zoom Fit'},
    'zoom': {'action': 'view', 'preset': 'fit', 'description': 'Zoom'},
    'i': {'action': 'import', 'description': 'Insert / Import File'},
    'insert': {'action': 'import', 'description': 'Insert / Import File'}
}

class ChatResponse:
    def __init__(self, text: str, requires_action: bool = False, action_intent: dict = None):
        self.text = text
        self.requires_action = requires_action
        self.action_intent = action_intent or {}

class CommandEngine:
    def __init__(self):
        self.state = global_cad_state

    def process_chat(self, message: str) -> ChatResponse:
        msg_low = message.lower().strip()
        if msg_low in CAD_ALIASES:
            alias = CAD_ALIASES[msg_low]
            return ChatResponse(
                text=f"Command: {alias['description']} ({msg_low.upper()}) activated.",
                requires_action=True,
                action_intent=alias
            )
        if "export python" in msg_low or "export cq" in msg_low or "download python" in msg_low:
            return ChatResponse(
                text="Generated CadQuery Python script for export.",
                requires_action=True,
                action_intent={"action": "export_python", "target_node": "AssemblyPart", "params": {}}
            )
        elif "fit view" in msg_low or "center view" in msg_low or "zoom fit" in msg_low or msg_low == "z":
            return ChatResponse(
                text="Aligning camera to fit document scene.",
                requires_action=True,
                action_intent={"action": "update_camera", "target_node": "camera", "params": {"view_name": "fit"}}
            )
        return ChatResponse(text="", requires_action=False)

    async def execute(self, command_data: dict) -> dict:
        cmd = command_data.get("command", "")
        params = command_data.get("parameters", {}) or command_data.get("params", {}) or {}

        try:
            if cmd == "undo":
                success = self.state.undo()
                return {
                    "ok": success,
                    "command": cmd,
                    "message": "Undo executed" if success else "Nothing to undo",
                    "document": self.state.to_dict()
                }

            elif cmd == "redo":
                success = self.state.redo()
                return {
                    "ok": success,
                    "command": cmd,
                    "message": "Redo executed" if success else "Nothing to redo",
                    "document": self.state.to_dict()
                }

            elif cmd.startswith("camera_"):
                preset = cmd.replace("camera_", "")
                cameras = {
                    "front": {"heading": 0, "tilt": 90},
                    "back": {"heading": 180, "tilt": 90},
                    "left": {"heading": 270, "tilt": 90},
                    "right": {"heading": 90, "tilt": 90},
                    "side": {"heading": 90, "tilt": 90},
                    "top": {"heading": 0, "tilt": 1},
                    "bottom": {"heading": 0, "tilt": 179},
                    "iso": {"heading": 45, "tilt": 54.7356},
                    "fit": {"fit": True}
                }
                cam_data = cameras.get(preset, {"heading": 30, "tilt": 65})
                return {
                    "ok": True,
                    "command": cmd,
                    "preset": preset,
                    "camera": cam_data,
                    "document": self.state.to_dict()
                }

            elif cmd in ("create_primitive", "create_box", "create_cylinder", "create_sphere", "create_cone", "create_torus", "create_prism", "create_pyramid", "create_wedge", "create_ellipsoid", "create_tube", "create_plane", "create_cross_sections", "create_polygon", "create_ellipse", "create_line", "create_polyline", "create_rect", "create_circle", "create_arc"):
                self.state.save_snapshot()
                primitive = params.get("primitive", params.get("type", "box"))
                if cmd.startswith("create_") and cmd != "create_primitive":
                    primitive = cmd.replace("create_", "")

                name = params.get("name", f"New {primitive.capitalize()} (12\" / 1')")
                obj_id = params.get("id", params.get("manifest_id", f"obj_{primitive}_{uuid.uuid4().hex[:6]}"))
                pos = params.get("position", [0.0, 0.0, 0.0])
                rot = params.get("rotation", [0.0, 0.0, 0.0])
                scale = params.get("scale", [1.0, 1.0, 1.0])
                color = params.get("color", "#38bdf8")
                material = params.get("material", "Steel")
                opacity = float(params.get("opacity", 1.0))

                shape_params = params.get("parameters", params)
                cad_obj = CADObject(
                    object_id=obj_id,
                    name=name,
                    primitive_type=primitive,
                    parameters=shape_params,
                    position=pos,
                    rotation=rot,
                    scale=scale,
                    color=color,
                    material=material,
                    opacity=opacity
                )
                faces = generate_geometry(primitive, cad_obj.parameters, [0.0, 0.0, 0.0], [0.0, 0.0, 0.0])
                cad_obj.faces = faces
                self.state.add_object(cad_obj)

                return {
                    "ok": True,
                    "success": True,
                    "command": cmd,
                    "cad_obj": cad_obj.to_dict(),
                    "object": cad_obj.to_dict(),
                    "faces": faces,
                    "document": self.state.to_dict()
                }

            elif cmd in ("delete_object", "manifest_delete", "erase"):
                self.state.save_snapshot()
                ids = params.get("ids") or ([params.get("id")] if params.get("id") else ([params.get("manifest_id")] if params.get("manifest_id") else []))
                if not ids and len(self.state.objects) > 0:
                    ids = [list(self.state.objects.keys())[-1]]
                for obj_id in ids:
                    if obj_id:
                        self.state.remove_object(obj_id)
                return {
                    "ok": True,
                    "success": True,
                    "command": cmd,
                    "deleted_ids": ids,
                    "document": self.state.to_dict()
                }

            elif cmd in ("toggle_visibility", "manifest_hide"):
                self.state.save_snapshot()
                ids = params.get("ids") or ([params.get("id")] if params.get("id") else ([params.get("manifest_id")] if params.get("manifest_id") else []))
                if not ids and len(self.state.objects) > 0:
                    ids = [list(self.state.objects.keys())[-1]]
                toggled = []
                for obj_id in ids:
                    obj = self.state.get_object(obj_id)
                    if obj:
                        obj.visible = not obj.visible
                        obj.updated_at = time.time()
                        toggled.append(obj.object_id)
                return {
                    "ok": True,
                    "success": True,
                    "command": cmd,
                    "toggled_ids": toggled,
                    "hidden": not self.state.get_object(ids[0]).visible if (ids and self.state.get_object(ids[0])) else False,
                    "document": self.state.to_dict()
                }

            elif cmd in ("set_property", "update_object", "manifest_properties"):
                self.state.save_snapshot()
                obj_id = params.get("id") or params.get("object_id") or params.get("manifest_id")
                obj = self.state.get_object(obj_id)
                if not obj:
                    return {"ok": False, "success": False, "error": f"Object {obj_id} not found", "command": cmd}

                if "name" in params:
                    obj.name = str(params["name"])
                if "color" in params:
                    obj.color = str(params["color"])
                if "material" in params:
                    obj.material = str(params["material"])
                if "visible" in params:
                    obj.visible = bool(params["visible"])
                if "opacity" in params:
                    obj.opacity = max(0.0, min(1.0, float(params["opacity"])))
                if "position" in params:
                    obj.position = [float(v) for v in params["position"]]
                if "rotation" in params:
                    obj.rotation = [float(v) for v in params["rotation"]]
                if "scale" in params:
                    obj.scale = [float(v) for v in params["scale"]]
                if "parameters" in params:
                    obj.parameters.update(params["parameters"])
                    obj.faces = generate_geometry(obj.primitive_type, obj.parameters, [0.0, 0.0, 0.0], [0.0, 0.0, 0.0])
                obj.updated_at = time.time()

                return {
                    "ok": True,
                    "success": True,
                    "command": cmd,
                    "object": obj.to_dict(),
                    "manifest_id": obj_id,
                    "faces": obj.faces,
                    "document": self.state.to_dict()
                }

            elif cmd in ("transform_object", "manifest_transform"):
                self.state.save_snapshot()
                target_ids = params.get("ids") or ([params.get("id")] if params.get("id") else ([params.get("manifest_id")] if params.get("manifest_id") else ([params.get("target_id")] if params.get("target_id") else [])))
                if not target_ids and len(self.state.objects) > 0:
                    target_ids = [list(self.state.objects.keys())[-1]]
                if not target_ids:
                    return {"ok": False, "success": False, "error": "No target object for transform", "command": cmd}

                action = params.get("action", "move")
                delta = params.get("delta", {})
                
                for tid in target_ids:
                    obj = self.state.get_object(tid)
                    if not obj: continue
                    
                    if action in ("duplicate", "copy"):
                        new_id = f"obj_{obj.primitive_type}_{uuid.uuid4().hex[:6]}"
                        new_pos = [obj.position[0] + 50.0, obj.position[1] + 50.0, obj.position[2]]
                        new_obj = CADObject(
                            object_id=new_id,
                            name=f"{obj.name} (Copy)",
                            primitive_type=obj.primitive_type,
                            parameters=copy.deepcopy(obj.parameters),
                            position=new_pos,
                            rotation=copy.deepcopy(obj.rotation),
                            scale=copy.deepcopy(obj.scale),
                            color=obj.color,
                            material=obj.material,
                            opacity=obj.opacity,
                            faces=copy.deepcopy(obj.faces)
                        )
                        self.state.add_object(new_obj)
                        continue

                    if "translation" in delta or "move" in delta:
                        d_pos = delta.get("translation", delta.get("move", [0,0,0]))
                        obj.position = [obj.position[i] + float(d_pos[i]) for i in range(3)]
                    elif action == "move":
                        step = float(params.get("step", 25.4))
                        axis = params.get("axis", "x").lower()
                        idx = 0 if axis == 'x' else (1 if axis == 'y' else 2)
                        obj.position[idx] += step

                    if "rotation" in delta:
                        d_rot = delta.get("rotation", [0,0,0])
                        obj.rotation = [obj.rotation[i] + float(d_rot[i]) for i in range(3)]
                    elif action == "rotate":
                        ang = float(params.get("angle", 15.0))
                        axis = params.get("axis", "z").lower()
                        idx = 0 if axis == 'x' else (1 if axis == 'y' else 2)
                        obj.rotation[idx] = (obj.rotation[idx] + ang) % 360

                    if "scale" in delta:
                        d_scale = delta.get("scale", [1,1,1])
                        obj.scale = [obj.scale[i] * float(d_scale[i]) for i in range(3)]
                    elif action == "scale":
                        factor = float(params.get("factor", 1.1))
                        obj.scale = [s * factor for s in obj.scale]

                    obj.updated_at = time.time()

                return {
                    "ok": True,
                    "success": True,
                    "command": cmd,
                    "document": self.state.to_dict()
                }

            elif cmd in ("feature_extrude", "feature_revolve", "feature_hole", "feature_fillet", "feature_chamfer", "feature_cross_sections"):
                self.state.save_snapshot()
                obj_id = params.get("target_id") or params.get("id") or params.get("manifest_id")
                obj = self.state.get_object(obj_id) if obj_id else (list(self.state.objects.values())[-1] if self.state.objects else None)
                if not obj:
                    return {"ok": False, "success": False, "error": "No target object selected", "command": cmd}

                feature_name = cmd.replace("feature_", "")
                feature = {
                    "id": f"feat_{uuid.uuid4().hex[:10]}",
                    "type": feature_name,
                    "parameters": copy.deepcopy(params),
                    "created_at": time.time(),
                    "status": "applied_parametric" if feature_name == "extrude" else "defined",
                    "kernel": "GeoParametric3D lightweight kernel"
                }

                if "_features" not in obj.parameters or not isinstance(obj.parameters["_features"], list):
                    obj.parameters["_features"] = []
                obj.parameters["_features"].append(feature)

                if feature_name == "extrude":
                    distance = float(params.get("distance", 0.0))
                    axis = str(params.get("axis", "Z")).lower()
                    if distance == 0:
                        return {"ok": False, "success": False, "error": "Extrusion distance must be non-zero", "command": cmd}
                    axis_key = {"x": "width", "y": "depth", "z": "height"}.get(axis)
                    if axis_key and axis_key in obj.parameters and isinstance(obj.parameters[axis_key], (int, float)):
                        obj.parameters[axis_key] = float(obj.parameters[axis_key]) + abs(distance)
                        feature["status"] = "applied_parametric"
                        feature["kernel_effect"] = f"increased {axis_key}"
                    else:
                        feature["status"] = "defined"
                        feature["kernel_effect"] = "profile/external-face extrusion recorded; exact topology deferred"

                elif feature_name == "revolve":
                    angle = float(params.get("angle", 360))
                    if not -3600 <= angle <= 3600:
                        return {"ok": False, "success": False, "error": "Revolve angle out of range", "command": cmd}
                    feature["status"] = "defined"
                    feature["kernel_effect"] = "revolve feature recorded in feature history"

                elif feature_name == "hole":
                    diameter = float(params.get("diameter", 0))
                    depth = float(params.get("depth", 0))
                    if diameter <= 0 or depth <= 0:
                        return {"ok": False, "success": False, "error": "Hole diameter and depth must be positive", "command": cmd}
                    feature["status"] = "defined"
                    feature["kernel_effect"] = "hole feature recorded in feature history"

                elif feature_name in ("fillet", "chamfer"):
                    value = float(params.get("radius", params.get("distance", 0)))
                    if value <= 0:
                        return {"ok": False, "success": False, "error": f"{feature_name} size must be positive", "command": cmd}
                    feature["status"] = "defined"
                    feature["kernel_effect"] = f"{feature_name} feature recorded in feature history"

                elif feature_name == "cross_sections":
                    count = int(params.get("count", 1))
                    if count < 1 or count > 10000:
                        return {"ok": False, "success": False, "error": "Cross-section count must be between 1 and 10000", "command": cmd}
                    feature["status"] = "defined"
                    feature["kernel_effect"] = "section planes recorded in feature history"

                obj.updated_at = time.time()
                obj.faces = generate_geometry(obj.primitive_type, obj.parameters, [0.0, 0.0, 0.0], [0.0, 0.0, 0.0])
                return {
                    "ok": True, "success": True, "command": cmd,
                    "feature": feature, "object": obj.to_dict(),
                    "manifest_id": obj.object_id, "document": self.state.to_dict()
                }

            elif cmd in ("boolean_union", "boolean_subtract", "boolean_intersect"):
                self.state.save_snapshot()
                target_id = params.get("target_id")
                tool_id = params.get("tool_id")
                target = self.state.get_object(target_id)
                tool = self.state.get_object(tool_id)
                if not target or not tool or target.object_id == tool.object_id:
                    return {"ok": False, "success": False, "error": "Boolean operations require two distinct selected bodies", "command": cmd}
                op = cmd.replace("boolean_", "")
                feature = {
                    "id": f"bool_{uuid.uuid4().hex[:10]}",
                    "type": op,
                    "target_id": target.object_id,
                    "tool_id": tool.object_id,
                    "created_at": time.time(),
                    "status": "defined",
                    "kernel": "GeoParametric3D lightweight kernel",
                    "note": "Operation retained in parametric history; exact B-Rep boolean requires the solid kernel adapter."
                }
                target.parameters.setdefault("_features", []).append(feature)
                if op in ("subtract", "intersect"):
                    tool.visible = False
                target.updated_at = time.time()
                return {
                    "ok": True, "success": True, "command": cmd,
                    "feature": feature, "object": target.to_dict(),
                    "manifest_id": target.object_id, "document": self.state.to_dict()
                }

            elif cmd == "align_object":
                self.state.save_snapshot()
                obj_id = params.get("id") or params.get("target_id")
                obj = self.state.get_object(obj_id)
                if not obj:
                    return {"ok": False, "success": False, "error": "No target object selected", "command": cmd}
                mode = params.get("target", "ground")
                if mode == "ground":
                    bb = obj.compute_bounds()
                    obj.position[2] -= float(bb.get("min", [0,0,0])[2])
                elif mode == "origin":
                    bb = obj.compute_bounds()
                    center = bb.get("center", [0,0,0])
                    obj.position = [obj.position[0] - center[0], obj.position[1] - center[1], obj.position[2] - center[2]]
                else:
                    return {"ok": False, "success": False, "error": f"Unknown alignment target: {mode}", "command": cmd}
                obj.faces = generate_geometry(obj.primitive_type, obj.parameters, [0.0, 0.0, 0.0], [0.0, 0.0, 0.0])
                return {
                    "ok": True, "success": True, "command": cmd, "object": obj.to_dict(), "document": self.state.to_dict()
                }

            elif cmd == "measure_selected":
                ids = params.get("ids") or ([params.get("id")] if params.get("id") else [])
                obj = self.state.get_object(ids[0]) if ids else (list(self.state.objects.values())[-1] if self.state.objects else None)
                if not obj:
                    return {"ok": False, "success": False, "error": "No object selected", "command": cmd}
                return {"ok": True, "success": True, "command": cmd, "measurement": {
                    "object_id": obj.object_id, "name": obj.name, "bounding_box": obj.compute_bounds(),
                    "volume_cm3": obj.get_volume_cm3(), "mass_grams": obj.get_mass_grams()
                }, "document": self.state.to_dict()}

            elif cmd == "execute_script":
                self.state.save_snapshot()
                script = params.get("script", "")
                if not script:
                    return {"ok": False, "success": False, "error": "No script provided", "command": cmd}
                try:
                    local_scope = {"state": self.state, "result": None}
                    try:
                        import cadquery as cq
                        local_scope["cq"] = cq
                    except ImportError:
                        pass
                    exec(script, local_scope)
                    return {
                        "ok": True,
                        "success": True,
                        "command": cmd,
                        "message": "Script executed successfully",
                        "document": self.state.to_dict()
                    }
                except Exception as script_err:
                    return {
                        "ok": False,
                        "success": False,
                        "error": str(script_err),
                        "command": cmd
                    }

            elif cmd in ("export_xbf", "export_step", "export"):
                fmt = params.get("format", "xbf").lower()
                objs = list(self.state.objects.values())
                if fmt == "step":
                    data_bytes = export_step_bytes(objs)
                    return {"ok": True, "format": "step", "content_base64": data_bytes.decode('utf-8', errors='ignore')}
                else:
                    data_bytes = export_xbf_bytes(objs, self.state.assembly_tree)
                    import base64
                    return {"ok": True, "format": "xbf", "content_base64": base64.b64encode(data_bytes).decode('ascii')}

            elif cmd in ("clear_document", "new_document"):
                self.state.save_snapshot()
                self.state.clear()
                return {
                    "ok": True,
                    "command": cmd,
                    "message": "Document cleared",
                    "document": self.state.to_dict()
                }

            else:
                return {
                    "ok": True,
                    "command": cmd,
                    "document": self.state.to_dict()
                }

        except GeometryPipelineException as gpe:
            return {
                "ok": False,
                "success": False,
                "stage": gpe.stage.value if hasattr(gpe, 'stage') else "GEOMETRY_ERROR",
                "error": str(gpe),
                "command": cmd
            }
        except Exception as e:
            return {
                "ok": False,
                "success": False,
                "stage": "COMMAND_ERROR",
                "error": str(e),
                "command": cmd
            }

    async def process_import(self, filename: str, content_bytes: bytes) -> dict:
        try:
            self.state.save_snapshot()
            parsed_result = import_bytes(content_bytes, filename)
            
            if parsed_result and parsed_result.get("objects"):
                self.state.clear()
                headers = parsed_result.get("headers", {})
                descriptor = parsed_result.get("descriptor", {})
                bodies = parsed_result.get("objects", [])
                assembly_tree = parsed_result.get("assembly_tree", [])
                
                for b in bodies:
                    cad_obj = CADObject(
                        object_id=b.get("id", f"body_{uuid.uuid4().hex[:6]}"),
                        name=b.get("name", "Imported Part"),
                        primitive_type=b.get("primitive_type", "solid_imported"),
                        parameters=b.get("parameters", {"file": filename}),
                        position=b.get("position", [0.0, 0.0, 0.0]),
                        rotation=b.get("rotation", [0.0, 0.0, 0.0]),
                        scale=b.get("scale", [1.0, 1.0, 1.0]),
                        color=b.get("color", "#38bdf8"),
                        material=b.get("material", "Steel"),
                        opacity=float(b.get("opacity", 1.0)),
                        faces=b.get("faces", []),
                        brep=b.get("brep"),
                        bounding_box=b.get("bounding_box")
                    )
                    self.state.add_object(cad_obj)
                    
                if assembly_tree:
                    self.state.assembly_tree = assembly_tree
                self.state.metadata = headers
                    
                doc = self.state.to_dict()
                doc["headers"] = headers
                doc["descriptor"] = descriptor
                
                return {
                    "ok": True,
                    "success": True,
                    "message": f"Imported {len(bodies)} bodies from {filename}",
                    "headers": headers,
                    "descriptor": descriptor,
                    "document": doc
                }
            return {
                "ok": False,
                "success": False,
                "stage": "IMPORT_ERROR",
                "error": f"IMPORT_FAILED: Unable to parse 3D polygon topology from '{filename}'."
            }
        except Exception as e:
            return {"ok": False, "success": False, "stage": "IMPORT_ERROR", "error": f"IMPORT_FAILED: {str(e)}"}
