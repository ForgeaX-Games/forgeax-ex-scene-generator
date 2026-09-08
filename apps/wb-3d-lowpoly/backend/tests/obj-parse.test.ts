/**
 * parseObjToRawMesh 单测：角色路 / 多材质物体路把分件预烘的 <sha>.obj 一起合并时，
 * baker 会回读 blob 并用它解析成裸网格。这里覆盖我们自己导出的 OBJ 方言 + 常见容错。
 */
import { describe, it, expect } from 'vitest'
import { parseObjToRawMesh } from '../src/services/baker/obj_export.js'

describe('parseObjToRawMesh', () => {
  it('解析基本 v/f（1-based → 0-based 三角）', () => {
    const obj = [
      '# baked by forgeax-wb-scene baker',
      'v 0 0 0',
      'v 1 0 0',
      'v 0 1 0',
      'f 1 2 3',
      '',
    ].join('\n')
    const { vertices, triangles } = parseObjToRawMesh(obj)
    expect(vertices).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
    expect(triangles).toEqual([0, 1, 2])
  })

  it('多边形面按三角扇拆分（quad → 2 三角）', () => {
    const obj = ['v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'f 1 2 3 4'].join('\n')
    const { triangles } = parseObjToRawMesh(obj)
    expect(triangles).toEqual([0, 1, 2, 0, 2, 3])
  })

  it('兼容 f v/vt、v//vn、v/vt/vn（只取顶点索引）', () => {
    const obj = [
      'v 0 0 0', 'v 1 0 0', 'v 0 1 0',
      'f 1/1 2/2 3/3',
      'f 1//1 2//2 3//3',
      'f 1/1/1 2/2/2 3/3/3',
    ].join('\n')
    const { triangles } = parseObjToRawMesh(obj)
    expect(triangles).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2])
  })

  it('负索引相对当前顶点数解析', () => {
    const obj = ['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f -3 -2 -1'].join('\n')
    const { triangles } = parseObjToRawMesh(obj)
    expect(triangles).toEqual([0, 1, 2])
  })

  it('跳过越界索引的面、非法坐标不崩', () => {
    const obj = ['v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 99', 'f 1 2 3'].join('\n')
    const { triangles } = parseObjToRawMesh(obj)
    expect(triangles).toEqual([0, 1, 2])
  })

  it('空 / 纯注释输入 → 空网格', () => {
    expect(parseObjToRawMesh('')).toEqual({ vertices: [], triangles: [] })
    expect(parseObjToRawMesh('# just a comment\n\n  \n')).toEqual({ vertices: [], triangles: [] })
  })

  it('容忍 CRLF 与首尾空白', () => {
    const obj = '  v 0 0 0  \r\n v 1 0 0\r\nv 0 1 0\r\nf 1 2 3\r\n'
    const { vertices, triangles } = parseObjToRawMesh(obj)
    expect(vertices).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
    expect(triangles).toEqual([0, 1, 2])
  })
})
