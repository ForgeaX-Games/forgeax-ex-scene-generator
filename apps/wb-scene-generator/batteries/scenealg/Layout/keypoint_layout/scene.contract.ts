// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "keypointLayout",
  "contractVersion": "1.0.0",
  "opId": "keypoint_layout",
  "description": "Solve a 2D position (meters) for every node of a keypoint hierarchy. Area, clearance net-distance and orientation relations become differentiable energy terms, plus regularizers for parent = area-weighted child mean, circle non-overlap, and overall compactness, minimized by a deterministic Adam gradient descent. Outputs the same keypoint dict with a position {x,y} added to each node, ready to feed Keypoint Graph for metric drawing. Internals (model / weights / terms / optimizer) are decoupled for later tuning of variables, constraints and objective.",
  "inputs": [
    {
      "name": "keypoint",
      "type": "dict",
      "access": "item",
      "required": true,
      "description": "Input keypoint dict ({ hierarchy, relations }).",
      "label": "keypoint"
    }
  ],
  "outputs": [
    {
      "name": "keypoint",
      "type": "dict",
      "access": "item",
      "description": "The same keypoint dict with position {x,y} (meters) added to each node.",
      "label": "keypoint"
    }
  ],
  "deterministic": true
})
