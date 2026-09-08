// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "addSceneChildren",
  "contractVersion": "1.0.0",
  "opId": "add_child",
  "description": "Attach a list of standalone scene nodes under parent.focus as siblings. Each element of nodes is a one-node scene (e.g. grid2node output); the child name is taken from the last segment of that scene's focus. Name collisions raise an explicit error.",
  "inputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "item",
      "required": true,
      "description": "Parent scene (focus must point at an existing node).",
      "label": "scene"
    },
    {
      "name": "nodes",
      "type": "scene",
      "access": "list",
      "required": true,
      "description": "List of child scenes to graft; each element's focus basename becomes the child name.",
      "label": "nodes"
    }
  ],
  "outputs": [
    {
      "name": "scene",
      "type": "scene",
      "access": "item",
      "description": "Updated scene (focus stays at the parent path; chain further add_child / mutator).",
      "label": "scene"
    },
    {
      "name": "childPaths",
      "type": "string",
      "access": "list",
      "description": "Absolute paths of the grafted children (1:1 with nodes input). Feed into scene_focus_path to target a specific child.",
      "label": "子节点路径列表"
    }
  ],
  "deterministic": true
})
