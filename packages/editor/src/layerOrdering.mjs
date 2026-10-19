// Shared project-layer stacking algorithm. Topmost layer appears first in the inspector.
// Return the original array for no-ops so callers do not add empty undo history entries.
export function moveLayerInStack(layers,dragId,targetId,placeAfter=false){
  if(!dragId || !targetId || dragId===targetId)return layers;
  const ordered=[...layers].sort((a,b)=>(Number(b.z)||0)-(Number(a.z)||0));
  const before=ordered.map(layer=>layer.id);
  const from=ordered.findIndex(layer=>layer.id===dragId);
  if(from<0)return layers;
  const [moved]=ordered.splice(from,1);
  const destination=ordered.findIndex(layer=>layer.id===targetId);
  if(destination<0)return layers;
  ordered.splice(destination+(placeAfter?1:0),0,moved);
  if(ordered.every((layer,index)=>layer.id===before[index]))return layers;
  const ranks=new Map(ordered.map((layer,index)=>[layer.id,ordered.length-index]));
  return layers.map(layer=>({...layer,z:ranks.get(layer.id)??layer.z}));
}
