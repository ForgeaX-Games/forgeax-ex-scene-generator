// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default [
  defineAtomic({
    "functionName": "mergePoints",
    "contractVersion": "2.0.0",
    "opId": "tree_merge",
    "description": "Merge multiple point2d values into one typed DataTree.",
    "runtimeDefaults": {
      "inferredAccess": "item",
      "inferredType": "point2d",
      "portCount": 1
    },
    "inputs": [
      {
        "name": "items",
        "type": "point2d",
        "access": "item",
        "required": true,
        "runtimePort": "item"
      }
    ],
    "outputs": [
      {
        "name": "tree",
        "type": "point2d",
        "access": "tree"
      }
    ],
    "deterministic": true
  }),
  defineAtomic({
    "functionName": "mergeScenes",
    "contractVersion": "2.0.0",
    "opId": "tree_merge",
    "description": "Merge multiple scene values into one typed DataTree.",
    "runtimeDefaults": {
      "inferredAccess": "tree",
      "inferredType": "scene",
      "portCount": 1
    },
    "inputs": [
      {
        "name": "items",
        "type": "scene",
        "access": "tree",
        "required": true,
        "runtimePort": "item"
      }
    ],
    "outputs": [
      {
        "name": "tree",
        "type": "scene",
        "access": "tree"
      }
    ],
    "deterministic": true
  }),
  defineAtomic({
    "functionName": "mergeStrings",
    "contractVersion": "2.0.0",
    "opId": "tree_merge",
    "description": "Merge multiple string values into one typed DataTree.",
    "runtimeDefaults": {
      "inferredAccess": "tree",
      "inferredType": "string",
      "portCount": 1
    },
    "inputs": [
      {
        "name": "items",
        "type": "string",
        "access": "tree",
        "required": true,
        "runtimePort": "item"
      }
    ],
    "outputs": [
      {
        "name": "tree",
        "type": "string",
        "access": "tree"
      }
    ],
    "deterministic": true
  }),
  defineAtomic({
    "functionName": "mergeNumbers",
    "contractVersion": "2.0.0",
    "opId": "tree_merge",
    "description": "Merge multiple number values into one typed DataTree.",
    "runtimeDefaults": {
      "inferredAccess": "item",
      "inferredType": "number",
      "portCount": 1
    },
    "inputs": [
      {
        "name": "items",
        "type": "number",
        "access": "item",
        "required": true,
        "runtimePort": "item"
      }
    ],
    "outputs": [
      {
        "name": "tree",
        "type": "number",
        "access": "tree"
      }
    ],
    "deterministic": true
  })
]
