export type V3 = readonly [number,number,number]
export type Q4 = readonly [number,number,number,number]
const cross = (a:V3,b:V3): V3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
const unit = (a:V3):V3 => { const n=Math.hypot(...a); if(n<1e-9 || !Number.isFinite(n)) throw new Error('Frame directions must be finite, nonzero and nonparallel'); return [a[0]/n,a[1]/n,a[2]/n] }
/** Local X = tangent, local Y = inward normal, local Z = up. */
export function localFrameValue(origin:V3, normal:V3, up:V3=[0,0,1]) {
  const y=unit(normal), x=unit(cross(y,up)), z=unit(cross(x,y))
  const m00=x[0],m01=y[0],m02=z[0],m10=x[1],m11=y[1],m12=z[1],m20=x[2],m21=y[2],m22=z[2]
  const t=m00+m11+m22; let q:number[]
  if(t>0){const s=Math.sqrt(t+1)*2;q=[(m21-m12)/s,(m02-m20)/s,(m10-m01)/s,s/4]}
  else if(m00>m11&&m00>m22){const s=Math.sqrt(1+m00-m11-m22)*2;q=[s/4,(m01+m10)/s,(m02+m20)/s,(m21-m12)/s]}
  else if(m11>m22){const s=Math.sqrt(1+m11-m00-m22)*2;q=[(m01+m10)/s,s/4,(m12+m21)/s,(m02-m20)/s]}
  else {const s=Math.sqrt(1+m22-m00-m11)*2;q=[(m02+m20)/s,(m12+m21)/s,s/4,(m10-m01)/s]}
  return {pos:origin,quat:q as unknown as Q4}
}
export function rotatePoint(point:V3,q:Q4):V3 {
  const u:V3=[q[0],q[1],q[2]], uv=cross(u,point), uuv=cross(u,uv)
  return point.map((v,i)=>v+2*(q[3]*uv[i]!+uuv[i]!)) as unknown as V3
}
export function fitAnchorValue(local:V3,target:V3,quat:Q4=[0,0,0,1]) {
  const n=Math.hypot(...quat); if(Math.abs(n-1)>1e-6) throw new Error('Anchor quaternion must be normalized')
  const p=rotatePoint(local,quat)
  return {pos:target.map((v,i)=>v-p[i]!) as unknown as V3,quat}
}
export interface Bounds3 { min: V3; max: V3 }
export function boundsRelationValue(a:Bounds3,b:Bounds3,tolerance=0) {
  if (!Number.isFinite(tolerance)||tolerance<0) throw new Error('Tolerance must be nonnegative')
  for(const box of [a,b]) for(let i=0;i<3;i++) if(!Number.isFinite(box.min[i])||!Number.isFinite(box.max[i])||box.min[i]!>box.max[i]!) throw new Error('Invalid bounds')
  const overlaps=a.min.map((v,i)=>Math.min(a.max[i]!,b.max[i]!)-Math.max(v,b.min[i]!))
  const clearance=Math.hypot(...overlaps.map(v=>Math.max(0,-v)))
  return {relation:overlaps.some(v=>v < -tolerance)?'separate':overlaps.some(v=>v<=tolerance)?'touching':'overlap',clearance,overlapVolume:overlaps.reduce((p,v)=>p*Math.max(0,v),1),contains:a.min.every((v,i)=>v<=b.min[i]!+tolerance&&a.max[i]!>=b.max[i]!-tolerance)}
}
