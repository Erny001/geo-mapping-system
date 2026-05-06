import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";

const NIGERIA_CENTER = [9.082, 8.6753];
const NIGERIA_ZOOM = 6;
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_SIZE = 256;
const ROCK_COLORS = {
  Shale: "#6b6b2a", Limestone: "#00bcd4", Sandstone: "#e8e04a",
  Clay: "#9c27b0", Siltstone: "#f4a460", Marl: "#b8860b", Gravel: "#a0a0a0",
};
const ROCK_TYPES = Object.keys(ROCK_COLORS);
const GEO_PERIODS = ["Precambrian","Cambrian","Ordovician","Silurian","Devonian","Carboniferous","Permian","Triassic","Jurassic","Cretaceous","Paleogene","Neogene","Quaternary","Unknown"];
const CONTACT_TYPES = ["Conformable","Unconformable","Fault Contact","Gradational","Intrusive","Unknown"];
const TOWN_TYPES = ["Settlement","Village","Town","City","LGA Headquarters","State Capital"];
const ROAD_SURFACES = ["Paved","Unpaved","Laterite","Track"];
const RIVER_FLOW = ["N","NE","E","SE","S","SW","W","NW","Unknown"];
const AUTO_SAVE_INTERVAL = 30000; // 30 seconds

var tileCache = {};

function lon2tile(lon,z){return Math.floor(((lon+180)/360)*Math.pow(2,z));}
function lat2tile(lat,z){return Math.floor(((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2)*Math.pow(2,z));}
function tile2lon(x,z){return x/Math.pow(2,z)*360-180;}
function tile2lat(y,z){var n=Math.PI-2*Math.PI*y/Math.pow(2,z);return 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n)));}
function ll2px(lat,lon,clat,clon,z,W,H){
  var ws=TILE_SIZE*Math.pow(2,z);
  function ly(la){var s=Math.sin(la*Math.PI/180);return ws/(2*Math.PI)*(Math.PI-Math.log((1+s)/(1-s))/2);}
  function lx(lo){return ws*(lo+180)/360;}
  return {x:W/2+(lx(lon)-lx(clon)),y:H/2+(ly(lat)-ly(clat))};
}
function px2ll(px,py,clat,clon,z,W,H){
  var ws=TILE_SIZE*Math.pow(2,z);
  function ly(la){var s=Math.sin(la*Math.PI/180);return ws/(2*Math.PI)*(Math.PI-Math.log((1+s)/(1-s))/2);}
  function lx(lo){return ws*(lo+180)/360;}
  var wx=lx(clon)+(px-W/2),wy=ly(clat)+(py-H/2);
  var n=Math.PI-2*Math.PI*wy/ws;
  return {lat:180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))),lon:wx/ws*360-180};
}
function toDMS(deg,isLat){
  var d=Math.abs(deg),dd=Math.floor(d),mm=Math.floor((d-dd)*60),ss=Math.round(((d-dd)*60-mm)*60);
  return dd+"\u00b0"+mm+"'"+ss+'"'+(isLat?(deg>=0?"N":"S"):(deg>=0?"E":"W"));
}
function loadTile(z,x,y,cb){
  var k=z+"/"+x+"/"+y;
  if(tileCache[k]){cb(tileCache[k]);return;}
  var img=new Image();img.crossOrigin="anonymous";
  img.onload=function(){tileCache[k]=img;cb(img);};
  img.onerror=function(){cb(null);};
  img.src=TILE_URL.replace("{z}",z).replace("{x}",x).replace("{y}",y);
}
function dist(p1,p2){return Math.sqrt(Math.pow(p1.x-p2.x,2)+Math.pow(p1.y-p2.y,2));}

function drawSmooth(ctx,pts){
  if(!pts||pts.length<2)return;
  ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
  if(pts.length===2){ctx.lineTo(pts[1].x,pts[1].y);}
  else{
    for(var i=0;i<pts.length-1;i++){
      var cp1x=pts[i].x+(pts[i+1].x-pts[i].x)*0.4,cp1y=pts[i].y+(pts[i+1].y-pts[i].y)*0.4;
      var cp2x=pts[i].x+(pts[i+1].x-pts[i].x)*0.6,cp2y=pts[i].y+(pts[i+1].y-pts[i].y)*0.6;
      if(i>0){cp1x=pts[i].x+(pts[i+1].x-pts[i-1].x)*0.2;cp1y=pts[i].y+(pts[i+1].y-pts[i-1].y)*0.2;}
      if(i<pts.length-2){cp2x=pts[i+1].x-(pts[i+2].x-pts[i].x)*0.2;cp2y=pts[i+1].y-(pts[i+2].y-pts[i].y)*0.2;}
      ctx.bezierCurveTo(cp1x,cp1y,cp2x,cp2y,pts[i+1].x,pts[i+1].y);
    }
  }
}

var DRAW_SMOOTH_SRC=`function drawSmooth(ctx,pts){if(!pts||pts.length<2)return;ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);if(pts.length===2){ctx.lineTo(pts[1].x,pts[1].y);}else{for(var i=0;i<pts.length-1;i++){var cp1x=pts[i].x+(pts[i+1].x-pts[i].x)*0.4,cp1y=pts[i].y+(pts[i+1].y-pts[i].y)*0.4,cp2x=pts[i].x+(pts[i+1].x-pts[i].x)*0.6,cp2y=pts[i].y+(pts[i+1].y-pts[i].y)*0.6;if(i>0){cp1x=pts[i].x+(pts[i+1].x-pts[i-1].x)*0.2;cp1y=pts[i].y+(pts[i+1].y-pts[i-1].y)*0.2;}if(i<pts.length-2){cp2x=pts[i+1].x-(pts[i+2].x-pts[i].x)*0.2;cp2y=pts[i+1].y-(pts[i+2].y-pts[i].y)*0.2;}ctx.bezierCurveTo(cp1x,cp1y,cp2x,cp2y,pts[i+1].x,pts[i+1].y);}}}`;

