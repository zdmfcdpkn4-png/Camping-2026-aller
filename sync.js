/* Backend de synchronisation du roadbook.
   Stockage : Redis Upstash via son API REST (intégration Vercel Marketplace).
   Contrat :
     GET  /api/sync?trip=<id>               -> { state: étatStocké }
     POST /api/sync?trip=<id>  body {state} -> { state: étatFusionné }
   Le serveur fusionne l'état du client avec l'état stocké, item par item,
   en gardant la modification la plus récente (horodatage ts), puis
   n'écrit dans Redis que si le résultat diffère de l'existant. */

const KV_URL   = process.env.UPSTASH_REDIS_REST_URL   || process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const DEFAULTS = () => ({dep:"09:30", steps:{}, prep:{}, bag:{}, alts:false, ts:{}, resetAt:0});

function getPath(s, p){ const i = p.indexOf("."); if(i < 0) return s[p];
  const sec = p.slice(0, i), k = p.slice(i + 1); return (s[sec] || {})[k]; }
function setPath(s, p, v){ const i = p.indexOf("."); if(i < 0){ s[p] = v; return; }
  const sec = p.slice(0, i), k = p.slice(i + 1); (s[sec] = s[sec] || {})[k] = v; }

function mergeStates(a, b){
  const RA = Math.max(a.resetAt || 0, b.resetAt || 0);
  const out = DEFAULTS(); out.resetAt = RA;
  for(const src of [a, b]){
    const t = (src && src.ts) || {};
    for(const p in t){
      if(typeof t[p] !== "number" || t[p] < RA) continue;
      if(!(p in out.ts) || t[p] > out.ts[p]){ out.ts[p] = t[p]; setPath(out, p, getPath(src, p)); }
    }
  }
  return out;
}

/* Sérialisation canonique (clés triées) pour comparer deux états. */
function stable(o){
  if(o === null || typeof o !== "object") return JSON.stringify(o);
  if(Array.isArray(o)) return "[" + o.map(stable).join(",") + "]";
  return "{" + Object.keys(o).sort().map(k => JSON.stringify(k) + ":" + stable(o[k])).join(",") + "}";
}

async function kvGet(key){
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`,
    {headers:{Authorization:`Bearer ${KV_TOKEN}`}});
  if(!r.ok) throw new Error("Redis GET " + r.status);
  const j = await r.json();
  if(j.result === null || j.result === undefined) return null;
  return JSON.parse(j.result);
}
async function kvSet(key, val){
  const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`,
    {method:"POST", headers:{Authorization:`Bearer ${KV_TOKEN}`}, body: JSON.stringify(val)});
  if(!r.ok) throw new Error("Redis SET " + r.status);
}

export default async function handler(req, res){
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if(req.method === "OPTIONS") return res.status(204).end();

  if(!KV_URL || !KV_TOKEN){
    return res.status(500).json({error:
      "Stockage non configuré : connecter Upstash Redis (Marketplace Vercel) puis redéployer."});
  }

  const trip = String((req.query && req.query.trip) || "")
    .replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  if(!trip) return res.status(400).json({error:"Paramètre trip manquant."});
  const key = "roadbook:" + trip;

  try{
    const stored = (await kvGet(key)) || DEFAULTS();

    if(req.method === "GET") return res.status(200).json({state: stored});
    if(req.method !== "POST") return res.status(405).json({error:"Méthode non autorisée."});

    let client = req.body && req.body.state;
    if(typeof client === "string"){ try{ client = JSON.parse(client); }catch(e){ client = null; } }
    if(!client || typeof client !== "object" || Array.isArray(client)) client = DEFAULTS();
    if(JSON.stringify(client).length > 200000){
      return res.status(413).json({error:"État trop volumineux."});
    }

    const merged = mergeStates(stored, client);
    if(stable(merged) !== stable(stored)) await kvSet(key, merged);
    return res.status(200).json({state: merged});
  }catch(e){
    return res.status(502).json({error:"Stockage injoignable.",
      detail:String((e && e.message) || e)});
  }
}
