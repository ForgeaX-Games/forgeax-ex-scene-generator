/**
 * furniture_template_picker: 按索引（1-15）选取预生成的房间家具模板
 * 输入：index (number 1-15) — 房间编号
 * 输出：result (string) — 完整 JSON 字符串，可直接接 furniture_list_split；
 *        room (string) — 房间名称；room_size (string) — 房间尺寸
 */

import roomTemplatesData from "./room_templates.json";

type FurnitureItem = {
  rank: number;
  name: string;
  furniture_id: string;
  type: string;
  placement: string;
  reason: string;
};

type RoomTemplate = {
  room: string;
  room_size: string;
  furniture_list: FurnitureItem[];
};

// Templates are pure data, kept in room_templates.json so this op file stays
// small and the catalogue can be edited without touching code.
const ROOM_TEMPLATES = roomTemplatesData as RoomTemplate[];


export function furnitureTemplatePicker(input: Record<string, unknown>): Record<string, unknown> {
  const rawIndex = typeof input.index === "number" ? input.index : Number(input.index);
  const idx = Math.round(rawIndex);

  if (isNaN(idx) || idx < 1 || idx > ROOM_TEMPLATES.length) {
    return { error: `index 必须为 1–${ROOM_TEMPLATES.length}，当前值: ${rawIndex}` };
  }

  const template = ROOM_TEMPLATES[idx - 1];

  return {
    result: JSON.stringify(template),
    room: template.room,
    room_size: template.room_size,
  };
}
