// Strict shape hit-testing for Mobile's deliberate drag, pause, release action.
// Photo overlap and photo-center proximity are NOT fill instructions.
const SHAPE_POLYGONS={
  triangle:[[.5,0],[1,1],[0,1]],
  diamond:[[.5,0],[1,.5],[.5,1],[0,.5]],
  star:Array.from({length:10},(_,i)=>{
    const angle=-Math.PI/2+i*Math.PI/5,r=i%2===0?.49:.22;
    return [.5+Math.cos(angle)*r,.5+Math.sin(angle)*r];
  })
};
function insidePolygon(vertices,x,y){
  let inside=false;
  for(let i=0,j=vertices.length-1;i<vertices.length;j=i++){
    const a=vertices[i],b=vertices[j];
    if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export function pointInsideShape(shape,point){
  if(!shape || !point || !(shape.w>0) || !(shape.h>0))return false;
  const x=(point.x-shape.x)/shape.w,y=(point.y-shape.y)/shape.h;
  if(x<0||x>1||y<0||y>1)return false;
  const kind=shape.shape||'rounded';
  if(kind==='ellipse')return (2*x-1)**2+(2*y-1)**2<=1;
  if(SHAPE_POLYGONS[kind])return insidePolygon(SHAPE_POLYGONS[kind],x,y);
  if(kind==='rounded'){
    const rx=Math.min(.5,Math.max(0,(shape.radius||0)/shape.w));
    const ry=Math.min(.5,Math.max(0,(shape.radius||0)/shape.h));
    if(rx>0 && ry>0){
      const cx=Math.max(rx,Math.min(1-rx,x)),cy=Math.max(ry,Math.min(1-ry,y));
      return ((x-cx)/rx)**2+((y-cy)/ry)**2<=1;
    }
  }
  return true;
}
export function findImageShapeDropTarget(layers,image,pointer,movingIds=new Set()){
  if(!image || image.type!=='image' || !pointer)return null;
  // Prefer the topmost actual shape beneath the finger, never one intersected
  // solely by a large photo that the user is dragging past the shape.
  const matches=layers.filter(shape=>shape.type==='shape' && !movingIds.has(shape.id) && pointInsideShape(shape,pointer));
  matches.sort((a,b)=>(Number(b.z)||0)-(Number(a.z)||0));
  return matches[0]||null;
}
