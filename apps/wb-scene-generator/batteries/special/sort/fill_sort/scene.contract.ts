// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "fillSort",
  "contractVersion": "1.0.0",
  "opId": "fill_sort",
  "description": "Pre-processes and aligns each [grid/gridList, nameList/nameListList] bundle, then re-numbers all values globally from 1: ① removes ghost entries not present in the grid; ② fills missing entries for values in the grid; ③ matches gridList[i] to nameListList[i] by index; ④ merges all slots and assigns globally unique IDs starting from 1.",
  "inputs": [
    {
      "name": "description",
      "type": "string",
      "defaultValue": "",
      "description": "Arbitrary description text; passed through unchanged to the output port.",
      "label": "说明信息",
      "mode": "parameter"
    },
    {
      "name": "item_0",
      "type": "any",
      "description": "Two-element list [grid or gridList, nameList]; if grid slot is a grid list, each sub-grid is processed independently.",
      "label": "层0"
    },
    {
      "name": "item_1",
      "type": "any",
      "description": "Two-element list [grid or gridList, nameList]; connecting it appends a new slot.",
      "label": "层1"
    }
  ],
  "outputs": [
    {
      "name": "description",
      "type": "string",
      "description": "Same string as the input 'description' port, passed through unchanged.",
      "label": "说明信息"
    },
    {
      "name": "outputGrids",
      "type": "array",
      "description": "List of remapped grids in input order; each layer remains separate. All values across the list are globally unique.",
      "label": "输出网格列表"
    },
    {
      "name": "outputNameList",
      "type": "array",
      "description": "Unified name list after pre-processing alignment and global re-numbering; {id, name, type?} entry IDs match the values across all output grids.",
      "label": "名称清单"
    },
    {
      "name": "errorMessage",
      "type": "string",
      "description": "Detects two issues: ① duplicate names; ② missing type field (entry has no tile/asset type marker). Outputs an error message if issues exist, empty string otherwise.",
      "label": "错误信息"
    }
  ],
  "deterministic": true
})
