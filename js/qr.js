/* ============================================================
   qr.js — compact, dependency-free QR generator.
   Byte mode, ECC level L, versions 1–4 (single block — enough for
   a short invite URL). Returns an SVG string. Good enough to scan
   a join link poolside; the invite link/code is always shown too.
   ============================================================ */
const QR = (() => {
  // ---- Galois field GF(256) ----
  const EXP = new Array(512), LOG = new Array(256);
  (function(){ let x=1; for(let i=0;i<255;i++){ EXP[i]=x; LOG[x]=i; x<<=1; if(x&0x100) x^=0x11d; } for(let i=255;i<512;i++) EXP[i]=EXP[i-255]; })();
  const gfMul = (a,b)=> (a===0||b===0)?0:EXP[LOG[a]+LOG[b]];

  // ---- Reed–Solomon ECC ----
  // generator polynomial, leading coefficient first: gen[0]=1 … gen[deg]=constant
  function rsGen(deg){ let poly=[1]; for(let i=0;i<deg;i++){ const np=new Array(poly.length+1).fill(0); for(let j=0;j<poly.length;j++){ np[j]^=poly[j]; np[j+1]^=gfMul(poly[j], EXP[i]); } poly=np; } return poly; }
  function rsEncode(data, ecLen){
    const gen=rsGen(ecLen); const res=new Array(ecLen).fill(0);
    for(let i=0;i<data.length;i++){
      const factor = data[i]^res[0];
      for(let j=0;j<ecLen-1;j++) res[j]=res[j+1]^gfMul(gen[j+1],factor);
      res[ecLen-1]=gfMul(gen[ecLen],factor);
    }
    return res;
  }

  // version → { size, total, data, ecc, align }
  const V = {
    1:{ data:19, ecc:7,  align:null },
    2:{ data:34, ecc:10, align:18 },
    3:{ data:55, ecc:15, align:22 },
    4:{ data:80, ecc:20, align:26 },
  };
  const sizeOf = v => 17 + 4*v;

  function chooseVersion(len){ // len = byte count; +2 overhead (mode+len)
    for(let v=1;v<=4;v++){ if(len+2 <= V[v].data) return v; }
    return null;
  }

  function encodeData(bytes, v){
    const cap = V[v].data;
    const bits=[];
    const push=(val,n)=>{ for(let i=n-1;i>=0;i--) bits.push((val>>i)&1); };
    push(0b0100,4);            // byte mode
    push(bytes.length,8);      // length (8 bits for v1–9)
    for(const b of bytes) push(b,8);
    push(0,4);                 // terminator (trim if over)
    while(bits.length%8) bits.push(0);
    const cw=[]; for(let i=0;i<bits.length;i+=8){ let b=0; for(let j=0;j<8;j++) b=(b<<1)|bits[i+j]; cw.push(b); }
    let pad=0xEC; while(cw.length<cap){ cw.push(pad); pad=(pad===0xEC)?0x11:0xEC; }
    const ecc=rsEncode(cw, V[v].ecc);
    return cw.concat(ecc);
  }

  // ---- matrix ----
  function buildMatrix(codewords, v){
    const n=sizeOf(v);
    const m=Array.from({length:n},()=>new Array(n).fill(null));
    const set=(r,c,val)=>{ if(r>=0&&c>=0&&r<n&&c<n) m[r][c]=val; };
    const finder=(r,c)=>{ for(let i=-1;i<=7;i++) for(let j=-1;j<=7;j++){ const rr=r+i, cc=c+j; if(rr<0||cc<0||rr>=n||cc>=n) continue; const inb = i>=0&&i<=6&&j>=0&&j<=6; const ring = i===0||i===6||j===0||j===6; const core = i>=2&&i<=4&&j>=2&&j<=4; set(rr,cc, inb && (ring||core)?1:0); } };
    finder(0,0); finder(0,n-7); finder(n-7,0);
    // timing
    for(let i=8;i<n-8;i++){ if(m[6][i]===null) m[6][i]=(i%2===0)?1:0; if(m[i][6]===null) m[i][6]=(i%2===0)?1:0; }
    // alignment
    if(V[v].align!=null){ const a=V[v].align; for(let i=-2;i<=2;i++) for(let j=-2;j<=2;j++){ const ring=Math.max(Math.abs(i),Math.abs(j)); set(a+i,a+j, (ring===1)?0:1); } }
    // dark module
    set(n-8,8,1);
    // reserve format areas (mark as 2 = reserved, filled later)
    const reserve=(r,c)=>{ if(m[r][c]===null) m[r][c]=2; };
    for(let i=0;i<9;i++){ reserve(8,i); reserve(i,8); }
    for(let i=0;i<8;i++){ reserve(8,n-1-i); reserve(n-1-i,8); }

    // place data with zigzag
    let bitIdx=0; const totalBits=codewords.length*8;
    const getBit=()=> (bitIdx<totalBits)? ((codewords[bitIdx>>3]>>(7-(bitIdx&7)))&1) : 0;
    let up=true;
    for(let col=n-1; col>0; col-=2){
      if(col===6) col--; // skip timing column
      for(let k=0;k<n;k++){
        const row = up ? n-1-k : k;
        for(let c=0;c<2;c++){ const cc=col-c; if(m[row][cc]===null){ const dataBit=getBit(); bitIdx++; m[row][cc]=dataBit; } }
      }
      up=!up;
    }
    return m;
  }

  // mask 0..7 condition
  function maskFn(i){ return [
    (r,c)=>(r+c)%2===0, (r,c)=>r%2===0, (r,c)=>c%3===0, (r,c)=>(r+c)%3===0,
    (r,c)=>(((r>>1)+(Math.floor(c/3)))%2)===0, (r,c)=>((r*c)%2+(r*c)%3)===0,
    (r,c)=>(((r*c)%2+(r*c)%3)%2)===0, (r,c)=>(((r+c)%2+(r*c)%3)%2)===0,
  ][i]; }

  // format info (ECC level L=01) with BCH + mask
  function formatBits(maskI){
    const data=(0b01<<3)|maskI; let d=data<<10; const g=0b10100110111;
    let rem=d; for(let i=14;i>=10;i--){ if((rem>>i)&1) rem ^= g<<(i-10); }
    let bits=((data<<10)|rem) ^ 0b101010000010010;
    const arr=[]; for(let i=14;i>=0;i--) arr.push((bits>>i)&1); return arr;
  }

  function placeFormat(m, fmt){
    const n=m.length;
    // positions per spec
    const coords1=[[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
    const coords2=[[n-1,8],[n-2,8],[n-3,8],[n-4,8],[n-5,8],[n-6,8],[n-7,8],[8,n-8],[8,n-7],[8,n-6],[8,n-5],[8,n-4],[8,n-3],[8,n-2],[8,n-1]];
    for(let i=0;i<15;i++){ m[coords1[i][0]][coords1[i][1]]=fmt[i]; m[coords2[i][0]][coords2[i][1]]=fmt[i]; }
  }

  // identify which cells are "function" (not maskable): finders+sep+timing+align+dark+format
  function functionMask(v){
    const n=sizeOf(v); const f=Array.from({length:n},()=>new Array(n).fill(false));
    const mark=(r,c)=>{ if(r>=0&&c>=0&&r<n&&c<n) f[r][c]=true; };
    for(let i=-1;i<=7;i++) for(let j=-1;j<=7;j++){ mark(i,j); mark(i,n-8+j); mark(n-8+i,j); }
    for(let i=0;i<n;i++){ mark(6,i); mark(i,6); }
    if(V[v].align!=null){ const a=V[v].align; for(let i=-2;i<=2;i++) for(let j=-2;j<=2;j++) mark(a+i,a+j); }
    mark(n-8,8);
    for(let i=0;i<9;i++){ mark(8,i); mark(i,8); }
    for(let i=0;i<8;i++){ mark(8,n-1-i); mark(n-1-i,8); }
    return f;
  }

  function penalty(m){ // simple rule 1 + rule 3-ish for mask selection
    const n=m.length; let p=0;
    for(let r=0;r<n;r++){ let run=1; for(let c=1;c<n;c++){ if(m[r][c]===m[r][c-1]){ run++; if(run===5)p+=3; else if(run>5)p++; } else run=1; } }
    for(let c=0;c<n;c++){ let run=1; for(let r=1;r<n;r++){ if(m[r][c]===m[r-1][c]){ run++; if(run===5)p+=3; else if(run>5)p++; } else run=1; } }
    return p;
  }

  function makeMatrix(text){
    const bytes = Array.from(new TextEncoder().encode(text));
    const v = chooseVersion(bytes.length);
    if(!v) throw new Error('payload too long for QR v1–4');
    const cw = encodeData(bytes, v);
    const base = buildMatrix(cw, v);
    const fmask = functionMask(v);
    // pick best mask
    let best=null, bestP=Infinity, bestI=0;
    for(let i=0;i<8;i++){
      const cand = base.map(row=>row.slice());
      const fn=maskFn(i);
      for(let r=0;r<cand.length;r++) for(let c=0;c<cand.length;c++){ if(!fmask[r][c] && cand[r][c]!==null && cand[r][c]!==2){ if(fn(r,c)) cand[r][c]^=1; } }
      placeFormat(cand, formatBits(i));
      const p=penalty(cand);
      if(p<bestP){ bestP=p; best=cand; bestI=i; }
    }
    // normalize: any leftover null/2 → 0
    return best.map(row=>row.map(v=> v?1:0));
  }

  function toSVG(text, opts={}){
    const m = makeMatrix(text);
    const n = m.length; const quiet = opts.quiet ?? 2; const total = n + quiet*2;
    const px = opts.size ? (opts.size/total) : 6;
    const dim = total*px;
    let rects='';
    for(let r=0;r<n;r++) for(let c=0;c<n;c++) if(m[r][c]) rects+=`<rect x="${(c+quiet)*px}" y="${(r+quiet)*px}" width="${px}" height="${px}"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#fff"/><g fill="#0b1f2c">${rects}</g></svg>`;
  }

  return { makeMatrix, toSVG, _rsEncode: rsEncode };
})();
if (typeof module!=='undefined') module.exports = QR;
