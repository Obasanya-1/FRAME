// Minimal, dependency-free ZIP writer (ZIP32, stored entries).
// PNGs are already losslessly compressed, so recompression is unnecessary.
const encoder = new TextEncoder();
const crcTable = new Uint32Array(256);
for(let i=0;i<256;i++){
  let c=i;
  for(let k=0;k<8;k++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);
  crcTable[i]=c>>>0;
}

function crc32(bytes){
  let crc=0xFFFFFFFF;
  for(const byte of bytes) crc=(crc>>>8)^crcTable[(crc^byte)&255];
  return (crc^0xFFFFFFFF)>>>0;
}

function u16(view,offset,value){view.setUint16(offset,value,true);}
function u32(view,offset,value){view.setUint32(offset,value,true);}

export function createZip(entries){
  if(entries.length>65535) throw new Error('Too many slides for a ZIP archive.');
  const chunks=[], central=[];
  let offset=0;
  for(const item of entries){
    const name=encoder.encode(item.name);
    const bytes=item.bytes;
    if(name.length>65535 || bytes.length>0xFFFFFFFF) throw new Error('A slide is too large to archive.');
    const crc=crc32(bytes);
    const local=new Uint8Array(30+name.length);
    const lv=new DataView(local.buffer);
    u32(lv,0,0x04034b50);u16(lv,4,20);u16(lv,6,0x0800);u16(lv,8,0);
    u32(lv,14,crc);u32(lv,18,bytes.length);u32(lv,22,bytes.length);
    u16(lv,26,name.length);local.set(name,30);
    const header=new Uint8Array(46+name.length);
    const cv=new DataView(header.buffer);
    u32(cv,0,0x02014b50);u16(cv,4,20);u16(cv,6,20);u16(cv,8,0x0800);
    u32(cv,16,crc);u32(cv,20,bytes.length);u32(cv,24,bytes.length);
    u16(cv,28,name.length);u32(cv,42,offset);header.set(name,46);
    central.push(header);chunks.push(local,bytes);
    offset+=local.length+bytes.length;
    if(offset>0xFFFFFFFF) throw new Error('Export exceeds the 4 GB ZIP limit.');
  }
  const centralSize=central.reduce((n,b)=>n+b.length,0);
  if(offset+centralSize+22>0xFFFFFFFF) throw new Error('Export exceeds the 4 GB ZIP limit.');
  const end=new Uint8Array(22);
  const ev=new DataView(end.buffer);
  u32(ev,0,0x06054b50);u16(ev,8,entries.length);u16(ev,10,entries.length);
  u32(ev,12,centralSize);u32(ev,16,offset);
  return new Blob([...chunks,...central,end],{type:'application/zip'});
}
