// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "strToListBranches",
  "contractVersion": "1.0.0",
  "opId": "str_to_list_branches",
  "description": "Parse a list string like [a,b,c] and explode each element into its own DataTree child branch (access:list), ready to fan out into item ports. Tolerant: elements may be unquoted (e.g. [test2,test3]).",
  "inputs": [
    {
      "name": "str",
      "type": "string",
      "description": "A list string like [...]; each element becomes its own child branch. Elements may be quoted or unquoted.",
      "label": "输入字符串",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "items",
      "type": "any",
      "access": "list",
      "description": "Parsed elements, each emitted as its own child branch (same shape as grid_split_by_value's grids).",
      "label": "分支列表"
    }
  ],
  "deterministic": true
})
