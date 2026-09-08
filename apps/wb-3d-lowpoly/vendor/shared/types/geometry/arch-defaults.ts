/**
 * Architecture 家族默认值 SSOT（single source of truth）。
 *
 * 电池层（`g_roof`/`g_wall`/… index.ts）与 baker（`ops/architecture.ts`）以及 AABB
 * 估算（`aabb.ts`）共享同一份默认值，避免"电池默认 1.6、baker 默认 min(bw,bd)*0.4、
 * 第三处又不一样"的默认值漂移。改默认值只改这里一处。
 *
 * 单位 = 米，Z 朝上。
 */
export const ARCH_DEFAULTS = {
  roof: {
    /** 出檐宽度（DSL 省略 overhang 时的默认） */
    overhang: 0.3,
    /** flat 屋顶板厚 */
    flatThickness: 0.15,
    /** 非 flat 屋顶：电池给用户的默认屋脊高度 */
    height: 1.6,
    /** 非 flat 屋顶：DSL 未显式给 height 时 baker/AABB 的回退高度 = min(bw,bd) * heightFactor */
    heightFactor: 0.4,
    /** 平屋面女儿墙壁厚（parapet_thickness 省略时的默认） */
    parapetThickness: 0.12,
    /** 平屋面女儿墙压顶板厚（coping_width>0 时压顶自身厚度） */
    copingThickness: 0.06,
  },
  wall: {
    thickness: 0.2,
    height: 2.8,
    /** 勒脚基座相对墙面每侧外挑（plinth_height>0 时的默认外挑） */
    plinthProjection: 0.04,
  },
  floor: {
    thickness: 0.2,
    /** 周边下翻梁默认梁宽（beam_depth>0 且未给 beam_width 时） */
    beamWidth: 0.24,
    /** 楼板边缘默认倒角尺寸（edge_chamfer 省略时） */
    edgeChamfer: 0.03,
  },
} as const;
