import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const app = express();
const PORT = process.env.PORT || 8787;
const WWW = path.join(process.cwd(), 'web');

app.use(express.json({ limit: '20mb' }));
app.use(cors());
app.use(express.static(WWW));

// --- Minimal engine (trimmed from the browser code) ---
function parsePDB(text){
  const atoms=[];
  const lines=String(text||'').split(/\r?\n/);
  for(const line of lines){
    if(!(line.startsWith('ATOM')||line.startsWith('HETATM'))) continue;
    if(line.length<54) continue;
    const xf=(s,a,b)=>parseFloat((s.substring(a,b)||'').trim());
    const name=(line.substring(12,16)||'').trim();
    const resn=(line.substring(17,20)||'').trim()||'UNK';
    const chain=(line.substring(21,22)||'A').trim()||'A';
    const resi=parseInt((line.substring(22,26)||'').trim()||'0')||1;
    const x=xf(line,30,38), y=xf(line,38,46), z=xf(line,46,54);
    if(!isFinite(x)||!isFinite(y)||!isFinite(z)) continue;
    let elem=(line.length>=78? (line.substring(76,78)||'').trim() : '') || name.trim()[0] || 'C';
    atoms.push({name,resn,chain,resi,x,y,z,elem:elem.toUpperCase()});
  }
  return atoms;
}
function centroid(pts){ let x=0,y=0,z=0; for(const p of pts){x+=p.x;y+=p.y;z+=p.z;} const n=pts.length||1; return {x:x/n,y:y/n,z:z/n};}
function translate(points,t){return points.map(p=>({...p,x:p.x+t.x,y:p.y+t.y,z:p.z+t.z}));}
function selectAtomSet(atoms, mode){ const bb=new Set(['N','CA','C','O']); return atoms.filter(a=> mode==='CA'?a.name==='CA' : mode==='BB'? bb.has(a.name) : a.elem!=='H'); }
function rand(seed){let s=seed>>>0; return ()=>((s=(1664525*s+1013904223)>>>0)/0xFFFFFFFF);}
function randomQuat(r){const u1=r(),u2=r(),u3=r(); const a=Math.sqrt(1-u1),b=Math.sqrt(u1),t1=2*Math.PI*u2,t2=2*Math.PI*u3; return [a*Math.sin(t1),a*Math.cos(t1),b*Math.sin(t2),b*Math.cos(t2)];}
function applyQuat(p,q){const[qx,qy,qz,qw]=q; const vx=p.x,vy=p.y,vz=p.z; const ix=qw*vx+qy*vz-qz*vy,iy=qw*vy+qz*vx-qx*vz,iz=qw*vz+qx*vy-qy*vx,iw=-qx*vx-qy*vy-qz*vz; return {x:ix*qw+iw*(-qx)+iy*(-qz)-iz*(-qy),y:iy*qw+iw*(-qy)+iz*(-qx)-ix*(-qz),z:iz*qw+iw*(-qz)+ix*(-qy)-iy*(-qx)};}
function transform(B,q,t){return B.map(p=>{const r=applyQuat(p,q); return {...p,x:r.x+t.x,y:r.y+t.y,z:r.z+t.z};});}
const vdw={H:1.2,C:1.7,N:1.55,O:1.52,S:1.8,P:1.8,F:1.47,CL:1.75,BR:1.85,I:1.98};
function scorePose(A,B,contact,clashFactor,wC,wX,soft){
  let contacts=0, clash=0;
  for(const b of B) for(const a of A){
    const d=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
    const rs=(vdw[a.elem]||1.7)+(vdw[b.elem]||1.7);
    const cut=clashFactor*rs;
    if(d<=cut){ const ov=(cut-d+1e-6)/cut; clash+=wX*ov*(1/(1+soft*ov)); }
    else if(d<=contact){ contacts++; }
  }
  return {score:wC*contacts - clash, contacts, clash};
}
function diverseTop(sorted,deg,transA,limit){
  const out=[]; const max=Math.max(1,limit);
  const ang=(q1,q2)=>{const dot=Math.abs(q1[0]*q2[0]+q1[1]*q2[1]+q1[2]*q2[2]+q1[3]*q2[3]); return 2*Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI;};
  for(const p of sorted){
    let dupe=false;
    for(const s of out){
      const a=ang(p.q,s.q);
      const t=Math.hypot(p.t.x-s.t.x,p.t.y-s.t.y,p.t.z-s.t.z);
      if(a<=deg && t<=transA){dupe=true;break;}
    }
    if(!dupe){out.push(p); if(out.length>=max) break;}
  }
  return out;
}
async function runDocking(body){
  const pdbAtext = body.pdbA || DEMO_A;
  const pdbBtext = body.pdbB || DEMO_B;
  const params = body.params || {};
  const Aall=parsePDB(pdbAtext), Ball=parsePDB(pdbBtext);
  if(!Aall.length || !Ball.length) throw new Error('PDB parse failed');
  const A=selectAtomSet(Aall, params.atomMode||'HEAVY');
  const B=selectAtomSet(Ball, params.atomMode||'HEAVY');
  const cA=centroid(A), cB=centroid(B);
  const A0=translate(A.map(a=>({...a})), {x:-cA.x,y:-cA.y,z:-cA.z});
  const B0=translate(B.map(a=>({...a})), {x:-cB.x,y:-cB.y,z:-cB.z});
  const next=rand(params.seed||42);
  const poses=[];
  const samples = params.samples || 6000;
  for(let i=0;i<samples;i++){
    const q=randomQuat(next);
    const t={x:(next()*2-1)*(params.maxTrans||12), y:(next()*2-1)*(params.maxTrans||12), z:(next()*2-1)*(params.maxTrans||12)};
    const TB=transform(B0,q,t);
    const s=scorePose(A0,TB, params.contactCut||4.8, params.clashFactor||0.85, params.wContact||1.0, params.wClash||6.0, params.soft||0.5);
    poses.push({score:s.score,contacts:s.contacts,clash:s.clash,q,t});
  }
  poses.sort((a,b)=>b.score-a.score);
  const diverse=diverseTop(poses, params.dupAngle||12, params.dupTrans||2, (params.topN||8)*3);
  const top=diverse.slice(0, params.topN||8);
  return {
    params,
    complexes: [{
      label: "A{all} vs B{all}",
      topPoses: top,
      Aviz: A0,     // centered heavy atoms for viewer
      B0: B0
    }]
  };
}

