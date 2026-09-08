// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "algFieldThreshold",
  "contractVersion": "1.0.0",
  "opId": "alg_field_threshold",
  "description": "Splits a scalar field into 'near'/'far' 0/1 sub-region masks by a threshold. Given a scalar field (e.g. a distance field) and a region mask bounding the valid cells, it partitions the region's valid cells at threshold: near = valid cells with 0<=field<=threshold (close to the sources, small distance), far = valid cells that are not near (field>threshold, or BFS-unreachable -1). The two masks together equal the region's valid cells and never overlap, ideal for inner/outer, shallow/deep, coast/inland splits. Convention (aligned with the distance batteries): in field, invalid cells=0, source cells=0, unreachable=-1; field alone cannot tell invalid 0 from source 0, so a region mask is required to bound the valid cells.",
  "inputs": [
    {
      "name": "field",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "The scalar field number[][] to threshold (e.g. a distance field). Convention: invalid cells 0, source cells 0, unreachable -1.",
      "label": "标量场"
    },
    {
      "name": "region",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "Mask bounding the valid cells; non-zero cells are valid. Only valid cells are split into near/far, whose union equals the valid cells.",
      "label": "有效范围"
    },
    {
      "name": "threshold",
      "type": "number",
      "defaultValue": 1,
      "description": "Near/far boundary value (inclusive goes to near). For a raw distance field use an integer (e.g. 3 = within 3 cells is near); for a normalized field use a [0,1] decimal (e.g. 0.3).",
      "label": "阈值",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "near",
      "type": "grid",
      "access": "item",
      "description": "0/1 mask: valid cells with 0<=field<=threshold (close to sources/boundary). Ocean use case = shallow sea, island use case = coastline.",
      "label": "近处区域"
    },
    {
      "name": "far",
      "type": "grid",
      "access": "item",
      "description": "0/1 mask: valid cells not in near (field>threshold or unreachable). Ocean use case = deep sea, island use case = inland.",
      "label": "远处区域"
    }
  ],
  "deterministic": true
})
