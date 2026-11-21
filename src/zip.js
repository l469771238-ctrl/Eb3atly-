// ZIP reader/writer used for backups. Store-only (no compression), no dependencies.
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
export function crc32(u){let c=0xFFFFFFFF;for(let i=0;i<u.length;i++)c=CRC[(c^u[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
export function zipStore(files){
  const enc=new TextEncoder(),parts=[],cd=[];let off=0;
  const now=new Date(),dt=((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate(),tm=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1);
  for(const [name,data] of files){
    const nb=enc.encode(name),crc=crc32(data);
    const lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(6,0x0800,true);lh.setUint16(8,0,true);lh.setUint16(10,tm,true);lh.setUint16(12,dt,true);
    lh.setUint32(14,crc,true);lh.setUint32(18,data.length,true);lh.setUint32(22,data.length,true);lh.setUint16(26,nb.length,true);lh.setUint16(28,0,true);
    parts.push(new Uint8Array(lh.buffer),nb,data);
    const ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);ch.setUint16(8,0x0800,true);ch.setUint16(10,0,true);ch.setUint16(12,tm,true);ch.setUint16(14,dt,true);
    ch.setUint32(16,crc,true);ch.setUint32(20,data.length,true);ch.setUint32(24,data.length,true);ch.setUint16(28,nb.length,true);
    ch.setUint16(30,0,true);ch.setUint16(32,0,true);ch.setUint16(34,0,true);ch.setUint16(36,0,true);ch.setUint32(38,0,true);ch.setUint32(42,off,true);
    cd.push(new Uint8Array(ch.buffer),nb);
    off+=30+nb.length+data.length;
  }
  const cdSize=cd.reduce((a,b)=>a+b.length,0);
  const eo=new DataView(new ArrayBuffer(22));
  eo.setUint32(0,0x06054b50,true);eo.setUint16(8,files.length,true);eo.setUint16(10,files.length,true);eo.setUint32(12,cdSize,true);eo.setUint32(16,off,true);
  return [...parts,...cd,new Uint8Array(eo.buffer)];
}
export function zipRead(u8){
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  // every read goes through here, so a truncated or malicious file throws instead of returning bad data
  const need=(off,n)=>{if(!Number.isInteger(off)||off<0||off+n>u8.length)throw new Error('zip: truncated');};
  if(u8.length<22) throw new Error('zip');
  let e=-1; for(let i=u8.length-22;i>=Math.max(0,u8.length-65557);i--){if(dv.getUint32(i,true)===0x06054b50){e=i;break}}
  if(e<0)throw new Error('zip');
  need(e,22);
  const n=dv.getUint16(e+10,true); let p=dv.getUint32(e+16,true);
  const out=Object.create(null), dec=new TextDecoder();
  for(let i=0;i<n;i++){
    need(p,46);
    if(dv.getUint32(p,true)!==0x02014b50)throw new Error('zip');
    const method=dv.getUint16(p+10,true),cs=dv.getUint32(p+20,true),nl=dv.getUint16(p+28,true),el=dv.getUint16(p+30,true),cl=dv.getUint16(p+32,true),lo=dv.getUint32(p+42,true);
    need(p+46,nl);
    const name=dec.decode(u8.subarray(p+46,p+46+nl));
    if(method!==0)throw new Error('method');
    need(lo,30);
    if(dv.getUint32(lo,true)!==0x04034b50)throw new Error('zip');
    const lnl=dv.getUint16(lo+26,true),lel=dv.getUint16(lo+28,true),ds=lo+30+lnl+lel;
    need(ds,cs);
    out[name]=u8.subarray(ds,ds+cs);
    p+=46+nl+el+cl;
  }
  return out;
}