// Small fake-but-OK demo PDBs (C-alpha trace)
const DEMO_A = `ATOM      1  CA  ALA A   1       -8.000   0.000   0.000  1.00  0.00           C
ATOM      2  CA  ALA A   2       -6.600   1.200   0.200  1.00  0.00           C
ATOM      3  CA  ALA A   3       -5.200   0.100   1.200  1.00  0.00           C
ATOM      4  CA  ALA A   4       -3.800   1.400   1.400  1.00  0.00           C
END`;
const DEMO_B = `ATOM      1  CA  GLY B   1        8.000   0.000   0.000  1.00  0.00           C
ATOM      2  CA  GLY B   2        6.800  -1.100  -0.100  1.00  0.00           C
ATOM      3  CA  GLY B   3        5.600  -0.200  -1.100  1.00  0.00           C
ATOM      4  CA  GLY B   4        4.400  -1.300  -1.300  1.00  0.00           C
END`;

// --- In-memory job store ---
const jobs = new Map();

app.post('/dock', async (req, res) => {
  const id = randomUUID();
  jobs.set(id, { id, status: 'queued', createdAt: Date.now() });
  res.json({ jobId: id });

  // process
  try {
    jobs.get(id).status = 'running';
    const result = await runDocking(req.body || {});
    jobs.set(id, { id, status: 'done', createdAt: Date.now(), result });
  } catch (e) {
    jobs.set(id, { id, status: 'error', createdAt: Date.now(), error: e?.message || String(e) });
  }
});

app.get('/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  res.json(job);
});

app.listen(PORT, () => {
  console.log(`Server http://localhost:${PORT}`);
  console.log(`Serving ${WWW}`);
});