function parseCoord(str,isLat){
  if(!str||!str.trim())return null;
  str=str.trim();
  var dec=parseFloat(str);
  if(!isNaN(dec)&&str.match(/^-?[\d.]+$/))return dec;
  var m=str.replace(/[°d]/g," ").replace(/['m]/g," ").replace(/["s]/g," ").replace(/[NSEW]/gi," $& ").trim().split(/\s+/);
  var nums=[],dir=null;
  m.forEach(function(p){if(p.match(/^[NSEWnsew]$/))dir=p.toUpperCase();else if(!isNaN(parseFloat(p)))nums.push(parseFloat(p));});
  if(nums.length===0)return null;
  var val=(nums[0]||0)+(nums[1]||0)/60+(nums[2]||0)/3600;
  if(dir==="S"||dir==="W")val=-val;
  return isNaN(val)?null:val;
}

function validateStrike(v){var n=parseFloat(v);if(v===""||v===null||v===undefined)return null;if(isNaN(n))return "Strike must be a number";if(n<0||n>360)return "Strike must be 0–360°";return null;}
function validateDip(v){var n=parseFloat(v);if(v===""||v===null||v===undefined)return null;if(isNaN(n))return "Dip must be a number";if(n<0||n>90)return "Dip must be 0–90°";return null;}
function validateSampleId(id,samples,editingIdx){if(!id||!id.trim())return "Sample ID is required";var dup=samples.findIndex(function(s,i){return s.id===id.trim()&&i!==editingIdx;});if(dup>=0)return "ID already used by sample #"+(dup+1);return null;}

function scoreFeature(type,feat){
  if(type==="town"){var f=[feat.name,feat.townType];return{score:f.filter(function(x){return x&&x.trim();}).length,max:f.length};}
  if(type==="sample"){var f=[feat.id,feat.rock,feat.description,feat.strike,feat.dip];return{score:f.filter(function(x){return x!==undefined&&x!==null&&String(x).trim()!=="";}).length,max:f.length};}
  if(type==="geology"){var f=[feat.rock,feat.formation,feat.period,feat.contact];return{score:f.filter(function(x){return x&&x.trim();}).length,max:f.length};}
  if(type==="road"){var f=[feat.name,feat.surface];return{score:f.filter(function(x){return x&&x.trim();}).length,max:f.length};}
  if(type==="river"){var f=[feat.name,feat.flow];return{score:f.filter(function(x){return x&&x.trim();}).length,max:f.length};}
  return{score:0,max:1};
}
function computeCompleteness(towns,roads,rivers,samples,geoZones){
  var total=0,filled=0;
  towns.forEach(function(f){var s=scoreFeature("town",f);total+=s.max;filled+=s.score;});
  roads.forEach(function(f){var s=scoreFeature("road",f);total+=s.max;filled+=s.score;});
  rivers.forEach(function(f){var s=scoreFeature("river",f);total+=s.max;filled+=s.score;});
  samples.forEach(function(f){var s=scoreFeature("sample",f);total+=s.max;filled+=s.score;});
  geoZones.forEach(function(f){var s=scoreFeature("geology",f);total+=s.max;filled+=s.score;});
  if(total===0)return 0;
  return Math.round((filled/total)*100);
}

var INP={width:"100%",background:"#1e2e3e",color:"#fff",border:"1px solid #3a5a7a",borderRadius:4,padding:"5px 7px",fontSize:10,boxSizing:"border-box",marginBottom:5};
var SEL=Object.assign({},INP,{cursor:"pointer"});
var LABEL={fontSize:9,color:"#7ab",marginBottom:2,display:"block"};

function Field({label,children}){return(<div style={{marginBottom:4}}><span style={LABEL}>{label}</span>{children}</div>);}

function CoordInput({onPlace,label}){
  var [fmt,setFmt]=useState("dec");
  var [latStr,setLatStr]=useState("");
  var [lonStr,setLonStr]=useState("");
  var [err,setErr]=useState("");
  function handle(){
    var lat=parseCoord(latStr,true),lon=parseCoord(lonStr,false);
    if(lat===null||lon===null){setErr("Invalid. Try: 5.503 or 5°30'12\"N");return;}
    if(lat<-90||lat>90||lon<-180||lon>180){setErr("Out of range.");return;}
    setErr("");onPlace({lat,lon});setLatStr("");setLonStr("");
  }
  var ph=fmt==="dec"?{lat:"e.g. 5.5033",lon:"e.g. 7.7591"}:{lat:'e.g. 5°30\'12"N',lon:'e.g. 7°45\'33"E'};
  return(
    <div style={{background:"#0d1a2a",border:"1px solid #2a4a6a",borderRadius:7,padding:9,marginTop:6}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <span style={{fontSize:10,color:"#4a9adf",fontWeight:"bold"}}>📍 {label}</span>
        <div style={{display:"flex",gap:3}}>
          {["dec","dms"].map(function(f){return(<button key={f} onClick={function(){setFmt(f);setLatStr("");setLonStr("");setErr("");}} style={{border:"none",borderRadius:3,padding:"2px 7px",fontSize:9,cursor:"pointer",background:fmt===f?"#f0c040":"#1a2a3a",color:fmt===f?"#000":"#888",fontWeight:"bold"}}>{f==="dec"?"Dec":"DMS"}</button>);})}
        </div>
      </div>
      <div style={{display:"flex",gap:4,marginBottom:4}}>
        <div style={{flex:1}}><div style={{fontSize:9,color:"#666",marginBottom:2}}>Latitude</div><input value={latStr} onChange={function(e){setLatStr(e.target.value);setErr("");}} onKeyDown={function(e){if(e.key==="Enter")handle();}} placeholder={ph.lat} style={Object.assign({},INP,{marginBottom:0})}/></div>
        <div style={{flex:1}}><div style={{fontSize:9,color:"#666",marginBottom:2}}>Longitude</div><input value={lonStr} onChange={function(e){setLonStr(e.target.value);setErr("");}} onKeyDown={function(e){if(e.key==="Enter")handle();}} placeholder={ph.lon} style={Object.assign({},INP,{marginBottom:0})}/></div>
      </div>
      {err&&<div style={{fontSize:9,color:"#e74c3c",marginBottom:4}}>{err}</div>}
      <button onClick={handle} style={{width:"100%",background:"#1a4a2a",color:"#27ae60",border:"1px solid #27ae60",borderRadius:4,padding:"5px",fontSize:10,cursor:"pointer",fontWeight:"bold"}}>✓ Place on Map & Pan</button>
    </div>
  );
}

// ── AUTH SCREEN ────────────────────────────────────────────────────────────────
function AuthScreen({onAuth}){
  var [mode,setMode]=useState("login"); // login | register | reset
  var [email,setEmail]=useState("");
  var [password,setPassword]=useState("");
  var [loading,setLoading]=useState(false);
  var [msg,setMsg]=useState("");
  var [err,setErr]=useState("");

  async function handleSubmit(){
    setErr("");setMsg("");
    if(!email.trim()){setErr("Email is required.");return;}
    if(mode!=="reset"&&!password.trim()){setErr("Password is required.");return;}
    setLoading(true);
    try{
      if(mode==="login"){
        var {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});
        if(error)throw error;
      } else if(mode==="register"){
        if(password.length<6){setErr("Password must be at least 6 characters.");setLoading(false);return;}
        var {error}=await supabase.auth.signUp({email:email.trim(),password});
        if(error)throw error;
        setMsg("Account created! Check your email to confirm, then log in.");
        setMode("login");setPassword("");
      } else if(mode==="reset"){
        var {error}=await supabase.auth.resetPasswordForEmail(email.trim());
        if(error)throw error;
        setMsg("Password reset email sent. Check your inbox.");
      }
    } catch(e){
      setErr(e.message||"Something went wrong.");
    }
    setLoading(false);
  }

  return(
    <div style={{background:"#0d0d1f",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"sans-serif"}}>
      <div style={{width:360,background:"#12122e",border:"1px solid #2a2a5a",borderRadius:12,padding:32}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
          <div style={{width:40,height:40,background:"#f0c040",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>🗺</div>
          <div>
            <div style={{fontSize:16,fontWeight:"bold",color:"#f0c040"}}>Geo Mapping System</div>
            <div style={{fontSize:10,color:"#555"}}>Nigeria Geological Survey</div>
          </div>
        </div>

        <div style={{display:"flex",gap:4,marginBottom:20}}>
          {["login","register"].map(function(m){return(
            <button key={m} onClick={function(){setMode(m);setErr("");setMsg("");}}
              style={{flex:1,padding:"7px",border:"none",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:"bold",background:mode===m?"#f0c040":"#1a1a3a",color:mode===m?"#000":"#666"}}>
              {m==="login"?"Sign In":"Register"}
            </button>
          );})}
        </div>

        {err&&<div style={{background:"#2a0a0a",border:"1px solid #e74c3c",borderRadius:6,padding:"8px 10px",marginBottom:12,fontSize:10,color:"#ffaaaa"}}>{err}</div>}
        {msg&&<div style={{background:"#0a2a0a",border:"1px solid #27ae60",borderRadius:6,padding:"8px 10px",marginBottom:12,fontSize:10,color:"#aaffaa"}}>{msg}</div>}

        <div style={{marginBottom:10}}>
          <div style={{fontSize:10,color:"#7ab",marginBottom:4}}>Email</div>
          <input type="email" value={email} onChange={function(e){setEmail(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")handleSubmit();}}
            placeholder="your@email.com"
            style={{width:"100%",background:"#1e2e3e",color:"#fff",border:"1px solid #3a5a7a",borderRadius:6,padding:"8px 10px",fontSize:11,boxSizing:"border-box"}}/>
        </div>

        {mode!=="reset"&&(
          <div style={{marginBottom:16}}>
            <div style={{fontSize:10,color:"#7ab",marginBottom:4}}>Password</div>
            <input type="password" value={password} onChange={function(e){setPassword(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")handleSubmit();}}
              placeholder={mode==="register"?"Minimum 6 characters":"Your password"}
              style={{width:"100%",background:"#1e2e3e",color:"#fff",border:"1px solid #3a5a7a",borderRadius:6,padding:"8px 10px",fontSize:11,boxSizing:"border-box"}}/>
          </div>
        )}

        <button onClick={handleSubmit} disabled={loading}
          style={{width:"100%",background:loading?"#1a3a1a":"#27ae60",color:"#fff",border:"none",borderRadius:6,padding:"10px",fontSize:12,fontWeight:"bold",cursor:loading?"not-allowed":"pointer",marginBottom:12}}>
          {loading?"Please wait…":mode==="login"?"Sign In":mode==="register"?"Create Account":"Send Reset Email"}
        </button>

        {mode==="login"&&(
          <div style={{textAlign:"center"}}>
            <button onClick={function(){setMode("reset");setErr("");setMsg("");}} style={{background:"none",border:"none",color:"#555",fontSize:10,cursor:"pointer",textDecoration:"underline"}}>
              Forgot password?
            </button>
          </div>
        )}
        {mode==="reset"&&(
          <div style={{textAlign:"center"}}>
            <button onClick={function(){setMode("login");setErr("");setMsg("");}} style={{background:"none",border:"none",color:"#555",fontSize:10,cursor:"pointer",textDecoration:"underline"}}>
              Back to Sign In
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── PROJECT DASHBOARD ──────────────────────────────────────────────────────────
function Dashboard({user,onOpen,onNew,onSignOut}){
  var [projects,setProjects]=useState([]);
  var [loading,setLoading]=useState(true);
  var [creating,setCreating]=useState(false);
  var [newName,setNewName]=useState("");
  var [deleting,setDeleting]=useState(null);

  useEffect(function(){loadProjects();},[]);

  async function loadProjects(){
    setLoading(true);
    var {data,error}=await supabase.from("projects").select("*").order("updated_at",{ascending:false});
    if(!error)setProjects(data||[]);
    setLoading(false);
  }

  async function createProject(){
    var name=newName.trim()||"Untitled Project";
    var {data,error}=await supabase.from("projects").insert({user_id:user.id,name}).select().single();
    if(!error&&data){setCreating(false);setNewName("");onOpen(data);}
  }

  async function deleteProject(id){
    await supabase.from("projects").delete().eq("id",id);
    setDeleting(null);
    setProjects(function(p){return p.filter(function(x){return x.id!==id;});});
  }

  function fmt(ts){
    var d=new Date(ts),now=new Date();
    var diff=Math.floor((now-d)/1000);
    if(diff<60)return "just now";
    if(diff<3600)return Math.floor(diff/60)+"m ago";
    if(diff<86400)return Math.floor(diff/3600)+"h ago";
    return d.toLocaleDateString();
  }

  return(
    <div style={{background:"#0d0d1f",height:"100vh",fontFamily:"sans-serif",color:"#eee",display:"flex",flexDirection:"column"}}>
      {/* Header */}
      <div style={{background:"#12122e",borderBottom:"1px solid #2a2a5a",padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:32,height:32,background:"#f0c040",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🗺</div>
          <div>
            <div style={{fontWeight:"bold",fontSize:14,color:"#f0c040"}}>Geo Mapping System</div>
            <div style={{fontSize:9,color:"#555"}}>Signed in as {user.email}</div>
          </div>
        </div>
        <button onClick={onSignOut} style={{background:"#1a1a3a",color:"#888",border:"1px solid #3a3a6a",borderRadius:6,padding:"5px 12px",fontSize:10,cursor:"pointer"}}>Sign Out</button>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:24,maxWidth:800,margin:"0 auto",width:"100%"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div style={{fontSize:18,fontWeight:"bold",color:"#f0c040"}}>My Projects</div>
          <button onClick={function(){setCreating(true);}} style={{background:"#27ae60",color:"#fff",border:"none",borderRadius:7,padding:"8px 16px",fontSize:11,fontWeight:"bold",cursor:"pointer"}}>+ New Project</button>
        </div>

        {/* New project form */}
        {creating&&(
          <div style={{background:"#12122e",border:"1px solid #27ae60",borderRadius:10,padding:16,marginBottom:16}}>
            <div style={{fontSize:11,color:"#27ae60",fontWeight:"bold",marginBottom:8}}>New Project</div>
            <input value={newName} onChange={function(e){setNewName(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")createProject();}}
              placeholder="e.g. Ogu-Itumbuoso Geological Survey"
              style={{width:"100%",background:"#1e2e3e",color:"#fff",border:"1px solid #3a5a7a",borderRadius:6,padding:"8px 10px",fontSize:11,boxSizing:"border-box",marginBottom:8}}
              autoFocus/>
            <div style={{display:"flex",gap:8}}>
              <button onClick={createProject} style={{flex:1,background:"#27ae60",color:"#fff",border:"none",borderRadius:6,padding:"8px",fontSize:11,fontWeight:"bold",cursor:"pointer"}}>✓ Create</button>
              <button onClick={function(){setCreating(false);setNewName("");}} style={{background:"#1a1a3a",color:"#888",border:"1px solid #3a3a6a",borderRadius:6,padding:"8px 14px",fontSize:11,cursor:"pointer"}}>Cancel</button>
            </div>
          </div>
        )}

        {loading?(
          <div style={{textAlign:"center",padding:40,color:"#555"}}>Loading projects…</div>
        ):projects.length===0?(
          <div style={{textAlign:"center",padding:60,color:"#333"}}>
            <div style={{fontSize:32,marginBottom:12}}>🗺</div>
            <div style={{fontSize:14,color:"#555",marginBottom:8}}>No projects yet</div>
            <div style={{fontSize:11,color:"#333"}}>Create your first project to get started</div>
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {projects.map(function(p){return(
              <div key={p.id} style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:10,padding:16,display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}}
                onClick={function(){if(deleting!==p.id)onOpen(p);}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:"bold",color:"#f0c040",marginBottom:3}}>{p.name}</div>
                  <div style={{fontSize:10,color:"#555"}}>Last saved {fmt(p.updated_at)}</div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <button onClick={function(e){e.stopPropagation();onOpen(p);}}
                    style={{background:"#1a3a5a",color:"#4a9adf",border:"1px solid #2a5a8a",borderRadius:6,padding:"6px 14px",fontSize:10,fontWeight:"bold",cursor:"pointer"}}>
                    Open →
                  </button>
                  {deleting===p.id?(
                    <div style={{display:"flex",gap:4}}>
                      <button onClick={function(e){e.stopPropagation();deleteProject(p.id);}}
                        style={{background:"#3a0a0a",color:"#e74c3c",border:"1px solid #e74c3c",borderRadius:6,padding:"6px 10px",fontSize:10,cursor:"pointer",fontWeight:"bold"}}>Delete</button>
                      <button onClick={function(e){e.stopPropagation();setDeleting(null);}}
                        style={{background:"#1a1a3a",color:"#888",border:"1px solid #3a3a6a",borderRadius:6,padding:"6px 8px",fontSize:10,cursor:"pointer"}}>✕</button>
                    </div>
                  ):(
                    <button onClick={function(e){e.stopPropagation();setDeleting(p.id);}}
                      style={{background:"transparent",color:"#3a3a6a",border:"none",borderRadius:6,padding:"6px 8px",fontSize:12,cursor:"pointer"}}>🗑</button>
                  )}
                </div>
              </div>
            );})}
          </div>
        )}
      </div>
    </div>
  );
}

// ── EDIT PANELS ────────────────────────────────────────────────────────────────
function TownEditPanel({town,onSave,onDelete,onDeselect}){
  var [f,setF]=useState(Object.assign({name:"",townType:"Settlement"},town));
  function upd(k,v){setF(function(p){return Object.assign({},p,{[k]:v});});}
  return(
    <div style={{background:"#12122e",border:"1px solid #1a3a5a",borderRadius:8,padding:10}}>
      <div style={{fontSize:11,color:"#4a9adf",fontWeight:"bold",marginBottom:8}}>🏘 EDIT TOWN</div>
      <Field label="Town Name *"><input value={f.name||""} onChange={function(e){upd("name",e.target.value);}} placeholder="e.g. Ananamong" style={INP}/></Field>
      <Field label="Settlement Type"><select value={f.townType||"Settlement"} onChange={function(e){upd("townType",e.target.value);}} style={SEL}>{TOWN_TYPES.map(function(t){return <option key={t}>{t}</option>;})}</select></Field>
      <div style={{fontSize:9,color:"#555",fontFamily:"monospace",marginBottom:8}}>{f.lat&&f.lon?toDMS(f.lat,true)+" "+toDMS(f.lon,false):""}</div>
      <div style={{display:"flex",gap:4}}>
        <button onClick={function(){onSave(f);}} style={{flex:1,background:"#1a4a2a",color:"#27ae60",border:"1px solid #27ae60",borderRadius:4,padding:"6px",fontSize:10,cursor:"pointer",fontWeight:"bold"}}>✓ Save</button>
        <button onClick={onDelete} style={{background:"#3a0a0a",color:"#e74c3c",border:"1px solid #e74c3c",borderRadius:4,padding:"6px 8px",fontSize:10,cursor:"pointer"}}>🗑</button>
        <button onClick={onDeselect} style={{background:"#1a1a2a",color:"#888",border:"1px solid #3a3a6a",borderRadius:4,padding:"6px 8px",fontSize:10,cursor:"pointer"}}>✕</button>
      </div>
    </div>
  );
}

function SampleEditPanel({sample,allSamples,editingIdx,onSave,onDelete,onDeselect}){
  var [f,setF]=useState(Object.assign({id:"",rock:"Shale",description:"",strike:"",dip:"",notes:""},sample));
  var [errs,setErrs]=useState({});
  function upd(k,v){setF(function(p){return Object.assign({},p,{[k]:v});});}
  function validate(){
    var e={};
    var idErr=validateSampleId(f.id,allSamples,editingIdx);if(idErr)e.id=idErr;
    var sErr=validateStrike(f.strike);if(sErr)e.strike=sErr;
    var dErr=validateDip(f.dip);if(dErr)e.dip=dErr;
    setErrs(e);return Object.keys(e).length===0;
  }
  function save(){if(validate())onSave(f);}
  return(
    <div style={{background:"#12122e",border:"1px solid #5a1a1a",borderRadius:8,padding:10}}>
      <div style={{fontSize:11,color:"#e74c3c",fontWeight:"bold",marginBottom:8}}>🔺 EDIT SAMPLE</div>
      <Field label="Sample ID *"><input value={f.id||""} onChange={function(e){upd("id",e.target.value);}} placeholder="e.g. UU/GS/GLG/25/57" style={INP}/>{errs.id&&<div style={{fontSize:9,color:"#e74c3c",marginTop:-3,marginBottom:4}}>{errs.id}</div>}</Field>
      <Field label="Rock Type"><select value={f.rock||"Shale"} onChange={function(e){upd("rock",e.target.value);}} style={SEL}>{ROCK_TYPES.map(function(r){return <option key={r}>{r}</option>;})}</select></Field>
      <Field label="Field Description"><input value={f.description||""} onChange={function(e){upd("description",e.target.value);}} placeholder="e.g. dark grey, finely laminated" style={INP}/></Field>
      <div style={{display:"flex",gap:6}}>
        <div style={{flex:1}}><Field label="Strike (0–360°)"><input value={f.strike||""} onChange={function(e){upd("strike",e.target.value);}} placeholder="e.g. 045" style={INP}/>{errs.strike&&<div style={{fontSize:9,color:"#e74c3c",marginTop:-3,marginBottom:4}}>{errs.strike}</div>}</Field></div>
        <div style={{flex:1}}><Field label="Dip (0–90°)"><input value={f.dip||""} onChange={function(e){upd("dip",e.target.value);}} placeholder="e.g. 32" style={INP}/>{errs.dip&&<div style={{fontSize:9,color:"#e74c3c",marginTop:-3,marginBottom:4}}>{errs.dip}</div>}</Field></div>
      </div>
      <Field label="Field Notes"><textarea value={f.notes||""} onChange={function(e){upd("notes",e.target.value);}} rows={2} placeholder="Additional observations…" style={Object.assign({},INP,{resize:"none"})}/></Field>
      <div style={{fontSize:9,color:"#555",fontFamily:"monospace",marginBottom:8}}>{f.lat&&f.lon?toDMS(f.lat,true)+" "+toDMS(f.lon,false):""}</div>
      <div style={{display:"flex",gap:4}}>
        <button onClick={save} style={{flex:1,background:"#1a4a2a",color:"#27ae60",border:"1px solid #27ae60",borderRadius:4,padding:"6px",fontSize:10,cursor:"pointer",fontWeight:"bold"}}>✓ Save</button>
        <button onClick={onDelete} style={{background:"#3a0a0a",color:"#e74c3c",border:"1px solid #e74c3c",borderRadius:4,padding:"6px 8px",fontSize:10,cursor:"pointer"}}>🗑</button>
        <button onClick={onDeselect} style={{background:"#1a1a2a",color:"#888",border:"1px solid #3a3a6a",borderRadius:4,padding:"6px 8px",fontSize:10,cursor:"pointer"}}>✕</button>
      </div>
    </div>
  );
}

function GeoEditPanel({zone,onSave,onDelete,onDeselect}){
  var [f,setF]=useState(Object.assign({rock:"Shale",formation:"",period:"Unknown",contact:"Unknown"},zone));
  function upd(k,v){setF(function(p){return Object.assign({},p,{[k]:v});});}
  return(
    <div style={{background:"#12122e",border:"1px solid #2a1a5a",borderRadius:8,padding:10}}>
      <div style={{fontSize:11,color:"#9b59b6",fontWeight:"bold",marginBottom:8}}>🪨 EDIT GEOLOGY ZONE</div>
      <Field label="Rock Type"><select value={f.rock||"Shale"} onChange={function(e){upd("rock",e.target.value);}} style={SEL}>{ROCK_TYPES.map(function(r){return <option key={r}>{r}</option>;})}</select></Field>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}><div style={{width:16,height:16,background:ROCK_COLORS[f.rock]||"#ccc",borderRadius:3,border:"1px solid #fff",flexShrink:0}}/><span style={{fontSize:9,color:"#888"}}>{f.rock}</span></div>
      <Field label="Formation Name"><input value={f.formation||""} onChange={function(e){upd("formation",e.target.value);}} placeholder="e.g. Asu River Group" style={INP}/></Field>
      <Field label="Geological Period"><select value={f.period||"Unknown"} onChange={function(e){upd("period",e.target.value);}} style={SEL}>{GEO_PERIODS.map(function(p){return <option key={p}>{p}</option>;})}</select></Field>
      <Field label="Contact Type"><select value={f.contact||"Unknown"} onChange={function(e){upd("contact",e.target.value);}} style={SEL}>{CONTACT_TYPES.map(function(c){return <option key={c}>{c}</option>;})}</select></Field>
      <div style={{fontSize:9,color:"#555",marginBottom:8}}>{(f.points||[]).length} nodes</div>
      <div style={{display:"flex",gap:4}}>
        <button onClick={function(){onSave(f);}} style={{flex:1,background:"#1a4a2a",color:"#27ae60",border:"1px solid #27ae60",borderRadius:4,padding:"6px",fontSize:10,cursor:"pointer",fontWeight:"bold"}}>✓ Save</button>
        <button onClick={onDelete} style={{background:"#3a0a0a",color:"#e74c3c",border:"1px solid #e74c3c",borderRadius:4,padding:"6px 8px",fontSize:10,cursor:"pointer"}}>🗑</button>
        <button onClick={onDeselect} style={{background:"#1a1a2a",color:"#888",border:"1px solid #3a3a6a",borderRadius:4,padding:"6px 8px",fontSize:10,cursor:"pointer"}}>✕</button>
      </div>
    </div>
  );
}

function RoadEditPanel({road,onSave,onDelete,onDeselect}){
  var [f,setF]=useState(Object.assign({name:"",surface:"Paved"},road));
  function upd(k,v){setF(function(p){return Object.assign({},p,{[k]:v});});}
  return(
    <div style={{background:"#12122e",border:"1px solid #5a2a00",borderRadius:8,padding:10}}>
      <div style={{fontSize:11,color:"#e07030",fontWeight:"bold",marginBottom:8}}>{road.type==="major"?"🟠 EDIT MAJOR ROAD":"⬛ EDIT MINOR ROAD"}</div>
      <Field label="Road Name"><input value={f.name||""} onChange={function(e){upd("name",e.target.value);}} placeholder="e.g. Aba-Umuahia Rd" style={INP}/></Field>
      <Field label="Surface"><select value={f.surface||"Paved"} onChange={function(e){upd("surface",e.target.value);}} style={SEL}>{ROAD_SURFACES.map(function(s){return <option key={s}>{s}</option>;})}</select></Field>
      <div style={{fontSize:9,color:"#555",marginBottom:8}}>{(f.points||[]).length} nodes</div>
      <div style={{display:"flex",gap:4}}>
        <button onClick={function(){onSave(f);}} style={{flex:1,background:"#1a4a2a",color:"#27ae60",border:"1px solid #27ae60",borderRadius:4,padding:"6px",fontSize:10,cursor:"pointer",fontWeight:"bold"}}>✓ Save</button>
        <button onClick={onDelete} style={{background:"#3a0a0a",color:"#e74c3c",border:"1px solid #e74c3c",borderRadius:4,padding:"6px 8px",fontSize:10,cursor:"pointer"}}>🗑</button>
        <button onClick={onDeselect} style={{background:"#1a1a2a",color:"#888",border:"1px solid #3a3a6a",borderRadius:4,padding:"6px 8px",fontSize:10,cursor:"pointer"}}>✕</button>
      </div>
    </div>
  );
}

function RiverEditPanel({river,onSave,onDelete,onDeselect}){
  var [f,setF]=useState(Object.assign({name:"",flow:"Unknown"},river));
  function upd(k,v){setF(function(p){return Object.assign({},p,{[k]:v});});}
  return(
    <div style={{background:"#12122e",border:"1px solid #003a5a",borderRadius:8,padding:10}}>
      <div style={{fontSize:11,color:"#2980d9",fontWeight:"bold",marginBottom:8}}>🌊 EDIT RIVER</div>
      <Field label="River Name"><input value={f.name||""} onChange={function(e){upd("name",e.target.value);}} placeholder="e.g. Cross River" style={INP}/></Field>
      <Field label="Flow Direction"><select value={f.flow||"Unknown"} onChange={function(e){upd("flow",e.target.value);}} style={SEL}>{RIVER_FLOW.map(function(d){return <option key={d}>{d}</option>;})}</select></Field>
      <div style={{fontSize:9,color:"#555",marginBottom:8}}>{(f.points||[]).length} nodes</div>
      <div style={{display:"flex",gap:4}}>
        <button onClick={function(){onSave(f);}} style={{flex:1,background:"#1a4a2a",color:"#27ae60",border:"1px solid #27ae60",borderRadius:4,padding:"6px",fontSize:10,cursor:"pointer",fontWeight:"bold"}}>✓ Save</button>
        <button onClick={onDelete} style={{background:"#3a0a0a",color:"#e74c3c",border:"1px solid #e74c3c",borderRadius:4,padding:"6px 8px",fontSize:10,cursor:"pointer"}}>🗑</button>
        <button onClick={onDeselect} style={{background:"#1a1a2a",color:"#888",border:"1px solid #3a3a6a",borderRadius:4,padding:"6px 8px",fontSize:10,cursor:"pointer"}}>✕</button>
      </div>
    </div>
  );
}

function CompletenessBar({score}){
  var color=score>=80?"#27ae60":score>=50?"#f0c040":"#e74c3c";
  return(
    <div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10,marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <span style={{fontSize:11,color:"#f0c040",fontWeight:"bold"}}>DATA COMPLETENESS</span>
        <span style={{fontSize:16,fontWeight:"bold",color}}>{score}%</span>
      </div>
      <div style={{height:6,background:"#1a1a3a",borderRadius:3,overflow:"hidden"}}>
        <div style={{height:"100%",width:score+"%",background:color,borderRadius:3,transition:"width 0.3s"}}/>
      </div>
      <div style={{fontSize:9,color:"#444",marginTop:5}}>{score<50?"Fill in feature attributes to improve quality":score<80?"Good progress — add formation names and descriptions":"Map data is well documented"}</div>
    </div>
  );
}

function ValidationBanner({errors}){
  if(!errors||errors.length===0)return null;
  return(
    <div style={{background:"#3a0a0a",border:"1px solid #e74c3c",borderRadius:6,padding:"8px 10px",marginBottom:8}}>
      <div style={{fontSize:10,color:"#e74c3c",fontWeight:"bold",marginBottom:4}}>⚠ VALIDATION WARNINGS</div>
      {errors.map(function(e,i){return <div key={i} style={{fontSize:9,color:"#ffaaaa",marginBottom:2}}>• {e}</div>;})}
    </div>
  );
}

// ── EXPORT FUNCTIONS ───────────────────────────────────────────────────────────
function exportGeoJSON(towns,roads,rivers,samples,geoZones,projectName){
  var features=[];
  towns.forEach(function(t){features.push({type:"Feature",geometry:{type:"Point",coordinates:[t.lon,t.lat]},properties:{type:"town",name:t.name||"",settlementType:t.townType||"Settlement"}});});
  samples.forEach(function(s){features.push({type:"Feature",geometry:{type:"Point",coordinates:[s.lon,s.lat]},properties:{type:"sample",id:s.id||"",rock:s.rock||"",description:s.description||"",strike:s.strike||"",dip:s.dip||"",notes:s.notes||""}});});
  roads.forEach(function(r){if(r.points.length<2)return;features.push({type:"Feature",geometry:{type:"LineString",coordinates:r.points.map(function(p){return[p.lon,p.lat];})},properties:{type:"road",roadType:r.type||"minor",name:r.name||"",surface:r.surface||""}});});
  rivers.forEach(function(r){if(r.points.length<2)return;features.push({type:"Feature",geometry:{type:"LineString",coordinates:r.points.map(function(p){return[p.lon,p.lat];})},properties:{type:"river",name:r.name||"",flow:r.flow||""}});});
  geoZones.forEach(function(z){if(z.points.length<3)return;var coords=z.points.map(function(p){return[p.lon,p.lat];});coords.push(coords[0]);features.push({type:"Feature",geometry:{type:"Polygon",coordinates:[coords]},properties:{type:"geology",rock:z.rock||"",formation:z.formation||"",period:z.period||"",contact:z.contact||""}});});
  var blob=new Blob([JSON.stringify({type:"FeatureCollection",name:projectName||"export",features},null,2)],{type:"application/json"});
  var url=URL.createObjectURL(blob),a=document.createElement("a");
  a.download=(projectName||"geomap").replace(/\s+/g,"_")+".geojson";a.href=url;a.click();
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
}

function exportKML(towns,roads,rivers,samples,geoZones,projectName){
  function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
  var L=[];
  L.push('<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>'+esc(projectName||"Export")+'</name>');
  L.push('<Folder><name>Towns</name>');
  towns.forEach(function(t){L.push('<Placemark><name>'+esc(t.name)+'</name><description>'+esc(t.townType||"Settlement")+'</description><Point><coordinates>'+t.lon+','+t.lat+',0</coordinates></Point></Placemark>');});
  L.push('</Folder><Folder><name>Sample Points</name>');
  samples.forEach(function(s){L.push('<Placemark><name>'+esc(s.id)+'</name><description>'+esc([s.rock,s.description,s.strike?"Strike: "+s.strike:"",s.dip?"Dip: "+s.dip+"\u00b0":"",s.notes].filter(Boolean).join(" | "))+'</description><Point><coordinates>'+s.lon+','+s.lat+',0</coordinates></Point></Placemark>');});
  L.push('</Folder><Folder><name>Roads</name>');
  roads.forEach(function(r,i){if(r.points.length<2)return;L.push('<Placemark><name>'+esc(r.name||(r.type==="major"?"Major Road":"Minor Road")+" "+(i+1))+'</name><description>'+esc(r.type+(r.surface?" | "+r.surface:""))+'</description><LineString><coordinates>'+r.points.map(function(p){return p.lon+","+p.lat+",0";}).join(" ")+'</coordinates></LineString></Placemark>');});
  L.push('</Folder><Folder><name>Rivers</name>');
  rivers.forEach(function(r,i){if(r.points.length<2)return;L.push('<Placemark><name>'+esc(r.name||"River "+(i+1))+'</name><description>'+esc(r.flow?"Flow: "+r.flow:"")+'</description><LineString><coordinates>'+r.points.map(function(p){return p.lon+","+p.lat+",0";}).join(" ")+'</coordinates></LineString></Placemark>');});
  L.push('</Folder><Folder><name>Geology Zones</name>');
  geoZones.forEach(function(z,i){if(z.points.length<3)return;var pts=z.points.concat([z.points[0]]);L.push('<Placemark><name>'+esc(z.formation||z.rock)+'</name><description>'+esc([z.rock,z.period,z.contact].filter(Boolean).join(" | "))+'</description><Polygon><outerBoundaryIs><LinearRing><coordinates>'+pts.map(function(p){return p.lon+","+p.lat+",0";}).join(" ")+'</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>');});
  L.push('</Folder></Document></kml>');
  var blob=new Blob([L.join("\n")],{type:"application/vnd.google-earth.kml+xml"});
  var url=URL.createObjectURL(blob),a=document.createElement("a");
  a.download=(projectName||"geomap").replace(/\s+/g,"_")+".kml";a.href=url;a.click();
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
}

function exportCSV(samples,projectName){
  var rows=[["Sample_ID","Rock_Type","Description","Latitude","Longitude","Strike","Dip","Notes"].join(",")];
  samples.forEach(function(s){
    function q(v){v=String(v||"");if(v.indexOf(",")>=0||v.indexOf('"')>=0||v.indexOf("\n")>=0)return'"'+v.replace(/"/g,'""')+'"';return v;}
    rows.push([q(s.id),q(s.rock),q(s.description),s.lat,s.lon,q(s.strike),q(s.dip),q(s.notes)].join(","));
  });
  var blob=new Blob([rows.join("\n")],{type:"text/csv"});
  var url=URL.createObjectURL(blob),a=document.createElement("a");
  a.download=(projectName||"geomap").replace(/\s+/g,"_")+"_samples.csv";a.href=url;a.click();
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
}

// ── MAP RENDERER ───────────────────────────────────────────────────────────────
function renderMap(type,data,projectName,exportDPI){
  exportDPI=exportDPI||300;
  const W=1123,H=1587;
  const MARGIN={top:70,left:60,right:60,bottom:220};
  const MAP_W=W-MARGIN.left-MARGIN.right,MAP_H=H-MARGIN.top-MARGIN.bottom;
  const {towns,roads,rivers,samples,geoZones,center,zoom}=data;
  var html=`<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>${type==="map2"?"MAP 2":"MAP 3"} | ${projectName}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"><\/script>
<style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#e8e8e8;font-family:"Times New Roman",serif;}.page{width:${W}px;margin:20px auto;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,0.18);}canvas{display:block;}.controls{width:${W}px;margin:0 auto;padding:12px;background:#f5f5f5;border:1px solid #ccc;display:flex;gap:10px;align-items:center;flex-wrap:wrap;}.controls button{background:#2c5f8a;color:#fff;border:none;padding:8px 18px;border-radius:5px;font-weight:bold;cursor:pointer;font-size:13px;font-family:sans-serif;}.controls button:hover{background:#1a4a70;}.dpi-badge{background:#e8f4e8;border:1px solid #4a8a4a;border-radius:4px;padding:4px 10px;font-size:12px;color:#2a6a2a;font-family:sans-serif;font-weight:bold;}@media print{body{background:#fff;}.controls{display:none;}.page{margin:0;box-shadow:none;}@page{size:A3 portrait;margin:0;}}</style>
</head><body>
<div class="controls">
  <button onclick="download300PNG()">⬇ PNG ${exportDPI}dpi</button>
  <button onclick="downloadPDF()">⬇ PDF A3</button>
  <button onclick="window.print()">🖨 Print</button>
  <span class="dpi-badge">Quality: ${exportDPI} dpi</span>
</div>
<div class="page"><canvas id="mapCanvas" width="${W}" height="${H}"></canvas></div>
<script>
var W=${W},H=${H},MARGIN={top:${MARGIN.top},left:${MARGIN.left},right:${MARGIN.right},bottom:${MARGIN.bottom}};
var MAP_W=${MAP_W},MAP_H=${MAP_H},center=${JSON.stringify(center)},zoom=${zoom};
var towns=${JSON.stringify(towns)},roads=${JSON.stringify(roads)},rivers=${JSON.stringify(rivers)};
var samples=${JSON.stringify(samples)},geoZones=${JSON.stringify(geoZones)};
var ROCK_COLORS=${JSON.stringify(ROCK_COLORS)},projectName=${JSON.stringify(projectName)},mapType=${JSON.stringify(type)};
var exportDPI=${exportDPI},SCREEN_DPI=96,TILE_SIZE=256,tileCache={};
var canvas=document.getElementById("mapCanvas"),ctx=canvas.getContext("2d");
function lon2tile(lon,z){return Math.floor(((lon+180)/360)*Math.pow(2,z));}
function lat2tile(lat,z){return Math.floor(((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2)*Math.pow(2,z));}
function tile2lon(x,z){return x/Math.pow(2,z)*360-180;}
function tile2lat(y,z){var n=Math.PI-2*Math.PI*y/Math.pow(2,z);return 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n)));}
function ll2px(lat,lon){var ws=TILE_SIZE*Math.pow(2,zoom);function ly(la){var s=Math.sin(la*Math.PI/180);return ws/(2*Math.PI)*(Math.PI-Math.log((1+s)/(1-s))/2);}function lx(lo){return ws*(lo+180)/360;}return{x:MAP_W/2+(lx(lon)-lx(center.lon))+MARGIN.left,y:MAP_H/2+(ly(lat)-ly(center.lat))+MARGIN.top};}
function px2ll(px,py){var ws=TILE_SIZE*Math.pow(2,zoom);function ly(la){var s=Math.sin(la*Math.PI/180);return ws/(2*Math.PI)*(Math.PI-Math.log((1+s)/(1-s))/2);}function lx(lo){return ws*(lo+180)/360;}var wx=lx(center.lon)+(px-MARGIN.left-MAP_W/2),wy=ly(center.lat)+(py-MARGIN.top-MAP_H/2);var n=Math.PI-2*Math.PI*wy/ws;return{lat:180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))),lon:wx/ws*360-180};}
function toDMS(deg,isLat){var d=Math.abs(deg),dd=Math.floor(d),mm=Math.floor((d-dd)*60),ss=Math.round(((d-dd)*60-mm)*60);return dd+"\u00b0"+mm+"'"+ss+'"'+(isLat?(deg>=0?"N":"S"):(deg>=0?"E":"W"));}
function loadTile(z,x,y,cb){var k=z+"/"+x+"/"+y;if(tileCache[k]){cb(tileCache[k]);return;}var img=new Image();img.crossOrigin="anonymous";img.onload=function(){tileCache[k]=img;cb(img);};img.onerror=function(){cb(null);};img.src="https://tile.openstreetmap.org/"+z+"/"+x+"/"+y+".png";}
${DRAW_SMOOTH_SRC}
function drawAll(){
  ctx.clearRect(0,0,W,H);ctx.fillStyle="#fff";ctx.fillRect(0,0,W,H);
  ctx.strokeStyle="#000";ctx.lineWidth=3;ctx.strokeRect(2,2,W-4,H-4);
  ctx.strokeStyle="#000";ctx.lineWidth=1;ctx.strokeRect(8,8,W-16,H-16);
  ctx.strokeStyle="#000";ctx.lineWidth=1.5;ctx.strokeRect(MARGIN.left,MARGIN.top,MAP_W,MAP_H);
  ctx.save();ctx.beginPath();ctx.rect(MARGIN.left,MARGIN.top,MAP_W,MAP_H);ctx.clip();
  var cx2=lon2tile(center.lon,zoom),cy2=lat2tile(center.lat,zoom),range=Math.ceil(Math.max(MAP_W,MAP_H)/TILE_SIZE/2)+2;
  for(var tx=cx2-range;tx<=cx2+range;tx++){for(var ty=cy2-range;ty<=cy2+range;ty++){var max=Math.pow(2,zoom);if(ty<0||ty>=max)continue;var ox=tx,rx=((tx%max)+max)%max,img=tileCache[zoom+"/"+rx+"/"+ty],pt=ll2px(tile2lat(ty,zoom),tile2lon(ox,zoom));if(img){ctx.globalAlpha=mapType==="map3"?0.35:0.65;ctx.drawImage(img,Math.round(pt.x),Math.round(pt.y),TILE_SIZE,TILE_SIZE);ctx.globalAlpha=1;}else{ctx.fillStyle="#f5f5f5";ctx.fillRect(Math.round(pt.x),Math.round(pt.y),TILE_SIZE,TILE_SIZE);}}}
  if(mapType==="map3"){geoZones.forEach(function(z){if(z.points.length<3)return;ctx.beginPath();z.points.forEach(function(pt,i){var pp=ll2px(pt.lat,pt.lon);if(i===0)ctx.moveTo(pp.x,pp.y);else ctx.lineTo(pp.x,pp.y);});ctx.closePath();ctx.globalAlpha=0.7;ctx.fillStyle=ROCK_COLORS[z.rock]||"#ccc";ctx.fill();ctx.globalAlpha=1;ctx.strokeStyle="#333";ctx.lineWidth=1.5;ctx.stroke();var cx3=z.points.reduce(function(s,pt){return s+pt.lon;},0)/z.points.length,cy3=z.points.reduce(function(s,pt){return s+pt.lat;},0)/z.points.length,cp=ll2px(cy3,cx3);ctx.fillStyle="#000";ctx.font="bold 8px Times New Roman";ctx.textAlign="center";ctx.fillText(z.formation&&z.formation.trim()?z.formation:z.rock,cp.x,cp.y);ctx.textAlign="left";});}
  roads.forEach(function(road){if(road.points.length<2)return;var pts=road.points.map(function(pt){return ll2px(pt.lat,pt.lon);});if(road.type==="major"){drawSmooth(ctx,pts);ctx.strokeStyle="#c0392b";ctx.lineWidth=3;ctx.stroke();drawSmooth(ctx,pts);ctx.strokeStyle="#e07030";ctx.lineWidth=1.5;ctx.stroke();}else{drawSmooth(ctx,pts);ctx.strokeStyle="#888";ctx.lineWidth=1.2;ctx.stroke();}if(road.name&&road.name.trim()){var mid=road.points[Math.floor(road.points.length/2)],mp=ll2px(mid.lat,mid.lon);ctx.fillStyle="#333";ctx.font="7px Times New Roman";ctx.fillText(road.name,mp.x+2,mp.y-3);}});
  rivers.forEach(function(river){if(river.points.length<2)return;var pts=river.points.map(function(pt){return ll2px(pt.lat,pt.lon);});drawSmooth(ctx,pts);ctx.strokeStyle="#2471a3";ctx.lineWidth=1.8;ctx.stroke();if(river.name&&river.name.trim()){var mid=river.points[Math.floor(river.points.length/2)],mp=ll2px(mid.lat,mid.lon);ctx.fillStyle="#2471a3";ctx.font="italic 7px Times New Roman";ctx.fillText(river.name,mp.x+2,mp.y-3);}});
  towns.forEach(function(town){var pp=ll2px(town.lat,town.lon);ctx.fillStyle="#000";ctx.beginPath();ctx.arc(pp.x,pp.y,4,0,Math.PI*2);ctx.fill();ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(pp.x,pp.y,2.5,0,Math.PI*2);ctx.fill();ctx.fillStyle="#000";ctx.font="bold 8px Times New Roman";ctx.fillText(town.name||"Town",pp.x+5,pp.y-3);});
  samples.forEach(function(s){var pp=ll2px(s.lat,s.lon),sz=mapType==="map2"?8:5;ctx.fillStyle="#c0392b";ctx.beginPath();ctx.moveTo(pp.x,pp.y-sz);ctx.lineTo(pp.x+sz*0.75,pp.y+sz*0.5);ctx.lineTo(pp.x-sz*0.75,pp.y+sz*0.5);ctx.closePath();ctx.fill();ctx.strokeStyle="#7b241c";ctx.lineWidth=0.5;ctx.stroke();if(mapType==="map2"){ctx.fillStyle="#000";ctx.font="7px Times New Roman";ctx.fillText(s.id,pp.x+sz+1,pp.y+2);}if(s.strike&&s.dip&&mapType==="map3"){var sa=parseFloat(s.strike)*Math.PI/180,sl=10;ctx.save();ctx.translate(pp.x,pp.y);ctx.strokeStyle="#1a7a1a";ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(-sl*Math.sin(sa),-sl*Math.cos(sa));ctx.lineTo(sl*Math.sin(sa),sl*Math.cos(sa));var da=sa+Math.PI/2;ctx.moveTo(0,0);ctx.lineTo(sl*0.5*Math.sin(da),sl*0.5*Math.cos(da));ctx.stroke();ctx.fillStyle="#1a7a1a";ctx.font="6px Times New Roman";ctx.fillText(s.dip+"\u00b0",sl*0.6*Math.sin(da),sl*0.6*Math.cos(da));ctx.restore();}});
  ctx.restore();
  ctx.save();ctx.strokeStyle="rgba(0,0,0,0.3)";ctx.lineWidth=0.5;ctx.setLineDash([3,3]);ctx.font="8px Times New Roman";ctx.fillStyle="#000";
  var step=zoom<=6?5:zoom<=8?2:zoom<=10?1:0.5,tl=px2ll(MARGIN.left,MARGIN.top),br=px2ll(MARGIN.left+MAP_W,MARGIN.top+MAP_H);
  for(var lo=Math.ceil(tl.lon/step)*step;lo<=br.lon;lo+=step){var ppx=ll2px(center.lat,lo).x;if(ppx<MARGIN.left||ppx>MARGIN.left+MAP_W)continue;ctx.beginPath();ctx.moveTo(ppx,MARGIN.top);ctx.lineTo(ppx,MARGIN.top+MAP_H);ctx.stroke();ctx.fillText(toDMS(lo,false),ppx-14,MARGIN.top+MAP_H+12);ctx.fillText(toDMS(lo,false),ppx-14,MARGIN.top-4);}
  for(var la=Math.floor(tl.lat/step)*step;la>=br.lat;la-=step){var ppy=ll2px(la,center.lon).y;if(ppy<MARGIN.top||ppy>MARGIN.top+MAP_H)continue;ctx.beginPath();ctx.moveTo(MARGIN.left,ppy);ctx.lineTo(MARGIN.left+MAP_W,ppy);ctx.stroke();ctx.save();ctx.translate(MARGIN.left-4,ppy+14);ctx.rotate(-Math.PI/2);ctx.fillText(toDMS(la,true),0,0);ctx.restore();ctx.save();ctx.translate(MARGIN.left+MAP_W+12,ppy+14);ctx.rotate(-Math.PI/2);ctx.fillText(toDMS(la,true),0,0);ctx.restore();}
  ctx.setLineDash([]);ctx.restore();
  ctx.save();ctx.font="bold 16px Times New Roman";ctx.fillStyle="#000";ctx.textAlign="center";ctx.fillText(mapType==="map2"?"MAP 2: SAMPLE LOCATION MAP":"MAP 3: GEOLOGIC MAP",MARGIN.left+MAP_W/2,MARGIN.top-30);ctx.font="11px Times New Roman";ctx.fillText("OF "+(projectName||"STUDY AREA").toUpperCase(),MARGIN.left+MAP_W/2,MARGIN.top-14);ctx.textAlign="left";ctx.restore();
  var BY=MARGIN.top+MAP_H+10;ctx.save();ctx.strokeStyle="#000";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(MARGIN.left,BY);ctx.lineTo(W-MARGIN.right,BY);ctx.stroke();ctx.restore();
  var ax=MARGIN.left+60,ay=BY+60;ctx.save();ctx.fillStyle="#fff";ctx.strokeStyle="#000";ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(ax,ay,28,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle="#000";ctx.beginPath();ctx.moveTo(ax,ay-22);ctx.lineTo(ax-9,ay+5);ctx.lineTo(ax+9,ay+5);ctx.closePath();ctx.fill();ctx.fillStyle="#fff";ctx.beginPath();ctx.moveTo(ax,ay+22);ctx.lineTo(ax-9,ay-5);ctx.lineTo(ax+9,ay-5);ctx.closePath();ctx.fill();ctx.strokeStyle="#000";ctx.lineWidth=0.8;ctx.beginPath();ctx.moveTo(ax,ay+22);ctx.lineTo(ax-9,ay-5);ctx.lineTo(ax+9,ay-5);ctx.closePath();ctx.stroke();ctx.fillStyle="#000";ctx.font="bold 15px Times New Roman";ctx.textAlign="center";ctx.fillText("N",ax,ay-27);ctx.textAlign="left";ctx.restore();
  var mpp=(156543.03392*Math.cos(center.lat*Math.PI/180))/Math.pow(2,zoom),bm=zoom>=12?500:zoom>=10?2000:zoom>=8?20000:zoom>=6?100000:500000,bp=Math.min(bm/mpp,180),sx=MARGIN.left+20,sy=BY+115;
  ctx.save();ctx.font="bold 10px Times New Roman";ctx.fillStyle="#000";ctx.fillText("SCALE",sx,sy-16);ctx.fillStyle="#000";ctx.fillRect(sx,sy-10,bp/2,10);ctx.fillStyle="#fff";ctx.fillRect(sx+bp/2,sy-10,bp/2,10);ctx.strokeStyle="#000";ctx.lineWidth=1;ctx.strokeRect(sx,sy-10,bp,10);ctx.font="9px Times New Roman";ctx.fillStyle="#000";ctx.fillText("0",sx-2,sy+12);ctx.fillText(bm>=1000?bm/1000+" km":bm+" m",sx+bp-10,sy+12);ctx.restore();
  var lx=MARGIN.left+200,ly2=BY+20;ctx.save();ctx.font="bold 11px Times New Roman";ctx.fillStyle="#000";ctx.fillText("LEGEND",lx,ly2);ly2+=16;ctx.strokeStyle="#000";ctx.lineWidth=0.8;ctx.beginPath();ctx.moveTo(lx,ly2);ctx.lineTo(lx+300,ly2);ctx.stroke();ly2+=12;var col1x=lx,col2x=lx+160,row=ly2;ctx.fillStyle="#000";ctx.beginPath();ctx.arc(col1x+7,row,5,0,Math.PI*2);ctx.fill();ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(col1x+7,row,3,0,Math.PI*2);ctx.fill();ctx.fillStyle="#000";ctx.font="10px Times New Roman";ctx.fillText("Town",col1x+16,row+4);ctx.strokeStyle="#c0392b";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(col2x,row);ctx.lineTo(col2x+24,row);ctx.stroke();ctx.fillStyle="#000";ctx.font="10px Times New Roman";ctx.fillText("Major Road",col2x+28,row+4);row+=18;ctx.strokeStyle="#888";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(col1x,row);ctx.lineTo(col1x+24,row);ctx.stroke();ctx.fillStyle="#000";ctx.font="10px Times New Roman";ctx.fillText("Minor Road",col1x+28,row+4);ctx.strokeStyle="#2471a3";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(col2x,row);ctx.lineTo(col2x+24,row);ctx.stroke();ctx.fillStyle="#000";ctx.font="10px Times New Roman";ctx.fillText("River",col2x+28,row+4);row+=18;ctx.fillStyle="#c0392b";ctx.beginPath();ctx.moveTo(col1x+8,row-9);ctx.lineTo(col1x+15,row+4);ctx.lineTo(col1x+1,row+4);ctx.closePath();ctx.fill();ctx.fillStyle="#000";ctx.font="10px Times New Roman";ctx.fillText("Sample Point",col1x+20,row+4);row+=18;
  if(mapType==="map3"){ctx.beginPath();ctx.moveTo(lx,row);ctx.lineTo(lx+300,row);ctx.stroke();row+=12;ctx.font="bold 10px Times New Roman";ctx.fillStyle="#000";ctx.fillText("LITHOLOGY",lx,row);row+=12;var usedRocks={};geoZones.forEach(function(z){var lbl=z.formation&&z.formation.trim()?z.formation+" ("+z.rock+")":z.rock;usedRocks[lbl]=ROCK_COLORS[z.rock]||"#ccc";});var col=0;Object.keys(usedRocks).forEach(function(lbl){var rx2=col===0?col1x:col2x,ry=row;ctx.fillStyle=usedRocks[lbl];ctx.fillRect(rx2,ry-10,14,12);ctx.strokeStyle="#333";ctx.lineWidth=0.5;ctx.strokeRect(rx2,ry-10,14,12);ctx.fillStyle="#000";ctx.font="9px Times New Roman";ctx.fillText(lbl,rx2+18,ry);col++;if(col>=2){col=0;row+=16;}});}
  ctx.restore();
  var tbx=W-MARGIN.right-280,tby=BY+10,tbw=260,tbh=H-BY-20;ctx.save();ctx.strokeStyle="#000";ctx.lineWidth=1.2;ctx.strokeRect(tbx,tby,tbw,tbh);ctx.beginPath();ctx.moveTo(tbx,tby+tbh*0.45);ctx.lineTo(tbx+tbw,tby+tbh*0.45);ctx.stroke();ctx.font="bold 11px Times New Roman";ctx.fillStyle="#000";ctx.textAlign="center";ctx.fillText(mapType==="map2"?"MAP 2: SAMPLE LOCATION MAP":"MAP 3: GEOLOGIC MAP",tbx+tbw/2,tby+20);ctx.font="10px Times New Roman";ctx.fillText("OF "+(projectName||"STUDY AREA").toUpperCase(),tbx+tbw/2,tby+36);ctx.font="9px Times New Roman";ctx.fillStyle="#555";ctx.fillText("Projection: WGS84 / Geographic",tbx+tbw/2,tby+tbh*0.45+18);ctx.fillText("Base map: \u00a9 OpenStreetMap contributors",tbx+tbw/2,tby+tbh*0.45+32);ctx.fillText("Generated by Geo Mapping System",tbx+tbw/2,tby+tbh*0.45+46);ctx.textAlign="left";ctx.restore();
}
function init(){var cx2=lon2tile(center.lon,zoom),cy2=lat2tile(center.lat,zoom),range=Math.ceil(Math.max(MAP_W,MAP_H)/TILE_SIZE/2)+2,toLoad=[];for(var tx=cx2-range;tx<=cx2+range;tx++){for(var ty=cy2-range;ty<=cy2+range;ty++){var max=Math.pow(2,zoom);if(ty<0||ty>=max)continue;toLoad.push({z:zoom,x:((tx%max)+max)%max,y:ty});}}if(toLoad.length===0){drawAll();return;}toLoad.forEach(function(t){loadTile(t.z,t.x,t.y,function(){drawAll();});})}
function getFilename(ext){return(mapType==="map2"?"MAP2_":"MAP3_")+(projectName||"geomap").replace(/\s+/g,"_")+"."+ext;}
function download300PNG(){var SCALE=exportDPI/SCREEN_DPI;if(exportDPI>=1200){if(!confirm("1200dpi = ~120MB. Continue?"))return;}var hiCanvas=document.createElement("canvas");hiCanvas.width=Math.round(W*SCALE);hiCanvas.height=Math.round(H*SCALE);var hiCtx=hiCanvas.getContext("2d");hiCtx.scale(SCALE,SCALE);hiCtx.fillStyle="#fff";hiCtx.fillRect(0,0,W,H);var cx2=lon2tile(center.lon,zoom),cy2=lat2tile(center.lat,zoom),range=Math.ceil(Math.max(MAP_W,MAP_H)/TILE_SIZE/2)+2;for(var tx=cx2-range;tx<=cx2+range;tx++){for(var ty=cy2-range;ty<=cy2+range;ty++){var max=Math.pow(2,zoom);if(ty<0||ty>=max)continue;var ox=tx,rx=((tx%max)+max)%max,img=tileCache[zoom+"/"+rx+"/"+ty],pt=ll2px(tile2lat(ty,zoom),tile2lon(ox,zoom));if(img){hiCtx.globalAlpha=mapType==="map3"?0.35:0.65;hiCtx.drawImage(img,Math.round(pt.x),Math.round(pt.y),TILE_SIZE,TILE_SIZE);hiCtx.globalAlpha=1;}}}hiCtx.drawImage(canvas,0,0,W,H);hiCanvas.toBlob(function(blob){var url=URL.createObjectURL(blob),a=document.createElement("a");a.download=getFilename("png");a.href=url;a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);},"image/png");}
function downloadPDF(){if(!window.jspdf){alert("PDF library loading. Try again.");return;}var doc=new window.jspdf.jsPDF({orientation:"portrait",unit:"mm",format:"a3"});doc.addImage(canvas.toDataURL("image/png",1.0),"PNG",0,0,297,420);doc.save(getFilename("pdf"));}
window.download300PNG=download300PNG;window.downloadPDF=downloadPDF;
init();
<\/script></body></html>`;
  return html;
}

// ── CONSTANTS ──────────────────────────────────────────────────────────────────
const MODES=["pan","town","road-major","road-minor","river","sample","geology","select"];
const MODE_LABELS={pan:"✋ Pan",town:"🏘 Town","road-major":"🟠 Major Road","road-minor":"⬛ Minor Road",river:"🌊 River",sample:"🔺 Sample",geology:"🪨 Geology",select:"👆 Select"};
const MODE_COLORS={pan:"#2a2a4a",town:"#1a3a5a","road-major":"#5a2a00","road-minor":"#2a2a2a",river:"#003a5a",sample:"#5a1a1a",geology:"#2a1a5a",select:"#1a3a1a"};
const DPI_OPTIONS=[{dpi:150,label:"150 dpi",desc:"Screen / digital"},{dpi:300,label:"300 dpi",desc:"Thesis standard"},{dpi:600,label:"600 dpi",desc:"NGSA publication"},{dpi:1200,label:"1200 dpi",desc:"Large format print"}];

// ── MAIN COMPONENT ─────────────────────────────────────────────────────────────
export default function GeoMappingSystem(){
  // ── Auth / session state ────────────────────────────────────────────
  var [user,setUser]=useState(null);
  var [authLoading,setAuthLoading]=useState(true);
  var [currentProject,setCurrentProject]=useState(null);
  var [showDashboard,setShowDashboard]=useState(false);
  var [saveStatus,setSaveStatus]=useState("saved"); // saved | saving | unsaved | error

  // ── Map state ───────────────────────────────────────────────────────
  var canvasRef=useRef(null),containerRef=useRef(null);
  var [center,setCenter]=useState({lat:NIGERIA_CENTER[0],lon:NIGERIA_CENTER[1]});
  var [zoom,setZoom]=useState(NIGERIA_ZOOM);
  var [mode,setMode]=useState("pan");
  var [tiles,setTiles]=useState([]);
  var [tick,setTick]=useState(0);
  var [size,setSize]=useState({w:800,h:560});
  var [tab,setTab]=useState("draw");
  var [exportDPI,setExportDPI]=useState(300);
  var [cursorLL,setCursorLL]=useState(null);

  var [towns,setTowns]=useState([]);
  var [roads,setRoads]=useState([]);
  var [rivers,setRivers]=useState([]);
  var [samples,setSamples]=useState([]);
  var [geoZones,setGeoZones]=useState([]);

  var [activeRoadIdx,setActiveRoadIdx]=useState(null);
  var [activeRiverIdx,setActiveRiverIdx]=useState(null);
  var [activeGeoIdx,setActiveGeoIdx]=useState(null);
  var [previewPin,setPreviewPin]=useState(null);
  var [selectedFeature,setSelectedFeature]=useState(null);
  var [mousePos,setMousePos]=useState(null);

  var [townForm,setTownForm]=useState({name:"",townType:"Settlement"});
  var [sampleForm,setSampleForm]=useState({id:"",rock:"Shale",description:"",strike:"",dip:"",notes:""});
  var [sampleFormErrs,setSampleFormErrs]=useState({});
  var [geoRock,setGeoRock]=useState("Shale");
  var dragRef=useRef(null);
  var autoSaveRef=useRef(null);
  var W=size.w,H=size.h;

  // ── Auth listener ───────────────────────────────────────────────────
  useEffect(function(){
    supabase.auth.getSession().then(function(res){
      setUser(res.data.session?.user||null);
      setAuthLoading(false);
      if(res.data.session?.user)setShowDashboard(true);
    });
    var {data:{subscription}}=supabase.auth.onAuthStateChange(function(_event,session){
      setUser(session?.user||null);
      if(!session?.user){setCurrentProject(null);setShowDashboard(false);}
      else{setShowDashboard(true);}
    });
    return function(){subscription.unsubscribe();};
  },[]);

  // ── Load project data ───────────────────────────────────────────────
  async function loadProject(project){
    setCurrentProject(project);
    setShowDashboard(false);
    setCenter({lat:project.center_lat||NIGERIA_CENTER[0],lon:project.center_lon||NIGERIA_CENTER[1]});
    setZoom(project.zoom||NIGERIA_ZOOM);

    // Load all feature tables in parallel
    var [t,ro,ri,s,g]=await Promise.all([
      supabase.from("towns").select("*").eq("project_id",project.id),
      supabase.from("roads").select("*").eq("project_id",project.id),
      supabase.from("rivers").select("*").eq("project_id",project.id),
      supabase.from("samples").select("*").eq("project_id",project.id),
      supabase.from("geology_zones").select("*").eq("project_id",project.id),
    ]);

    setTowns((t.data||[]).map(function(x){return{lat:x.lat,lon:x.lon,name:x.name,townType:x.town_type,_id:x.id};}));
    setRoads((ro.data||[]).map(function(x){return{type:x.road_type,name:x.name,surface:x.surface,points:x.points||[],_id:x.id};}));
    setRivers((ri.data||[]).map(function(x){return{name:x.name,flow:x.flow,points:x.points||[],_id:x.id};}));
    setSamples((s.data||[]).map(function(x){return{lat:x.lat,lon:x.lon,id:x.sample_id,rock:x.rock,description:x.description,strike:x.strike,dip:x.dip,notes:x.notes,_id:x.id};}));
    setGeoZones((g.data||[]).map(function(x){return{rock:x.rock,formation:x.formation,period:x.period,contact:x.contact,points:x.points||[],_id:x.id};}));
    setSaveStatus("saved");
  }

  // ── Save project ────────────────────────────────────────────────────
  var saveProject=useCallback(async function(){
    if(!currentProject||!user)return;
    setSaveStatus("saving");
    try{
      // Update project meta
      await supabase.from("projects").update({
        name:currentProject.name,
        center_lat:center.lat,
        center_lon:center.lon,
        zoom:zoom
      }).eq("id",currentProject.id);

      // Delete all existing features and re-insert (simple upsert strategy)
      await Promise.all([
        supabase.from("towns").delete().eq("project_id",currentProject.id),
        supabase.from("roads").delete().eq("project_id",currentProject.id),
        supabase.from("rivers").delete().eq("project_id",currentProject.id),
        supabase.from("samples").delete().eq("project_id",currentProject.id),
        supabase.from("geology_zones").delete().eq("project_id",currentProject.id),
      ]);

      var pid=currentProject.id;
      var inserts=[];
      if(towns.length>0)inserts.push(supabase.from("towns").insert(towns.map(function(t){return{project_id:pid,name:t.name||"",town_type:t.townType||"Settlement",lat:t.lat,lon:t.lon};})));
      if(roads.length>0)inserts.push(supabase.from("roads").insert(roads.map(function(r){return{project_id:pid,name:r.name||"",road_type:r.type||"minor",surface:r.surface||"Paved",points:r.points};})));
      if(rivers.length>0)inserts.push(supabase.from("rivers").insert(rivers.map(function(r){return{project_id:pid,name:r.name||"",flow:r.flow||"Unknown",points:r.points};})));
      if(samples.length>0)inserts.push(supabase.from("samples").insert(samples.map(function(s){return{project_id:pid,sample_id:s.id||"",rock:s.rock||"Shale",description:s.description||"",strike:s.strike||"",dip:s.dip||"",notes:s.notes||"",lat:s.lat,lon:s.lon};})));
      if(geoZones.length>0)inserts.push(supabase.from("geology_zones").insert(geoZones.map(function(z){return{project_id:pid,rock:z.rock||"Shale",formation:z.formation||"",period:z.period||"Unknown",contact:z.contact||"Unknown",points:z.points};})));

      await Promise.all(inserts);
      setSaveStatus("saved");
    } catch(e){
      console.error("Save error:",e);
      setSaveStatus("error");
    }
  },[currentProject,user,center,zoom,towns,roads,rivers,samples,geoZones]);

  // ── Mark unsaved on data change ─────────────────────────────────────
  useEffect(function(){if(currentProject)setSaveStatus("unsaved");},[towns,roads,rivers,samples,geoZones]);

  // ── Auto-save every 30s ─────────────────────────────────────────────
  useEffect(function(){
    if(!currentProject)return;
    if(autoSaveRef.current)clearInterval(autoSaveRef.current);
    autoSaveRef.current=setInterval(function(){saveProject();},AUTO_SAVE_INTERVAL);
    return function(){clearInterval(autoSaveRef.current);};
  },[saveProject,currentProject]);

  // ── Resize observer ─────────────────────────────────────────────────
  useEffect(function(){
    function upd(){if(containerRef.current){var r=containerRef.current.getBoundingClientRect();setSize({w:Math.floor(r.width)||800,h:Math.floor(r.height)||560});}}
    upd();window.addEventListener("resize",upd);return function(){window.removeEventListener("resize",upd);};
  },[]);

  // ── Tile loading ────────────────────────────────────────────────────
  useEffect(function(){
    var cx=lon2tile(center.lon,zoom),cy=lat2tile(center.lat,zoom);
    var range=Math.ceil(Math.max(W,H)/TILE_SIZE/2)+2,next=[];
    for(var x=cx-range;x<=cx+range;x++){for(var y=cy-range;y<=cy+range;y++){var max=Math.pow(2,zoom);if(y<0||y>=max)continue;next.push({z:zoom,x:((x%max)+max)%max,y:y,ox:x});}}
    setTiles(next);
  },[center,zoom,W,H]);

  useEffect(function(){tiles.forEach(function(t){loadTile(t.z,t.x,t.y,function(){setTick(function(n){return n+1;});});});},[tiles]);

  // ── Canvas draw ─────────────────────────────────────────────────────
  useEffect(function(){
    var canvas=canvasRef.current;if(!canvas)return;
    var ctx=canvas.getContext("2d");
    ctx.clearRect(0,0,W,H);
    function p(lat,lon){return ll2px(lat,lon,center.lat,center.lon,zoom,W,H);}

    tiles.forEach(function(t){var img=tileCache[t.z+"/"+t.x+"/"+t.y],pt=p(tile2lat(t.y,zoom),tile2lon(t.ox,zoom));if(img){ctx.drawImage(img,Math.round(pt.x),Math.round(pt.y),TILE_SIZE,TILE_SIZE);}else{ctx.fillStyle="#e8e8e8";ctx.fillRect(Math.round(pt.x),Math.round(pt.y),TILE_SIZE,TILE_SIZE);}});

    var g=ctx.createRadialGradient(W/2,H/2,H*0.25,W/2,H/2,H*0.75);g.addColorStop(0,"rgba(0,0,0,0)");g.addColorStop(1,"rgba(0,0,0,0.1)");ctx.fillStyle=g;ctx.fillRect(0,0,W,H);

    ctx.save();ctx.strokeStyle="rgba(255,255,255,0.25)";ctx.lineWidth=0.7;ctx.setLineDash([4,4]);ctx.font="9px monospace";ctx.fillStyle="rgba(255,255,255,0.8)";
    var step=zoom<=6?5:zoom<=8?2:zoom<=10?1:0.5;
    var tl=px2ll(0,0,center.lat,center.lon,zoom,W,H),br=px2ll(W,H,center.lat,center.lon,zoom,W,H);
    for(var lo=Math.ceil(tl.lon/step)*step;lo<=br.lon;lo+=step){var px2=p(center.lat,lo).x;ctx.beginPath();ctx.moveTo(px2,0);ctx.lineTo(px2,H);ctx.stroke();ctx.fillText(toDMS(lo,false),px2+2,H-5);}
    for(var la=Math.floor(tl.lat/step)*step;la>=br.lat;la-=step){var py2=p(la,center.lon).y;ctx.beginPath();ctx.moveTo(0,py2);ctx.lineTo(W,py2);ctx.stroke();ctx.fillText(toDMS(la,true),3,py2-3);}
    ctx.setLineDash([]);ctx.restore();

    geoZones.forEach(function(z2,gi){
      if(z2.points.length<2)return;
      var isSel=selectedFeature&&selectedFeature.type==="geology"&&selectedFeature.id===gi;
      var isActive=gi===activeGeoIdx;
      ctx.beginPath();z2.points.forEach(function(pt,i){var pp=p(pt.lat,pt.lon);if(i===0)ctx.moveTo(pp.x,pp.y);else ctx.lineTo(pp.x,pp.y);});
      if(!isActive&&z2.points.length>2)ctx.closePath();
      ctx.globalAlpha=0.55;ctx.fillStyle=ROCK_COLORS[z2.rock]||"#aaa";if(!isActive)ctx.fill();ctx.globalAlpha=1;
      ctx.strokeStyle=isSel?"#f0c040":isActive?"#27ae60":ROCK_COLORS[z2.rock]||"#aaa";ctx.lineWidth=isSel?3:2;
      if(isActive)ctx.setLineDash([5,3]);ctx.stroke();ctx.setLineDash([]);
      if(isActive){z2.points.forEach(function(pt,i){var pp=p(pt.lat,pt.lon);ctx.fillStyle=i===0?"#27ae60":"#fff";ctx.beginPath();ctx.arc(pp.x,pp.y,i===0?6:4,0,Math.PI*2);ctx.fill();if(i===0){ctx.strokeStyle="#27ae60";ctx.lineWidth=2;ctx.beginPath();ctx.arc(pp.x,pp.y,10,0,Math.PI*2);ctx.stroke();}});if(mousePos){var last2=z2.points[z2.points.length-1],lp=p(last2.lat,last2.lon),mp=p(mousePos.lat,mousePos.lon);ctx.beginPath();ctx.moveTo(lp.x,lp.y);ctx.lineTo(mp.x,mp.y);ctx.strokeStyle="#27ae60";ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.stroke();ctx.setLineDash([]);}}
      if(!isActive&&z2.points.length>2){var cx2=z2.points.reduce(function(s,pt){return s+pt.lon;},0)/z2.points.length,cy2=z2.points.reduce(function(s,pt){return s+pt.lat;},0)/z2.points.length,cp=p(cy2,cx2);ctx.fillStyle="#fff";ctx.font="bold 9px sans-serif";ctx.textAlign="center";ctx.fillText(z2.formation&&z2.formation.trim()?z2.formation:z2.rock,cp.x,cp.y);ctx.textAlign="left";}
    });

    roads.forEach(function(road,ri){
      if(road.points.length<1)return;
      var pts=road.points.map(function(pt){return p(pt.lat,pt.lon);});
      var isSel=selectedFeature&&selectedFeature.type==="road"&&selectedFeature.id===ri;
      var isActive=ri===activeRoadIdx;
      if(isSel){ctx.shadowColor="#f0c040";ctx.shadowBlur=10;}
      if(road.type==="major"){if(pts.length>=2)drawSmooth(ctx,pts);else{ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);}ctx.strokeStyle=isSel?"#f0c040":"#c0392b";ctx.lineWidth=4;ctx.stroke();if(pts.length>=2)drawSmooth(ctx,pts);ctx.strokeStyle=isSel?"#ffe080":"#e07030";ctx.lineWidth=2;ctx.stroke();}
      else{if(pts.length>=2)drawSmooth(ctx,pts);else{ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);}ctx.strokeStyle=isSel?"#f0c040":"#888";ctx.lineWidth=1.8;ctx.stroke();}
      ctx.shadowBlur=0;
      if(road.name&&road.name.trim()&&pts.length>=2){var mid=pts[Math.floor(pts.length/2)];ctx.fillStyle=isSel?"#f0c040":"#ccc";ctx.font="8px sans-serif";ctx.fillText(road.name,mid.x+3,mid.y-4);}
      if(isActive){pts.forEach(function(pp){ctx.fillStyle=road.type==="major"?"#e07030":"#aaa";ctx.beginPath();ctx.arc(pp.x,pp.y,4,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=1;ctx.beginPath();ctx.arc(pp.x,pp.y,4,0,Math.PI*2);ctx.stroke();});if(mousePos&&pts.length>0){var last=pts[pts.length-1],mp=p(mousePos.lat,mousePos.lon);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(mp.x,mp.y);ctx.strokeStyle="#e07030";ctx.lineWidth=1.5;ctx.setLineDash([4,3]);ctx.stroke();ctx.setLineDash([]);}}
    });

    rivers.forEach(function(river,ri){
      if(river.points.length<1)return;
      var pts=river.points.map(function(pt){return p(pt.lat,pt.lon);});
      var isSel=selectedFeature&&selectedFeature.type==="river"&&selectedFeature.id===ri;
      var isActive=ri===activeRiverIdx;
      if(isSel){ctx.shadowColor="#f0c040";ctx.shadowBlur=10;}
      if(pts.length>=2)drawSmooth(ctx,pts);else{ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);}
      ctx.strokeStyle=isSel?"#f0c040":"#2980d9";ctx.lineWidth=isSel?3:2;ctx.stroke();
      ctx.shadowBlur=0;
      if(river.name&&river.name.trim()&&pts.length>=2){var mid=pts[Math.floor(pts.length/2)];ctx.fillStyle=isSel?"#f0c040":"#5ab4e8";ctx.font="italic 8px sans-serif";ctx.fillText(river.name,mid.x+3,mid.y-4);}
      if(isActive){pts.forEach(function(pp){ctx.fillStyle="#2980d9";ctx.beginPath();ctx.arc(pp.x,pp.y,4,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=1;ctx.beginPath();ctx.arc(pp.x,pp.y,4,0,Math.PI*2);ctx.stroke();});if(mousePos&&pts.length>0){var last=pts[pts.length-1],mp=p(mousePos.lat,mousePos.lon);ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(mp.x,mp.y);ctx.strokeStyle="#2980d9";ctx.lineWidth=1.5;ctx.setLineDash([4,3]);ctx.stroke();ctx.setLineDash([]);}}
    });

    towns.forEach(function(town,ti){
      var pp=p(town.lat,town.lon);var isSel=selectedFeature&&selectedFeature.type==="town"&&selectedFeature.id===ti;
      if(isSel){ctx.shadowColor="#f0c040";ctx.shadowBlur=12;}
      ctx.fillStyle=isSel?"#f0c040":"#000";ctx.beginPath();ctx.arc(pp.x,pp.y,isSel?6:4,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(pp.x,pp.y,isSel?3.5:2.5,0,Math.PI*2);ctx.fill();
      ctx.shadowBlur=0;ctx.fillStyle=isSel?"#f0c040":"#000";ctx.font="bold 9px sans-serif";ctx.fillText(town.name||"Town",pp.x+6,pp.y-3);
    });

    samples.forEach(function(s,si){
      var pp=p(s.lat,s.lon);var isSel=selectedFeature&&selectedFeature.type==="sample"&&selectedFeature.id===si;
      if(isSel){ctx.shadowColor="#f0c040";ctx.shadowBlur=12;}
      ctx.fillStyle=isSel?"#f0c040":"#c0392b";var sz=isSel?11:9;
      ctx.beginPath();ctx.moveTo(pp.x,pp.y-sz);ctx.lineTo(pp.x+sz*0.7,pp.y+sz*0.5);ctx.lineTo(pp.x-sz*0.7,pp.y+sz*0.5);ctx.closePath();ctx.fill();
      ctx.shadowBlur=0;ctx.fillStyle=isSel?"#f0c040":"#c0392b";ctx.font="6px sans-serif";ctx.fillText(s.id,pp.x+sz+1,pp.y+2);
      if(s.strike&&s.dip){var sa=parseFloat(s.strike)*Math.PI/180,sl=10;ctx.save();ctx.translate(pp.x,pp.y);ctx.strokeStyle="#27ae60";ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(-sl*Math.sin(sa),-sl*Math.cos(sa));ctx.lineTo(sl*Math.sin(sa),sl*Math.cos(sa));var da=sa+Math.PI/2;ctx.moveTo(0,0);ctx.lineTo(sl*0.5*Math.sin(da),sl*0.5*Math.cos(da));ctx.stroke();ctx.fillStyle="#27ae60";ctx.font="6px sans-serif";ctx.fillText(s.dip+"°",sl*0.6*Math.sin(da)+1,sl*0.6*Math.cos(da));ctx.restore();}
    });

    if(previewPin){var pp=p(previewPin.lat,previewPin.lon);ctx.save();ctx.strokeStyle="#f0c040";ctx.lineWidth=2;ctx.beginPath();ctx.arc(pp.x,pp.y,10,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(pp.x-14,pp.y);ctx.lineTo(pp.x+14,pp.y);ctx.stroke();ctx.beginPath();ctx.moveTo(pp.x,pp.y-14);ctx.lineTo(pp.x,pp.y+14);ctx.stroke();ctx.fillStyle="#f0c040";ctx.font="bold 9px sans-serif";ctx.fillText(previewPin.lat.toFixed(5)+", "+previewPin.lon.toFixed(5),pp.x+16,pp.y-4);ctx.restore();}

    var ax=W-36,ay=36;ctx.save();ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(ax,ay,18,0,Math.PI*2);ctx.fill();ctx.fillStyle="#c0392b";ctx.beginPath();ctx.moveTo(ax,ay-14);ctx.lineTo(ax-6,ay+3);ctx.lineTo(ax+6,ay+3);ctx.closePath();ctx.fill();ctx.fillStyle="#333";ctx.beginPath();ctx.moveTo(ax,ay+14);ctx.lineTo(ax-6,ay-3);ctx.lineTo(ax+6,ay-3);ctx.closePath();ctx.fill();ctx.fillStyle="#c0392b";ctx.font="bold 10px sans-serif";ctx.textAlign="center";ctx.fillText("N",ax,ay-17);ctx.textAlign="left";ctx.restore();

    var mpp=(156543.03392*Math.cos(center.lat*Math.PI/180))/Math.pow(2,zoom),bm=zoom>=12?500:zoom>=10?2000:zoom>=8?20000:zoom>=6?100000:500000,bp=bm/mpp,sx=10,sy=H-20;
    ctx.save();ctx.fillStyle="rgba(255,255,255,0.88)";ctx.fillRect(sx-3,sy-12,bp+6,18);ctx.fillStyle="#222";ctx.fillRect(sx,sy-6,bp/2,7);ctx.fillStyle="#999";ctx.fillRect(sx+bp/2,sy-6,bp/2,7);ctx.strokeStyle="#222";ctx.lineWidth=1;ctx.strokeRect(sx,sy-6,bp,7);ctx.fillStyle="#222";ctx.font="8px sans-serif";ctx.fillText("0",sx,sy-8);ctx.fillText(bm>=1000?bm/1000+"km":bm+"m",sx+bp-6,sy-8);ctx.restore();

    ctx.save();ctx.fillStyle="rgba(0,0,0,0.55)";ctx.fillRect(8,8,160,22);ctx.fillStyle="#f0c040";ctx.font="bold 11px sans-serif";ctx.fillText("MODE: "+MODE_LABELS[mode],14,23);ctx.restore();
    ctx.save();ctx.fillStyle="rgba(255,255,255,0.7)";ctx.fillRect(W-185,H-15,185,15);ctx.fillStyle="#666";ctx.font="8px sans-serif";ctx.fillText("\u00a9 OpenStreetMap contributors",W-182,H-4);ctx.restore();

  },[tiles,center,zoom,tick,towns,roads,rivers,samples,geoZones,activeRoadIdx,activeRiverIdx,activeGeoIdx,mousePos,mode,geoRock,W,H,previewPin,selectedFeature]);

  function getLL(e){var r=canvasRef.current.getBoundingClientRect();return px2ll((e.clientX-r.left)*(W/r.width),(e.clientY-r.top)*(H/r.height),center.lat,center.lon,zoom,W,H);}

  function handleClick(e){
    var ll=getLL(e);
    if(mode==="select"){
      var SNAP=16,cp=ll2px(ll.lat,ll.lon,center.lat,center.lon,zoom,W,H);
      for(var ti=0;ti<towns.length;ti++){var tp=ll2px(towns[ti].lat,towns[ti].lon,center.lat,center.lon,zoom,W,H);if(dist(cp,tp)<SNAP){setSelectedFeature({type:"town",id:ti});setTab("draw");return;}}
      for(var si=0;si<samples.length;si++){var sp=ll2px(samples[si].lat,samples[si].lon,center.lat,center.lon,zoom,W,H);if(dist(cp,sp)<SNAP){setSelectedFeature({type:"sample",id:si});setTab("draw");return;}}
      for(var ri=0;ri<roads.length;ri++){for(var rj=0;rj<roads[ri].points.length;rj++){var rp=ll2px(roads[ri].points[rj].lat,roads[ri].points[rj].lon,center.lat,center.lon,zoom,W,H);if(dist(cp,rp)<SNAP){setSelectedFeature({type:"road",id:ri});setTab("draw");return;}}}
      for(var rvi=0;rvi<rivers.length;rvi++){for(var rvj=0;rvj<rivers[rvi].points.length;rvj++){var rvp=ll2px(rivers[rvi].points[rvj].lat,rivers[rvi].points[rvj].lon,center.lat,center.lon,zoom,W,H);if(dist(cp,rvp)<SNAP){setSelectedFeature({type:"river",id:rvi});setTab("draw");return;}}}
      for(var gi=0;gi<geoZones.length;gi++){for(var gj=0;gj<geoZones[gi].points.length;gj++){var gp=ll2px(geoZones[gi].points[gj].lat,geoZones[gi].points[gj].lon,center.lat,center.lon,zoom,W,H);if(dist(cp,gp)<SNAP){setSelectedFeature({type:"geology",id:gi});setTab("draw");return;}}}
      setSelectedFeature(null);return;
    }
    if(mode==="town"){var name=townForm.name||"Town "+(towns.length+1);setTowns(function(t){return t.concat([{lat:ll.lat,lon:ll.lon,name:name,townType:townForm.townType||"Settlement"}]);});setTownForm({name:"",townType:"Settlement"});}
    else if(mode==="road-major"||mode==="road-minor"){
      if(activeRoadIdx===null){var nr={type:mode==="road-major"?"major":"minor",points:[ll],name:"",surface:"Paved"};setRoads(function(prev){setActiveRoadIdx(prev.length);return prev.concat([nr]);});}
      else{setRoads(function(prev){return prev.map(function(r,i){if(i===activeRoadIdx)return Object.assign({},r,{points:r.points.concat([ll])});return r;});});}
    }
    else if(mode==="river"){
      if(activeRiverIdx===null){var nrv={points:[ll],name:"",flow:"Unknown"};setRivers(function(prev){setActiveRiverIdx(prev.length);return prev.concat([nrv]);});}
      else{setRivers(function(prev){return prev.map(function(r,i){if(i===activeRiverIdx)return Object.assign({},r,{points:r.points.concat([ll])});return r;});});}
    }
    else if(mode==="sample"){
      var errs={};
      var idErr=validateSampleId(sampleForm.id,samples,-1);if(idErr)errs.id=idErr;
      var sErr=validateStrike(sampleForm.strike);if(sErr)errs.strike=sErr;
      var dErr=validateDip(sampleForm.dip);if(dErr)errs.dip=dErr;
      if(Object.keys(errs).length>0){setSampleFormErrs(errs);return;}
      var id=sampleForm.id||"SAMPLE-"+(samples.length+1);
      setSamples(function(s){return s.concat([{lat:ll.lat,lon:ll.lon,id:id,rock:sampleForm.rock,description:sampleForm.description||"",strike:sampleForm.strike||"",dip:sampleForm.dip||"",notes:sampleForm.notes||""}]);});
      setSampleForm(function(f){return Object.assign({},f,{id:"",description:"",strike:"",dip:"",notes:""});});setSampleFormErrs({});
    }
    else if(mode==="geology"){
      if(activeGeoIdx===null){var ng={rock:geoRock,formation:"",period:"Unknown",contact:"Unknown",points:[ll]};setGeoZones(function(prev){setActiveGeoIdx(prev.length);return prev.concat([ng]);});}
      else{var firstPt=geoZones[activeGeoIdx].points[0],fp2=ll2px(firstPt.lat,firstPt.lon,center.lat,center.lon,zoom,W,H),cp2=ll2px(ll.lat,ll.lon,center.lat,center.lon,zoom,W,H);
        if(geoZones[activeGeoIdx].points.length>2&&dist(fp2,cp2)<16){setActiveGeoIdx(null);return;}
        setGeoZones(function(prev){return prev.map(function(z,i){if(i===activeGeoIdx)return Object.assign({},z,{points:z.points.concat([ll])});return z;});});}
    }
  }

  function deleteSelected(){
    if(!selectedFeature)return;
    var t=selectedFeature.type,id=selectedFeature.id;
    if(t==="town")setTowns(function(a){return a.filter(function(_,i){return i!==id;});});
    else if(t==="sample")setSamples(function(a){return a.filter(function(_,i){return i!==id;});});
    else if(t==="road"){setRoads(function(a){return a.filter(function(_,i){return i!==id;});});setActiveRoadIdx(null);}
    else if(t==="river"){setRivers(function(a){return a.filter(function(_,i){return i!==id;});});setActiveRiverIdx(null);}
    else if(t==="geology"){setGeoZones(function(a){return a.filter(function(_,i){return i!==id;});});setActiveGeoIdx(null);}
    setSelectedFeature(null);
  }

  function saveSelected(updates){
    if(!selectedFeature)return;
    var t=selectedFeature.type,id=selectedFeature.id;
    if(t==="town")setTowns(function(a){return a.map(function(f,i){return i===id?Object.assign({},f,updates):f;});});
    else if(t==="sample")setSamples(function(a){return a.map(function(f,i){return i===id?Object.assign({},f,updates):f;});});
    else if(t==="road")setRoads(function(a){return a.map(function(f,i){return i===id?Object.assign({},f,updates):f;});});
    else if(t==="river")setRivers(function(a){return a.map(function(f,i){return i===id?Object.assign({},f,updates):f;});});
    else if(t==="geology")setGeoZones(function(a){return a.map(function(f,i){return i===id?Object.assign({},f,updates):f;});});
    setSelectedFeature(null);
  }

  function onMouseDown(e){if(mode==="pan"){dragRef.current={sx:e.clientX,sy:e.clientY,clat:center.lat,clon:center.lon};}}
  function onMouseMove(e){
    var ll=getLL(e);setCursorLL(ll);
    if(mode==="pan"&&dragRef.current){var d=dragRef.current,ws=TILE_SIZE*Math.pow(2,zoom),r=canvasRef.current.getBoundingClientRect();setCenter({lat:Math.max(-85,Math.min(85,d.clat+((e.clientY-d.sy)*(H/r.height)/ws)*180)),lon:d.clon+(-(e.clientX-d.sx)*(W/r.width)/ws)*360});}
    else{setMousePos(ll);}
  }
  function onMouseUp(e){if(mode==="pan"){dragRef.current=null;}else{handleClick(e);}}
  function onMouseLeave(){dragRef.current=null;setMousePos(null);setCursorLL(null);}
  function onWheel(e){e.preventDefault();setZoom(function(z){return Math.max(4,Math.min(18,z+(e.deltaY>0?-1:1)));});}
  function finishRoad(){setActiveRoadIdx(null);}
  function finishRiver(){setActiveRiverIdx(null);}
  function finishGeo(){if(activeGeoIdx!==null&&geoZones[activeGeoIdx]&&geoZones[activeGeoIdx].points.length<3){setGeoZones(function(prev){return prev.filter(function(_,i){return i!==activeGeoIdx;});});}setActiveGeoIdx(null);}
  function undoLastNode(){
    if((mode==="road-major"||mode==="road-minor")&&activeRoadIdx!==null){setRoads(function(prev){return prev.map(function(r,i){if(i===activeRoadIdx){if(r.points.length<=1){setActiveRoadIdx(null);return null;}return Object.assign({},r,{points:r.points.slice(0,-1)});}return r;}).filter(Boolean);});}
    else if(mode==="river"&&activeRiverIdx!==null){setRivers(function(prev){return prev.map(function(r,i){if(i===activeRiverIdx){if(r.points.length<=1){setActiveRiverIdx(null);return null;}return Object.assign({},r,{points:r.points.slice(0,-1)});}return r;}).filter(Boolean);});}
    else if(mode==="geology"&&activeGeoIdx!==null){setGeoZones(function(prev){return prev.map(function(z,i){if(i===activeGeoIdx){if(z.points.length<=1){setActiveGeoIdx(null);return null;}return Object.assign({},z,{points:z.points.slice(0,-1)});}return z;}).filter(Boolean);});}
  }
  function clearAll(){setTowns([]);setRoads([]);setRivers([]);setSamples([]);setGeoZones([]);setActiveRoadIdx(null);setActiveRiverIdx(null);setActiveGeoIdx(null);setPreviewPin(null);setSelectedFeature(null);}

  function placeFromCoord(ll){
    setPreviewPin(ll);setCenter({lat:ll.lat,lon:ll.lon});if(zoom<10)setZoom(10);
    if(mode==="town"){var name=townForm.name||"Town "+(towns.length+1);setTowns(function(t){return t.concat([{lat:ll.lat,lon:ll.lon,name:name,townType:townForm.townType||"Settlement"}]);});setTownForm({name:"",townType:"Settlement"});}
    else if(mode==="sample"){var errs={};var idErr=validateSampleId(sampleForm.id,samples,-1);if(idErr)errs.id=idErr;var sErr=validateStrike(sampleForm.strike);if(sErr)errs.strike=sErr;var dErr=validateDip(sampleForm.dip);if(dErr)errs.dip=dErr;if(Object.keys(errs).length>0){setSampleFormErrs(errs);return;}var id=sampleForm.id||"SAMPLE-"+(samples.length+1);setSamples(function(s){return s.concat([{lat:ll.lat,lon:ll.lon,id:id,rock:sampleForm.rock,description:sampleForm.description||"",strike:sampleForm.strike||"",dip:sampleForm.dip||"",notes:sampleForm.notes||""}]);});setSampleForm(function(f){return Object.assign({},f,{id:"",description:"",strike:"",dip:"",notes:""});});setSampleFormErrs({});}
    else if(mode==="road-major"||mode==="road-minor"){if(activeRoadIdx===null){var nr={type:mode==="road-major"?"major":"minor",points:[ll],name:"",surface:"Paved"};setRoads(function(prev){setActiveRoadIdx(prev.length);return prev.concat([nr]);});}else{setRoads(function(prev){return prev.map(function(r,i){if(i===activeRoadIdx)return Object.assign({},r,{points:r.points.concat([ll])});return r;});});}}
    else if(mode==="river"){if(activeRiverIdx===null){var nrv={points:[ll],name:"",flow:"Unknown"};setRivers(function(prev){setActiveRiverIdx(prev.length);return prev.concat([nrv]);});}else{setRivers(function(prev){return prev.map(function(r,i){if(i===activeRiverIdx)return Object.assign({},r,{points:r.points.concat([ll])});return r;});});}}
    else if(mode==="geology"){if(activeGeoIdx===null){var ng={rock:geoRock,formation:"",period:"Unknown",contact:"Unknown",points:[ll]};setGeoZones(function(prev){setActiveGeoIdx(prev.length);return prev.concat([ng]);});}else{setGeoZones(function(prev){return prev.map(function(z,i){if(i===activeGeoIdx)return Object.assign({},z,{points:z.points.concat([ll])});return z;});});}}
    setTimeout(function(){setPreviewPin(null);},2500);
  }

  var openMap=useCallback(function(type){var data={towns,roads,rivers,samples,geoZones,center,zoom};var html=renderMap(type,data,currentProject?.name||"Study Area",exportDPI);var w=window.open("","_blank");w.document.write(html);w.document.close();},[towns,roads,rivers,samples,geoZones,center,zoom,currentProject,exportDPI]);
  var openMapExport=useCallback(function(type,fmt){var data={towns,roads,rivers,samples,geoZones,center,zoom};var html=renderMap(type,data,currentProject?.name||"Study Area",exportDPI);var w=window.open("","_blank");w.document.write(html);w.document.close();w.addEventListener("load",function(){setTimeout(function(){if(fmt==="png"&&w.download300PNG)w.download300PNG();if(fmt==="pdf"&&w.downloadPDF)w.downloadPDF();},3000);});},[towns,roads,rivers,samples,geoZones,center,zoom,currentProject,exportDPI]);

  var activeRoad=activeRoadIdx!==null?roads[activeRoadIdx]:null;
  var activeRiver=activeRiverIdx!==null?rivers[activeRiverIdx]:null;
  var activeGeo=activeGeoIdx!==null?geoZones[activeGeoIdx]:null;
  var completeness=computeCompleteness(towns,roads,rivers,samples,geoZones);
  var btnBase={border:"none",borderRadius:6,cursor:"pointer",fontFamily:"sans-serif",fontWeight:"bold"};
  var validationErrors=[];
  var sampleIds=samples.map(function(s){return s.id;});
  var dupIds=sampleIds.filter(function(id,i){return sampleIds.indexOf(id)!==i;});
  if(dupIds.length>0)validationErrors.push("Duplicate sample IDs: "+[...new Set(dupIds)].join(", "));
  samples.forEach(function(s,i){if(s.strike){var n=parseFloat(s.strike);if(isNaN(n)||n<0||n>360)validationErrors.push("Sample "+(i+1)+" ("+s.id+"): Strike out of range");}if(s.dip){var n=parseFloat(s.dip);if(isNaN(n)||n<0||n>90)validationErrors.push("Sample "+(i+1)+" ("+s.id+"): Dip out of range");}});
  geoZones.forEach(function(z,i){if(z.points.length>0&&z.points.length<3)validationErrors.push("Geology zone "+(i+1)+" ("+z.rock+"): needs at least 3 nodes");});

  // ── Loading / Auth / Dashboard screens ─────────────────────────────
  if(authLoading)return(<div style={{background:"#0d0d1f",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:"#f0c040",fontFamily:"sans-serif",fontSize:14}}>Loading…</div>);
  if(!user)return <AuthScreen onAuth={setUser}/>;
  if(showDashboard)return <Dashboard user={user} onOpen={loadProject} onNew={function(){}} onSignOut={async function(){await supabase.auth.signOut();}}/>;

  // ── Main map editor ─────────────────────────────────────────────────
  var saveColor=saveStatus==="saved"?"#27ae60":saveStatus==="saving"?"#f0c040":saveStatus==="error"?"#e74c3c":"#888";
  var saveLabel=saveStatus==="saved"?"✓ Saved":saveStatus==="saving"?"Saving…":saveStatus==="error"?"Save failed":"● Unsaved";

  return(
    <div style={{background:"#0d0d1f",height:"100vh",fontFamily:"sans-serif",color:"#eee",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Header */}
      <div style={{background:"#12122e",borderBottom:"1px solid #2a2a5a",padding:"7px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:30,height:30,background:"#f0c040",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🗺</div>
          <div>
            <div style={{fontWeight:"bold",fontSize:14,color:"#f0c040"}}>{currentProject?.name||"Geo Mapping System"}</div>
            <div style={{fontSize:9,color:"#555"}}>Nigeria Geological Survey — Sequence 6</div>
          </div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          {/* Save status */}
          <div style={{fontSize:9,color:saveColor,border:"1px solid "+saveColor,borderRadius:10,padding:"2px 8px"}}>{saveLabel}</div>
          <button onClick={saveProject} style={Object.assign({},btnBase,{background:"#1a3a1a",color:"#27ae60",border:"1px solid #27ae60",padding:"4px 10px",fontSize:10})}>💾 Save</button>
          <button onClick={function(){openMap("map2");}} style={Object.assign({},btnBase,{background:"#1a3a5a",color:"#4a9adf",border:"1px solid #2a5a8a",padding:"5px 10px",fontSize:10})}>📄 MAP 2</button>
          <button onClick={function(){openMap("map3");}} style={Object.assign({},btnBase,{background:"#2a1a5a",color:"#9b59b6",border:"1px solid #5a2a8a",padding:"5px 10px",fontSize:10})}>🪨 MAP 3</button>
          <button onClick={function(){setShowDashboard(true);}} style={Object.assign({},btnBase,{background:"#1a1a3a",color:"#888",border:"1px solid #3a3a6a",padding:"4px 10px",fontSize:10})}>← Projects</button>
          <div style={{background:"#1a1a3a",border:"1px solid #3a3a6a",borderRadius:10,padding:"2px 8px",fontSize:9,color:"#888"}}>z{zoom}</div>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{background:"#0a0a20",borderBottom:"1px solid #2a2a5a",padding:"6px 10px",display:"flex",gap:4,alignItems:"center",flexShrink:0,overflowX:"auto"}}>
        {MODES.map(function(m){return(
          <button key={m} onClick={function(){setMode(m);if(m==="pan"){setActiveRoadIdx(null);setActiveRiverIdx(null);setActiveGeoIdx(null);}if(m!=="select")setSelectedFeature(null);}}
            style={Object.assign({},btnBase,{background:mode===m?"#f0c040":MODE_COLORS[m]||"#2a2a4a",color:mode===m?"#000":"#ccc",padding:"6px 10px",fontSize:10,whiteSpace:"nowrap",border:"1px solid "+(mode===m?"#f0c040":"#3a3a6a")})}>
            {MODE_LABELS[m]}
          </button>
        );})}
        <div style={{marginLeft:"auto",display:"flex",gap:4}}>
          <button onClick={function(){setZoom(function(z){return Math.min(18,z+1);});}} style={Object.assign({},btnBase,{background:"#1e1e3a",color:"#fff",padding:"6px 11px",border:"1px solid #3a3a6a"})}>+</button>
          <button onClick={function(){setZoom(function(z){return Math.max(4,z-1);});}} style={Object.assign({},btnBase,{background:"#1e1e3a",color:"#fff",padding:"6px 11px",border:"1px solid #3a3a6a"})}>−</button>
          <button onClick={function(){setCenter({lat:NIGERIA_CENTER[0],lon:NIGERIA_CENTER[1]});setZoom(NIGERIA_ZOOM);}} style={Object.assign({},btnBase,{background:"#1e1e3a",color:"#aaa",padding:"6px 10px",fontSize:10,border:"1px solid #3a3a6a"})}>🇳🇬</button>
        </div>
      </div>

      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        {/* Canvas */}
        <div ref={containerRef} style={{flex:1,position:"relative",overflow:"hidden"}}>
          <canvas ref={canvasRef} width={W} height={H}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave} onWheel={onWheel}
            style={{display:"block",width:"100%",height:"100%",cursor:mode==="pan"?(dragRef.current?"grabbing":"grab"):mode==="select"?"pointer":"crosshair"}}
          />
          <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(0,0,0,0.85)",borderTop:"1px solid #2a2a5a",padding:"4px 12px",display:"flex",gap:16,alignItems:"center",pointerEvents:"none"}}>
            <span style={{fontSize:10,color:"#555",fontFamily:"monospace"}}>📍 CURSOR</span>
            {cursorLL?(<><span style={{fontSize:11,color:"#f0c040",fontFamily:"monospace",fontWeight:"bold"}}>{toDMS(cursorLL.lat,true)}</span><span style={{fontSize:11,color:"#f0c040",fontFamily:"monospace",fontWeight:"bold"}}>{toDMS(cursorLL.lon,false)}</span><span style={{fontSize:10,color:"#555",fontFamily:"monospace"}}>({cursorLL.lat.toFixed(5)}, {cursorLL.lon.toFixed(5)})</span></>):(<span style={{fontSize:10,color:"#333",fontFamily:"monospace"}}>Move cursor over map to read coordinates</span>)}
          </div>
          {(mode==="road-major"||mode==="road-minor")&&(<div style={{position:"absolute",bottom:28,left:"50%",transform:"translateX(-50%)",background:"rgba(0,0,0,0.75)",color:"#fff",borderRadius:8,padding:"6px 14px",fontSize:11,display:"flex",gap:8}}><span>{activeRoad?activeRoad.points.length+" nodes — click to add more":"Click to start road"}</span>{activeRoad&&<button onClick={finishRoad} style={Object.assign({},btnBase,{background:"#27ae60",color:"#fff",padding:"3px 10px",fontSize:10})}>✓ Finish Road</button>}{activeRoad&&<button onClick={undoLastNode} style={Object.assign({},btnBase,{background:"#e74c3c",color:"#fff",padding:"3px 8px",fontSize:10})}>↩ Undo</button>}</div>)}
          {mode==="river"&&(<div style={{position:"absolute",bottom:28,left:"50%",transform:"translateX(-50%)",background:"rgba(0,0,0,0.75)",color:"#fff",borderRadius:8,padding:"6px 14px",fontSize:11,display:"flex",gap:8}}><span>{activeRiver?activeRiver.points.length+" nodes — click to add more":"Click to start river"}</span>{activeRiver&&<button onClick={finishRiver} style={Object.assign({},btnBase,{background:"#27ae60",color:"#fff",padding:"3px 10px",fontSize:10})}>✓ Finish River</button>}{activeRiver&&<button onClick={undoLastNode} style={Object.assign({},btnBase,{background:"#e74c3c",color:"#fff",padding:"3px 8px",fontSize:10})}>↩ Undo</button>}</div>)}
          {mode==="geology"&&(<div style={{position:"absolute",bottom:28,left:"50%",transform:"translateX(-50%)",background:"rgba(0,0,0,0.75)",color:"#fff",borderRadius:8,padding:"6px 14px",fontSize:11,display:"flex",gap:8,alignItems:"center"}}>{!activeGeo?"Click to start polygon":activeGeo.points.length+" nodes · click green circle to close"}{activeGeo&&activeGeo.points.length>2&&<button onClick={finishGeo} style={Object.assign({},btnBase,{background:"#27ae60",color:"#fff",padding:"3px 10px",fontSize:10})}>✓ Close</button>}{activeGeo&&<button onClick={undoLastNode} style={Object.assign({},btnBase,{background:"#e74c3c",color:"#fff",padding:"3px 8px",fontSize:10})}>↩ Undo</button>}</div>)}
          {mode==="select"&&(<div style={{position:"absolute",bottom:28,left:"50%",transform:"translateX(-50%)",background:"rgba(0,20,0,0.85)",color:"#27ae60",borderRadius:8,padding:"6px 14px",fontSize:11}}>Click any feature to select &amp; edit attributes</div>)}
        </div>

        {/* Sidebar */}
        <div style={{width:250,background:"#0a0a1e",borderLeft:"1px solid #2a2a5a",display:"flex",flexDirection:"column",flexShrink:0}}>
          <div style={{display:"flex",borderBottom:"1px solid #2a2a5a"}}>
            {["draw","data","output"].map(function(t){return(<button key={t} onClick={function(){setTab(t);}} style={Object.assign({},btnBase,{flex:1,padding:"8px 4px",fontSize:10,background:tab===t?"#1a1a3a":"transparent",color:tab===t?"#f0c040":"#555",borderRadius:0,borderBottom:tab===t?"2px solid #f0c040":"2px solid transparent"})}>{t==="draw"?"✏️ Draw":t==="data"?"📊 Data":"🗺 Output"}</button>);})}
          </div>
          <div style={{flex:1,overflowY:"auto",padding:12}}>

            {/* ── DRAW TAB ── */}
            {tab==="draw"&&(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {mode==="select"&&(selectedFeature?(
                  selectedFeature.type==="town"?<TownEditPanel town={towns[selectedFeature.id]} onSave={saveSelected} onDelete={deleteSelected} onDeselect={function(){setSelectedFeature(null);}}/>
                  :selectedFeature.type==="sample"?<SampleEditPanel sample={samples[selectedFeature.id]} allSamples={samples} editingIdx={selectedFeature.id} onSave={saveSelected} onDelete={deleteSelected} onDeselect={function(){setSelectedFeature(null);}}/>
                  :selectedFeature.type==="geology"?<GeoEditPanel zone={geoZones[selectedFeature.id]} onSave={saveSelected} onDelete={deleteSelected} onDeselect={function(){setSelectedFeature(null);}}/>
                  :selectedFeature.type==="road"?<RoadEditPanel road={roads[selectedFeature.id]} onSave={saveSelected} onDelete={deleteSelected} onDeselect={function(){setSelectedFeature(null);}}/>
                  :selectedFeature.type==="river"?<RiverEditPanel river={rivers[selectedFeature.id]} onSave={saveSelected} onDelete={deleteSelected} onDeselect={function(){setSelectedFeature(null);}}/>
                  :null
                ):(<div style={{background:"#12122e",border:"1px solid #1a3a1a",borderRadius:8,padding:12,textAlign:"center"}}><div style={{fontSize:20,marginBottom:6}}>👆</div><div style={{fontSize:11,color:"#27ae60",fontWeight:"bold",marginBottom:4}}>SELECT MODE</div><div style={{fontSize:10,color:"#555",lineHeight:1.7}}>Click any feature on the map to select it and edit its attributes.</div></div>))}
                {mode==="town"&&(<div style={{background:"#12122e",border:"1px solid #1a3a5a",borderRadius:8,padding:10}}><div style={{fontSize:11,color:"#4a9adf",fontWeight:"bold",marginBottom:8}}>🏘 PLACE TOWN</div><Field label="Town Name"><input value={townForm.name} onChange={function(e){setTownForm(function(f){return Object.assign({},f,{name:e.target.value});});}} placeholder="e.g. Ananamong" style={INP}/></Field><Field label="Settlement Type"><select value={townForm.townType||"Settlement"} onChange={function(e){setTownForm(function(f){return Object.assign({},f,{townType:e.target.value});});}} style={SEL}>{TOWN_TYPES.map(function(t){return <option key={t}>{t}</option>;})}</select></Field><div style={{fontSize:10,color:"#555",marginBottom:4}}>Click map to place</div><CoordInput label="Place by Coordinates" onPlace={placeFromCoord}/></div>)}
                {(mode==="road-major"||mode==="road-minor")&&(<div style={{background:"#12122e",border:"1px solid #5a2a00",borderRadius:8,padding:10}}><div style={{fontSize:11,color:"#e07030",fontWeight:"bold",marginBottom:6}}>{mode==="road-major"?"🟠 MAJOR ROAD":"⬛ MINOR ROAD"}</div><div style={{fontSize:10,color:"#888",lineHeight:1.6,marginBottom:6}}>Click nodes · curves through all points · finish when done</div>{activeRoad&&<div style={{marginBottom:6,fontSize:10,color:"#f0c040"}}>{activeRoad.points.length} nodes placed</div>}<CoordInput label="Add Node by Coordinates" onPlace={placeFromCoord}/></div>)}
                {mode==="river"&&(<div style={{background:"#12122e",border:"1px solid #003a5a",borderRadius:8,padding:10}}><div style={{fontSize:11,color:"#2980d9",fontWeight:"bold",marginBottom:6}}>🌊 DRAW RIVER</div><div style={{fontSize:10,color:"#888",lineHeight:1.6,marginBottom:6}}>Click nodes · curves through all points · finish when done</div>{activeRiver&&<div style={{marginBottom:6,fontSize:10,color:"#f0c040"}}>{activeRiver.points.length} nodes placed</div>}<CoordInput label="Add Node by Coordinates" onPlace={placeFromCoord}/></div>)}
                {mode==="sample"&&(<div style={{background:"#12122e",border:"1px solid #5a1a1a",borderRadius:8,padding:10}}><div style={{fontSize:11,color:"#e74c3c",fontWeight:"bold",marginBottom:8}}>🔺 PLACE SAMPLE</div><Field label="Sample ID *"><input value={sampleForm.id} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{id:e.target.value});});setSampleFormErrs(function(e2){return Object.assign({},e2,{id:null});});}} placeholder="e.g. UU/GS/GLG/25/57" style={INP}/>{sampleFormErrs.id&&<div style={{fontSize:9,color:"#e74c3c",marginTop:-3,marginBottom:4}}>{sampleFormErrs.id}</div>}</Field><Field label="Rock Type"><select value={sampleForm.rock} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{rock:e.target.value});});}} style={SEL}>{ROCK_TYPES.map(function(r){return <option key={r}>{r}</option>;})}</select></Field><Field label="Field Description"><input value={sampleForm.description||""} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{description:e.target.value});});}} placeholder="e.g. dark grey, finely laminated" style={INP}/></Field><div style={{display:"flex",gap:6}}><div style={{flex:1}}><Field label="Strike (0–360°)"><input value={sampleForm.strike||""} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{strike:e.target.value});});setSampleFormErrs(function(e2){return Object.assign({},e2,{strike:null});});}} placeholder="e.g. 045" style={INP}/>{sampleFormErrs.strike&&<div style={{fontSize:9,color:"#e74c3c",marginTop:-3,marginBottom:4}}>{sampleFormErrs.strike}</div>}</Field></div><div style={{flex:1}}><Field label="Dip (0–90°)"><input value={sampleForm.dip||""} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{dip:e.target.value});});setSampleFormErrs(function(e2){return Object.assign({},e2,{dip:null});});}} placeholder="e.g. 32" style={INP}/>{sampleFormErrs.dip&&<div style={{fontSize:9,color:"#e74c3c",marginTop:-3,marginBottom:4}}>{sampleFormErrs.dip}</div>}</Field></div></div><Field label="Field Notes"><textarea value={sampleForm.notes||""} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{notes:e.target.value});});}} rows={2} placeholder="Additional observations…" style={Object.assign({},INP,{resize:"none"})}/></Field><CoordInput label="Place by Coordinates" onPlace={placeFromCoord}/></div>)}
                {mode==="geology"&&(<div style={{background:"#12122e",border:"1px solid #2a1a5a",borderRadius:8,padding:10}}><div style={{fontSize:11,color:"#9b59b6",fontWeight:"bold",marginBottom:8}}>🪨 GEOLOGY ZONE</div><Field label="Rock Type"><select value={geoRock} onChange={function(e){setGeoRock(e.target.value);}} style={SEL}>{ROCK_TYPES.map(function(r){return <option key={r}>{r}</option>;})}</select></Field><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}><div style={{width:18,height:18,background:ROCK_COLORS[geoRock],borderRadius:3,border:"1px solid #fff"}}/><span style={{fontSize:10,color:"#888"}}>{geoRock}</span></div><div style={{fontSize:10,color:"#888",lineHeight:1.6,marginBottom:6}}>Click nodes · green circle to close · min 3 points<br/>After placing, switch to 👆 Select to add formation name</div>{activeGeo&&<div style={{marginTop:6,fontSize:10,color:"#f0c040"}}>{activeGeo.points.length} nodes placed</div>}<CoordInput label="Add Node by Coordinates" onPlace={placeFromCoord}/></div>)}
                {mode==="pan"&&(<div style={{fontSize:11,color:"#555",textAlign:"center",padding:20,lineHeight:1.8}}>Select a drawing tool above to begin.<br/><br/>Use <span style={{color:"#27ae60"}}>👆 Select</span> to click any placed feature and edit its attributes.</div>)}
                <button onClick={clearAll} style={Object.assign({},btnBase,{background:"#3a1a1a",color:"#e74c3c",border:"1px solid #e74c3c",padding:"7px",fontSize:10,width:"100%"})}>🗑 Clear All Features</button>
              </div>
            )}

            {/* ── DATA TAB ── */}
            {tab==="data"&&(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <CompletenessBar score={completeness}/>
                <ValidationBanner errors={validationErrors}/>
                {[{label:"Towns",count:towns.length,color:"#3498db"},{label:"Major Roads",count:roads.filter(function(r){return r.type==="major";}).length,color:"#e07030"},{label:"Minor Roads",count:roads.filter(function(r){return r.type==="minor";}).length,color:"#888"},{label:"Rivers",count:rivers.length,color:"#2980d9"},{label:"Samples",count:samples.length,color:"#e74c3c"},{label:"Geology Zones",count:geoZones.length,color:"#9b59b6"}].map(function(item,i){return(<div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#12122e",borderRadius:6,padding:"7px 10px",borderLeft:"3px solid "+item.color}}><span style={{fontSize:11,color:"#aaa"}}>{item.label}</span><span style={{fontSize:16,fontWeight:"bold",color:item.color}}>{item.count}</span></div>);})}
                {samples.length>0&&(<div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10,marginTop:4}}><div style={{fontSize:11,color:"#f0c040",fontWeight:"bold",marginBottom:6}}>SAMPLES</div>{samples.map(function(s,i){var sc=scoreFeature("sample",s),pct=Math.round(sc.score/sc.max*100);return(<div key={i} style={{borderBottom:"1px solid #1a1a3a",padding:"5px 0",cursor:"pointer"}} onClick={function(){setSelectedFeature({type:"sample",id:i});setTab("draw");setMode("select");}}><div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:10,color:"#ffaaaa",fontWeight:"bold"}}>{s.id||"(unnamed)"}</span><span style={{fontSize:9,color:pct===100?"#27ae60":pct>=60?"#f0c040":"#e74c3c"}}>{pct}%</span></div><div style={{fontSize:9,color:"#888"}}>{s.rock}{s.description?" · "+s.description.slice(0,20):""}{s.strike&&s.dip?" · "+s.strike+"/"+s.dip+"°":""}</div><div style={{fontSize:8,color:"#444",fontFamily:"monospace"}}>{s.lat.toFixed(4)}, {s.lon.toFixed(4)}</div></div>);})}</div>)}
                {geoZones.length>0&&(<div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10}}><div style={{fontSize:11,color:"#f0c040",fontWeight:"bold",marginBottom:6}}>GEOLOGY ZONES</div>{geoZones.map(function(z,i){var sc=scoreFeature("geology",z),pct=Math.round(sc.score/sc.max*100);return(<div key={i} style={{borderBottom:"1px solid #1a1a3a",padding:"5px 0",cursor:"pointer"}} onClick={function(){setSelectedFeature({type:"geology",id:i});setTab("draw");setMode("select");}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:6}}><div style={{width:10,height:10,background:ROCK_COLORS[z.rock]||"#ccc",borderRadius:2,flexShrink:0}}/><span style={{fontSize:10,color:"#cca0ff",fontWeight:"bold",flex:1}}>{z.formation||z.rock}</span><span style={{fontSize:9,color:pct===100?"#27ae60":pct>=60?"#f0c040":"#e74c3c"}}>{pct}%</span></div><div style={{fontSize:9,color:"#666",marginLeft:16}}>{z.rock} · {z.period} · {z.points.length} nodes</div></div>);})}</div>)}
              </div>
            )}

            {/* ── OUTPUT TAB ── */}
            {tab==="output"&&(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {validationErrors.length>0&&<ValidationBanner errors={validationErrors}/>}
                <div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10}}>
                  <div style={{fontSize:11,color:"#f0c040",fontWeight:"bold",marginBottom:8}}>EXPORT QUALITY</div>
                  {DPI_OPTIONS.map(function(opt){var active=exportDPI===opt.dpi;return(<div key={opt.dpi} onClick={function(){setExportDPI(opt.dpi);}} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:active?"#1a3a1a":"#0f0f2a",border:"1px solid "+(active?"#27ae60":"#2a2a5a"),borderRadius:5,padding:"6px 8px",marginBottom:4,cursor:"pointer"}}><span style={{fontSize:11,fontWeight:"bold",color:active?"#27ae60":"#aaa"}}>{opt.label}</span><span style={{fontSize:9,color:active?"#8fbb8f":"#444"}}>{opt.desc}</span>{active&&<span style={{fontSize:9,color:"#27ae60"}}>✓</span>}</div>);})}
                </div>
                <div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10}}>
                  <div style={{fontSize:11,color:"#f0c040",fontWeight:"bold",marginBottom:8}}>GENERATE MAPS</div>
                  <button onClick={function(){openMap("map2");}} style={Object.assign({},btnBase,{width:"100%",background:"#1a3a5a",color:"#4a9adf",border:"1px solid #2a5a8a",padding:"9px",fontSize:11,marginBottom:8})}>📄 Generate MAP 2<br/><span style={{fontSize:9,fontWeight:"normal",color:"#888"}}>Sample Location Map</span></button>
                  <button onClick={function(){openMap("map3");}} style={Object.assign({},btnBase,{width:"100%",background:"#2a1a5a",color:"#9b59b6",border:"1px solid #5a2a8a",padding:"9px",fontSize:11,marginBottom:12})}>🪨 Generate MAP 3<br/><span style={{fontSize:9,fontWeight:"normal",color:"#888"}}>Geological Map</span></button>
                  <div style={{fontSize:10,color:"#f0c040",fontWeight:"bold",marginBottom:6}}>QUICK EXPORT</div>
                  {[{label:"⬇ MAP 2 — PNG "+exportDPI+"dpi",type:"map2",fmt:"png"},{label:"⬇ MAP 2 — PDF A3",type:"map2",fmt:"pdf"},{label:"⬇ MAP 3 — PNG "+exportDPI+"dpi",type:"map3",fmt:"png"},{label:"⬇ MAP 3 — PDF A3",type:"map3",fmt:"pdf"}].map(function(item,i){return(<button key={i} onClick={function(){openMapExport(item.type,item.fmt);}} style={Object.assign({},btnBase,{width:"100%",background:"#0f1f2f",color:"#7ab",border:"1px solid #2a4a6a",padding:"7px",fontSize:10,marginBottom:4})}>{item.label}</button>);})}
                </div>
                <div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10}}>
                  <div style={{fontSize:11,color:"#f0c040",fontWeight:"bold",marginBottom:6}}>GIS EXPORT</div>
                  <div style={{fontSize:9,color:"#555",marginBottom:8,lineHeight:1.5}}>Export for QGIS, ArcGIS, Google Earth, or Excel.</div>
                  <button onClick={function(){exportGeoJSON(towns,roads,rivers,samples,geoZones,currentProject?.name||"Study_Area");}} style={Object.assign({},btnBase,{width:"100%",background:"#0a2a1a",color:"#27ae60",border:"1px solid #27ae60",padding:"8px",fontSize:10,marginBottom:5})}>⬇ GeoJSON — QGIS / ArcGIS</button>
                  <button onClick={function(){exportKML(towns,roads,rivers,samples,geoZones,currentProject?.name||"Study_Area");}} style={Object.assign({},btnBase,{width:"100%",background:"#0a1a2a",color:"#4a9adf",border:"1px solid #4a9adf",padding:"8px",fontSize:10,marginBottom:5})}>⬇ KML — Google Earth</button>
                  <button onClick={function(){exportCSV(samples,currentProject?.name||"Study_Area");}} style={Object.assign({},btnBase,{width:"100%",background:"#1a1a0a",color:"#f0c040",border:"1px solid #f0c040",padding:"8px",fontSize:10})}>⬇ CSV — Sample Data (Excel)</button>
                </div>
                <div style={{background:"#0f0f1e",border:"1px dashed #2a2a4a",borderRadius:8,padding:10}}>
                  <div style={{fontSize:10,color:"#444",fontWeight:"bold",marginBottom:4}}>NEXT: SEQUENCE 7</div>
                  <div style={{fontSize:10,color:"#333",lineHeight:1.6}}>GPS + file import (GPX, KML, CSV upload).</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{background:"#0a0a1e",borderTop:"1px solid #2a2a5a",padding:"4px 14px",display:"flex",justifyContent:"space-between",flexShrink:0}}>
        <span style={{fontSize:9,color:"#333"}}>Geo Mapping System v0.6 — Database + Auth</span>
        <span style={{fontSize:9,color:"#333"}}>Nigeria · WGS84 · OpenStreetMap · {user?.email}</span>
      </div>
    </div>
  );
}