import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";

const NIGERIA_CENTER = [5.000, 7.8333];
const NIGERIA_ZOOM = 6;
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_SIZE = 256;
const ROCK_COLORS = {
  Shale: "#6b6b2a", Limestone: "#00e5ff", Sandstone: "#f9e040",
  Clay: "#cc00ff", Siltstone: "#ffaa55", Marl: "#d4a017", Gravel: "#b0b0b0",
};
const ROCK_TYPES = Object.keys(ROCK_COLORS);
const GEO_PERIODS = ["Precambrian","Cambrian","Ordovician","Silurian","Devonian","Carboniferous","Permian","Triassic","Jurassic","Cretaceous","Paleogene","Neogene","Quaternary","Unknown"];
const CONTACT_TYPES = ["Conformable","Unconformable","Fault Contact","Gradational","Intrusive","Unknown"];
const TOWN_TYPES = ["Settlement","Village","Town","City","LGA Headquarters","State Capital"];
const ROAD_SURFACES = ["Paved","Unpaved","Laterite","Track"];
const RIVER_FLOW = ["N","NE","E","SE","S","SW","W","NW","Unknown"];
const AUTO_SAVE_INTERVAL = 30000;
const NIGERIA_STATES = ["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara"];

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
  return dd+"°"+mm+"'"+ss+'"'+(isLat?(deg>=0?"N":"S"):(deg>=0?"E":"W"));
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
  var ph=fmt==="dec"?{lat:"e.g. 5.5033",lon:"e.g. 7.7591"}:{lat:"e.g. 5°30'12\"N",lon:"e.g. 7°45'33\"E"};
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
      <button onClick={handle} style={{width:"100%",background:"#1a4a2a",color:"#27ae60",border:"1px solid #27ae60",borderRadius:4,padding:"5px",fontSize:10,cursor:"pointer",fontWeight:"bold"}}>✓ Place on Map &amp; Pan</button>
    </div>
  );
}

function AuthScreen(){
  var [mode,setMode]=useState("login");
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
      if(mode==="login"){var {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});if(error)throw error;}
      else if(mode==="register"){if(password.length<6){setErr("Password must be at least 6 characters.");setLoading(false);return;}var {error}=await supabase.auth.signUp({email:email.trim(),password});if(error)throw error;setMsg("Account created! Check your email to confirm, then log in.");setMode("login");setPassword("");}
      else if(mode==="reset"){var {error}=await supabase.auth.resetPasswordForEmail(email.trim());if(error)throw error;setMsg("Password reset email sent.");}
    }catch(e){setErr(e.message||"Something went wrong.");}
    setLoading(false);
  }
  return(
    <div style={{background:"#0d0d1f",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"sans-serif"}}>
      <div style={{width:360,background:"#12122e",border:"1px solid #2a2a5a",borderRadius:12,padding:32}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
          <div style={{width:40,height:40,background:"#f0c040",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>🗺</div>
          <div><div style={{fontSize:16,fontWeight:"bold",color:"#f0c040"}}>Geo Mapping System</div><div style={{fontSize:10,color:"#555"}}>Nigeria Geological Survey</div></div>
        </div>
        <div style={{display:"flex",gap:4,marginBottom:20}}>
          {["login","register"].map(function(m){return(<button key={m} onClick={function(){setMode(m);setErr("");setMsg("");}} style={{flex:1,padding:"7px",border:"none",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:"bold",background:mode===m?"#f0c040":"#1a1a3a",color:mode===m?"#000":"#666"}}>{m==="login"?"Sign In":"Register"}</button>);})}
        </div>
        {err&&<div style={{background:"#2a0a0a",border:"1px solid #e74c3c",borderRadius:6,padding:"8px 10px",marginBottom:12,fontSize:10,color:"#ffaaaa"}}>{err}</div>}
        {msg&&<div style={{background:"#0a2a0a",border:"1px solid #27ae60",borderRadius:6,padding:"8px 10px",marginBottom:12,fontSize:10,color:"#aaffaa"}}>{msg}</div>}
        <div style={{marginBottom:10}}><div style={{fontSize:10,color:"#7ab",marginBottom:4}}>Email</div><input type="email" value={email} onChange={function(e){setEmail(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")handleSubmit();}} placeholder="your@email.com" style={{width:"100%",background:"#1e2e3e",color:"#fff",border:"1px solid #3a5a7a",borderRadius:6,padding:"8px 10px",fontSize:11,boxSizing:"border-box"}}/></div>
        {mode!=="reset"&&(<div style={{marginBottom:16}}><div style={{fontSize:10,color:"#7ab",marginBottom:4}}>Password</div><input type="password" value={password} onChange={function(e){setPassword(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")handleSubmit();}} placeholder={mode==="register"?"Minimum 6 characters":"Your password"} style={{width:"100%",background:"#1e2e3e",color:"#fff",border:"1px solid #3a5a7a",borderRadius:6,padding:"8px 10px",fontSize:11,boxSizing:"border-box"}}/></div>)}
        <button onClick={handleSubmit} disabled={loading} style={{width:"100%",background:loading?"#1a3a1a":"#27ae60",color:"#fff",border:"none",borderRadius:6,padding:"10px",fontSize:12,fontWeight:"bold",cursor:loading?"not-allowed":"pointer",marginBottom:12}}>{loading?"Please wait…":mode==="login"?"Sign In":mode==="register"?"Create Account":"Send Reset Email"}</button>
        {mode==="login"&&(<div style={{textAlign:"center"}}><button onClick={function(){setMode("reset");setErr("");setMsg("");}} style={{background:"none",border:"none",color:"#555",fontSize:10,cursor:"pointer",textDecoration:"underline"}}>Forgot password?</button></div>)}
        {mode==="reset"&&(<div style={{textAlign:"center"}}><button onClick={function(){setMode("login");setErr("");setMsg("");}} style={{background:"none",border:"none",color:"#555",fontSize:10,cursor:"pointer",textDecoration:"underline"}}>Back to Sign In</button></div>)}
      </div>
    </div>
  );
}

// ── Map type definitions ──────────────────────────────────────────────────────
var MAP_TYPE_DEFS = [
  {key:"sample", label:"Sample Location Map", icon:"📄", color:"#4a9adf", available:true},
  {key:"geo",    label:"Geologic Map",         icon:"🪨", color:"#9b59b6", available:true},
  {key:"topo",   label:"Topographic Map",      icon:"🏔", color:"#2e7d32", available:true},
  {key:"strat",  label:"Stratigraphic Column", icon:"📊", color:"#e67e22", available:true},
];

function MapTypeBadge({mapTypes}){
  var types = mapTypes||["sample","geo"];
  var active = MAP_TYPE_DEFS.filter(function(d){return types.indexOf(d.key)>=0;});
  return(
    <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:4}}>
      {active.map(function(d){return(
        <span key={d.key} style={{fontSize:8,fontWeight:"bold",color:d.color,border:"1px solid "+d.color,borderRadius:10,padding:"1px 6px",background:"rgba(0,0,0,0.3)"}}>{d.icon} {d.label}</span>
      );})}
    </div>
  );
}

function Dashboard({user,onOpen,onSignOut}){
  var [projects,setProjects]=useState([]);
  var [loading,setLoading]=useState(true);
  var [creating,setCreating]=useState(false);
  var [form,setForm]=useState({name:"",studyArea:"",lga:"",state:"Akwa Ibom",mapTypes:["sample","geo"]});
  var [deleting,setDeleting]=useState(null);
  useEffect(function(){loadProjects();},[]);

  async function loadProjects(){
    setLoading(true);
    var {data,error}=await supabase.from("projects").select("*").order("updated_at",{ascending:false});
    if(!error)setProjects(data||[]);
    setLoading(false);
  }

  function toggleMapType(key){
    setForm(function(f){
      var current=f.mapTypes||["sample","geo"];
      var next=current.indexOf(key)>=0
        ? current.filter(function(k){return k!==key;})
        : current.concat([key]);
      // Must have at least one active type
      if(next.length===0)return f;
      return Object.assign({},f,{mapTypes:next});
    });
  }

  async function createProject(){
    if(!form.studyArea.trim()){return;}
    var name=form.name.trim()||form.studyArea.trim()||"Untitled Project";
    var mapTypes=form.mapTypes.length>0?form.mapTypes:["sample","geo"];
    var {data,error}=await supabase.from("projects").insert({
      user_id:user.id,name,
      study_area:form.studyArea.trim(),
      lga:form.lga.trim(),
      state:form.state,
      map_types:mapTypes
    }).select().single();
    if(!error&&data){
      setCreating(false);
      setForm({name:"",studyArea:"",lga:"",state:"Akwa Ibom",mapTypes:["sample","geo"]});
      onOpen(data);
    }
  }

  async function deleteProject(id){
    await supabase.from("projects").delete().eq("id",id);
    setDeleting(null);
    setProjects(function(p){return p.filter(function(x){return x.id!==id;});});
  }

  function fmt(ts){
    var d=new Date(ts),now=new Date(),diff=Math.floor((now-d)/1000);
    if(diff<60)return "just now";
    if(diff<3600)return Math.floor(diff/60)+"m ago";
    if(diff<86400)return Math.floor(diff/3600)+"h ago";
    return d.toLocaleDateString();
  }

  return(
    <div style={{background:"#0d0d1f",height:"100vh",fontFamily:"sans-serif",color:"#eee",display:"flex",flexDirection:"column"}}>
      <div style={{background:"#12122e",borderBottom:"1px solid #2a2a5a",padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:32,height:32,background:"#f0c040",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🗺</div>
          <div><div style={{fontWeight:"bold",fontSize:14,color:"#f0c040"}}>Geo Mapping System</div><div style={{fontSize:9,color:"#555"}}>Signed in as {user.email}</div></div>
        </div>
        <button onClick={onSignOut} style={{background:"#1a1a3a",color:"#888",border:"1px solid #3a3a6a",borderRadius:6,padding:"5px 12px",fontSize:10,cursor:"pointer"}}>Sign Out</button>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:24,maxWidth:800,margin:"0 auto",width:"100%"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div style={{fontSize:18,fontWeight:"bold",color:"#f0c040"}}>My Projects</div>
          <button onClick={function(){setCreating(true);}} style={{background:"#27ae60",color:"#fff",border:"none",borderRadius:7,padding:"8px 16px",fontSize:11,fontWeight:"bold",cursor:"pointer"}}>+ New Project</button>
        </div>

        {creating&&(
          <div style={{background:"#12122e",border:"1px solid #27ae60",borderRadius:10,padding:16,marginBottom:16}}>
            <div style={{fontSize:11,color:"#27ae60",fontWeight:"bold",marginBottom:12}}>New Project</div>

            {/* Study area + LGA */}
            <div style={{display:"flex",gap:8,marginBottom:8}}>
              <div style={{flex:1}}>
                <div style={{fontSize:9,color:"#7ab",marginBottom:3}}>Study Area Name *</div>
                <input value={form.studyArea} onChange={function(e){setForm(function(f){return Object.assign({},f,{studyArea:e.target.value});});}} placeholder="e.g. Ogu Itumbuoso" autoFocus style={Object.assign({},INP,{marginBottom:0})}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:9,color:"#7ab",marginBottom:3}}>LGA</div>
                <input value={form.lga} onChange={function(e){setForm(function(f){return Object.assign({},f,{lga:e.target.value});});}} placeholder="e.g. Itu" style={Object.assign({},INP,{marginBottom:0})}/>
              </div>
            </div>

            {/* State */}
            <div style={{marginBottom:8}}>
              <div style={{fontSize:9,color:"#7ab",marginBottom:3}}>State</div>
              <select value={form.state} onChange={function(e){setForm(function(f){return Object.assign({},f,{state:e.target.value});});}} style={SEL}>
                {NIGERIA_STATES.map(function(s){return <option key={s}>{s}</option>;})}
              </select>
            </div>

            {/* ── MAP TYPE SELECTOR ── */}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:9,color:"#7ab",marginBottom:6}}>Map Types *</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {MAP_TYPE_DEFS.map(function(d){
                  var active=(form.mapTypes||[]).indexOf(d.key)>=0;
                  return(
                    <div key={d.key} onClick={function(){if(d.available)toggleMapType(d.key);}}
                      style={{
                        display:"flex",alignItems:"center",gap:8,
                        background:active&&d.available?"#1a2a1a":"#0f0f20",
                        border:"1px solid "+(active&&d.available?d.color:"#2a2a4a"),
                        borderRadius:6,padding:"8px 10px",
                        cursor:d.available?"pointer":"not-allowed",
                        opacity:d.available?1:0.45,
                        transition:"all 0.15s"
                      }}>
                      <div style={{
                        width:16,height:16,borderRadius:3,flexShrink:0,
                        background:active&&d.available?d.color:"transparent",
                        border:"2px solid "+(d.available?d.color:"#444"),
                        display:"flex",alignItems:"center",justifyContent:"center",fontSize:10
                      }}>{active&&d.available?"✓":""}</div>
                      <div>
                        <div style={{fontSize:10,fontWeight:"bold",color:d.available?d.color:"#555"}}>
                          {d.icon} {d.label}
                        </div>
                        {!d.available&&<div style={{fontSize:8,color:"#444"}}>Coming {d.soon}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Project name */}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:9,color:"#7ab",marginBottom:3}}>Project Name (optional)</div>
              <input value={form.name} onChange={function(e){setForm(function(f){return Object.assign({},f,{name:e.target.value});});}} onKeyDown={function(e){if(e.key==="Enter")createProject();}} placeholder="e.g. Ogu-Itumbuoso Geological Survey 2025" style={Object.assign({},INP,{marginBottom:0})}/>
            </div>

            <div style={{display:"flex",gap:8}}>
              <button onClick={createProject} style={{flex:1,background:"#27ae60",color:"#fff",border:"none",borderRadius:6,padding:"8px",fontSize:11,fontWeight:"bold",cursor:"pointer"}}>✓ Create Project</button>
              <button onClick={function(){setCreating(false);}} style={{background:"#1a1a3a",color:"#888",border:"1px solid #3a3a6a",borderRadius:6,padding:"8px 14px",fontSize:11,cursor:"pointer"}}>Cancel</button>
            </div>
          </div>
        )}

        {loading
          ?(<div style={{textAlign:"center",padding:40,color:"#555"}}>Loading projects…</div>)
          :projects.length===0
            ?(<div style={{textAlign:"center",padding:60,color:"#333"}}>
                <div style={{fontSize:32,marginBottom:12}}>🗺</div>
                <div style={{fontSize:14,color:"#555",marginBottom:8}}>No projects yet</div>
                <div style={{fontSize:11,color:"#333"}}>Create your first project to get started</div>
              </div>)
            :(<div style={{display:"flex",flexDirection:"column",gap:10}}>
                {projects.map(function(p){return(
                  <div key={p.id} style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:10,padding:16,display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={function(){if(deleting!==p.id)onOpen(p);}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:"bold",color:"#f0c040",marginBottom:2}}>{p.name||p.study_area||"Untitled"}</div>
                      {p.study_area&&<div style={{fontSize:10,color:"#7ab",marginBottom:3}}>{p.study_area}{p.lga?" · "+p.lga:""}{p.state?" · "+p.state+" State":""}</div>}
                      <MapTypeBadge mapTypes={p.map_types}/>
                      <div style={{fontSize:10,color:"#555",marginTop:4}}>Last saved {fmt(p.updated_at)}</div>
                    </div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <button onClick={function(e){e.stopPropagation();onOpen(p);}} style={{background:"#1a3a5a",color:"#4a9adf",border:"1px solid #2a5a8a",borderRadius:6,padding:"6px 14px",fontSize:10,fontWeight:"bold",cursor:"pointer"}}>Open →</button>
                      {deleting===p.id
                        ?(<div style={{display:"flex",gap:4}}>
                            <button onClick={function(e){e.stopPropagation();deleteProject(p.id);}} style={{background:"#3a0a0a",color:"#e74c3c",border:"1px solid #e74c3c",borderRadius:6,padding:"6px 10px",fontSize:10,cursor:"pointer",fontWeight:"bold"}}>Delete</button>
                            <button onClick={function(e){e.stopPropagation();setDeleting(null);}} style={{background:"#1a1a3a",color:"#888",border:"1px solid #3a3a6a",borderRadius:6,padding:"6px 8px",fontSize:10,cursor:"pointer"}}>✕</button>
                          </div>)
                        :(<button onClick={function(e){e.stopPropagation();setDeleting(p.id);}} style={{background:"transparent",color:"#3a3a6a",border:"none",borderRadius:6,padding:"6px 8px",fontSize:12,cursor:"pointer"}}>🗑</button>)
                      }
                    </div>
                  </div>
                );})}
              </div>)
        }
      </div>
    </div>
  );
}

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
  var [f,setF]=useState(Object.assign({id:"",rock:"Shale",description:"",strike:"",dip:"",notes:"",elevation:""},sample));
  var [errs,setErrs]=useState({});
  function upd(k,v){setF(function(p){return Object.assign({},p,{[k]:v});});}
  function validate(){var e={};var idErr=validateSampleId(f.id,allSamples,editingIdx);if(idErr)e.id=idErr;var sErr=validateStrike(f.strike);if(sErr)e.strike=sErr;var dErr=validateDip(f.dip);if(dErr)e.dip=dErr;setErrs(e);return Object.keys(e).length===0;}
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
      <Field label="Elevation (m asl)"><input value={f.elevation||""} onChange={function(e){upd("elevation",e.target.value);}} placeholder="e.g. 45  (GPS or hand level)" type="number" style={INP}/><div style={{fontSize:8,color:"#555",marginTop:-3,marginBottom:4}}>Used as spot height on topographic map</div></Field>
      <div style={{fontSize:9,color:"#555",fontFamily:"monospace",marginBottom:8}}>{f.lat&&f.lon?toDMS(f.lat,true)+" "+toDMS(f.lon,false):""}</div>
      <div style={{display:"flex",gap:4}}>
        <button onClick={save} style={{flex:1,background:"#1a4a2a",color:"#27ae60",border:"1px solid #27ae60",borderRadius:4,padding:"6px",fontSize:10,cursor:"pointer",fontWeight:"bold"}}>✓ Save</button>
        <button onClick={onDelete} style={{background:"#3a0a0a",color:"#e74c3c",border:"1px solid #e74c3c",borderRadius:4,padding:"6px 8px",fontSize:10,cursor:"pointer"}}>🗑</button>
        <button onClick={onDeselect} style={{background:"#1a1a2a",color:"#888",border:"1px solid #3a3a6a",borderRadius:4,padding:"6px 8px",fontSize:10,cursor:"pointer"}}>✕</button>
      </div>
    </div>
  );
}

function GeoEditPanel({zone,onSave,onDelete,onDeselect,stratFormations}){
  var [f,setF]=useState(Object.assign({rock:"Shale",formation:"",period:"Unknown",contact:"Unknown",strike:"",dip:""},zone));
  function upd(k,v){setF(function(p){return Object.assign({},p,{[k]:v});});}
  var stratNames=(stratFormations||[]).map(function(s){return s.name;}).filter(Boolean);
  return(
    <div style={{background:"#12122e",border:"1px solid #2a1a5a",borderRadius:8,padding:10}}>
      <div style={{fontSize:11,color:"#9b59b6",fontWeight:"bold",marginBottom:8}}>🪨 EDIT GEOLOGY ZONE</div>
      <Field label="Rock Type"><select value={f.rock||"Shale"} onChange={function(e){upd("rock",e.target.value);}} style={SEL}>{ROCK_TYPES.map(function(r){return <option key={r}>{r}</option>;})}</select></Field>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}><div style={{width:16,height:16,background:ROCK_COLORS[f.rock]||"#ccc",borderRadius:3,border:"1px solid #fff",flexShrink:0}}/><span style={{fontSize:9,color:"#888"}}>{f.rock}</span></div>
      <Field label="Formation Name">
        {stratNames.length>0?(
          <select value={f.formation||""} onChange={function(e){upd("formation",e.target.value);}} style={SEL}>
            <option value="">— Select formation —</option>
            {stratNames.map(function(n){return <option key={n} value={n}>{n}</option>;})}
            <option value="__custom__">Other (type below)</option>
          </select>
        ):null}
        {(stratNames.length===0||f.formation==="__custom__")&&(
          <input value={f.formation==="__custom__"?"":f.formation||""} onChange={function(e){upd("formation",e.target.value);}} placeholder="e.g. Asu River Group" style={INP}/>
        )}
        {stratNames.length>0&&<div style={{fontSize:8,color:"#555",marginTop:-3,marginBottom:4}}>From your stratigraphic column</div>}
      </Field>
      <Field label="Geological Period"><select value={f.period||"Unknown"} onChange={function(e){upd("period",e.target.value);}} style={SEL}>{GEO_PERIODS.map(function(p){return <option key={p}>{p}</option>;})}</select></Field>
      <Field label="Contact Type"><select value={f.contact||"Unknown"} onChange={function(e){upd("contact",e.target.value);}} style={SEL}>{CONTACT_TYPES.map(function(c){return <option key={c}>{c}</option>;})}</select></Field>
      <div style={{fontSize:10,color:"#f0c040",fontWeight:"bold",marginTop:6,marginBottom:4}}>Cross-Section Dip (optional)</div>
      <div style={{display:"flex",gap:6}}>
        <div style={{flex:1}}><Field label="Strike (0–360°)"><input value={f.strike||""} onChange={function(e){upd("strike",e.target.value);}} placeholder="e.g. 045" style={INP}/></Field></div>
        <div style={{flex:1}}><Field label="Dip (0–90°)"><input value={f.dip||""} onChange={function(e){upd("dip",e.target.value);}} placeholder="e.g. 32" style={INP}/></Field></div>
      </div>
      <div style={{fontSize:9,color:"#555",marginBottom:8}}>{(f.points||[]).length} nodes · Leave blank for flat layers in cross-section</div>
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
      <div style={{height:6,background:"#1a1a3a",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:score+"%",background:color,borderRadius:3,transition:"width 0.3s"}}/></div>
      <div style={{fontSize:9,color:"#444",marginTop:5}}>{score<50?"Fill in feature attributes to improve quality":score<80?"Good progress — add formation names and descriptions":"Map data is well documented"}</div>
    </div>
  );
}
function ValidationBanner({errors}){
  if(!errors||errors.length===0)return null;
  return(<div style={{background:"#3a0a0a",border:"1px solid #e74c3c",borderRadius:6,padding:"8px 10px",marginBottom:8}}><div style={{fontSize:10,color:"#e74c3c",fontWeight:"bold",marginBottom:4}}>⚠ VALIDATION WARNINGS</div>{errors.map(function(e,i){return <div key={i} style={{fontSize:9,color:"#ffaaaa",marginBottom:2}}>• {e}</div>;})}</div>);
}

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
  L.push('<Folder><name>Towns</name>');towns.forEach(function(t){L.push('<Placemark><name>'+esc(t.name)+'</name><description>'+esc(t.townType||"Settlement")+'</description><Point><coordinates>'+t.lon+','+t.lat+',0</coordinates></Point></Placemark>');});L.push('</Folder>');
  L.push('<Folder><name>Sample Points</name>');samples.forEach(function(s){L.push('<Placemark><name>'+esc(s.id)+'</name><description>'+esc([s.rock,s.description,s.strike?"Strike: "+s.strike:"",s.dip?"Dip: "+s.dip+"°":"",s.notes].filter(Boolean).join(" | "))+'</description><Point><coordinates>'+s.lon+','+s.lat+',0</coordinates></Point></Placemark>');});L.push('</Folder>');
  L.push('<Folder><name>Roads</name>');roads.forEach(function(r,i){if(r.points.length<2)return;L.push('<Placemark><name>'+esc(r.name||(r.type==="major"?"Major Road":"Minor Road")+" "+(i+1))+'</name><LineString><coordinates>'+r.points.map(function(p){return p.lon+","+p.lat+",0";}).join(" ")+'</coordinates></LineString></Placemark>');});L.push('</Folder>');
  L.push('<Folder><name>Rivers</name>');rivers.forEach(function(r,i){if(r.points.length<2)return;L.push('<Placemark><name>'+esc(r.name||"River "+(i+1))+'</name><LineString><coordinates>'+r.points.map(function(p){return p.lon+","+p.lat+",0";}).join(" ")+'</coordinates></LineString></Placemark>');});L.push('</Folder>');
  L.push('<Folder><name>Geology Zones</name>');geoZones.forEach(function(z,i){if(z.points.length<3)return;var pts=z.points.concat([z.points[0]]);L.push('<Placemark><name>'+esc(z.formation||z.rock)+'</name><Polygon><outerBoundaryIs><LinearRing><coordinates>'+pts.map(function(p){return p.lon+","+p.lat+",0";}).join(" ")+'</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>');});L.push('</Folder>');
  L.push('</Document></kml>');
  var blob=new Blob([L.join("\n")],{type:"application/vnd.google-earth.kml+xml"});
  var url=URL.createObjectURL(blob),a=document.createElement("a");
  a.download=(projectName||"geomap").replace(/\s+/g,"_")+".kml";a.href=url;a.click();
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
}
function exportCSV(samples,projectName){
  var rows=[["Sample_ID","Rock_Type","Description","Latitude","Longitude","Strike","Dip","Elevation_m","Notes"].join(",")];
  samples.forEach(function(s){function q(v){v=String(v||"");if(v.indexOf(",")>=0||v.indexOf('"')>=0||v.indexOf("\n")>=0)return'"'+v.replace(/"/g,'""')+'"';return v;}rows.push([q(s.id),q(s.rock),q(s.description),s.lat,s.lon,q(s.strike),q(s.dip),q(s.elevation||""),q(s.notes)].join(","));});
  var blob=new Blob([rows.join("\n")],{type:"text/csv"});
  var url=URL.createObjectURL(blob),a=document.createElement("a");
  a.download=(projectName||"geomap").replace(/\s+/g,"_")+"_samples.csv";a.href=url;a.click();
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
}



// ── MAP RENDERER — Seq 7.1 ────────────────────────────────────────────────────
function renderMap(type, data, meta, exportDPI, pageSize){
  exportDPI = exportDPI||300;
  pageSize  = pageSize||"A3";

  // ── Page dimensions ──────────────────────────────────────────────────────────
  var PW = pageSize==="A2" ? 1587 : 1123;
  var PH = pageSize==="A2" ? 2245 : 1587;

  var BORDER_OUTER = 6;
  var BORDER_INNER = 2;
  var BORDER_GAP   = 8;
  var PAD          = 20;
  var RIGHT_W      = Math.round(PW * 0.26);
  var BELOW_H      = 40;  // space below map frame for scale bar

  var MAP_X = BORDER_OUTER + BORDER_GAP + BORDER_INNER + PAD;
  var MAP_Y = BORDER_OUTER + BORDER_GAP + BORDER_INNER + PAD + 30;
  var MAP_W = PW - RIGHT_W - MAP_X - 10;

  var CS_H   = type==="geo" ? Math.round(PH * 0.13) : 0;
  var CS_GAP = type==="geo" ? 52 : 0;

  var MAP_H = PH - MAP_Y - BELOW_H - CS_H - CS_GAP
              - BORDER_OUTER - BORDER_GAP - BORDER_INNER - PAD;

  var {towns,roads,rivers,samples,geoZones,center,zoom} = data;
  var {studyArea,lga,state} = meta;

  // ── Vivid geology colors ─────────────────────────────────────────────────────
  var RCOLORS = {
    Shale:"#8b8b2a", Limestone:"#00bcd4", Sandstone:"#e8e04a",
    Clay:"#9c27b0",  Siltstone:"#f4a460", Marl:"#d4a017", Gravel:"#c8c8c8"
  };

  // ── Map titles ───────────────────────────────────────────────────────────────
  var areaLabel = (studyArea||"STUDY AREA").toUpperCase()+" AND ENVIRONS";
  var mapTitle = type==="sample"
    ? "MAP 2: SAMPLE LOCATION MAP OF "+areaLabel
    : "MAP 3: GEOLOGIC MAP OF "+areaLabel;
  var mapSubtitle = "IN "+(lga?lga.toUpperCase()+", ":"")+(state||"").toUpperCase()+" STATE";
  var filename = (type==="sample"?"SampleMap":"GeologicMap")
                 +"_"+(studyArea||"map").replace(/\s+/g,"_");

  // ── AUTO-ZOOM: tight bbox from all feature coordinates ───────────────────────
  var allLats=[], allLons=[];
  towns.forEach(function(f){allLats.push(f.lat);allLons.push(f.lon);});
  samples.forEach(function(f){allLats.push(f.lat);allLons.push(f.lon);});
  roads.forEach(function(r){r.points.forEach(function(p){allLats.push(p.lat);allLons.push(p.lon);});});
  rivers.forEach(function(r){r.points.forEach(function(p){allLats.push(p.lat);allLons.push(p.lon);});});
  geoZones.forEach(function(z){z.points.forEach(function(p){allLats.push(p.lat);allLons.push(p.lon);});});

  var hasFeatures = allLats.length > 0;
  var featMinLat = hasFeatures ? Math.min.apply(null,allLats) : center.lat-0.05;
  var featMaxLat = hasFeatures ? Math.max.apply(null,allLats) : center.lat+0.05;
  var featMinLon = hasFeatures ? Math.min.apply(null,allLons) : center.lon-0.05;
  var featMaxLon = hasFeatures ? Math.max.apply(null,allLons) : center.lon+0.05;

  var latSpan = Math.max(featMaxLat-featMinLat, 0.01);
  var lonSpan = Math.max(featMaxLon-featMinLon, 0.01);
  var padLat  = latSpan * 0.12;
  var padLon  = lonSpan * 0.12;
  var bboxMinLat = featMinLat - padLat;
  var bboxMaxLat = featMaxLat + padLat;
  var bboxMinLon = featMinLon - padLon;
  var bboxMaxLon = featMaxLon + padLon;

  var exportCenterLat = (bboxMinLat+bboxMaxLat)/2;
  var exportCenterLon = (bboxMinLon+bboxMaxLon)/2;

  function computeFitZoom(minLat,maxLat,minLon,maxLon,pixW,pixH){
    for(var z=18;z>=1;z--){
      var ws=256*Math.pow(2,z);
      function ly(la){var s=Math.sin(la*Math.PI/180);return ws/(2*Math.PI)*(Math.PI-Math.log((1+s)/(1-s))/2);}
      function lx(lo){return ws*(lo+180)/360;}
      var pw=lx(maxLon)-lx(minLon);
      var ph=ly(minLat)-ly(maxLat);
      if(pw<=pixW*0.88&&ph<=pixH*0.88)return z;
    }
    return 1;
  }
  var exportZoom = computeFitZoom(bboxMinLat,bboxMaxLat,bboxMinLon,bboxMaxLon,MAP_W,MAP_H);

  // A–B line through feature centroid, west→east of bbox
  var abLat     = exportCenterLat;
  var abWestLon = bboxMinLon;
  var abEastLon = bboxMaxLon;

  // ── DRAW_SMOOTH for exported HTML ────────────────────────────────────────────
  var DRAW_SMOOTH_SRC = `function drawSmooth(ctx,pts){if(!pts||pts.length<2)return;ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);if(pts.length===2){ctx.lineTo(pts[1].x,pts[1].y);}else{for(var i=0;i<pts.length-1;i++){var cp1x=pts[i].x+(pts[i+1].x-pts[i].x)*0.4,cp1y=pts[i].y+(pts[i+1].y-pts[i].y)*0.4,cp2x=pts[i].x+(pts[i+1].x-pts[i].x)*0.6,cp2y=pts[i].y+(pts[i+1].y-pts[i].y)*0.6;if(i>0){cp1x=pts[i].x+(pts[i+1].x-pts[i-1].x)*0.2;cp1y=pts[i].y+(pts[i+1].y-pts[i-1].y)*0.2;}if(i<pts.length-2){cp2x=pts[i+1].x-(pts[i+2].x-pts[i].x)*0.2;cp2y=pts[i+1].y-(pts[i+2].y-pts[i].y)*0.2;}ctx.bezierCurveTo(cp1x,cp1y,cp2x,cp2y,pts[i+1].x,pts[i+1].y);}}}`;

  // ── Per-state static outlines — accurate simplified boundaries ───────────────
  // Akwa Ibom: traced from official boundary data [lon, lat]
  var STATE_OUTLINES = {
    "akwa ibom": [
      [7.4983,4.4976],[7.5311,4.4654],[7.5614,4.4483],[7.5821,4.4285],
      [7.6124,4.4102],[7.6502,4.3934],[7.6901,4.3791],[7.7215,4.3712],
      [7.7613,4.3669],[7.8012,4.3701],[7.8398,4.3801],[7.8714,4.3967],
      [7.9012,4.4201],[7.9298,4.4487],[7.9601,4.4812],[7.9912,4.5178],
      [8.0187,4.5534],[8.0401,4.5887],[8.0598,4.6234],[8.0791,4.6598],
      [8.0987,4.6987],[8.1123,4.7398],[8.1234,4.7812],[8.1312,4.8234],
      [8.1398,4.8656],[8.1456,4.9087],[8.1487,4.9512],[8.1498,4.9934],
      [8.1476,5.0345],[8.1412,5.0743],[8.1312,5.1123],[8.1167,5.1487],
      [8.0987,5.1823],[8.0756,5.2134],[8.0487,5.2398],[8.0187,5.2623],
      [7.9856,5.2801],[7.9498,5.2934],[7.9123,5.3023],[7.8734,5.3067],
      [7.8334,5.3056],[7.7934,5.2989],[7.7545,5.2867],[7.7178,5.2689],
      [7.6834,5.2456],[7.6523,5.2167],[7.6245,5.1834],[7.6001,5.1456],
      [7.5789,5.1045],[7.5612,5.0612],[7.5467,5.0156],[7.5356,4.9689],
      [7.5267,4.9212],[7.5201,4.8734],[7.5156,4.8245],[7.5123,4.7756],
      [7.5098,4.7267],[7.5067,4.6778],[7.5023,4.6298],[7.4967,4.5823],
      [7.4923,4.5356],[7.4912,4.4976],[7.4983,4.4976]
    ],
    "default": [
      [7.4983,4.4976],[7.6502,4.3934],[7.8012,4.3701],[7.9912,4.5178],
      [8.1234,4.7812],[8.1498,4.9934],[8.1167,5.1487],[7.9856,5.2801],
      [7.8334,5.3056],[7.6834,5.2456],[7.5612,5.0612],[7.5156,4.8245],
      [7.4983,4.4976]
    ]
  };

  // Pick the right outline for the selected state
  var stateKey = (meta.state||"akwa ibom").toLowerCase().trim()
                  .replace(" state","").trim();
  var SELECTED_OUTLINE = STATE_OUTLINES[stateKey] || STATE_OUTLINES["default"];
  var AKS_OUTLINE_SRC = JSON.stringify(SELECTED_OUTLINE);

  var html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>${mapTitle}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#d0d0d0;font-family:"Times New Roman",serif;display:flex;flex-direction:column;align-items:center;}
.controls{width:${PW}px;padding:10px 14px;background:#2a2a2a;display:flex;gap:10px;align-items:center;flex-wrap:wrap;position:sticky;top:0;z-index:100;}
.controls button{background:#2c5f8a;color:#fff;border:none;padding:7px 16px;border-radius:5px;font-weight:bold;cursor:pointer;font-size:12px;font-family:sans-serif;}
.controls button:hover{background:#1a4a70;}
.size-btn{background:#444!important;}
.size-btn.active{background:#f0c040!important;color:#000!important;}
.page{width:${PW}px;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,0.3);margin:16px auto;}
canvas{display:block;}
@media print{body{background:#fff;}.controls{display:none;}.page{margin:0;box-shadow:none;}@page{size:${pageSize==="A2"?"A2":"A3"} portrait;margin:0;}}
</style>
</head><body>
<div class="controls">
  <span style="color:#f0c040;font-family:sans-serif;font-weight:bold;font-size:12px;">PAGE SIZE:</span>
  <button class="size-btn ${pageSize==="A3"?"active":""}" onclick="switchSize('A3')">A3</button>
  <button class="size-btn ${pageSize==="A2"?"active":""}" onclick="switchSize('A2')">A2</button>
  <span style="color:#888;font-family:sans-serif;font-size:11px;margin:0 8px;">|</span>
  <span style="color:#f0c040;font-family:sans-serif;font-weight:bold;font-size:12px;">EXPORT:</span>
  <button onclick="doExport('png')">&#11015; PNG</button>
  <button onclick="doExport('jpeg')">&#11015; JPEG</button>
  <button onclick="doExport('pdf')">&#11015; PDF</button>
  <button onclick="window.print()">Print</button>
  <span style="color:#555;font-family:sans-serif;font-size:10px;margin-left:auto;">DPI: ${exportDPI}</span>
</div>
<div class="page"><canvas id="mapCanvas" width="${PW}" height="${PH}"></canvas></div>

<script>
// ── constants ────────────────────────────────────────────────────────────────
var PW=${PW},PH=${PH},pageSize="${pageSize}";
var MAP_X=${MAP_X},MAP_Y=${MAP_Y},MAP_W=${MAP_W},MAP_H=${MAP_H};
var RIGHT_W=${RIGHT_W},CS_H=${CS_H},CS_GAP=${CS_GAP},BELOW_H=${BELOW_H};
var BORDER_OUTER=${BORDER_OUTER},BORDER_GAP=${BORDER_GAP},BORDER_INNER=${BORDER_INNER},PAD=${PAD};
var exportCenter={lat:${exportCenterLat},lon:${exportCenterLon}},zoom=${exportZoom};
var towns=${JSON.stringify(towns)},roads=${JSON.stringify(roads)},rivers=${JSON.stringify(rivers)};
var samples=${JSON.stringify(samples)},geoZones=${JSON.stringify(geoZones)};
var ROCK_COLORS=${JSON.stringify(RCOLORS)};
var mapType="${type}",mapTitle=${JSON.stringify(mapTitle)},mapSubtitle=${JSON.stringify(mapSubtitle)};
var studyArea=${JSON.stringify(studyArea||"")},lga=${JSON.stringify(lga||"")},state=${JSON.stringify(state||"")};
var filename=${JSON.stringify(filename)},exportDPI=${exportDPI},SCREEN_DPI=96;
var featMinLat=${featMinLat},featMaxLat=${featMaxLat};
var featMinLon=${featMinLon},featMaxLon=${featMaxLon};
var bboxMinLat=${bboxMinLat},bboxMaxLat=${bboxMaxLat};
var bboxMinLon=${bboxMinLon},bboxMaxLon=${bboxMaxLon};
var abLat=${abLat},abWestLon=${abWestLon},abEastLon=${abEastLon};
var AKS_OUTLINE=${AKS_OUTLINE_SRC};
var TILE_SIZE=256,tileCache={};
var canvas=document.getElementById("mapCanvas"),ctx=canvas.getContext("2d");
var stateGeoJSON=null;   // filled by fetchStateData()

// ── geo math ─────────────────────────────────────────────────────────────────
function lon2tile(lon,z){return Math.floor(((lon+180)/360)*Math.pow(2,z));}
function lat2tile(lat,z){return Math.floor(((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2)*Math.pow(2,z));}
function tile2lon(x,z){return x/Math.pow(2,z)*360-180;}
function tile2lat(y,z){var n=Math.PI-2*Math.PI*y/Math.pow(2,z);return 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n)));}
function ll2px(lat,lon){
  var ws=TILE_SIZE*Math.pow(2,zoom);
  function ly(la){var s=Math.sin(la*Math.PI/180);return ws/(2*Math.PI)*(Math.PI-Math.log((1+s)/(1-s))/2);}
  function lx(lo){return ws*(lo+180)/360;}
  return{x:MAP_W/2+(lx(lon)-lx(exportCenter.lon))+MAP_X,
         y:MAP_H/2+(ly(lat)-ly(exportCenter.lat))+MAP_Y};
}
function px2ll(px,py){
  var ws=TILE_SIZE*Math.pow(2,zoom);
  function ly(la){var s=Math.sin(la*Math.PI/180);return ws/(2*Math.PI)*(Math.PI-Math.log((1+s)/(1-s))/2);}
  function lx(lo){return ws*(lo+180)/360;}
  var wx=lx(exportCenter.lon)+(px-MAP_X-MAP_W/2),wy=ly(exportCenter.lat)+(py-MAP_Y-MAP_H/2);
  var n=Math.PI-2*Math.PI*wy/ws;
  return{lat:180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))),lon:wx/ws*360-180};
}
function toDMS(deg,isLat){
  var d=Math.abs(deg),dd=Math.floor(d),mm=Math.floor((d-dd)*60),ss=Math.round(((d-dd)*60-mm)*60);
  return dd+"\u00b0"+mm+"'"+ss+'"'+(isLat?(deg>=0?"N":"S"):(deg>=0?"E":"W"));
}
function loadTile(z,x,y,cb){
  var k=z+"/"+x+"/"+y;if(tileCache[k]){cb(tileCache[k]);return;}
  var img=new Image();img.crossOrigin="anonymous";
  img.onload=function(){tileCache[k]=img;cb(img);};
  img.onerror=function(){cb(null);};
  img.src="https://tile.openstreetmap.org/"+z+"/"+x+"/"+y+".png";
}
function pointInPolygon(px,py,polygon){
  var inside=false;
  for(var i=0,j=polygon.length-1;i<polygon.length;j=i++){
    var xi=polygon[i][0],yi=polygon[i][1],xj=polygon[j][0],yj=polygon[j][1];
    if(((yi>py)!=(yj>py))&&(px<(xj-xi)*(py-yi)/(yj-yi)+xi))inside=!inside;
  }
  return inside;
}
${DRAW_SMOOTH_SRC}

// ── study boundary pixel coords (used for clipping) ───────────────────────────
function getStudyBBox(){
  var tl=ll2px(featMaxLat,featMinLon);
  var br=ll2px(featMinLat,featMaxLon);
  return{x:tl.x,y:tl.y,w:br.x-tl.x,h:br.y-tl.y};
}

// ── PAGE BORDERS ──────────────────────────────────────────────────────────────
function drawBorders(){
  ctx.fillStyle="#fff";ctx.fillRect(0,0,PW,PH);
  ctx.strokeStyle="#000";ctx.lineWidth=BORDER_OUTER;
  ctx.strokeRect(BORDER_OUTER/2,BORDER_OUTER/2,PW-BORDER_OUTER,PH-BORDER_OUTER);
  var ib=BORDER_OUTER+BORDER_GAP;
  ctx.lineWidth=BORDER_INNER;ctx.strokeRect(ib,ib,PW-ib*2,PH-ib*2);
}

// ── MAP FRAME ─────────────────────────────────────────────────────────────────
function drawMapFrame(){
  // White fill for entire map frame area (clean background)
  ctx.fillStyle="#fff";ctx.fillRect(MAP_X,MAP_Y,MAP_W,MAP_H);
  ctx.strokeStyle="#000";ctx.lineWidth=1.5;ctx.strokeRect(MAP_X,MAP_Y,MAP_W,MAP_H);
}

// ── TILES — clipped to study boundary, white outside ─────────────────────────
function drawTiles(){
  // Tile alpha: geo map = 0 (white bg), sample map = 0.18 (faint OSM context)
  var alpha = mapType==="geo" ? 0 : 0.18;
  if(alpha===0)return; // no tiles for geo map

  // Get study boundary pixel rect
  var sb=getStudyBBox();
  var cx2=lon2tile(exportCenter.lon,zoom),cy2=lat2tile(exportCenter.lat,zoom);
  var range=Math.ceil(Math.max(MAP_W,MAP_H)/TILE_SIZE/2)+2;

  ctx.save();
  // Clip to study boundary only — white shows outside
  ctx.beginPath();ctx.rect(sb.x,sb.y,sb.w,sb.h);ctx.clip();
  for(var tx=cx2-range;tx<=cx2+range;tx++){
    for(var ty=cy2-range;ty<=cy2+range;ty++){
      var max=Math.pow(2,zoom);if(ty<0||ty>=max)continue;
      var rx=((tx%max)+max)%max,img=tileCache[zoom+"/"+rx+"/"+ty];
      var pt=ll2px(tile2lat(ty,zoom),tile2lon(tx,zoom));
      if(img){ctx.globalAlpha=alpha;ctx.drawImage(img,Math.round(pt.x),Math.round(pt.y),TILE_SIZE,TILE_SIZE);ctx.globalAlpha=1;}
    }
  }
  ctx.restore();
}

// ── GEOLOGY ZONES — clipped to study boundary ─────────────────────────────────
function drawGeoZones(){
  var sb=getStudyBBox();
  ctx.save();ctx.beginPath();ctx.rect(sb.x,sb.y,sb.w,sb.h);ctx.clip();
  geoZones.forEach(function(z){
    if(z.points.length<3)return;
    ctx.beginPath();
    z.points.forEach(function(pt,i){var pp=ll2px(pt.lat,pt.lon);if(i===0)ctx.moveTo(pp.x,pp.y);else ctx.lineTo(pp.x,pp.y);});
    ctx.closePath();
    ctx.fillStyle=ROCK_COLORS[z.rock]||"#ccc";ctx.globalAlpha=0.92;ctx.fill();ctx.globalAlpha=1;
    ctx.strokeStyle="#333";ctx.lineWidth=1.4;ctx.stroke();
    // Formation label at centroid
    var cx3=z.points.reduce(function(s,p){return s+p.lon;},0)/z.points.length;
    var cy3=z.points.reduce(function(s,p){return s+p.lat;},0)/z.points.length;
    var cp=ll2px(cy3,cx3);
    ctx.fillStyle="#000";ctx.font="bold 11px Times New Roman";ctx.textAlign="center";
    ctx.fillText(z.formation&&z.formation.trim()?z.formation:z.rock,cp.x,cp.y);
    ctx.textAlign="left";
  });
  ctx.restore();
}

// ── ROADS — clipped to study boundary ────────────────────────────────────────
function drawRoads(){
  var sb=getStudyBBox();
  ctx.save();ctx.beginPath();ctx.rect(sb.x,sb.y,sb.w,sb.h);ctx.clip();
  roads.forEach(function(road){
    if(road.points.length<2)return;
    var pts=road.points.map(function(pt){return ll2px(pt.lat,pt.lon);});
    if(road.type==="major"){
      // Salmon/orange-pink — matches reference
      drawSmooth(ctx,pts);ctx.strokeStyle="#c06040";ctx.lineWidth=5;ctx.stroke();
      drawSmooth(ctx,pts);ctx.strokeStyle="#e8956a";ctx.lineWidth=2.8;ctx.stroke();
    }else{
      drawSmooth(ctx,pts);ctx.strokeStyle="#444";ctx.lineWidth=1.8;ctx.stroke();
    }
    if(road.name&&road.name.trim()&&pts.length>=2){
      var mid=pts[Math.floor(pts.length/2)];
      ctx.fillStyle="#111";ctx.font="9px Times New Roman";
      ctx.fillText(road.name,mid.x+4,mid.y-5);
    }
  });
  ctx.restore();
}

// ── RIVERS — clipped to study boundary ───────────────────────────────────────
function drawRivers(){
  var sb=getStudyBBox();
  ctx.save();ctx.beginPath();ctx.rect(sb.x,sb.y,sb.w,sb.h);ctx.clip();
  rivers.forEach(function(river){
    if(river.points.length<2)return;
    var pts=river.points.map(function(pt){return ll2px(pt.lat,pt.lon);});
    drawSmooth(ctx,pts);ctx.strokeStyle="#1976d2";ctx.lineWidth=2.5;ctx.stroke();
    if(river.name&&river.name.trim()&&pts.length>=2){
      var mid=pts[Math.floor(pts.length/2)];
      ctx.fillStyle="#1565c0";ctx.font="italic 9px Times New Roman";
      ctx.fillText(river.name,mid.x+4,mid.y-5);
    }
  });
  ctx.restore();
}

// ── STUDY BOUNDARY — drawn on top of content, inside map frame ───────────────
function drawStudyBoundary(){
  if(featMinLat===featMaxLat||featMinLon===featMaxLon)return;
  var sb=getStudyBBox();
  ctx.save();ctx.beginPath();ctx.rect(MAP_X,MAP_Y,MAP_W,MAP_H);ctx.clip();
  ctx.strokeStyle="#222";ctx.lineWidth=1.4;ctx.setLineDash([8,4]);
  ctx.strokeRect(sb.x,sb.y,sb.w,sb.h);
  ctx.setLineDash([]);ctx.restore();
}

// ── TOWNS — clipped to study boundary ────────────────────────────────────────
function drawTowns(){
  var sb=getStudyBBox();
  ctx.save();ctx.beginPath();ctx.rect(sb.x,sb.y,sb.w,sb.h);ctx.clip();
  towns.forEach(function(town){
    var pp=ll2px(town.lat,town.lon);
    ctx.fillStyle="#000";ctx.beginPath();ctx.arc(pp.x,pp.y,5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(pp.x,pp.y,2.2,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#000";ctx.font="bold 10px Times New Roman";
    ctx.fillText(town.name||"",pp.x+7,pp.y-4);
  });
  ctx.restore();
}

// ── SAMPLES — clipped to study boundary ──────────────────────────────────────
function drawSamples(showLabels){
  var sb=getStudyBBox();
  ctx.save();ctx.beginPath();ctx.rect(sb.x,sb.y,sb.w,sb.h);ctx.clip();
  samples.forEach(function(s){
    var pp=ll2px(s.lat,s.lon),sz=12;
    ctx.fillStyle="#7b0000";
    ctx.beginPath();
    ctx.moveTo(pp.x,pp.y-sz);
    ctx.lineTo(pp.x+sz*0.87,pp.y+sz*0.6);
    ctx.lineTo(pp.x-sz*0.87,pp.y+sz*0.6);
    ctx.closePath();ctx.fill();
    ctx.strokeStyle="#4a0000";ctx.lineWidth=1;ctx.stroke();
    if(showLabels&&s.id){
      ctx.fillStyle="#000";ctx.font="bold 8px Times New Roman";
      ctx.fillText(s.id,pp.x+sz+2,pp.y+3);
    }
  });
  ctx.restore();
}

// ── STRIKE & DIP — clipped to study boundary ─────────────────────────────────
function drawStrikeDip(){
  var sb=getStudyBBox();
  ctx.save();ctx.beginPath();ctx.rect(sb.x,sb.y,sb.w,sb.h);ctx.clip();
  function drawSD(px,py,strikeStr,dipStr){
    if(!strikeStr||!dipStr)return;
    var sa=parseFloat(strikeStr)*Math.PI/180,sl=16;
    ctx.save();ctx.translate(px,py);
    ctx.strokeStyle="#1b5e20";ctx.lineWidth=2;
    ctx.beginPath();
    ctx.moveTo(-sl*Math.sin(sa),-sl*Math.cos(sa));
    ctx.lineTo(sl*Math.sin(sa),sl*Math.cos(sa));
    var da=sa+Math.PI/2;
    ctx.moveTo(0,0);ctx.lineTo(sl*0.6*Math.sin(da),sl*0.6*Math.cos(da));
    ctx.stroke();
    ctx.fillStyle="#1b5e20";ctx.font="bold 11px Times New Roman";ctx.textAlign="left";
    ctx.fillText(parseFloat(dipStr),sl*0.7*Math.sin(da)+3,sl*0.7*Math.cos(da)+4);
    ctx.textAlign="left";ctx.restore();
  }
  samples.forEach(function(s){
    var pp=ll2px(s.lat,s.lon);
    drawSD(pp.x,pp.y-16,s.strike,s.dip);
  });
  geoZones.forEach(function(z){
    if(z.points.length<3)return;
    var cx3=z.points.reduce(function(s,p){return s+p.lon;},0)/z.points.length;
    var cy3=z.points.reduce(function(s,p){return s+p.lat;},0)/z.points.length;
    var pp=ll2px(cy3,cx3);
    drawSD(pp.x,pp.y+20,z.strike,z.dip);
  });
  ctx.restore();
}

// ── A–B LINE — inside map frame ───────────────────────────────────────────────
function drawABLine(){
  if(mapType!=="geo")return;
  var ptA=ll2px(abLat,abWestLon),ptB=ll2px(abLat,abEastLon);
  ctx.save();ctx.beginPath();ctx.rect(MAP_X,MAP_Y,MAP_W,MAP_H);ctx.clip();
  ctx.strokeStyle="#111";ctx.lineWidth=1.8;ctx.setLineDash([10,5]);
  ctx.beginPath();ctx.moveTo(ptA.x,ptA.y);ctx.lineTo(ptB.x,ptB.y);ctx.stroke();
  ctx.setLineDash([]);ctx.restore();
  // A/B labels on frame edges
  ctx.font="bold 13px Times New Roman";ctx.fillStyle="#111";
  ctx.textAlign="right";ctx.fillText("A",MAP_X-6,ptA.y+5);
  ctx.textAlign="left";ctx.fillText("B",MAP_X+MAP_W+6,ptB.y+5);
  ctx.textAlign="left";
}

// ── COORDINATE GRID ───────────────────────────────────────────────────────────
function drawGrid(){
  ctx.save();
  ctx.strokeStyle="rgba(140,140,140,0.18)";ctx.lineWidth=0.4;ctx.setLineDash([3,4]);
  ctx.font="9px Times New Roman";ctx.fillStyle="#111";
  // Step size based on bbox span
  var span=bboxMaxLat-bboxMinLat;
  var step=span>2?1:span>0.5?0.25:span>0.1?0.05:0.01;
  var tl=px2ll(MAP_X,MAP_Y),br=px2ll(MAP_X+MAP_W,MAP_Y+MAP_H);
  for(var lo=Math.ceil(tl.lon/step)*step;lo<=br.lon+step;lo+=step){
    lo=Math.round(lo*100000)/100000;
    var px2=ll2px(exportCenter.lat,lo).x;
    if(px2<MAP_X||px2>MAP_X+MAP_W)continue;
    ctx.beginPath();ctx.moveTo(px2,MAP_Y);ctx.lineTo(px2,MAP_Y+MAP_H);ctx.stroke();
    ctx.textAlign="center";
    ctx.fillText(toDMS(lo,false),px2,MAP_Y-5);
    ctx.fillText(toDMS(lo,false),px2,MAP_Y+MAP_H+13);
  }
  for(var la=Math.floor(tl.lat/step)*step;la>=br.lat-step;la-=step){
    la=Math.round(la*100000)/100000;
    var py2=ll2px(la,exportCenter.lon).y;
    if(py2<MAP_Y||py2>MAP_Y+MAP_H)continue;
    ctx.beginPath();ctx.moveTo(MAP_X,py2);ctx.lineTo(MAP_X+MAP_W,py2);ctx.stroke();
    ctx.save();ctx.translate(MAP_X-5,py2);ctx.rotate(-Math.PI/2);
    ctx.textAlign="center";ctx.fillText(toDMS(la,true),0,0);ctx.restore();
    ctx.save();ctx.translate(MAP_X+MAP_W+16,py2);ctx.rotate(-Math.PI/2);
    ctx.textAlign="center";ctx.fillText(toDMS(la,true),0,0);ctx.restore();
  }
  ctx.setLineDash([]);ctx.textAlign="left";ctx.restore();
}

// ── NORTH ARROW — top right inside map frame ──────────────────────────────────
function drawNorthArrow(){
  var ax=MAP_X+MAP_W-36,ay=MAP_Y+40;
  ctx.save();
  ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(ax,ay,24,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle="#000";ctx.lineWidth=1.2;ctx.stroke();
  ctx.fillStyle="#000";ctx.beginPath();
  ctx.moveTo(ax,ay-20);ctx.lineTo(ax-9,ay+6);ctx.lineTo(ax+9,ay+6);ctx.closePath();ctx.fill();
  ctx.fillStyle="#fff";ctx.beginPath();
  ctx.moveTo(ax,ay+20);ctx.lineTo(ax-9,ay-6);ctx.lineTo(ax+9,ay-6);ctx.closePath();ctx.fill();
  ctx.strokeStyle="#000";ctx.lineWidth=0.8;ctx.beginPath();
  ctx.moveTo(ax,ay+20);ctx.lineTo(ax-9,ay-6);ctx.lineTo(ax+9,ay-6);ctx.closePath();ctx.stroke();
  ctx.fillStyle="#000";ctx.font="bold 14px Times New Roman";
  ctx.textAlign="center";ctx.fillText("N",ax,ay-24);ctx.textAlign="left";
  ctx.restore();
}

// ── SCALE BAR — below map frame, outside, left-aligned ───────────────────────
function drawScaleBar(){
  var mpp=(156543.03392*Math.cos(exportCenter.lat*Math.PI/180))/Math.pow(2,zoom);
  var targets=[100,200,500,1000,2000,5000,10000,20000,50000,100000,200000,500000];
  var idealPx=MAP_W*0.30;
  var bm=targets[0];
  for(var i=0;i<targets.length;i++){if(targets[i]/mpp<=idealPx)bm=targets[i];}
  var bp=bm/mpp;
  var sx=MAP_X,sy=MAP_Y+MAP_H+16;
  ctx.save();
  ctx.font="bold 9px Times New Roman";ctx.fillStyle="#000";
  ctx.fillText("SCALE",sx,sy-1);
  // 5-segment bar matching reference style
  var segs=4,segW=bp/segs;
  for(var j=0;j<segs;j++){
    ctx.fillStyle=j%2===0?"#000":"#fff";
    ctx.fillRect(sx+j*segW,sy+4,segW,11);
  }
  ctx.strokeStyle="#000";ctx.lineWidth=1;ctx.strokeRect(sx,sy+4,bp,11);
  // Labels: 0, half, full
  ctx.font="9px Times New Roman";ctx.fillStyle="#000";
  [[0,0],[bm/2,bp/2],[bm,bp]].forEach(function(pair){
    var lbl=pair[0]===0?"0":pair[0]>=1000?(pair[0]/1000)+" km":pair[0]+" m";
    ctx.textAlign="center";ctx.fillText(lbl,sx+pair[1],sy+28);
  });
  ctx.textAlign="left";ctx.restore();
}

// ── RIGHT PANEL ───────────────────────────────────────────────────────────────
function drawRightPanel(){
  var RX=MAP_X+MAP_W+12,RW=RIGHT_W-18;
  var panelTop=MAP_Y,panelH=MAP_H;

  // Panel border
  ctx.fillStyle="#fff";ctx.fillRect(RX,panelTop,RW,panelH);
  ctx.strokeStyle="#000";ctx.lineWidth=1;ctx.strokeRect(RX,panelTop,RW,panelH);

  // ── INSET MAP — top 36% of right panel ──────────────────────────────────────
  var insetH=Math.round(panelH*0.36);
  ctx.fillStyle="#fff";ctx.fillRect(RX+1,panelTop+1,RW-2,insetH-1);
  ctx.strokeStyle="#000";ctx.lineWidth=0.9;ctx.strokeRect(RX,panelTop,RW,insetH);

  // Build inset coordinate transform from state outline
  // Static outline is always the primary — live GeoJSON is an enhancement if fetch succeeded
  var outline = (stateGeoJSON && stateGeoJSON._stateOutline && stateGeoJSON._stateOutline.length > 5)
                ? stateGeoJSON._stateOutline
                : AKS_OUTLINE;
  var oLons=outline.map(function(c){return c[0];});
  var oLats=outline.map(function(c){return c[1];});
  var oMinLon=Math.min.apply(null,oLons),oMaxLon=Math.max.apply(null,oLons);
  var oMinLat=Math.min.apply(null,oLats),oMaxLat=Math.max.apply(null,oLats);
  var iPad=8;
  var iW=RW-iPad*2,iH=insetH-iPad*2;
  var scl=Math.min(iW/(oMaxLon-oMinLon),iH/(oMaxLat-oMinLat));
  var iox=RX+iPad+((iW-(oMaxLon-oMinLon)*scl)/2);
  var ioy=panelTop+iPad+((iH-(oMaxLat-oMinLat)*scl)/2);
  function toInset(lon,lat){return{x:iox+(lon-oMinLon)*scl,y:ioy+(oMaxLat-lat)*scl};}

  // Draw state outline — white fill, black border
  ctx.save();ctx.beginPath();ctx.rect(RX+1,panelTop+1,RW-2,insetH-2);ctx.clip();
  ctx.beginPath();
  outline.forEach(function(c,i){
    var p=toInset(c[0],c[1]);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);
  });
  ctx.closePath();
  ctx.fillStyle="#fff";ctx.fill();
  ctx.strokeStyle="#000";ctx.lineWidth=1.2;ctx.stroke();

  // Draw study area bbox as grey shaded rectangle — matching reference
  if(featMinLat!==featMaxLat&&featMinLon!==featMaxLon){
    var tl2=toInset(featMinLon,featMaxLat),br2=toInset(featMaxLon,featMinLat);
    var rw=Math.max(br2.x-tl2.x,5),rh=Math.max(br2.y-tl2.y,5);
    ctx.fillStyle="rgba(160,140,120,0.65)";ctx.fillRect(tl2.x,tl2.y,rw,rh);
    ctx.strokeStyle="#555";ctx.lineWidth=1;ctx.strokeRect(tl2.x,tl2.y,rw,rh);
  }
  ctx.restore();

  // State name below inset
  ctx.font="bold 8px Times New Roman";ctx.fillStyle="#000";ctx.textAlign="center";
  ctx.fillText((state||"").toUpperCase()+" STATE",RX+RW/2,panelTop+insetH-4);
  ctx.textAlign="left";

  // ── LEGEND ───────────────────────────────────────────────────────────────────
  var ly=panelTop+insetH+16;
  ctx.font="bold 12px Times New Roman";ctx.fillStyle="#000";
  ctx.textAlign="center";ctx.fillText("Legend",RX+RW/2,ly);ctx.textAlign="left";
  ly+=5;
  ctx.strokeStyle="#000";ctx.lineWidth=0.7;
  ctx.beginPath();ctx.moveTo(RX+6,ly);ctx.lineTo(RX+RW-6,ly);ctx.stroke();
  ly+=14;

  var iH2=16,symW=22;

  // Town
  ctx.fillStyle="#000";ctx.beginPath();ctx.arc(RX+13,ly-5,4.5,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(RX+13,ly-5,2,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#000";ctx.font="10px Times New Roman";ctx.fillText("Town",RX+24,ly-1);ly+=iH2;

  // Sample
  ctx.fillStyle="#7b0000";
  ctx.beginPath();ctx.moveTo(RX+13,ly-12);ctx.lineTo(RX+19,ly-3);ctx.lineTo(RX+7,ly-3);ctx.closePath();ctx.fill();
  ctx.fillStyle="#000";ctx.font="10px Times New Roman";ctx.fillText("Sample Locations",RX+24,ly-5);ly+=iH2;

  // River
  ctx.strokeStyle="#1976d2";ctx.lineWidth=2.5;
  ctx.beginPath();ctx.moveTo(RX+6,ly-5);ctx.lineTo(RX+6+symW,ly-5);ctx.stroke();
  ctx.fillStyle="#000";ctx.font="10px Times New Roman";ctx.fillText("River",RX+34,ly-2);ly+=iH2;

  // Minor road
  ctx.strokeStyle="#444";ctx.lineWidth=1.8;
  ctx.beginPath();ctx.moveTo(RX+6,ly-5);ctx.lineTo(RX+6+symW,ly-5);ctx.stroke();
  ctx.fillStyle="#000";ctx.font="10px Times New Roman";ctx.fillText("Minor Road",RX+34,ly-2);ly+=iH2;

  // Major road
  ctx.strokeStyle="#c06040";ctx.lineWidth=4.5;
  ctx.beginPath();ctx.moveTo(RX+6,ly-5);ctx.lineTo(RX+6+symW,ly-5);ctx.stroke();
  ctx.strokeStyle="#e8956a";ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(RX+6,ly-5);ctx.lineTo(RX+6+symW,ly-5);ctx.stroke();
  ctx.fillStyle="#000";ctx.font="10px Times New Roman";ctx.fillText("Major Road",RX+34,ly-2);ly+=iH2;

  // Study boundary
  ctx.strokeStyle="#222";ctx.lineWidth=1.2;ctx.setLineDash([6,3]);
  ctx.beginPath();ctx.moveTo(RX+6,ly-5);ctx.lineTo(RX+6+symW,ly-5);ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle="#000";ctx.font="10px Times New Roman";ctx.fillText("Study Boundary",RX+34,ly-2);ly+=iH2;

  if(mapType==="geo"){
    // Strike & dip
    ctx.strokeStyle="#1b5e20";ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(RX+6,ly-5);ctx.lineTo(RX+6+symW,ly-5);ctx.stroke();
    ctx.beginPath();ctx.moveTo(RX+6+symW/2,ly-5);ctx.lineTo(RX+6+symW/2,ly-12);ctx.stroke();
    ctx.fillStyle="#000";ctx.font="10px Times New Roman";ctx.fillText("Strike and Dip",RX+34,ly-2);ly+=iH2;

    // Lithology header
    ly+=6;
    ctx.strokeStyle="#000";ctx.lineWidth=0.7;
    ctx.beginPath();ctx.moveTo(RX+6,ly);ctx.lineTo(RX+RW-6,ly);ctx.stroke();ly+=12;
    ctx.font="bold 10px Times New Roman";ctx.fillStyle="#000";
    ctx.fillText("Lithology",RX+8,ly);ly+=14;

    // Rock swatches — only rocks present in geoZones
    var usedRocks={};
    geoZones.forEach(function(z){
      var lbl=z.formation&&z.formation.trim()?z.formation:z.rock;
      if(!usedRocks[lbl])usedRocks[lbl]=ROCK_COLORS[z.rock]||"#ccc";
    });
    Object.keys(usedRocks).forEach(function(lbl){
      if(ly>panelTop+panelH-100)return;
      ctx.fillStyle=usedRocks[lbl];ctx.fillRect(RX+8,ly-11,16,13);
      ctx.strokeStyle="#444";ctx.lineWidth=0.5;ctx.strokeRect(RX+8,ly-11,16,13);
      ctx.fillStyle="#000";ctx.font="9px Times New Roman";
      var maxW=RW-32,words=lbl.split(" "),line="";
      words.forEach(function(w){
        if(ctx.measureText(line+" "+w).width>maxW&&line){
          ctx.fillText(line,RX+28,ly);ly+=11;line=w;
        }else{line=line?line+" "+w:w;}
      });
      ctx.fillText(line,RX+28,ly);ly+=15;
    });
  }

  // ── TITLE BLOCK — bottom of right panel ──────────────────────────────────────
  var titleY=panelTop+panelH-92;
  ctx.strokeStyle="#000";ctx.lineWidth=0.8;
  ctx.beginPath();ctx.moveTo(RX,titleY);ctx.lineTo(RX+RW,titleY);ctx.stroke();
  ctx.font="bold 9px Times New Roman";ctx.fillStyle="#000";ctx.textAlign="center";
  // Wrap long title
  var titleWords=mapTitle.split(" "),titleLine1="",titleLine2="";
  titleWords.forEach(function(w){
    if(ctx.measureText(titleLine1+" "+w).width<RW-8&&!titleLine2)titleLine1=titleLine1?titleLine1+" "+w:w;
    else titleLine2=titleLine2?titleLine2+" "+w:w;
  });
  ctx.fillText(titleLine1,RX+RW/2,titleY+13);
  if(titleLine2)ctx.fillText(titleLine2,RX+RW/2,titleY+25);
  var subtY=titleLine2?titleY+37:titleY+26;
  ctx.font="8px Times New Roman";ctx.fillText(mapSubtitle,RX+RW/2,subtY);
  ctx.font="7px Times New Roman";ctx.fillStyle="#555";
  ctx.fillText("Projection: WGS 84 / Geographic",RX+RW/2,subtY+13);
  ctx.fillText("\u00a9 OpenStreetMap contributors",RX+RW/2,subtY+24);
  ctx.fillText("Geo Mapping System v0.7",RX+RW/2,subtY+35);
  ctx.textAlign="left";
}

// ── CROSS-SECTION — stratigraphic schematic style matching reference ───────────
function drawCrossSection(){
  if(mapType!=="geo"||CS_H===0)return;

  var CSX=MAP_X,CSW=MAP_W;
  var CSY=MAP_Y+MAP_H+CS_GAP;
  var CSH=CS_H;

  // Box + white background
  ctx.fillStyle="#fff";ctx.fillRect(CSX,CSY,CSW,CSH);
  ctx.strokeStyle="#000";ctx.lineWidth=1.2;ctx.strokeRect(CSX,CSY,CSW,CSH);

  // Title centered above
  ctx.font="bold 10px Times New Roman";ctx.fillStyle="#000";ctx.textAlign="center";
  ctx.fillText("CROSS SECTION (A-B)",CSX+CSW/2,CSY-9);
  ctx.textAlign="left";

  // A/B labels — bottom corners, outside box (matching reference)
  ctx.font="bold 12px Times New Roman";ctx.fillStyle="#000";
  ctx.textAlign="left";ctx.fillText("A",CSX,CSY+CSH+14);
  ctx.textAlign="right";ctx.fillText("B",CSX+CSW,CSY+CSH+14);
  ctx.textAlign="left";

  // Section drawing area (small margins inside box)
  var MX=6,MY=12,MB=10;
  var secX=CSX+MX,secW=CSW-MX*2;
  var secY=CSY+MY,secH=CSH-MY-MB;

  // Horizontal distance in km for scale
  var horizM=(abEastLon-abWestLon)*111320*Math.cos(abLat*Math.PI/180);

  // ── Sample A-B line at 500 points, point-in-polygon per zone ────────────────
  var N=500,segments=[],prevZone=-1,segStart=0;
  for(var si=0;si<=N;si++){
    var frac=si/N;
    var sLon=abWestLon+frac*(abEastLon-abWestLon);
    var found=-1;
    for(var zi=geoZones.length-1;zi>=0;zi--){
      var z=geoZones[zi];if(z.points.length<3)continue;
      var poly=z.points.map(function(p){return[p.lon,p.lat];});
      if(pointInPolygon(sLon,abLat,poly)){found=zi;break;}
    }
    if(found!==prevZone){
      if(prevZone>=0)segments.push({f0:segStart,f1:frac,zi:prevZone});
      prevZone=found;segStart=frac;
    }
  }
  if(prevZone>=0)segments.push({f0:segStart,f1:1,zi:prevZone});

  // Clip to section box
  ctx.save();ctx.beginPath();ctx.rect(secX,secY,secW,secH);ctx.clip();

  // Background — tan/cream like reference
  ctx.fillStyle="#f5f0e8";ctx.fillRect(secX,secY,secW,secH);

  // ── Draw segments as smooth geological bands ─────────────────────────────────
  // For each segment: draw trapezoid with dip-tilted top surface
  // Outside-zone areas (found=-1) show background only
  segments.forEach(function(seg){
    if(seg.zi<0)return;
    var z=geoZones[seg.zi];
    var x1=secX+seg.f0*secW;
    var x2=secX+seg.f1*secW;
    var bw=x2-x1;if(bw<0.5)return;

    var dipDeg=z.dip?Math.min(parseFloat(z.dip)||0,75):0;

    // Compute dipped top surface Y for left and right edges of this segment
    // Dip tilts the surface proportional to horizontal position relative to centre
    var fracMidL=seg.f0-0.5;
    var fracMidR=seg.f1-0.5;
    var dipFactor=dipDeg>0?Math.tan(dipDeg*Math.PI/180)*2:0;
    // Maximum dip drop = 50% of section height
    var maxDrop=secH*0.5;
    var y1L=secY+Math.max(0,Math.min(maxDrop,fracMidL*dipFactor*secH*0.5));
    var y1R=secY+Math.max(0,Math.min(maxDrop,fracMidR*dipFactor*secH*0.5));

    // Draw filled band (trapezoid: dipped top, flat bottom)
    ctx.beginPath();
    ctx.moveTo(x1,y1L);
    ctx.lineTo(x2,y1R);
    ctx.lineTo(x2,secY+secH);
    ctx.lineTo(x1,secY+secH);
    ctx.closePath();
    ctx.fillStyle=ROCK_COLORS[z.rock]||"#ccc";ctx.fill();

    // Subtle band separator
    ctx.strokeStyle="rgba(0,0,0,0.20)";ctx.lineWidth=0.6;ctx.stroke();

    // Formation label centered in visible band area
    var lbl=z.formation&&z.formation.trim()?z.formation:z.rock;
    var midX=(x1+x2)/2;
    var topMidY=(y1L+y1R)/2;
    var bandH=(secY+secH)-topMidY;
    var textY=topMidY+bandH*0.52;
    ctx.fillStyle="#000";ctx.font="bold 9px Times New Roman";
    var tw=ctx.measureText(lbl).width;
    if(bw>tw+8&&bandH>16){
      ctx.textAlign="center";ctx.fillText(lbl,midX,textY);ctx.textAlign="left";
    }
  });

  // Surface datum line — flat black line across top of section
  ctx.strokeStyle="#000";ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(secX,secY);ctx.lineTo(secX+secW,secY);ctx.stroke();

  ctx.restore();

  // Scale bar below cross-section — matching reference "0 1 2 4 Km" style
  var mpp=(156543.03392*Math.cos(exportCenter.lat*Math.PI/180))/Math.pow(2,zoom);
  var csScaleM=Math.round(horizM/4/1000)*1000||1000;
  var csScalePx=csScaleM/mpp;
  var sbx=CSX,sby=CSY+CSH+18;
  ctx.font="8px Times New Roman";ctx.fillStyle="#555";ctx.textAlign="left";
  ctx.fillText("Horizontal distance: "+Math.round(horizM/100)/10+" km",sbx,sby+10);
  ctx.textAlign="left";
}

// ── WATERMARK ─────────────────────────────────────────────────────────────────
function drawWatermark(){
  ctx.save();
  ctx.fillStyle="rgba(255,255,255,0.85)";ctx.fillRect(MAP_X,MAP_Y+MAP_H-14,260,14);
  ctx.fillStyle="#888";ctx.font="7px sans-serif";
  ctx.fillText("\u00a9 OpenStreetMap contributors | Geo Mapping System v0.7",MAP_X+4,MAP_Y+MAP_H-4);
  ctx.restore();
}

// ── DRAW ALL ──────────────────────────────────────────────────────────────────
function drawAll(){
  ctx.clearRect(0,0,PW,PH);
  drawBorders();
  drawMapFrame();        // white fill for entire map frame
  drawTiles();           // clipped to study boundary (0% geo, 18% sample)
  if(mapType==="geo")drawGeoZones();
  drawStudyBoundary();   // dashed boundary box
  drawRoads();
  drawRivers();
  drawTowns();
  drawSamples(mapType==="sample");
  if(mapType==="geo")drawStrikeDip();
  if(mapType==="geo")drawABLine();
  drawGrid();
  drawNorthArrow();
  drawScaleBar();        // outside, below frame
  drawRightPanel();
  if(mapType==="geo")drawCrossSection();
  drawWatermark();
}

// ── TILE INIT ─────────────────────────────────────────────────────────────────
function init(){
  // For geo map tiles are unused — just draw immediately
  if(mapType==="geo"){drawAll();return;}
  var cx2=lon2tile(exportCenter.lon,zoom),cy2=lat2tile(exportCenter.lat,zoom);
  var range=Math.ceil(Math.max(MAP_W,MAP_H)/TILE_SIZE/2)+2,toLoad=[];
  for(var tx=cx2-range;tx<=cx2+range;tx++){
    for(var ty=cy2-range;ty<=cy2+range;ty++){
      var max=Math.pow(2,zoom);if(ty<0||ty>=max)continue;
      toLoad.push({z:zoom,x:((tx%max)+max)%max,y:ty});
    }
  }
  if(toLoad.length===0){drawAll();return;}
  var loaded=0,total=toLoad.length;
  toLoad.forEach(function(t){
    loadTile(t.z,t.x,t.y,function(){
      loaded++;
      if(loaded===1||loaded===total)drawAll();
    });
  });
}

// ── FETCH live state outline — enhancement only, static fallback always shown ──
function fetchStateData(){
  // Normalize state name for matching
  var raw=(state||"akwa ibom").toLowerCase().trim().replace(/\s*state\s*$/,"").trim();

  // Every property key different GeoJSON sources use for the state name
  var NAME_KEYS=["name","Name","NAME","statename","StateName","STATENAME",
                 "admin1Name","STATE","state","State","shapeName","admin_name"];

  function extractOutline(feat){
    if(!feat||!feat.geometry)return null;
    var geom=feat.geometry;
    var rings=[];
    if(geom.type==="Polygon"){
      rings=[geom.coordinates[0]];
    }else if(geom.type==="MultiPolygon"){
      geom.coordinates.forEach(function(poly){if(poly[0])rings.push(poly[0]);});
      // Largest ring = main landmass (not tiny coastal islands)
      rings.sort(function(a,b){return b.length-a.length;});
    }
    if(!rings.length||!rings[0]||rings[0].length<4)return null;
    return rings[0].map(function(c){return[c[0],c[1]];});
  }

  function matchFeature(features){
    var exact=null,partial=null;
    features.forEach(function(feat){
      var props=feat.properties||{};
      for(var k=0;k<NAME_KEYS.length;k++){
        var val=(props[NAME_KEYS[k]]||"").toLowerCase().trim().replace(/\s*state\s*$/,"").trim();
        if(!val)continue;
        if(val===raw){exact=feat;return;}
        if(!partial&&(val.indexOf(raw)>=0||raw.indexOf(val)>=0)){partial=feat;}
      }
    });
    return exact||partial;
  }

  function trySource(url){
    return fetch(url)
      .then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json();})
      .then(function(data){
        var features=data.features||[];
        var match=matchFeature(features);
        if(!match)throw new Error("no state match in "+url);
        var outline=extractOutline(match);
        if(!outline)throw new Error("no outline extracted");
        stateGeoJSON={_stateOutline:outline};
        drawAll(); // repaint with live outline
        return true;
      });
  }

  // Two sources — first success wins, static fallback always already showing
  trySource(
    "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/nigeria-states.geojson"
  ).catch(function(){
    return trySource(
      "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson"
    );
  }).catch(function(){
    // Both failed — AKS_OUTLINE static shape already rendered, nothing to do
  });
}

// ── EXPORT ────────────────────────────────────────────────────────────────────
function doExport(fmt){
  var SCALE=exportDPI/SCREEN_DPI;
  var hiCanvas=document.createElement("canvas");
  hiCanvas.width=Math.round(PW*SCALE);hiCanvas.height=Math.round(PH*SCALE);
  var hiCtx=hiCanvas.getContext("2d");
  hiCtx.scale(SCALE,SCALE);hiCtx.drawImage(canvas,0,0,PW,PH);
  if(fmt==="pdf"){
    if(!window.jspdf){alert("PDF library still loading \u2014 try again.");return;}
    var mm=pageSize==="A2"?{w:420,h:594}:{w:297,h:420};
    var doc=new window.jspdf.jsPDF({orientation:"portrait",unit:"mm",format:pageSize==="A2"?"a2":"a3"});
    doc.addImage(canvas.toDataURL("image/png",1.0),"PNG",0,0,mm.w,mm.h);
    doc.save(filename+".pdf");
  }else{
    var mime=fmt==="jpeg"?"image/jpeg":"image/png";
    var ext=fmt==="jpeg"?"jpg":"png";
    hiCanvas.toBlob(function(blob){
      var url=URL.createObjectURL(blob),a=document.createElement("a");
      a.download=filename+"."+ext;a.href=url;a.click();
      setTimeout(function(){URL.revokeObjectURL(url);},1000);
    },mime,fmt==="jpeg"?0.95:undefined);
  }
}
function switchSize(sz){
  var msg=document.createElement("div");
  msg.style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#000;color:#f0c040;padding:20px 40px;border-radius:10px;font-family:sans-serif;font-size:16px;z-index:9999;";
  msg.innerText="To switch to "+sz+", regenerate the map from the editor and select "+sz+" in the Output tab.";
  document.body.appendChild(msg);setTimeout(function(){document.body.removeChild(msg);},3000);
}
window.doExport=doExport;window.switchSize=switchSize;
fetchStateData();
init();
<\/script></body></html>`;
  return html;
}

// ── STRATIGRAPHIC COLUMN RENDERER ────────────────────────────────────────────
var GEO_AGES = ["Hadean","Archean","Proterozoic","Cambrian","Ordovician","Silurian",
  "Devonian","Carboniferous","Permian","Triassic","Jurassic","Cretaceous",
  "Paleogene","Neogene","Quaternary","Unknown"];

// Lithology pattern colors — reuses ROCK_COLORS palette
var STRAT_ROCK_COLORS = {
  Shale:"#8b8b2a", Limestone:"#00bcd4", Sandstone:"#e8e04a",
  Clay:"#9c27b0",  Siltstone:"#f4a460", Marl:"#d4a017", Gravel:"#c8c8c8",
  Coal:"#222222",  Mudstone:"#a0785a",  Granite:"#f4a0a0", Quartzite:"#e0e0ff",
  Basalt:"#555577",Schist:"#88aa88",    Gneiss:"#bb9977",  Limestone:"#00bcd4",
};
var STRAT_ROCK_TYPES = ["Sandstone","Shale","Limestone","Clay","Siltstone",
  "Marl","Gravel","Coal","Mudstone","Granite","Quartzite","Basalt","Schist","Gneiss"];

function renderStratColumn(formations, meta, exportDPI, pageSize){
  exportDPI = exportDPI||300;
  pageSize  = pageSize||"A3";
  var PW = pageSize==="A2"?1587:1123;
  var PH = pageSize==="A2"?2245:1587;
  var {studyArea,lga,state} = meta;
  var title = "COMPOSITE STRATIGRAPHIC COLUMN OF "+(studyArea||"STUDY AREA").toUpperCase()+" AND ENVIRONS";
  var subtitle = "IN "+(lga?lga.toUpperCase()+", ":"")+(state||"").toUpperCase()+" STATE";
  var filename = "StratColumn_"+(studyArea||"map").replace(/\s+/g,"_");

  var RCOLORS = JSON.stringify(STRAT_ROCK_COLORS);

  var html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${title}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#d0d0d0;font-family:"Times New Roman",serif;display:flex;flex-direction:column;align-items:center;}
.controls{width:${PW}px;padding:10px 14px;background:#2a2a2a;display:flex;gap:10px;align-items:center;flex-wrap:wrap;position:sticky;top:0;z-index:100;}
.controls button{background:#2c5f8a;color:#fff;border:none;padding:7px 16px;border-radius:5px;font-weight:bold;cursor:pointer;font-size:12px;font-family:sans-serif;}
.controls button:hover{background:#1a4a70;}
.page{width:${PW}px;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,0.3);margin:16px auto;}
canvas{display:block;}
@media print{body{background:#fff;}.controls{display:none;}.page{margin:0;box-shadow:none;}@page{size:${pageSize==="A2"?"A2":"A3"} portrait;margin:0;}}
</style>
</head><body>
<div class="controls">
  <span style="color:#f0c040;font-family:sans-serif;font-weight:bold;font-size:12px;">MAP 5 — STRATIGRAPHIC COLUMN</span>
  <span style="color:#888;font-family:sans-serif;font-size:11px;margin:0 8px;">|</span>
  <button onclick="doExport('png')">&#11015; PNG</button>
  <button onclick="doExport('jpeg')">&#11015; JPEG</button>
  <button onclick="doExport('pdf')">&#11015; PDF</button>
  <button onclick="window.print()">Print</button>
  <span style="color:#555;font-family:sans-serif;font-size:10px;margin-left:auto;">DPI: ${exportDPI}</span>
</div>
<div class="page"><canvas id="sc" width="${PW}" height="${PH}"></canvas></div>
<script>
var PW=${PW},PH=${PH},pageSize="${pageSize}";
var formations=${JSON.stringify(formations)};
var ROCK_COLORS=${RCOLORS};
var title=${JSON.stringify(title)},subtitle=${JSON.stringify(subtitle)};
var filename=${JSON.stringify(filename)};
var exportDPI=${exportDPI},SCREEN_DPI=96;
var canvas=document.getElementById("sc"),ctx=canvas.getContext("2d");

// ── Layout constants ──────────────────────────────────────────────────────────
var BO=6,BG=8,BI=2,PAD=20;          // borders
var CX=BO+BG+BI+PAD;                 // content left
var CY=BO+BG+BI+PAD+80;             // content top (below title area)
var CW=PW-CX*2;                      // content width
var CH=PH-CY-(BO+BG+BI+PAD+60);    // content height

// Column layout (left to right)
var AGE_W   = Math.round(CW*0.14);  // Age / Period
var THICK_W = Math.round(CW*0.09);  // Thickness
var COL_W   = Math.round(CW*0.18);  // Lithology column (the column itself)
var DESC_W  = CW - AGE_W - THICK_W - COL_W; // Description

var COL_X   = CX + AGE_W + THICK_W;         // x of lithology column
var DESC_X  = COL_X + COL_W;                // x of description

// ── Total thickness for scale ─────────────────────────────────────────────────
var totalM = formations.reduce(function(s,f){return s+(parseFloat(f.thickness)||0);},0)||100;
var pxPerM = CH / totalM;

// ── DRAW ─────────────────────────────────────────────────────────────────────
function draw(){
  ctx.fillStyle="#fff";ctx.fillRect(0,0,PW,PH);

  // Page borders
  ctx.strokeStyle="#000";ctx.lineWidth=BO;
  ctx.strokeRect(BO/2,BO/2,PW-BO,PH-BO);
  ctx.lineWidth=BI;
  var ib=BO+BG;ctx.strokeRect(ib,ib,PW-ib*2,PH-ib*2);

  // Title block
  ctx.font="bold 13px Times New Roman";ctx.fillStyle="#000";ctx.textAlign="center";
  ctx.fillText(title,PW/2,BO+BG+BI+PAD+22);
  ctx.font="11px Times New Roman";
  ctx.fillText(subtitle,PW/2,BO+BG+BI+PAD+40);
  ctx.font="9px Times New Roman";ctx.fillStyle="#555";
  ctx.fillText("MAP 5: COMPOSITE STRATIGRAPHIC COLUMN",PW/2,BO+BG+BI+PAD+58);
  ctx.textAlign="left";

  // Column headers
  var HY=CY-8;
  ctx.font="bold 9px Times New Roman";ctx.fillStyle="#000";ctx.textAlign="center";
  ctx.fillText("AGE",CX+AGE_W/2,HY);
  ctx.fillText("THICK.(m)",CX+AGE_W+THICK_W/2,HY);
  ctx.fillText("LITHOLOGY",COL_X+COL_W/2,HY);
  ctx.fillText("DESCRIPTION",DESC_X+DESC_W/2,HY);
  ctx.textAlign="left";

  // Header separator
  ctx.strokeStyle="#000";ctx.lineWidth=1.2;
  ctx.beginPath();ctx.moveTo(CX,CY-2);ctx.lineTo(CX+CW,CY-2);ctx.stroke();

  // Outer column box
  ctx.strokeStyle="#000";ctx.lineWidth=1.2;ctx.strokeRect(CX,CY,CW,CH);

  // Vertical dividers
  [[CX+AGE_W],[CX+AGE_W+THICK_W],[COL_X+COL_W]].forEach(function(arr){
    var x=arr[0];
    ctx.beginPath();ctx.moveTo(x,CY);ctx.lineTo(x,CY+CH);ctx.stroke();
  });

  // Draw formations top to bottom (youngest at top, oldest at bottom)
  // formations array: index 0 = youngest (top)
  var y=CY;
  formations.forEach(function(f,fi){
    var m=parseFloat(f.thickness)||10;
    var h=Math.max(m*pxPerM,18); // min 18px so text is visible
    var color=ROCK_COLORS[f.rock]||"#ccc";

    // Lithology fill
    ctx.fillStyle=color;ctx.globalAlpha=0.9;
    ctx.fillRect(COL_X+1,y+1,COL_W-2,h-1);
    ctx.globalAlpha=1;

    // Unconformity: wavy line at top of this band if flagged
    if(f.unconformity&&fi>0){
      ctx.strokeStyle="#e74c3c";ctx.lineWidth=2;ctx.setLineDash([4,3]);
      ctx.beginPath();ctx.moveTo(COL_X,y);ctx.lineTo(COL_X+COL_W,y);ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle="#e74c3c";ctx.font="bold 8px Times New Roman";
      ctx.textAlign="center";ctx.fillText("— UNCONFORMITY —",COL_X+COL_W/2,y-3);
      ctx.textAlign="left";
    }

    // Band separator line
    ctx.strokeStyle="#000";ctx.lineWidth=0.5;
    ctx.beginPath();ctx.moveTo(CX,y+h);ctx.lineTo(CX+CW,y+h);ctx.stroke();

    // Age label (rotated if tall enough)
    var midY=y+h/2;
    ctx.fillStyle="#000";ctx.font="9px Times New Roman";
    if(h>24){
      ctx.save();ctx.translate(CX+AGE_W/2,midY);ctx.rotate(-Math.PI/2);
      ctx.textAlign="center";ctx.fillText(f.age||"Unknown",0,0);ctx.restore();
    }else{
      ctx.textAlign="center";ctx.font="7px Times New Roman";
      ctx.fillText((f.age||"").slice(0,8),CX+AGE_W/2,midY+3);
    }

    // Thickness
    ctx.textAlign="center";ctx.font="9px Times New Roman";ctx.fillStyle="#000";
    ctx.fillText(m+"m",CX+AGE_W+THICK_W/2,midY+3);

    // Formation name inside lithology column (centered, bold)
    ctx.textAlign="center";ctx.font="bold 8px Times New Roman";ctx.fillStyle="#000";
    if(h>14){ctx.fillText(f.name||"",COL_X+COL_W/2,midY+3);}

    // Description (left-aligned, wraps)
    ctx.textAlign="left";ctx.font="9px Times New Roman";ctx.fillStyle="#333";
    var desc=f.description||"";
    var maxW=DESC_W-8;
    var words=desc.split(" "),line="",dy=y+13;
    words.forEach(function(w){
      var test=line?line+" "+w:w;
      if(ctx.measureText(test).width>maxW&&line){
        if(dy<y+h-2){ctx.fillText(line,DESC_X+4,dy);dy+=11;}
        line=w;
      }else{line=test;}
    });
    if(line&&dy<y+h-2)ctx.fillText(line,DESC_X+4,dy);

    y+=h;
  });

  // Depth scale on right edge of lithology column
  ctx.strokeStyle="#000";ctx.lineWidth=0.7;
  var tickStep=totalM<=100?10:totalM<=500?50:100;
  for(var d=0;d<=totalM;d+=tickStep){
    var ty=CY+d*pxPerM;if(ty>CY+CH)break;
    ctx.beginPath();ctx.moveTo(COL_X+COL_W,ty);ctx.lineTo(COL_X+COL_W+6,ty);ctx.stroke();
    ctx.fillStyle="#000";ctx.font="8px Times New Roman";ctx.textAlign="left";
    ctx.fillText(d+"m",COL_X+COL_W+8,ty+3);
  }

  // Caption
  ctx.font="9px Times New Roman";ctx.fillStyle="#555";ctx.textAlign="center";
  ctx.fillText("Vertical scale: 1 cm = "+Math.round(totalM/(CH/28.35)*10)/10+" m  |  Generated by Geo Mapping System v0.8",
    PW/2,PH-(BO+BG+BI+PAD)-10);
  ctx.textAlign="left";
}

// ── EXPORT ────────────────────────────────────────────────────────────────────
function doExport(fmt){
  var SCALE=exportDPI/SCREEN_DPI;
  var hc=document.createElement("canvas");
  hc.width=Math.round(PW*SCALE);hc.height=Math.round(PH*SCALE);
  var hx=hc.getContext("2d");hx.scale(SCALE,SCALE);hx.drawImage(canvas,0,0,PW,PH);
  if(fmt==="pdf"){
    if(!window.jspdf){alert("PDF library loading, try again.");return;}
    var mm=pageSize==="A2"?{w:420,h:594}:{w:297,h:420};
    var doc=new window.jspdf.jsPDF({orientation:"portrait",unit:"mm",format:pageSize==="A2"?"a2":"a3"});
    doc.addImage(canvas.toDataURL("image/png",1.0),"PNG",0,0,mm.w,mm.h);
    doc.save(filename+".pdf");
  }else{
    var mime=fmt==="jpeg"?"image/jpeg":"image/png";
    var ext=fmt==="jpeg"?"jpg":"png";
    hc.toBlob(function(blob){
      var url=URL.createObjectURL(blob),a=document.createElement("a");
      a.download=filename+"."+ext;a.href=url;a.click();
      setTimeout(function(){URL.revokeObjectURL(url);},1000);
    },mime,fmt==="jpeg"?0.95:undefined);
  }
}
window.doExport=doExport;
draw();
<\/script></body></html>`;
  return html;
}

// ── STRAT EDITOR COMPONENT ────────────────────────────────────────────────────
var EMPTY_FORMATION = {name:"",rock:"Shale",thickness:"",age:"Unknown",description:"",unconformity:false};

function StratEditor({formations,onChange,onExport}){
  function addRow(){
    onChange(formations.concat([Object.assign({},EMPTY_FORMATION)]));
  }
  function updateRow(i,key,val){
    onChange(formations.map(function(f,idx){
      return idx===i?Object.assign({},f,{[key]:val}):f;
    }));
  }
  function removeRow(i){
    onChange(formations.filter(function(_,idx){return idx!==i;}));
  }
  function moveRow(i,dir){
    var next=formations.slice();
    var j=i+dir;
    if(j<0||j>=next.length)return;
    var tmp=next[i];next[i]=next[j];next[j]=tmp;
    onChange(next);
  }

  return(
    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      <div style={{fontSize:11,color:"#e67e22",fontWeight:"bold",marginBottom:4}}>
        📊 STRATIGRAPHIC COLUMN
      </div>
      <div style={{fontSize:9,color:"#666",lineHeight:1.6,marginBottom:6}}>
        Add formations youngest → oldest (top → bottom). Each row = one formation band.
      </div>

      {formations.length===0&&(
        <div style={{background:"#12122e",border:"1px dashed #3a3a6a",borderRadius:6,padding:12,textAlign:"center",color:"#444",fontSize:10}}>
          No formations yet. Click Add Formation to begin.
        </div>
      )}

      {formations.map(function(f,i){return(
        <div key={i} style={{background:"#12122e",border:"1px solid #3a2a1a",borderRadius:6,padding:8}}>
          {/* Row header */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:12,height:12,background:STRAT_ROCK_COLORS[f.rock]||"#ccc",borderRadius:2,border:"1px solid #fff",flexShrink:0}}/>
              <span style={{fontSize:10,color:"#e67e22",fontWeight:"bold"}}>
                {i===0?"Youngest":i===formations.length-1?"Oldest":"Formation "+(i+1)}
              </span>
            </div>
            <div style={{display:"flex",gap:3}}>
              <button onClick={function(){moveRow(i,-1);}} disabled={i===0}
                style={{background:"#1a1a3a",color:i===0?"#333":"#aaa",border:"1px solid #3a3a6a",borderRadius:3,padding:"2px 6px",fontSize:10,cursor:i===0?"not-allowed":"pointer"}}>↑</button>
              <button onClick={function(){moveRow(i,1);}} disabled={i===formations.length-1}
                style={{background:"#1a1a3a",color:i===formations.length-1?"#333":"#aaa",border:"1px solid #3a3a6a",borderRadius:3,padding:"2px 6px",fontSize:10,cursor:i===formations.length-1?"not-allowed":"pointer"}}>↓</button>
              <button onClick={function(){removeRow(i);}}
                style={{background:"#3a0a0a",color:"#e74c3c",border:"1px solid #e74c3c",borderRadius:3,padding:"2px 6px",fontSize:10,cursor:"pointer"}}>✕</button>
            </div>
          </div>

          {/* Formation name + thickness on one row */}
          <div style={{display:"flex",gap:4,marginBottom:4}}>
            <div style={{flex:2}}>
              <div style={{fontSize:8,color:"#7ab",marginBottom:2}}>Formation Name *</div>
              <input value={f.name} onChange={function(e){updateRow(i,"name",e.target.value);}}
                placeholder="e.g. Ajali Sandstone" style={Object.assign({},INP,{marginBottom:0,fontSize:9})}/>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:8,color:"#7ab",marginBottom:2}}>Thickness (m) *</div>
              <input value={f.thickness} onChange={function(e){updateRow(i,"thickness",e.target.value);}}
                placeholder="e.g. 45" type="number" min="1"
                style={Object.assign({},INP,{marginBottom:0,fontSize:9})}/>
            </div>
          </div>

          {/* Rock type + Age on one row */}
          <div style={{display:"flex",gap:4,marginBottom:4}}>
            <div style={{flex:1}}>
              <div style={{fontSize:8,color:"#7ab",marginBottom:2}}>Rock Type</div>
              <select value={f.rock} onChange={function(e){updateRow(i,"rock",e.target.value);}}
                style={Object.assign({},SEL,{marginBottom:0,fontSize:9})}>
                {STRAT_ROCK_TYPES.map(function(r){return <option key={r}>{r}</option>;})}
              </select>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:8,color:"#7ab",marginBottom:2}}>Geological Age</div>
              <select value={f.age||"Unknown"} onChange={function(e){updateRow(i,"age",e.target.value);}}
                style={Object.assign({},SEL,{marginBottom:0,fontSize:9})}>
                {GEO_AGES.map(function(a){return <option key={a}>{a}</option>;})}
              </select>
            </div>
          </div>

          {/* Description */}
          <div style={{marginBottom:4}}>
            <div style={{fontSize:8,color:"#7ab",marginBottom:2}}>Lithology Description</div>
            <input value={f.description} onChange={function(e){updateRow(i,"description",e.target.value);}}
              placeholder="e.g. Coarse-grained, cross-bedded, friable"
              style={Object.assign({},INP,{marginBottom:0,fontSize:9})}/>
          </div>

          {/* Unconformity toggle */}
          <div style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}
            onClick={function(){updateRow(i,"unconformity",!f.unconformity);}}>
            <div style={{
              width:14,height:14,borderRadius:2,border:"1px solid #e74c3c",
              background:f.unconformity?"#e74c3c":"transparent",
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:9
            }}>{f.unconformity?"✓":""}</div>
            <span style={{fontSize:9,color:"#888"}}>Unconformity above this formation</span>
          </div>
        </div>
      );})}

      <button onClick={addRow}
        style={{background:"#1a3a1a",color:"#27ae60",border:"1px solid #27ae60",
                borderRadius:6,padding:"7px",fontSize:10,cursor:"pointer",fontWeight:"bold",width:"100%"}}>
        + Add Formation
      </button>

      {formations.length>0&&(
        <button onClick={onExport}
          style={{background:"#3a2000",color:"#e67e22",border:"1px solid #e67e22",
                  borderRadius:6,padding:"8px",fontSize:10,cursor:"pointer",fontWeight:"bold",width:"100%"}}>
          📊 Generate Stratigraphic Column (MAP 5)
        </button>
      )}

      {/* Cross-map bonus notice */}
      {formations.length>0&&(
        <div style={{background:"#0a1a0a",border:"1px solid #1a3a1a",borderRadius:6,padding:8}}>
          <div style={{fontSize:9,color:"#27ae60",fontWeight:"bold",marginBottom:3}}>✓ Cross-Map Sync Active</div>
          <div style={{fontSize:8,color:"#555",lineHeight:1.6}}>
            Formation names here are available as dropdown options when editing geology polygon attributes.
          </div>
        </div>
      )}
    </div>
  );
}

// ── TOPOGRAPHIC MAP RENDERER — Seq 10 ────────────────────────────────────────
// ── TOPOGRAPHIC MAP RENDERER — Seq 10.1 Fixed ────────────────────────────────
function renderTopoMap(data, meta, exportDPI, pageSize, layout){
  exportDPI = exportDPI||300;
  pageSize  = pageSize||"A3";
  layout    = layout||"panel";

  var PW = pageSize==="A2"?1587:1123;
  var PH = pageSize==="A2"?2245:1587;
  var BO=6,BG=8,BI=2,PAD=20;

  var {towns,roads,rivers,samples,contourLines} = data;
  contourLines = contourLines||[];
  var {studyArea,lga,state} = meta;

  var areaLabel=(studyArea||"STUDY AREA").toUpperCase()+" AND ENVIRONS";
  var mapTitle  ="MAP 4: TOPOGRAPHIC MAP OF "+areaLabel;
  var mapSubtitle="IN "+(lga?lga.toUpperCase()+", ":"")+(state||"").toUpperCase()+" STATE";
  var filename  ="TopoMap_"+(studyArea||"map").replace(/\s+/g,"_");

  // ── Layout ──────────────────────────────────────────────────────────────────
  var RIGHT_W  = layout==="panel" ? Math.round(PW*0.26) : 0;
  var BELOW_H  = 44;
  var PROF_H   = Math.round(PH*0.14);
  var PROF_GAP = 50;

  var MAP_X = BO+BG+BI+PAD;
  var MAP_Y = BO+BG+BI+PAD+30;
  var MAP_W = PW - RIGHT_W - MAP_X - (layout==="panel"?10:BO+BG+BI+PAD);
  var MAP_H = PH - MAP_Y - BELOW_H - PROF_H - PROF_GAP - BO - BG - BI - PAD;

  // ── Bbox ────────────────────────────────────────────────────────────────────
  var allLats=[],allLons=[];
  towns.forEach(function(f){allLats.push(f.lat);allLons.push(f.lon);});
  samples.forEach(function(f){allLats.push(f.lat);allLons.push(f.lon);});
  roads.forEach(function(r){r.points.forEach(function(p){allLats.push(p.lat);allLons.push(p.lon);});});
  rivers.forEach(function(r){r.points.forEach(function(p){allLats.push(p.lat);allLons.push(p.lon);});});
  // Also include contour nodes in bbox
  contourLines.forEach(function(c){c.points.forEach(function(p){allLats.push(p.lat);allLons.push(p.lon);});});

  var hasF=allLats.length>0;
  var featMinLat=hasF?Math.min.apply(null,allLats):data.center.lat-0.05;
  var featMaxLat=hasF?Math.max.apply(null,allLats):data.center.lat+0.05;
  var featMinLon=hasF?Math.min.apply(null,allLons):data.center.lon-0.05;
  var featMaxLon=hasF?Math.max.apply(null,allLons):data.center.lon+0.05;
  var padLat=Math.max((featMaxLat-featMinLat)*0.10,0.005);
  var padLon=Math.max((featMaxLon-featMinLon)*0.10,0.005);
  var bboxMinLat=featMinLat-padLat, bboxMaxLat=featMaxLat+padLat;
  var bboxMinLon=featMinLon-padLon, bboxMaxLon=featMaxLon+padLon;
  var exportCenterLat=(bboxMinLat+bboxMaxLat)/2;
  var exportCenterLon=(bboxMinLon+bboxMaxLon)/2;

  function computeFitZoom(minLat,maxLat,minLon,maxLon,pixW,pixH){
    for(var z=18;z>=1;z--){
      var ws=256*Math.pow(2,z);
      function ly(la){var s=Math.sin(la*Math.PI/180);return ws/(2*Math.PI)*(Math.PI-Math.log((1+s)/(1-s))/2);}
      function lx(lo){return ws*(lo+180)/360;}
      if(lx(maxLon)-lx(minLon)<=pixW*0.88&&ly(minLat)-ly(maxLat)<=pixH*0.88)return z;
    }
    return 1;
  }
  var exportZoom=computeFitZoom(bboxMinLat,bboxMaxLat,bboxMinLon,bboxMaxLon,MAP_W,MAP_H);

  // A–B line
  var abLat=exportCenterLat,abWestLon=bboxMinLon,abEastLon=bboxMaxLon;

  // Contour elevation stats
  var elevVals=contourLines.map(function(c){return c.elevation;});
  var cMin=elevVals.length?Math.min.apply(null,elevVals):0;
  var cMax=elevVals.length?Math.max.apply(null,elevVals):100;
  var cRange=Math.max(cMax-cMin,1);
  // Determine index interval (every 5th contour level)
  var niceInts=[1,2,5,10,20,25,50,100,200];
  var cInterval=niceInts[0];
  for(var nii=0;nii<niceInts.length;nii++){if(niceInts[nii]>=cRange/10){cInterval=niceInts[nii];break;}}
  var indexInterval=cInterval*5;

  // Profile points along A–B (50 points — interpolated from contour elevations)
  var PROF_N=60;
  var profBatches=[];
  var profPts=[];
  for(var pi=0;pi<PROF_N;pi++){
    profPts.push({
      lat:Math.round(abLat*100000)/100000,
      lon:Math.round((abWestLon+(pi/(PROF_N-1))*(abEastLon-abWestLon))*100000)/100000
    });
  }
  for(var pbi=0;pbi<profPts.length;pbi+=100)profBatches.push(profPts.slice(pbi,pbi+100));

  // Static AKS outline
  var AKS_SRC=JSON.stringify([[7.4983,4.4976],[7.5311,4.4654],[7.5614,4.4483],[7.5821,4.4285],[7.6124,4.4102],[7.6502,4.3934],[7.6901,4.3791],[7.7215,4.3712],[7.7613,4.3669],[7.8012,4.3701],[7.8398,4.3801],[7.8714,4.3967],[7.9012,4.4201],[7.9298,4.4487],[7.9601,4.4812],[7.9912,4.5178],[8.0187,4.5534],[8.0401,4.5887],[8.0598,4.6234],[8.0791,4.6598],[8.0987,4.6987],[8.1123,4.7398],[8.1234,4.7812],[8.1312,4.8234],[8.1398,4.8656],[8.1456,4.9087],[8.1487,4.9512],[8.1498,4.9934],[8.1476,5.0345],[8.1412,5.0743],[8.1312,5.1123],[8.1167,5.1487],[8.0987,5.1823],[8.0756,5.2134],[8.0487,5.2398],[8.0187,5.2623],[7.9856,5.2801],[7.9498,5.2934],[7.9123,5.3023],[7.8734,5.3067],[7.8334,5.3056],[7.7934,5.2989],[7.7545,5.2867],[7.7178,5.2689],[7.6834,5.2456],[7.6523,5.2167],[7.6245,5.1834],[7.6001,5.1456],[7.5789,5.1045],[7.5612,5.0612],[7.5467,5.0156],[7.5356,4.9689],[7.5267,4.9212],[7.5201,4.8734],[7.5156,4.8245],[7.5123,4.7756],[7.5098,4.7267],[7.5067,4.6778],[7.5023,4.6298],[7.4967,4.5823],[7.4923,4.5356],[7.4912,4.4976],[7.4983,4.4976]]);

  var DSS=`function drawSmooth(ctx,pts){if(!pts||pts.length<2)return;ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);if(pts.length===2){ctx.lineTo(pts[1].x,pts[1].y);}else{for(var i=0;i<pts.length-1;i++){var cp1x=pts[i].x+(pts[i+1].x-pts[i].x)*0.4,cp1y=pts[i].y+(pts[i+1].y-pts[i].y)*0.4,cp2x=pts[i].x+(pts[i+1].x-pts[i].x)*0.6,cp2y=pts[i].y+(pts[i+1].y-pts[i].y)*0.6;if(i>0){cp1x=pts[i].x+(pts[i+1].x-pts[i-1].x)*0.2;cp1y=pts[i].y+(pts[i+1].y-pts[i-1].y)*0.2;}if(i<pts.length-2){cp2x=pts[i+1].x-(pts[i+2].x-pts[i].x)*0.2;cp2y=pts[i+1].y-(pts[i+2].y-pts[i].y)*0.2;}ctx.bezierCurveTo(cp1x,cp1y,cp2x,cp2y,pts[i+1].x,pts[i+1].y);}}}`;

  var html=`<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${mapTitle}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#d0d0d0;font-family:"Times New Roman",serif;display:flex;flex-direction:column;align-items:center;}
.controls{width:${PW}px;padding:10px 14px;background:#2a2a2a;display:flex;gap:10px;align-items:center;flex-wrap:wrap;position:sticky;top:0;z-index:100;}
.controls button{background:#2c5f8a;color:#fff;border:none;padding:7px 16px;border-radius:5px;font-weight:bold;cursor:pointer;font-size:12px;font-family:sans-serif;}
.controls button:hover{background:#1a4a70;}
.page{width:${PW}px;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,0.3);margin:16px auto;}
canvas{display:block;}
#status{color:#f0c040;font-family:sans-serif;font-size:11px;padding:4px 10px;background:#1a1a1a;border-radius:4px;min-width:180px;}
@media print{body{background:#fff;}.controls{display:none;}.page{margin:0;box-shadow:none;}@page{size:${pageSize==="A2"?"A2":"A3"} portrait;margin:0;}}
</style>
</head><body>
<div class="controls">
  <span style="color:#f0c040;font-family:sans-serif;font-weight:bold;font-size:12px;">MAP 4 — TOPOGRAPHIC</span>
  <span id="status">${contourLines.length>0?"Contours from editor ✓":"No contours — draw in editor first"}</span>
  <span style="color:#888;font-size:11px;">|</span>
  <button onclick="toggleProfile()">📈 Profile</button>
  <button onclick="doExport('png')">&#11015; PNG</button>
  <button onclick="doExport('jpeg')">&#11015; JPEG</button>
  <button onclick="doExport('pdf')">&#11015; PDF</button>
  <button onclick="window.print()">Print</button>
  <span style="color:#555;font-family:sans-serif;font-size:10px;margin-left:auto;">Layout: ${layout==="panel"?"Panel":"Full"} · DPI: ${exportDPI} · ${contourLines.length} contours</span>
</div>
<div class="page"><canvas id="mapCanvas" width="${PW}" height="${PH}"></canvas></div>
<script>
var PW=${PW},PH=${PH},pageSize="${pageSize}",layout="${layout}";
var BO=${BO},BG=${BG},BI=${BI},PAD=${PAD};
var MAP_X=${MAP_X},MAP_Y=${MAP_Y},MAP_W=${MAP_W},MAP_H=${MAP_H};
var RIGHT_W=${RIGHT_W},BELOW_H=${BELOW_H},PROF_H=${PROF_H},PROF_GAP=${PROF_GAP};
var exportCenter={lat:${exportCenterLat},lon:${exportCenterLon}},zoom=${exportZoom};
var towns=${JSON.stringify(towns)},roads=${JSON.stringify(roads)},rivers=${JSON.stringify(rivers)};
var samples=${JSON.stringify(samples)};
var contourLines=${JSON.stringify(contourLines)};
var cMin=${cMin},cMax=${cMax},cInterval=${cInterval},indexInterval=${indexInterval};
var mapTitle=${JSON.stringify(mapTitle)},mapSubtitle=${JSON.stringify(mapSubtitle)};
var filename=${JSON.stringify(filename)},exportDPI=${exportDPI},SCREEN_DPI=96;
var featMinLat=${featMinLat},featMaxLat=${featMaxLat};
var featMinLon=${featMinLon},featMaxLon=${featMaxLon};
var bboxMinLat=${bboxMinLat},bboxMaxLat=${bboxMaxLat};
var bboxMinLon=${bboxMinLon},bboxMaxLon=${bboxMaxLon};
var abLat=${abLat},abWestLon=${abWestLon},abEastLon=${abEastLon};
var state=${JSON.stringify(state||"")},lga=${JSON.stringify(lga||"")},studyArea=${JSON.stringify(studyArea||"")};
var AKS_OUTLINE=${AKS_SRC};
var PROF_N=${PROF_N},profBatches=${JSON.stringify(profBatches)};
var TILE_SIZE=256,tileCache={};
var canvas=document.getElementById("mapCanvas"),ctx=canvas.getContext("2d");
var profElev=null,showProfile=true;
var stateGeoJSON=null;
var statusEl=document.getElementById("status");

function lon2tile(lon,z){return Math.floor(((lon+180)/360)*Math.pow(2,z));}
function lat2tile(lat,z){return Math.floor(((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2)*Math.pow(2,z));}
function tile2lon(x,z){return x/Math.pow(2,z)*360-180;}
function tile2lat(y,z){var n=Math.PI-2*Math.PI*y/Math.pow(2,z);return 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n)));}
function ll2px(lat,lon){
  var ws=TILE_SIZE*Math.pow(2,zoom);
  function ly(la){var s=Math.sin(la*Math.PI/180);return ws/(2*Math.PI)*(Math.PI-Math.log((1+s)/(1-s))/2);}
  function lx(lo){return ws*(lo+180)/360;}
  return{x:MAP_W/2+(lx(lon)-lx(exportCenter.lon))+MAP_X,y:MAP_H/2+(ly(lat)-ly(exportCenter.lat))+MAP_Y};
}
function px2ll(px,py){
  var ws=TILE_SIZE*Math.pow(2,zoom);
  function ly(la){var s=Math.sin(la*Math.PI/180);return ws/(2*Math.PI)*(Math.PI-Math.log((1+s)/(1-s))/2);}
  function lx(lo){return ws*(lo+180)/360;}
  var wx=lx(exportCenter.lon)+(px-MAP_X-MAP_W/2),wy=ly(exportCenter.lat)+(py-MAP_Y-MAP_H/2);
  var n=Math.PI-2*Math.PI*wy/ws;
  return{lat:180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))),lon:wx/ws*360-180};
}
function toDMS(deg,isLat){
  var d=Math.abs(deg),dd=Math.floor(d),mm=Math.floor((d-dd)*60),ss=Math.round(((d-dd)*60-mm)*60);
  return dd+"\u00b0"+mm+"'"+ss+'"'+(isLat?(deg>=0?"N":"S"):(deg>=0?"E":"W"));
}
function loadTile(z,x,y,cb){
  var k=z+"/"+x+"/"+y;if(tileCache[k]){cb(tileCache[k]);return;}
  var img=new Image();img.crossOrigin="anonymous";
  img.onload=function(){tileCache[k]=img;cb(img);};
  img.onerror=function(){cb(null);};
  img.src="https://tile.openstreetmap.org/"+z+"/"+x+"/"+y+".png";
}
${DSS}

// ── DRAW ALL ─────────────────────────────────────────────────────────────────
function drawAll(){
  ctx.fillStyle="#fff";ctx.fillRect(0,0,PW,PH);

  // Page borders
  ctx.strokeStyle="#000";ctx.lineWidth=BO;
  ctx.strokeRect(BO/2,BO/2,PW-BO,PH-BO);
  ctx.lineWidth=BI;var ib=BO+BG;ctx.strokeRect(ib,ib,PW-ib*2,PH-ib*2);

  // Map frame — white fill
  ctx.fillStyle="#fff";ctx.fillRect(MAP_X,MAP_Y,MAP_W,MAP_H);
  ctx.strokeStyle="#000";ctx.lineWidth=1.5;ctx.strokeRect(MAP_X,MAP_Y,MAP_W,MAP_H);

  // Study boundary pixel coords
  var sbTL=ll2px(featMaxLat,featMinLon),sbBR=ll2px(featMinLat,featMaxLon);
  var sbX=sbTL.x,sbY=sbTL.y,sbW=sbBR.x-sbTL.x,sbH=sbBR.y-sbTL.y;

  // ── Contour lines — plain black on white ──────────────────────────────────
  if(contourLines.length>0){
    ctx.save();ctx.beginPath();ctx.rect(sbX,sbY,sbW,sbH);ctx.clip();
    contourLines.forEach(function(cl){
      if(cl.points.length<2)return;
      var pts=cl.points.map(function(p){return ll2px(p.lat,p.lon);});
      var isIdx=Math.abs(Math.round(cl.elevation/indexInterval)*indexInterval-cl.elevation)<0.01;
      ctx.strokeStyle=isIdx?"rgba(40,20,0,0.92)":"rgba(40,20,0,0.5)";
      ctx.lineWidth=isIdx?1.5:0.65;
      // Smooth bezier through nodes
      ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
      for(var i=1;i<pts.length;i++){
        if(i<pts.length-1){
          var mx=(pts[i].x+pts[i+1].x)/2,my=(pts[i].y+pts[i+1].y)/2;
          ctx.quadraticCurveTo(pts[i].x,pts[i].y,mx,my);
        }else{ctx.lineTo(pts[i].x,pts[i].y);}
      }
      ctx.stroke();
      // Label index contours at midpoint
      if(isIdx&&pts.length>=4){
        var mid=pts[Math.floor(pts.length/2)];
        ctx.save();
        ctx.font="bold 8px Times New Roman";ctx.textAlign="center";
        // White halo
        ctx.strokeStyle="#fff";ctx.lineWidth=3;ctx.strokeText(cl.elevation+"m",mid.x,mid.y-3);
        ctx.fillStyle="rgba(40,20,0,0.92)";ctx.fillText(cl.elevation+"m",mid.x,mid.y-3);
        ctx.restore();
      }
    });
    ctx.restore();
  }else{
    // No contours yet — show instruction inside map area
    ctx.fillStyle="#ccc";ctx.font="13px Times New Roman";ctx.textAlign="center";
    ctx.fillText("No contour lines drawn yet.",MAP_X+MAP_W/2,MAP_Y+MAP_H/2-10);
    ctx.font="11px Times New Roman";ctx.fillStyle="#aaa";
    ctx.fillText("Use the Contour tool in the editor to draw or load SRTM draft contours.",MAP_X+MAP_W/2,MAP_Y+MAP_H/2+10);
    ctx.textAlign="left";
  }

  // ── A–B dashed line ───────────────────────────────────────────────────────
  var ptA=ll2px(abLat,abWestLon),ptB=ll2px(abLat,abEastLon);
  ctx.save();ctx.beginPath();ctx.rect(MAP_X,MAP_Y,MAP_W,MAP_H);ctx.clip();
  ctx.strokeStyle="#000";ctx.lineWidth=1.4;ctx.setLineDash([10,5]);
  ctx.beginPath();ctx.moveTo(ptA.x,ptA.y);ctx.lineTo(ptB.x,ptB.y);ctx.stroke();
  ctx.setLineDash([]);ctx.restore();
  ctx.font="bold 13px Times New Roman";ctx.fillStyle="#000";
  ctx.textAlign="right";ctx.fillText("A",MAP_X-6,ptA.y+5);
  ctx.textAlign="left";ctx.fillText("B",MAP_X+MAP_W+6,ptB.y+5);
  ctx.textAlign="left";

  // ── Study boundary ────────────────────────────────────────────────────────
  if(featMinLat!==featMaxLat){
    ctx.save();ctx.beginPath();ctx.rect(MAP_X,MAP_Y,MAP_W,MAP_H);ctx.clip();
    ctx.strokeStyle="#555";ctx.lineWidth=1.4;ctx.setLineDash([8,4]);
    ctx.strokeRect(sbX,sbY,sbW,sbH);ctx.setLineDash([]);ctx.restore();
  }

  // ── Roads ─────────────────────────────────────────────────────────────────
  ctx.save();ctx.beginPath();ctx.rect(sbX,sbY,sbW,sbH);ctx.clip();
  roads.forEach(function(road){
    if(road.points.length<2)return;
    var pts=road.points.map(function(pt){return ll2px(pt.lat,pt.lon);});
    if(road.type==="major"){
      drawSmooth(ctx,pts);ctx.strokeStyle="#c06040";ctx.lineWidth=5;ctx.stroke();
      drawSmooth(ctx,pts);ctx.strokeStyle="#e8956a";ctx.lineWidth=2.8;ctx.stroke();
    }else{drawSmooth(ctx,pts);ctx.strokeStyle="#555";ctx.lineWidth=1.8;ctx.stroke();}
    if(road.name&&road.name.trim()&&pts.length>=2){
      var mid=pts[Math.floor(pts.length/2)];
      ctx.fillStyle="#333";ctx.font="9px Times New Roman";ctx.fillText(road.name,mid.x+4,mid.y-5);
    }
  });
  ctx.restore();

  // ── Rivers ────────────────────────────────────────────────────────────────
  ctx.save();ctx.beginPath();ctx.rect(sbX,sbY,sbW,sbH);ctx.clip();
  rivers.forEach(function(river){
    if(river.points.length<2)return;
    var pts=river.points.map(function(pt){return ll2px(pt.lat,pt.lon);});
    drawSmooth(ctx,pts);ctx.strokeStyle="#1565c0";ctx.lineWidth=2.5;ctx.stroke();
    if(river.name&&river.name.trim()&&pts.length>=2){
      var mid=pts[Math.floor(pts.length/2)];
      ctx.fillStyle="#1565c0";ctx.font="italic 9px Times New Roman";ctx.fillText(river.name,mid.x+4,mid.y-5);
    }
  });
  ctx.restore();

  // ── Towns ─────────────────────────────────────────────────────────────────
  ctx.save();ctx.beginPath();ctx.rect(sbX,sbY,sbW,sbH);ctx.clip();
  towns.forEach(function(town){
    var pp=ll2px(town.lat,town.lon);
    ctx.fillStyle="#000";ctx.beginPath();ctx.arc(pp.x,pp.y,5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(pp.x,pp.y,2.2,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#000";ctx.font="bold 10px Times New Roman";ctx.fillText(town.name||"",pp.x+7,pp.y-4);
  });
  ctx.restore();

  // ── Spot heights from samples with elevation ──────────────────────────────
  ctx.save();ctx.beginPath();ctx.rect(sbX,sbY,sbW,sbH);ctx.clip();
  samples.forEach(function(s){
    if(!s.elevation&&s.elevation!==0)return;
    var pp=ll2px(s.lat,s.lon);
    ctx.fillStyle="#333";
    ctx.beginPath();ctx.moveTo(pp.x,pp.y-4);ctx.lineTo(pp.x+3,pp.y+2);ctx.lineTo(pp.x-3,pp.y+2);ctx.closePath();ctx.fill();
    ctx.fillStyle="#000";ctx.font="bold 8px Times New Roman";
    ctx.fillText(Math.round(parseFloat(s.elevation))+"m",pp.x+5,pp.y-1);
  });
  ctx.restore();

  // ── Coordinate grid ───────────────────────────────────────────────────────
  ctx.save();ctx.strokeStyle="rgba(140,140,140,0.18)";ctx.lineWidth=0.4;ctx.setLineDash([3,4]);
  ctx.font="9px Times New Roman";ctx.fillStyle="#111";
  var span=bboxMaxLat-bboxMinLat;
  var step=span>2?1:span>0.5?0.25:span>0.1?0.05:0.01;
  var tl2=px2ll(MAP_X,MAP_Y),br2=px2ll(MAP_X+MAP_W,MAP_Y+MAP_H);
  for(var lo=Math.ceil(tl2.lon/step)*step;lo<=br2.lon+step;lo+=step){
    lo=Math.round(lo*100000)/100000;
    var px2=ll2px(exportCenter.lat,lo).x;if(px2<MAP_X||px2>MAP_X+MAP_W)continue;
    ctx.beginPath();ctx.moveTo(px2,MAP_Y);ctx.lineTo(px2,MAP_Y+MAP_H);ctx.stroke();
    ctx.textAlign="center";ctx.fillText(toDMS(lo,false),px2,MAP_Y-5);ctx.fillText(toDMS(lo,false),px2,MAP_Y+MAP_H+13);
  }
  for(var la=Math.floor(tl2.lat/step)*step;la>=br2.lat-step;la-=step){
    la=Math.round(la*100000)/100000;
    var py2=ll2px(la,exportCenter.lon).y;if(py2<MAP_Y||py2>MAP_Y+MAP_H)continue;
    ctx.beginPath();ctx.moveTo(MAP_X,py2);ctx.lineTo(MAP_X+MAP_W,py2);ctx.stroke();
    ctx.save();ctx.translate(MAP_X-5,py2);ctx.rotate(-Math.PI/2);ctx.textAlign="center";ctx.fillText(toDMS(la,true),0,0);ctx.restore();
    ctx.save();ctx.translate(MAP_X+MAP_W+16,py2);ctx.rotate(-Math.PI/2);ctx.textAlign="center";ctx.fillText(toDMS(la,true),0,0);ctx.restore();
  }
  ctx.setLineDash([]);ctx.textAlign="left";ctx.restore();

  // ── North arrow ───────────────────────────────────────────────────────────
  var ax=MAP_X+MAP_W-36,ay=MAP_Y+40;
  ctx.save();ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(ax,ay,24,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle="#000";ctx.lineWidth=1.2;ctx.stroke();
  ctx.fillStyle="#000";ctx.beginPath();ctx.moveTo(ax,ay-20);ctx.lineTo(ax-9,ay+6);ctx.lineTo(ax+9,ay+6);ctx.closePath();ctx.fill();
  ctx.fillStyle="#fff";ctx.beginPath();ctx.moveTo(ax,ay+20);ctx.lineTo(ax-9,ay-6);ctx.lineTo(ax+9,ay-6);ctx.closePath();ctx.fill();
  ctx.strokeStyle="#000";ctx.lineWidth=0.8;ctx.beginPath();ctx.moveTo(ax,ay+20);ctx.lineTo(ax-9,ay-6);ctx.lineTo(ax+9,ay-6);ctx.closePath();ctx.stroke();
  ctx.fillStyle="#000";ctx.font="bold 14px Times New Roman";ctx.textAlign="center";ctx.fillText("N",ax,ay-24);ctx.textAlign="left";ctx.restore();

  // ── Scale bar ─────────────────────────────────────────────────────────────
  var mpp=(156543.03392*Math.cos(exportCenter.lat*Math.PI/180))/Math.pow(2,zoom);
  var tgts=[100,200,500,1000,2000,5000,10000,20000,50000,100000];
  var idealPx=MAP_W*0.28,bm=tgts[0];
  for(var ti=0;ti<tgts.length;ti++){if(tgts[ti]/mpp<=idealPx)bm=tgts[ti];}
  var bp=bm/mpp,ssx=MAP_X,ssy=MAP_Y+MAP_H+16;
  ctx.save();ctx.font="bold 9px Times New Roman";ctx.fillStyle="#000";ctx.fillText("SCALE",ssx,ssy-1);
  for(var sj=0;sj<4;sj++){ctx.fillStyle=sj%2===0?"#000":"#fff";ctx.fillRect(ssx+sj*bp/4,ssy+4,bp/4,11);}
  ctx.strokeStyle="#000";ctx.lineWidth=1;ctx.strokeRect(ssx,ssy+4,bp,11);
  [[0,0],[bm/2,bp/2],[bm,bp]].forEach(function(pair){
    var lbl=pair[0]===0?"0":pair[0]>=1000?(pair[0]/1000)+" km":pair[0]+" m";
    ctx.font="9px Times New Roman";ctx.textAlign="center";ctx.fillText(lbl,ssx+pair[1],ssy+28);
  });
  ctx.textAlign="left";ctx.restore();

  // ── Right panel or floating legend ────────────────────────────────────────
  if(layout==="panel")drawRightPanel();else drawFloatingElements();

  // ── Terrain profile ───────────────────────────────────────────────────────
  if(showProfile)drawTerrainProfile();

  // Title
  var ttY=PH-(BO+BG+BI+PAD)-16;
  ctx.font="bold 10px Times New Roman";ctx.fillStyle="#000";ctx.textAlign="left";
  ctx.fillText(mapTitle,MAP_X,ttY);
  ctx.font="9px Times New Roman";ctx.fillText(mapSubtitle,MAP_X,ttY+14);

  // Watermark
  ctx.fillStyle="rgba(255,255,255,0.85)";ctx.fillRect(MAP_X,MAP_Y+MAP_H-14,300,14);
  ctx.fillStyle="#888";ctx.font="7px sans-serif";
  ctx.fillText("\u00a9 OpenStreetMap contributors | Geo Mapping System v0.9",MAP_X+4,MAP_Y+MAP_H-4);
}

// ── TERRAIN PROFILE — unchanged from Seq 10 ──────────────────────────────────
function drawTerrainProfile(){
  var PSX=MAP_X,PSW=MAP_W,PSY=MAP_Y+MAP_H+PROF_GAP,PSH=PROF_H;
  ctx.fillStyle="#fff";ctx.fillRect(PSX,PSY,PSW,PSH);
  ctx.strokeStyle="#000";ctx.lineWidth=1.2;ctx.strokeRect(PSX,PSY,PSW,PSH);
  ctx.font="bold 10px Times New Roman";ctx.fillStyle="#000";ctx.textAlign="center";
  ctx.fillText("TOPOGRAPHIC PROFILE (A \u2013 B)",PSX+PSW/2,PSY-10);ctx.textAlign="left";
  ctx.font="bold 12px Times New Roman";
  ctx.textAlign="left";ctx.fillText("A",PSX,PSY+PSH+14);
  ctx.textAlign="right";ctx.fillText("B",PSX+PSW,PSY+PSH+14);ctx.textAlign="left";

  var MX=48,MY=12,MB=20;
  var secX=PSX+MX,secW=PSW-MX-8,secY=PSY+MY,secH=PSH-MY-MB;

  if(!profElev||profElev.length===0){
    ctx.fillStyle="#aaa";ctx.font="10px Times New Roman";ctx.textAlign="center";
    ctx.fillText("Fetching elevation profile…",PSX+PSW/2,PSY+PSH/2);ctx.textAlign="left";
    return;
  }

  var pMin=Math.min.apply(null,profElev);
  var pMax=Math.max.apply(null,profElev);
  var pRange=Math.max(pMax-pMin,1);

  // Y axis
  var niceInts2=[1,2,5,10,20,25,50,100,200];
  var yInterval=niceInts2[0];
  for(var nii2=0;nii2<niceInts2.length;nii2++){if(niceInts2[nii2]>=pRange/6){yInterval=niceInts2[nii2];break;}}
  var yFirst=Math.ceil(pMin/yInterval)*yInterval;
  ctx.font="8px Times New Roman";ctx.fillStyle="#000";ctx.textAlign="right";
  ctx.strokeStyle="#000";ctx.lineWidth=0.7;
  for(var yv=yFirst;yv<=pMax+yInterval;yv+=yInterval){
    if(yv>pMax+yInterval*0.1)break;
    var ty3=secY+secH-(yv-pMin)/pRange*secH;
    if(ty3<secY||ty3>secY+secH)continue;
    ctx.beginPath();ctx.moveTo(secX-4,ty3);ctx.lineTo(secX,ty3);ctx.stroke();
    ctx.fillText(Math.round(yv)+"m",secX-6,ty3+3);
    ctx.save();ctx.strokeStyle="rgba(0,0,0,0.07)";ctx.lineWidth=0.5;ctx.setLineDash([3,4]);
    ctx.beginPath();ctx.moveTo(secX,ty3);ctx.lineTo(secX+secW,ty3);ctx.stroke();
    ctx.setLineDash([]);ctx.restore();
  }
  ctx.textAlign="left";

  // Y axis label
  ctx.save();ctx.translate(PSX+14,secY+secH/2);ctx.rotate(-Math.PI/2);
  ctx.textAlign="center";ctx.font="8px Times New Roman";ctx.fillStyle="#555";
  ctx.fillText("Elevation (m)",0,0);ctx.restore();

  // Profile curve
  ctx.save();ctx.beginPath();ctx.rect(secX,secY,secW,secH);ctx.clip();
  var profPts2=profElev.map(function(e,i){
    return{x:secX+i/(PROF_N-1)*secW,y:secY+secH-(e-pMin)/pRange*secH};
  });
  // Fill
  ctx.beginPath();ctx.moveTo(profPts2[0].x,secY+secH);
  profPts2.forEach(function(p){ctx.lineTo(p.x,p.y);});
  ctx.lineTo(profPts2[profPts2.length-1].x,secY+secH);ctx.closePath();
  ctx.fillStyle="rgba(180,210,140,0.5)";ctx.fill();
  // Line
  ctx.beginPath();ctx.moveTo(profPts2[0].x,profPts2[0].y);
  for(var ci2=1;ci2<profPts2.length;ci2++){
    var prev2=profPts2[ci2-1],curr2=profPts2[ci2];
    var mx2=(prev2.x+curr2.x)/2;
    ctx.bezierCurveTo(mx2,prev2.y,mx2,curr2.y,curr2.x,curr2.y);
  }
  ctx.strokeStyle="#333";ctx.lineWidth=1.8;ctx.stroke();

  // Dashed projection lines at index contour intersections
  for(var pi3=0;pi3<profElev.length-1;pi3++){
    var e3a=profElev[pi3],e3b=profElev[pi3+1];
    contourLines.forEach(function(cl){
      var lev3=cl.elevation;
      var isIdx3=Math.abs(Math.round(lev3/indexInterval)*indexInterval-lev3)<0.01;
      if(!isIdx3)return;
      if((e3a<=lev3&&e3b>=lev3)||(e3a>=lev3&&e3b<=lev3)){
        var frac3=(lev3-e3a)/(e3b-e3a);
        var profX3=secX+(pi3+frac3)/(PROF_N-1)*secW;
        var profY3=secY+secH-(lev3-pMin)/pRange*secH;
        ctx.save();ctx.strokeStyle="rgba(0,0,0,0.18)";ctx.lineWidth=0.6;ctx.setLineDash([3,3]);
        ctx.beginPath();ctx.moveTo(profX3,profY3);ctx.lineTo(profX3,secY);ctx.stroke();
        ctx.setLineDash([]);ctx.restore();
      }
    });
  }

  // Spot heights
  samples.forEach(function(s){
    if(!s.elevation&&s.elevation!==0)return;
    var frac4=(s.lon-abWestLon)/(abEastLon-abWestLon);
    if(frac4<0||frac4>1)return;
    var spx=secX+frac4*secW;
    var spy=secY+secH-(parseFloat(s.elevation)-pMin)/pRange*secH;
    if(spy<secY||spy>secY+secH)return;
    ctx.fillStyle="#7b0000";ctx.beginPath();ctx.arc(spx,spy,3.5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#7b0000";ctx.font="bold 7px Times New Roman";ctx.textAlign="center";
    ctx.fillText(Math.round(s.elevation)+"m",spx,spy-6);ctx.textAlign="left";
  });

  ctx.restore();
  ctx.strokeStyle="#000";ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(secX,secY);ctx.lineTo(secX+secW,secY);ctx.stroke();

  var horizKm=Math.round((abEastLon-abWestLon)*111320*Math.cos(abLat*Math.PI/180)/100)/10;
  ctx.font="8px Times New Roman";ctx.fillStyle="#555";ctx.textAlign="center";
  ctx.fillText("Horizontal distance: "+horizKm+" km  |  V.E. = 1\u00d7  |  SRTM 30m",secX+secW/2,PSY+PSH+8);
  ctx.textAlign="left";
}

// ── RIGHT PANEL (Option A) ────────────────────────────────────────────────────
function drawRightPanel(){
  var RX=MAP_X+MAP_W+12,RW=RIGHT_W-18;
  ctx.fillStyle="#fff";ctx.fillRect(RX,MAP_Y,RW,MAP_H);
  ctx.strokeStyle="#000";ctx.lineWidth=1;ctx.strokeRect(RX,MAP_Y,RW,MAP_H);
  var insetH=Math.round(MAP_H*0.33);
  ctx.fillStyle="#fff";ctx.fillRect(RX+1,MAP_Y+1,RW-2,insetH-1);
  ctx.strokeStyle="#000";ctx.lineWidth=0.9;ctx.strokeRect(RX,MAP_Y,RW,insetH);
  drawInset(RX,MAP_Y,RW,insetH);

  var ly=MAP_Y+insetH+16;
  ctx.font="bold 12px Times New Roman";ctx.fillStyle="#000";ctx.textAlign="center";
  ctx.fillText("Legend",RX+RW/2,ly);ctx.textAlign="left";ly+=5;
  ctx.strokeStyle="#000";ctx.lineWidth=0.7;ctx.beginPath();ctx.moveTo(RX+6,ly);ctx.lineTo(RX+RW-6,ly);ctx.stroke();ly+=14;

  // Index contour
  ctx.strokeStyle="rgba(40,20,0,0.92)";ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(RX+6,ly-4);ctx.lineTo(RX+28,ly-4);ctx.stroke();
  ctx.fillStyle="#000";ctx.font="9px Times New Roman";
  ctx.fillText("Index contour ("+(cMax>cMin?indexInterval+"m":"")+")",RX+32,ly-1);ly+=14;

  // Intermediate contour
  ctx.strokeStyle="rgba(40,20,0,0.5)";ctx.lineWidth=0.65;
  ctx.beginPath();ctx.moveTo(RX+6,ly-4);ctx.lineTo(RX+28,ly-4);ctx.stroke();
  ctx.fillText("Contour ("+(cMax>cMin?cInterval+"m interval":"no data")+")",RX+32,ly-1);ly+=14;

  // A-B line
  ctx.strokeStyle="#000";ctx.lineWidth=1.4;ctx.setLineDash([8,4]);
  ctx.beginPath();ctx.moveTo(RX+6,ly-4);ctx.lineTo(RX+28,ly-4);ctx.stroke();ctx.setLineDash([]);
  ctx.fillText("Profile line (A\u2013B)",RX+32,ly-1);ly+=14;

  // Spot height
  ctx.fillStyle="#333";ctx.beginPath();ctx.moveTo(RX+14,ly-9);ctx.lineTo(RX+17,ly-4);ctx.lineTo(RX+11,ly-4);ctx.closePath();ctx.fill();
  ctx.fillStyle="#000";ctx.fillText("Spot height (field)",RX+32,ly-4);ly+=14;

  // Roads
  ctx.strokeStyle="#c06040";ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(RX+6,ly-4);ctx.lineTo(RX+28,ly-4);ctx.stroke();
  ctx.strokeStyle="#e8956a";ctx.lineWidth=1.8;ctx.beginPath();ctx.moveTo(RX+6,ly-4);ctx.lineTo(RX+28,ly-4);ctx.stroke();
  ctx.fillText("Major Road",RX+32,ly-1);ly+=14;
  ctx.strokeStyle="#555";ctx.lineWidth=1.8;ctx.beginPath();ctx.moveTo(RX+6,ly-4);ctx.lineTo(RX+28,ly-4);ctx.stroke();
  ctx.fillText("Minor Road",RX+32,ly-1);ly+=14;
  ctx.strokeStyle="#1565c0";ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(RX+6,ly-4);ctx.lineTo(RX+28,ly-4);ctx.stroke();
  ctx.fillText("River",RX+32,ly-1);ly+=14;
  ctx.fillStyle="#000";ctx.beginPath();ctx.arc(RX+14,ly-5,4.5,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(RX+14,ly-5,2,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#000";ctx.fillText("Town",RX+32,ly-1);ly+=14;
  ctx.strokeStyle="#555";ctx.lineWidth=1.2;ctx.setLineDash([6,3]);
  ctx.beginPath();ctx.moveTo(RX+6,ly-4);ctx.lineTo(RX+28,ly-4);ctx.stroke();ctx.setLineDash([]);
  ctx.fillText("Study Boundary",RX+32,ly-1);

  // Contour count info
  var srtmCount=contourLines.filter(function(c){return c.source==="srtm";}).length;
  var fieldCount=contourLines.filter(function(c){return c.source!=="srtm";}).length;
  if(contourLines.length>0){
    ly+=18;ctx.font="8px Times New Roman";ctx.fillStyle="#555";
    if(srtmCount>0)ctx.fillText(srtmCount+" SRTM draft contours",RX+8,ly);ly+=11;
    if(fieldCount>0)ctx.fillText(fieldCount+" field-drawn contours",RX+8,ly);
  }

  // Title block
  var titleY=MAP_Y+MAP_H-92;
  ctx.strokeStyle="#000";ctx.lineWidth=0.8;ctx.beginPath();ctx.moveTo(RX,titleY);ctx.lineTo(RX+RW,titleY);ctx.stroke();
  ctx.font="bold 9px Times New Roman";ctx.fillStyle="#000";ctx.textAlign="center";
  ctx.fillText(mapTitle,RX+RW/2,titleY+13);
  ctx.font="8px Times New Roman";ctx.fillText(mapSubtitle,RX+RW/2,titleY+27);
  ctx.font="7px Times New Roman";ctx.fillStyle="#555";
  ctx.fillText("Projection: WGS 84 / Geographic",RX+RW/2,titleY+41);
  ctx.fillText("Contours: SRTM 30m + field data",RX+RW/2,titleY+53);
  ctx.fillText("Geo Mapping System v0.9",RX+RW/2,titleY+65);
  ctx.textAlign="left";
}

// ── INSET MAP ─────────────────────────────────────────────────────────────────
function drawInset(RX,IY,RW,insetH){
  var outline=stateGeoJSON&&stateGeoJSON._stateOutline?stateGeoJSON._stateOutline:AKS_OUTLINE;
  var oLons=outline.map(function(c){return c[0];}),oLats=outline.map(function(c){return c[1];});
  var oMinLon=Math.min.apply(null,oLons),oMaxLon=Math.max.apply(null,oLons);
  var oMinLat=Math.min.apply(null,oLats),oMaxLat=Math.max.apply(null,oLats);
  var iPad=7,scl=Math.min((RW-iPad*2)/(oMaxLon-oMinLon),(insetH-iPad*2-12)/(oMaxLat-oMinLat));
  var iox=RX+iPad+((RW-iPad*2)-(oMaxLon-oMinLon)*scl)/2;
  var ioy=IY+iPad+((insetH-iPad*2-12)-(oMaxLat-oMinLat)*scl)/2;
  function toInset(lon,lat){return{x:iox+(lon-oMinLon)*scl,y:ioy+(oMaxLat-lat)*scl};}
  ctx.save();ctx.beginPath();ctx.rect(RX+1,IY+1,RW-2,insetH-2);ctx.clip();
  ctx.beginPath();outline.forEach(function(c,i){var p=toInset(c[0],c[1]);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});
  ctx.closePath();ctx.fillStyle="#fff";ctx.fill();ctx.strokeStyle="#000";ctx.lineWidth=1.2;ctx.stroke();
  if(featMinLat!==featMaxLat){
    var tl3=toInset(featMinLon,featMaxLat),br3=toInset(featMaxLon,featMinLat);
    ctx.fillStyle="rgba(160,140,120,0.65)";ctx.fillRect(tl3.x,tl3.y,Math.max(br3.x-tl3.x,5),Math.max(br3.y-tl3.y,5));
    ctx.strokeStyle="#555";ctx.lineWidth=1;ctx.strokeRect(tl3.x,tl3.y,Math.max(br3.x-tl3.x,5),Math.max(br3.y-tl3.y,5));
  }
  ctx.restore();
  ctx.font="bold 8px Times New Roman";ctx.fillStyle="#000";ctx.textAlign="center";
  ctx.fillText((state||"").toUpperCase()+" STATE",RX+RW/2,IY+insetH-4);ctx.textAlign="left";
}

// ── FLOATING ELEMENTS (Option B) ─────────────────────────────────────────────
function drawFloatingElements(){
  var IW=130,IH=100,IX=MAP_X+MAP_W-IW-10,IY=MAP_Y+10;
  ctx.fillStyle="rgba(255,255,255,0.93)";ctx.fillRect(IX,IY,IW,IH);
  ctx.strokeStyle="#000";ctx.lineWidth=1;ctx.strokeRect(IX,IY,IW,IH);
  drawInset(IX,IY,IW,IH);
  var LW=190,LH=contourLines.length>0?200:130;
  var LX=MAP_X+MAP_W-LW-10,LY=MAP_Y+MAP_H-LH-10;
  ctx.fillStyle="rgba(255,255,255,0.93)";ctx.fillRect(LX,LY,LW,LH);
  ctx.strokeStyle="#000";ctx.lineWidth=1;ctx.strokeRect(LX,LY,LW,LH);
  var ly2=LY+13;
  ctx.font="bold 10px Times New Roman";ctx.fillStyle="#000";ctx.textAlign="center";
  ctx.fillText("Legend",LX+LW/2,ly2);ctx.textAlign="left";ly2+=7;
  ctx.strokeStyle="#000";ctx.lineWidth=0.6;ctx.beginPath();ctx.moveTo(LX+4,ly2);ctx.lineTo(LX+LW-4,ly2);ctx.stroke();ly2+=10;
  ctx.strokeStyle="rgba(40,20,0,0.92)";ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(LX+6,ly2-3);ctx.lineTo(LX+22,ly2-3);ctx.stroke();
  ctx.fillStyle="#000";ctx.font="8px Times New Roman";ctx.fillText("Index contour",LX+26,ly2);ly2+=11;
  ctx.strokeStyle="rgba(40,20,0,0.5)";ctx.lineWidth=0.65;ctx.beginPath();ctx.moveTo(LX+6,ly2-3);ctx.lineTo(LX+22,ly2-3);ctx.stroke();
  ctx.fillText("Contour line",LX+26,ly2);ly2+=11;
  ctx.strokeStyle="#000";ctx.lineWidth=1.2;ctx.setLineDash([7,4]);ctx.beginPath();ctx.moveTo(LX+6,ly2-3);ctx.lineTo(LX+22,ly2-3);ctx.stroke();ctx.setLineDash([]);
  ctx.fillText("Profile A\u2013B",LX+26,ly2);ly2+=11;
  ctx.fillStyle="#333";ctx.beginPath();ctx.moveTo(LX+14,ly2-7);ctx.lineTo(LX+17,ly2-2);ctx.lineTo(LX+11,ly2-2);ctx.closePath();ctx.fill();
  ctx.fillStyle="#000";ctx.fillText("Spot height",LX+26,ly2-2);ly2+=11;
  ctx.strokeStyle="#c06040";ctx.lineWidth=3.5;ctx.beginPath();ctx.moveTo(LX+6,ly2-3);ctx.lineTo(LX+22,ly2-3);ctx.stroke();
  ctx.fillText("Major Road",LX+26,ly2);ly2+=11;
  ctx.strokeStyle="#555";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(LX+6,ly2-3);ctx.lineTo(LX+22,ly2-3);ctx.stroke();
  ctx.fillText("Minor Road",LX+26,ly2);ly2+=11;
  ctx.strokeStyle="#1565c0";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(LX+6,ly2-3);ctx.lineTo(LX+22,ly2-3);ctx.stroke();
  ctx.fillText("River",LX+26,ly2);ly2+=11;
  ctx.setLineDash([5,3]);ctx.strokeStyle="#555";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(LX+6,ly2-3);ctx.lineTo(LX+22,ly2-3);ctx.stroke();ctx.setLineDash([]);
  ctx.fillText("Study Boundary",LX+26,ly2);
}

function toggleProfile(){showProfile=!showProfile;drawAll();}

// ── FETCH PROFILE from OpenTopoData ──────────────────────────────────────────
async function fetchProfile(){
  if(profBatches.length===0){drawAll();return;}
  statusEl.textContent="Fetching elevation profile…";
  var profElev2=new Array(PROF_N).fill(0);
  var pidx=0;
  try{
    for(var pbi=0;pbi<profBatches.length;pbi++){
      var batch=profBatches[pbi];
      var locs=batch.map(function(p){return p.lat+","+p.lon;}).join("|");
      var resp=await fetch("https://api.opentopodata.org/v1/srtm30m?locations="+locs);
      if(!resp.ok)throw new Error("HTTP "+resp.status);
      var json=await resp.json();
      (json.results||[]).forEach(function(r,i){profElev2[pidx+i]=r.elevation!==null?r.elevation:0;});
      pidx+=batch.length;
    }
    profElev=profElev2;
    statusEl.textContent="Profile loaded \u2713";
    drawAll();
  }catch(e){
    // Fallback: interpolate profile from contour lines
    if(contourLines.length>0){
      var fallback=[];
      for(var pi2=0;pi2<PROF_N;pi2++){
        var lon2=abWestLon+(pi2/(PROF_N-1))*(abEastLon-abWestLon);
        // Find closest contour elevation to this longitude
        var closest=null,closestDist=Infinity;
        contourLines.forEach(function(cl){
          cl.points.forEach(function(p){
            var d=Math.abs(p.lon-lon2);
            if(d<closestDist){closestDist=d;closest=cl.elevation;}
          });
        });
        fallback.push(closest!==null?closest:(cMin+cMax)/2);
      }
      profElev=fallback;
      statusEl.textContent="Profile from contours (API unavailable)";
    }else{
      // Pure synthetic
      profElev=[];
      for(var pi3=0;pi3<PROF_N;pi3++){
        profElev.push(20+60*Math.sin(Math.PI*pi3/PROF_N)+Math.random()*8);
      }
      statusEl.textContent="Synthetic profile (no data)";
    }
    drawAll();
  }
}

// ── FETCH STATE GEOJSON ───────────────────────────────────────────────────────
function fetchStateData(){
  var raw=(state||"akwa ibom").toLowerCase().trim().replace(/\s*state\s*$/,"").trim();
  var KEYS=["name","Name","NAME","statename","StateName","admin1Name","STATE","state"];
  function extractOutline(feat){
    if(!feat||!feat.geometry)return null;
    var geom=feat.geometry;
    var rings=geom.type==="Polygon"?[geom.coordinates[0]]:geom.type==="MultiPolygon"?geom.coordinates.map(function(p){return p[0];}):[];
    rings.sort(function(a,b){return b.length-a.length;});
    if(!rings[0]||rings[0].length<4)return null;
    var lons=rings[0].map(function(c){return c[0];});
    var lats=rings[0].map(function(c){return c[1];});
    if(Math.min.apply(null,lons)<2||Math.max.apply(null,lons)>15)return null;
    return rings[0].map(function(c){return[c[0],c[1]];});
  }
  fetch("https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/nigeria-states.geojson")
    .then(function(r){return r.json();})
    .then(function(data){
      var match=null,partial=null;
      (data.features||[]).forEach(function(feat){
        var props=feat.properties||{};
        for(var k=0;k<KEYS.length;k++){
          var val=(props[KEYS[k]]||"").toLowerCase().trim().replace(/\s*state\s*$/,"").trim();
          if(val===raw){match=feat;return;}
          if(!partial&&val&&(val.indexOf(raw)>=0||raw.indexOf(val)>=0))partial=feat;
        }
      });
      var chosen=match||partial;
      if(chosen){var ol=extractOutline(chosen);if(ol){stateGeoJSON={_stateOutline:ol};drawAll();}}
    }).catch(function(){});
}

// ── EXPORT ────────────────────────────────────────────────────────────────────
function doExport(fmt){
  var SCALE=exportDPI/SCREEN_DPI;
  var hc=document.createElement("canvas");
  hc.width=Math.round(PW*SCALE);hc.height=Math.round(PH*SCALE);
  var hx=hc.getContext("2d");hx.scale(SCALE,SCALE);hx.drawImage(canvas,0,0,PW,PH);
  if(fmt==="pdf"){
    if(!window.jspdf){alert("PDF library loading.");return;}
    var mm=pageSize==="A2"?{w:420,h:594}:{w:297,h:420};
    var doc=new window.jspdf.jsPDF({orientation:"portrait",unit:"mm",format:pageSize==="A2"?"a2":"a3"});
    doc.addImage(canvas.toDataURL("image/png",1.0),"PNG",0,0,mm.w,mm.h);
    doc.save(filename+".pdf");
  }else{
    var mime=fmt==="jpeg"?"image/jpeg":"image/png";
    hc.toBlob(function(blob){
      var url=URL.createObjectURL(blob),a=document.createElement("a");
      a.download=filename+"."+(fmt==="jpeg"?"jpg":"png");a.href=url;a.click();
      setTimeout(function(){URL.revokeObjectURL(url);},1000);
    },mime,fmt==="jpeg"?0.95:undefined);
  }
}
window.doExport=doExport;window.toggleProfile=toggleProfile;
drawAll();
fetchStateData();
fetchProfile();
<\/script></body></html>`;
  return html;
}

// ── CONSTANTS ──────────────────────────────────────────────────────────────────
const MODES=["pan","town","road-major","road-minor","river","sample","geology","contour","select"];
const MODE_LABELS={pan:"✋ Pan",town:"🏘 Town","road-major":"🟠 Major Road","road-minor":"⬛ Minor Road",river:"🌊 River",sample:"🔺 Sample",geology:"🪨 Geology",contour:"〰 Contour",select:"👆 Select"};
const MODE_COLORS={pan:"#2a2a4a",town:"#1a3a5a","road-major":"#5a2a00","road-minor":"#2a2a2a",river:"#003a5a",sample:"#5a1a1a",geology:"#2a1a5a",contour:"#1a3a2a",select:"#1a3a1a"};
const DPI_OPTIONS=[{dpi:150,label:"150 dpi",desc:"Screen / digital"},{dpi:300,label:"300 dpi",desc:"Thesis standard"},{dpi:600,label:"600 dpi",desc:"NGSA publication"}];

// ── CONTOUR EDIT PANEL ────────────────────────────────────────────────────────
function ContourEditPanel({contour,onSave,onDelete,onDeselect}){
  var [elev,setElev]=useState(String(contour.elevation||""));
  var [err,setErr]=useState("");
  function save(){
    var v=parseFloat(elev);
    if(isNaN(v)){setErr("Enter a valid elevation in metres");return;}
    onSave({elevation:v});
  }
  return(
    <div style={{background:"#12122e",border:"1px solid #1a3a2a",borderRadius:8,padding:10}}>
      <div style={{fontSize:11,color:"#27ae60",fontWeight:"bold",marginBottom:8}}>〰 EDIT CONTOUR</div>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
        <div style={{fontSize:9,color:"#555",background:"#0a1a0a",borderRadius:3,padding:"2px 6px"}}>
          {contour.source==="srtm"?"SRTM Draft":"Field Drawn"}
        </div>
        <div style={{fontSize:9,color:"#555"}}>{contour.points.length} nodes</div>
      </div>
      <Field label="Elevation (m asl) *">
        <input value={elev} onChange={function(e){setElev(e.target.value);setErr("");}}
          placeholder="e.g. 45" type="number"
          style={INP}/>
        {err&&<div style={{fontSize:9,color:"#e74c3c",marginTop:-3,marginBottom:4}}>{err}</div>}
      </Field>
      <div style={{fontSize:8,color:"#555",marginBottom:8,lineHeight:1.5}}>
        Change the elevation value to correct SRTM data with field measurements.
      </div>
      <div style={{display:"flex",gap:4}}>
        <button onClick={save} style={{flex:1,background:"#1a4a2a",color:"#27ae60",border:"1px solid #27ae60",borderRadius:4,padding:"6px",fontSize:10,cursor:"pointer",fontWeight:"bold"}}>✓ Save</button>
        <button onClick={onDelete} style={{background:"#3a0a0a",color:"#e74c3c",border:"1px solid #e74c3c",borderRadius:4,padding:"6px 8px",fontSize:10,cursor:"pointer"}}>🗑</button>
        <button onClick={onDeselect} style={{background:"#1a1a2a",color:"#888",border:"1px solid #3a3a6a",borderRadius:4,padding:"6px 8px",fontSize:10,cursor:"pointer"}}>✕</button>
      </div>
    </div>
  );
}

// ── SRTM CONTOUR LOADER — generates contour lines from OpenTopoData ───────────
async function loadSRTMContours(bbox,setContourLines,setActiveContourIdx,setSrtmLoading){
  setSrtmLoading(true);
  var GRID=30;
  var {minLat,maxLat,minLon,maxLon}=bbox;
  // Build grid points
  var pts=[];
  for(var gy=0;gy<GRID;gy++){
    for(var gx=0;gx<GRID;gx++){
      pts.push({
        lat:Math.round((maxLat-(gy/(GRID-1))*(maxLat-minLat))*100000)/100000,
        lon:Math.round((minLon+(gx/(GRID-1))*(maxLon-minLon))*100000)/100000
      });
    }
  }
  // Fetch in batches of 100
  var grid=new Array(GRID*GRID).fill(0);
  var idx=0;
  try{
    for(var bi=0;bi<pts.length;bi+=100){
      var batch=pts.slice(bi,bi+100);
      var locs=batch.map(function(p){return p.lat+","+p.lon;}).join("|");
      var resp=await fetch("https://api.opentopodata.org/v1/srtm30m?locations="+locs);
      if(!resp.ok)throw new Error("HTTP "+resp.status);
      var json=await resp.json();
      (json.results||[]).forEach(function(r,i){grid[idx+i]=r.elevation!==null?r.elevation:0;});
      idx+=batch.length;
    }
    var minE=Math.min.apply(null,grid.filter(function(v){return v>-500;}));
    var maxE=Math.max.apply(null,grid);
    var range=Math.max(maxE-minE,1);
    // Pick interval
    var niceInts=[1,2,5,10,20,25,50,100,200];
    var interval=niceInts[0];
    for(var ni=0;ni<niceInts.length;ni++){if(niceInts[ni]>=range/10){interval=niceInts[ni];break;}}
    // Marching squares — generate contour lines
    var newContours=[];
    function lerp(v1,v2,lv){return(lv-v1)/(v2-v1);}
    var firstLev=Math.ceil(minE/interval)*interval;
    for(var lev=firstLev;lev<=maxE;lev+=interval){
      var segs=[];
      for(var r=0;r<GRID-1;r++){
        for(var c=0;c<GRID-1;c++){
          var tl=grid[r*GRID+c]||0,tr=grid[r*GRID+c+1]||0;
          var bl=grid[(r+1)*GRID+c]||0,br=grid[(r+1)*GRID+c+1]||0;
          var msIdx=(tl>=lev?8:0)|(tr>=lev?4:0)|(br>=lev?2:0)|(bl>=lev?1:0);
          if(msIdx===0||msIdx===15)continue;
          var edgePts=[];
          function cellLat(row,frac){return maxLat-(( row+frac)/(GRID-1))*(maxLat-minLat);}
          function cellLon(col,frac){return minLon+((col+frac)/(GRID-1))*(maxLon-minLon);}
          if(msIdx===1||msIdx===14){edgePts.push({lat:cellLat(r+1,lerp(bl,tl,lev)),lon:cellLon(c,0)});edgePts.push({lat:cellLat(r+1,0),lon:cellLon(c,lerp(bl,br,lev))});}
          else if(msIdx===2||msIdx===13){edgePts.push({lat:cellLat(r+1,0),lon:cellLon(c,lerp(bl,br,lev))});edgePts.push({lat:cellLat(r,lerp(tr,br,lev)),lon:cellLon(c+1,0)});}
          else if(msIdx===3||msIdx===12){edgePts.push({lat:cellLat(r+1,lerp(bl,tl,lev)),lon:cellLon(c,0)});edgePts.push({lat:cellLat(r,lerp(tr,br,lev)),lon:cellLon(c+1,0)});}
          else if(msIdx===4||msIdx===11){edgePts.push({lat:cellLat(r,0),lon:cellLon(c,lerp(tl,tr,lev))});edgePts.push({lat:cellLat(r,lerp(tr,br,lev)),lon:cellLon(c+1,0)});}
          else if(msIdx===6||msIdx===9){edgePts.push({lat:cellLat(r,0),lon:cellLon(c,lerp(tl,tr,lev))});edgePts.push({lat:cellLat(r+1,0),lon:cellLon(c,lerp(bl,br,lev))});}
          else if(msIdx===7||msIdx===8){edgePts.push({lat:cellLat(r,0),lon:cellLon(c,lerp(tl,tr,lev))});edgePts.push({lat:cellLat(r+1,lerp(bl,tl,lev)),lon:cellLon(c,0)});}
          else if(msIdx===5){edgePts.push({lat:cellLat(r,0),lon:cellLon(c,lerp(tl,tr,lev))});edgePts.push({lat:cellLat(r+1,0),lon:cellLon(c,lerp(bl,br,lev))});}
          else if(msIdx===10){edgePts.push({lat:cellLat(r+1,lerp(bl,tl,lev)),lon:cellLon(c,0)});edgePts.push({lat:cellLat(r,lerp(tr,br,lev)),lon:cellLon(c+1,0)});}
          if(edgePts.length===2)segs.push(edgePts);
        }
      }
      // Chain segments into polylines
      var used=new Array(segs.length).fill(false);
      var SNAP=0.001;
      function d2(a,b){return Math.pow(a.lat-b.lat,2)+Math.pow(a.lon-b.lon,2);}
      for(var si=0;si<segs.length;si++){
        if(used[si])continue;
        used[si]=true;
        var line=[segs[si][0],segs[si][1]];
        var extended=true;
        while(extended){
          extended=false;
          var tail=line[line.length-1];
          var best=-1,bestD=SNAP*SNAP,flip=false;
          for(var sj=0;sj<segs.length;sj++){
            if(used[sj])continue;
            var d0=d2(tail,segs[sj][0]),d1=d2(tail,segs[sj][1]);
            if(d0<bestD){bestD=d0;best=sj;flip=false;}
            if(d1<bestD){bestD=d1;best=sj;flip=true;}
          }
          if(best>=0){used[best]=true;line.push(flip?segs[best][0]:segs[best][1]);extended=true;}
        }
        if(line.length>=2)newContours.push({elevation:Math.round(lev),points:line,source:"srtm"});
      }
    }
    // Replace existing SRTM contours, keep field-drawn ones
    setContourLines(function(prev){
      var fieldLines=prev.filter(function(c){return c.source!=="srtm";});
      return fieldLines.concat(newContours);
    });
    setActiveContourIdx(null);
  }catch(err){
    alert("SRTM fetch failed: "+err.message+"\nCheck internet connection or try again.");
  }finally{
    setSrtmLoading(false);
  }
}

export default function GeoMappingSystem(){
  // ── FIELD DEFINITIONS ─────────────────────────────────────────────────────────
var CSV_FIELDS = [
  {key:"id",       label:"Sample ID",    required:true},
  {key:"lat",      label:"Latitude",     required:true},
  {key:"lon",      label:"Longitude",    required:true},
  {key:"rock",     label:"Rock Type",    required:false},
  {key:"formation",label:"Formation",    required:false},
  {key:"strike",   label:"Strike",       required:false},
  {key:"dip",      label:"Dip",          required:false},
  {key:"elevation",label:"Elevation",    required:false},
  {key:"description",label:"Description",required:false},
  {key:"notes",    label:"Notes",        required:false},
];

function parseCSVFile(text){
  var lines=text.split(/\r?\n/).filter(function(l){return l.trim();});
  if(lines.length<2)return null;
  function parseLine(line){
    var cols=[],cur="",inQ=false;
    for(var i=0;i<line.length;i++){
      var c=line[i];
      if(c==='"'&&!inQ){inQ=true;}
      else if(c==='"'&&inQ&&line[i+1]==='"'){cur+='"';i++;}
      else if(c==='"'&&inQ){inQ=false;}
      else if(c===','&&!inQ){cols.push(cur.trim());cur="";}
      else{cur+=c;}
    }
    cols.push(cur.trim());
    return cols;
  }
  var headers=parseLine(lines[0]);
  var rows=lines.slice(1).map(function(l){return parseLine(l);}).filter(function(r){return r.some(function(c){return c;});});
  return{headers,rows};
}

function fuzzyMatchColumns(headers){
  var patterns={
    id:      [/sample.?id/i,/id/i,/sample.?no/i,/sample.?num/i,/name/i,/label/i],
    lat:     [/^lat/i,/latitude/i,/^y$/i,/^lat\.?$/i,/northing/i],
    lon:     [/^lon/i,/longitude/i,/^x$/i,/^long\.?$/i,/easting/i],
    rock:    [/rock.?type/i,/rock/i,/lithology/i,/lith/i,/type/i],
    formation:[/formation/i,/form/i,/unit/i,/member/i,/group/i],
    strike:  [/strike/i,/azimuth/i,/bearing/i],
    dip:     [/^dip$/i,/dip.?angle/i,/inclination/i],
    elevation:[/elev/i,/altitude/i,/height/i,/^z$/i,/asl/i,/masl/i],
    description:[/desc/i,/description/i,/field.?desc/i,/observation/i],
    notes:   [/note/i,/comment/i,/remark/i,/obs/i],
  };
  var mapping={};
  Object.keys(patterns).forEach(function(field){
    var pats=patterns[field];
    for(var pi=0;pi<pats.length;pi++){
      for(var hi=0;hi<headers.length;hi++){
        if(pats[pi].test(headers[hi].trim())){
          if(mapping[field]===undefined)mapping[field]=hi;
        }
      }
    }
    if(mapping[field]===undefined)mapping[field]=-1;
  });
  return mapping;
}

async function aiDetectColumns(headers, sampleRows){
  try{
    var preview=sampleRows.slice(0,3).map(function(r){return r.join(",");}).join("\n");
    var prompt='I have a CSV file with these column headers:\n'+
      headers.map(function(h,i){return i+": "+h;}).join(", ")+
      '\n\nFirst 3 data rows:\n'+preview+
      '\n\nMap each of these field names to the correct column INDEX (0-based integer, or -1 if not present):\n'+
      'id (Sample ID), lat (Latitude), lon (Longitude), rock (Rock Type), formation (Formation/Unit), '+
      'strike (Strike angle 0-360), dip (Dip angle 0-90), elevation (Elevation in metres), '+
      'description (Field description), notes (Notes/comments)\n\n'+
      'Respond ONLY with a JSON object like: {"id":0,"lat":1,"lon":2,"rock":3,"formation":-1,"strike":4,"dip":5,"elevation":6,"description":7,"notes":-1}\n'+
      'No explanation, no markdown, just the JSON object.';
    var resp=await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:300,messages:[{role:"user",content:prompt}]})
    });
    if(!resp.ok)throw new Error("API HTTP "+resp.status);
    var data=await resp.json();
    var text=(data.content||[]).map(function(b){return b.text||"";}).join("");
    var clean=text.replace(/```[a-z]*|```/g,"").trim();
    var parsed=JSON.parse(clean);
    var valid=true;
    CSV_FIELDS.forEach(function(f){if(typeof parsed[f.key]!=="number")valid=false;});
    if(!valid)throw new Error("Invalid mapping shape");
    return parsed;
  }catch(e){
    console.warn("AI column detection failed, using fuzzy match:",e.message);
    return fuzzyMatchColumns(headers);
  }
}

function convexHull(points){
  if(points.length<3)return points;
  var pivot=points.reduce(function(best,p){
    return(p.lat<best.lat||(p.lat===best.lat&&p.lon<best.lon))?p:best;
  },points[0]);
  var sorted=points.slice().sort(function(a,b){
    var da=Math.atan2(a.lat-pivot.lat,a.lon-pivot.lon);
    var db=Math.atan2(b.lat-pivot.lat,b.lon-pivot.lon);
    if(da!==db)return da-db;
    var da2=(a.lon-pivot.lon)*(a.lon-pivot.lon)+(a.lat-pivot.lat)*(a.lat-pivot.lat);
    var db2=(b.lon-pivot.lon)*(b.lon-pivot.lon)+(b.lat-pivot.lat)*(b.lat-pivot.lat);
    return da2-db2;
  });
  function cross(O,A,B){return(A.lon-O.lon)*(B.lat-O.lat)-(A.lat-O.lat)*(B.lon-O.lon);}
  var hull=[];
  for(var i=0;i<sorted.length;i++){
    while(hull.length>=2&&cross(hull[hull.length-2],hull[hull.length-1],sorted[i])<=0)hull.pop();
    hull.push(sorted[i]);
  }
  return hull;
}

function downloadTemplateCSV(){
  var headers="Sample_ID,Latitude,Longitude,Rock_Type,Formation,Strike,Dip,Elevation_m,Description,Notes";
  var example="UU/GS/GLG/25/001,5.5033,7.7591,Shale,Imo Shale,045,32,45,Dark grey finely laminated shale,Fresh outcrop near stream";
  var blob=new Blob([headers+"\n"+example],{type:"text/csv"});
  var url=URL.createObjectURL(blob),a=document.createElement("a");
  a.download="GeoMap_Template.csv";a.href=url;a.click();
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
}

var ROCK_ALIASES={
  "sh":"Shale","shale":"Shale","sl":"Shale","mudstone":"Mudstone","mud":"Mudstone",
  "ss":"Sandstone","sandstone":"Sandstone","sand":"Sandstone","arenite":"Sandstone",
  "ls":"Limestone","limestone":"Limestone","lime":"Limestone","calc":"Limestone",
  "cl":"Clay","clay":"Clay","claystone":"Clay",
  "si":"Siltstone","siltstone":"Siltstone","silt":"Siltstone",
  "ml":"Marl","marl":"Marl",
  "gr":"Gravel","gravel":"Gravel","conglomerate":"Gravel",
};
function normalizeRock(raw){
  if(!raw||!raw.trim())return"Shale";
  var key=raw.trim().toLowerCase();
  if(ROCK_ALIASES[key])return ROCK_ALIASES[key];
  for(var alias in ROCK_ALIASES){if(key.startsWith(alias))return ROCK_ALIASES[alias];}
  for(var i=0;i<ROCK_TYPES.length;i++){if(ROCK_TYPES[i].toLowerCase()===key)return ROCK_TYPES[i];}
  return"Shale";
}

function ColumnMappingTable({headers,mapping,onChange}){
  return(
    <div style={{background:"#0a0a1e",border:"1px solid #2a2a5a",borderRadius:6,overflow:"hidden",marginBottom:8}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",background:"#12122e",padding:"6px 8px",borderBottom:"1px solid #2a2a5a"}}>
        <span style={{fontSize:9,color:"#7ab",fontWeight:"bold"}}>FIELD</span>
        <span style={{fontSize:9,color:"#7ab",fontWeight:"bold"}}>CSV COLUMN</span>
      </div>
      {CSV_FIELDS.map(function(f){
        return(
          <div key={f.key} style={{display:"grid",gridTemplateColumns:"1fr 1fr",padding:"5px 8px",borderBottom:"1px solid #1a1a3a",alignItems:"center",background:f.required&&mapping[f.key]===-1?"#2a0a0a":"transparent"}}>
            <span style={{fontSize:9,color:f.required?"#f0c040":"#aaa"}}>{f.label}{f.required?" *":""}</span>
            <select value={mapping[f.key]===-1?"__none__":String(mapping[f.key])}
              onChange={function(e){var val=e.target.value==="__none__"?-1:parseInt(e.target.value);var next=Object.assign({},mapping);next[f.key]=val;onChange(next);}}
              style={{background:"#1e2e3e",color:mapping[f.key]===-1?"#555":"#fff",border:"1px solid #3a5a7a",borderRadius:3,padding:"2px 4px",fontSize:9,width:"100%"}}>
              <option value="__none__">— not mapped —</option>
              {headers.map(function(h,i){return <option key={i} value={String(i)}>{h}</option>;})}
            </select>
          </div>
        );
      })}
    </div>
  );
}

function CSVImportPanel({onImport,onClose,rockTypes}){
  var [stage,setStage]=useState("upload");
  var [csvHeaders,setCsvHeaders]=useState([]);
  var [csvRows,setCsvRows]=useState([]);
  var [mapping,setMapping]=useState({});
  var [msg,setMsg]=useState("");
  var [err,setErr]=useState("");
  var [importResult,setImportResult]=useState(null);

  function handleFile(e){
    var file=e.target.files&&e.target.files[0];
    if(!file)return;
    var reader=new FileReader();
    reader.onload=function(ev){
      var parsed=parseCSVFile(ev.target.result);
      if(!parsed||parsed.rows.length===0){setErr("Could not read CSV. Check the file has data rows.");return;}
      setCsvHeaders(parsed.headers);setCsvRows(parsed.rows);setErr("");
      setStage("detecting");setMsg("Detecting columns with AI…");
      aiDetectColumns(parsed.headers,parsed.rows.slice(0,3)).then(function(m){setMapping(m);setStage("mapping");setMsg("");});
    };
    reader.readAsText(file);
  }

  function handleImport(){
    if(mapping.id===-1||mapping.lat===-1||mapping.lon===-1){setErr("Sample ID, Latitude, and Longitude columns are required.");return;}
    setStage("importing");setMsg("Processing "+csvRows.length+" rows…");
    var imported=[],skipped=0;
    csvRows.forEach(function(row){
      var lat=parseFloat(row[mapping.lat]),lon=parseFloat(row[mapping.lon]);
      if(isNaN(lat)||isNaN(lon)||lat<3||lat>14||lon<3||lon>15){skipped++;return;}
      imported.push({
        id:(mapping.id>=0&&row[mapping.id])?row[mapping.id].trim():"S"+(imported.length+1),
        lat:lat,lon:lon,
        rock:normalizeRock(mapping.rock>=0?row[mapping.rock]:""),
        formation:(mapping.formation>=0&&row[mapping.formation])?row[mapping.formation].trim():"",
        strike:(mapping.strike>=0&&row[mapping.strike])?row[mapping.strike].trim():"",
        dip:(mapping.dip>=0&&row[mapping.dip])?row[mapping.dip].trim():"",
        elevation:(mapping.elevation>=0&&row[mapping.elevation])?row[mapping.elevation].trim():"",
        description:(mapping.description>=0&&row[mapping.description])?row[mapping.description].trim():"",
        notes:(mapping.notes>=0&&row[mapping.notes])?row[mapping.notes].trim():"",
      });
    });
    if(imported.length===0){setErr("No valid samples found. Check coordinates are within Nigeria (lat 3–14, lon 3–15).");setStage("mapping");return;}
    var geoZones=[];
    if(mapping.formation>=0){
      var byFormation={};
      imported.forEach(function(s){if(!s.formation)return;if(!byFormation[s.formation])byFormation[s.formation]=[];byFormation[s.formation].push({lat:s.lat,lon:s.lon,rock:s.rock});});
      Object.keys(byFormation).forEach(function(form){
        var pts=byFormation[form];if(pts.length<3)return;
        var hull=convexHull(pts);if(hull.length<3)return;
        var cLat=hull.reduce(function(s,p){return s+p.lat;},0)/hull.length;
        var cLon=hull.reduce(function(s,p){return s+p.lon;},0)/hull.length;
        var expanded=hull.map(function(p){return{lat:cLat+(p.lat-cLat)*1.03,lon:cLon+(p.lon-cLon)*1.03};});
        geoZones.push({rock:pts[0].rock,formation:form,period:"Unknown",contact:"Unknown",strike:"",dip:"",points:expanded});
      });
    }
    setImportResult({samples:imported,geoZones,skipped});
    onImport(imported,geoZones);
    setStage("done");setMsg("");
  }

  var canImport=mapping.id!==-1&&mapping.lat!==-1&&mapping.lon!==-1;

  return(
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.85)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:12,padding:20,width:480,maxHeight:"85vh",overflowY:"auto",fontFamily:"sans-serif"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div>
            <div style={{fontSize:14,fontWeight:"bold",color:"#f0c040"}}>📥 CSV Import</div>
            <div style={{fontSize:10,color:"#555",marginTop:2}}>
              {stage==="upload"&&"Upload your GPS field data CSV"}
              {stage==="detecting"&&"AI is detecting your column layout…"}
              {stage==="mapping"&&"Confirm the column mapping below"}
              {stage==="importing"&&"Importing samples…"}
              {stage==="done"&&"Import complete!"}
            </div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#555",fontSize:18,cursor:"pointer"}}>✕</button>
        </div>
        {(stage==="upload"||stage==="detecting"||stage==="mapping")&&(
          <div style={{background:"#0a0a1e",border:"1px solid #1a3a5a",borderRadius:6,padding:10,marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontSize:10,color:"#4a9adf",fontWeight:"bold"}}>Need a template?</div><div style={{fontSize:9,color:"#555",marginTop:2}}>Download the standard CSV format with example data</div></div>
            <button onClick={downloadTemplateCSV} style={{background:"#1a3a5a",color:"#4a9adf",border:"1px solid #2a5a8a",borderRadius:5,padding:"5px 10px",fontSize:9,cursor:"pointer",fontWeight:"bold",whiteSpace:"nowrap"}}>⬇ Template CSV</button>
          </div>
        )}
        {stage==="upload"&&(
          <div>
            <label style={{display:"block",background:"#0a1a2a",border:"2px dashed #2a5a8a",borderRadius:8,padding:24,textAlign:"center",cursor:"pointer"}}>
              <div style={{fontSize:24,marginBottom:8}}>📂</div>
              <div style={{fontSize:12,color:"#4a9adf",fontWeight:"bold",marginBottom:4}}>Click to select CSV file</div>
              <div style={{fontSize:10,color:"#555"}}>Or drag and drop your GPS export</div>
              <input type="file" accept=".csv,.txt" onChange={handleFile} style={{display:"none"}}/>
            </label>
            <div style={{fontSize:9,color:"#444",marginTop:8,lineHeight:1.6}}>Supported: Garmin BaseCamp, GPS Utility, Excel CSV, any spreadsheet saved as CSV. Coordinates must be decimal degrees (WGS84).</div>
          </div>
        )}
        {stage==="detecting"&&(
          <div style={{textAlign:"center",padding:24}}>
            <div style={{fontSize:24,marginBottom:8}}>🤖</div>
            <div style={{fontSize:12,color:"#f0c040",fontWeight:"bold",marginBottom:4}}>AI Column Detection</div>
            <div style={{fontSize:10,color:"#555"}}>Analysing {csvHeaders.length} columns across {csvRows.length} rows…</div>
            <div style={{marginTop:12,height:4,background:"#1a1a3a",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:"60%",background:"#f0c040",borderRadius:2}}/></div>
          </div>
        )}
        {stage==="mapping"&&(
          <div>
            <div style={{fontSize:10,color:"#27ae60",marginBottom:8}}>✓ Detected {csvHeaders.length} columns in {csvRows.length} rows. Review mapping below:</div>
            <ColumnMappingTable headers={csvHeaders} mapping={mapping} onChange={setMapping}/>
            <div style={{background:"#0a0a1e",border:"1px solid #2a2a5a",borderRadius:6,padding:8,marginBottom:10,overflowX:"auto"}}>
              <div style={{fontSize:9,color:"#7ab",marginBottom:4,fontWeight:"bold"}}>DATA PREVIEW (first 2 rows)</div>
              <table style={{borderCollapse:"collapse",width:"100%",fontSize:8}}>
                <thead><tr>{csvHeaders.map(function(h,i){return<th key={i} style={{color:"#aaa",padding:"2px 4px",textAlign:"left",borderBottom:"1px solid #2a2a5a",whiteSpace:"nowrap"}}>{h}</th>;})}</tr></thead>
                <tbody>{csvRows.slice(0,2).map(function(row,ri){return(<tr key={ri}>{row.map(function(cell,ci){return<td key={ci} style={{color:"#eee",padding:"2px 4px",whiteSpace:"nowrap",maxWidth:80,overflow:"hidden",textOverflow:"ellipsis"}}>{cell}</td>;})}</tr>);})}</tbody>
              </table>
            </div>
            {err&&<div style={{background:"#3a0a0a",border:"1px solid #e74c3c",borderRadius:6,padding:"6px 8px",marginBottom:8,fontSize:9,color:"#ffaaaa"}}>{err}</div>}
            <div style={{display:"flex",gap:8}}>
              <button onClick={handleImport} disabled={!canImport} style={{flex:1,background:canImport?"#1a4a2a":"#1a1a2a",color:canImport?"#27ae60":"#444",border:"1px solid "+(canImport?"#27ae60":"#333"),borderRadius:6,padding:"10px",fontSize:11,fontWeight:"bold",cursor:canImport?"pointer":"not-allowed"}}>✓ Import {csvRows.length} Rows</button>
              <button onClick={function(){setStage("upload");setCsvHeaders([]);setCsvRows([]);setErr("");}} style={{background:"#1a1a3a",color:"#888",border:"1px solid #3a3a6a",borderRadius:6,padding:"10px 14px",fontSize:11,cursor:"pointer"}}>← Back</button>
            </div>
            {!canImport&&<div style={{fontSize:9,color:"#e74c3c",marginTop:6}}>Map Sample ID, Latitude, and Longitude columns to continue.</div>}
          </div>
        )}
        {stage==="importing"&&(
          <div style={{textAlign:"center",padding:24}}><div style={{fontSize:24,marginBottom:8}}>⚙</div><div style={{fontSize:11,color:"#f0c040"}}>{msg}</div></div>
        )}
        {stage==="done"&&importResult&&(
          <div>
            <div style={{background:"#0a2a0a",border:"1px solid #27ae60",borderRadius:8,padding:14,marginBottom:12}}>
              <div style={{fontSize:13,color:"#27ae60",fontWeight:"bold",marginBottom:8}}>✓ Import Complete</div>
              <div style={{fontSize:11,color:"#eee",marginBottom:4}}>📍 {importResult.samples.length} sample points placed on map</div>
              {importResult.geoZones.length>0&&<div style={{fontSize:11,color:"#eee",marginBottom:4}}>🪨 {importResult.geoZones.length} draft geology zone{importResult.geoZones.length!==1?"s":""} generated</div>}
              {importResult.skipped>0&&<div style={{fontSize:11,color:"#f0c040",marginBottom:4}}>⚠ {importResult.skipped} row{importResult.skipped!==1?"s":""} skipped (invalid coordinates)</div>}
            </div>
            <div style={{background:"#0a1a2a",border:"1px solid #1a3a5a",borderRadius:6,padding:10,marginBottom:12}}>
              <div style={{fontSize:10,color:"#4a9adf",fontWeight:"bold",marginBottom:4}}>What to do next</div>
              <div style={{fontSize:9,color:"#888",lineHeight:1.7}}>
                1. Use 👆 Select mode to review and edit sample attributes<br/>
                {importResult.geoZones.length>0?"2. Drag geology polygon nodes to match actual field boundaries":"2. Switch to 🪨 Geology mode to draw formation boundaries"}<br/>
                3. Add roads and rivers manually, then generate maps
              </div>
            </div>
            <button onClick={onClose} style={{width:"100%",background:"#27ae60",color:"#fff",border:"none",borderRadius:6,padding:"10px",fontSize:12,fontWeight:"bold",cursor:"pointer"}}>✓ Done — Back to Map</button>
          </div>
        )}
      </div>
    </div>
  );
}

  var [user,setUser]=useState(null);
  var [authLoading,setAuthLoading]=useState(true);
  var [currentProject,setCurrentProject]=useState(null);
  var [showDashboard,setShowDashboard]=useState(false);
  var [saveStatus,setSaveStatus]=useState("saved");
  var [projName,setProjName]=useState("");
  var [projStudyArea,setProjStudyArea]=useState("");
  var [projLGA,setProjLGA]=useState("");
  var [projState,setProjState]=useState("Akwa Ibom");
  var [mapTypes,setMapTypes]=useState(["sample","geo"]);
  var [stratFormations,setStratFormations]=useState([]);
  var [showProjInfo,setShowProjInfo]=useState(false);
  var canvasRef=useRef(null),containerRef=useRef(null);
  var [center,setCenter]=useState({lat:NIGERIA_CENTER[0],lon:NIGERIA_CENTER[1]});
  var [zoom,setZoom]=useState(NIGERIA_ZOOM);
  var [mode,setMode]=useState("pan");
  var [tiles,setTiles]=useState([]);
  var [tick,setTick]=useState(0);
  var [size,setSize]=useState({w:800,h:560});
  var [tab,setTab]=useState("draw");
  var [exportDPI,setExportDPI]=useState(300);
  var [exportPageSize,setExportPageSize]=useState("A3");
  var [mapLayout,setMapLayout]=useState("panel"); // "panel" or "full"
  var [cursorLL,setCursorLL]=useState(null);
  var [towns,setTowns]=useState([]);
  var [roads,setRoads]=useState([]);
  var [rivers,setRivers]=useState([]);
  var [samples,setSamples]=useState([]);
  var [geoZones,setGeoZones]=useState([]);
  var [activeRoadIdx,setActiveRoadIdx]=useState(null);
  var [activeRiverIdx,setActiveRiverIdx]=useState(null);
  var [activeGeoIdx,setActiveGeoIdx]=useState(null);
  var [activeContourIdx,setActiveContourIdx]=useState(null);
  var [contourLines,setContourLines]=useState([]);
  var [contourElevInput,setContourElevInput]=useState(""); // elevation for active contour being drawn
  var [contourElevError,setContourElevError]=useState("");
  var [srtmLoading,setSrtmLoading]=useState(false);
  var [previewPin,setPreviewPin]=useState(null);
  var [selectedFeature,setSelectedFeature]=useState(null);
  var [mousePos,setMousePos]=useState(null);
  var [townForm,setTownForm]=useState({name:"",townType:"Settlement"});
  var [sampleForm,setSampleForm]=useState({id:"",rock:"Shale",description:"",strike:"",dip:"",notes:"",elevation:""});
  var [sampleFormErrs,setSampleFormErrs]=useState({});
  var [geoRock,setGeoRock]=useState("Shale");
  var [showCSVImport,setShowCSVImport]=useState(false);
  var dragRef=useRef(null);
  var autoSaveRef=useRef(null);
  var W=size.w,H=size.h;

  useEffect(function(){
    supabase.auth.getSession().then(function(res){
      setUser(res.data.session?.user||null);setAuthLoading(false);
      if(res.data.session?.user)setShowDashboard(true);
    });
    var {data:{subscription}}=supabase.auth.onAuthStateChange(function(_event,session){
      setUser(session?.user||null);
      if(!session?.user){setCurrentProject(null);setShowDashboard(false);}else{setShowDashboard(true);}
    });
    return function(){subscription.unsubscribe();};
  },[]);

  async function loadProject(project){
    setCurrentProject(project);setShowDashboard(false);
    setProjName(project.name||"");setProjStudyArea(project.study_area||"");
    setProjLGA(project.lga||"");setProjState(project.state||"Akwa Ibom");
    setMapTypes(project.map_types||["sample","geo"]);
    setMapLayout(project.map_layout||"panel");
    setCenter({lat:project.center_lat||NIGERIA_CENTER[0],lon:project.center_lon||NIGERIA_CENTER[1]});
    setZoom(project.zoom||NIGERIA_ZOOM);
    var [t,ro,ri,s,g,sc,cl]=await Promise.all([
      supabase.from("towns").select("*").eq("project_id",project.id),
      supabase.from("roads").select("*").eq("project_id",project.id),
      supabase.from("rivers").select("*").eq("project_id",project.id),
      supabase.from("samples").select("*").eq("project_id",project.id),
      supabase.from("geology_zones").select("*").eq("project_id",project.id),
      supabase.from("stratigraphic_columns").select("*").eq("project_id",project.id).single(),
      supabase.from("contour_lines").select("*").eq("project_id",project.id).order("elevation",{ascending:true}),
    ]);
    setTowns((t.data||[]).map(function(x){return{lat:x.lat,lon:x.lon,name:x.name,townType:x.town_type,_id:x.id};}));
    setRoads((ro.data||[]).map(function(x){return{type:x.road_type,name:x.name,surface:x.surface,points:x.points||[],_id:x.id};}));
    setRivers((ri.data||[]).map(function(x){return{name:x.name,flow:x.flow,points:x.points||[],_id:x.id};}));
    setSamples((s.data||[]).map(function(x){return{lat:x.lat,lon:x.lon,id:x.sample_id,rock:x.rock,description:x.description,strike:x.strike,dip:x.dip,notes:x.notes,elevation:x.elevation||"",_id:x.id};}));
    setGeoZones((g.data||[]).map(function(x){return{rock:x.rock,formation:x.formation,period:x.period,contact:x.contact,strike:x.strike||"",dip:x.dip||"",points:x.points||[],_id:x.id};}));
    setStratFormations((sc.data&&sc.data.formations)||[]);
    setContourLines((cl.data||[]).map(function(x){return{elevation:x.elevation,points:x.points||[],source:x.source||"field",_id:x.id};}));
    setSaveStatus("saved");
  }

  var saveProject=useCallback(async function(){
    if(!currentProject||!user)return;
    setSaveStatus("saving");
    try{
      await supabase.from("projects").update({
        name:projName||projStudyArea||"Untitled",study_area:projStudyArea,lga:projLGA,state:projState,
        map_types:mapTypes,map_layout:mapLayout,
        center_lat:center.lat,center_lon:center.lon,zoom
      }).eq("id",currentProject.id);
      await Promise.all([
        supabase.from("towns").delete().eq("project_id",currentProject.id),
        supabase.from("roads").delete().eq("project_id",currentProject.id),
        supabase.from("rivers").delete().eq("project_id",currentProject.id),
        supabase.from("samples").delete().eq("project_id",currentProject.id),
        supabase.from("geology_zones").delete().eq("project_id",currentProject.id),
      ]);
      var pid=currentProject.id,inserts=[];
      if(towns.length>0)inserts.push(supabase.from("towns").insert(towns.map(function(t){return{project_id:pid,name:t.name||"",town_type:t.townType||"Settlement",lat:t.lat,lon:t.lon};})));
      if(roads.length>0)inserts.push(supabase.from("roads").insert(roads.map(function(r){return{project_id:pid,name:r.name||"",road_type:r.type||"minor",surface:r.surface||"Paved",points:r.points};})));
      if(rivers.length>0)inserts.push(supabase.from("rivers").insert(rivers.map(function(r){return{project_id:pid,name:r.name||"",flow:r.flow||"Unknown",points:r.points};})));
      if(samples.length>0)inserts.push(supabase.from("samples").insert(samples.map(function(s){return{project_id:pid,sample_id:s.id||"",rock:s.rock||"Shale",description:s.description||"",strike:s.strike||"",dip:s.dip||"",notes:s.notes||"",elevation:s.elevation||null,lat:s.lat,lon:s.lon};})));
      if(geoZones.length>0)inserts.push(supabase.from("geology_zones").insert(geoZones.map(function(z){return{project_id:pid,rock:z.rock||"Shale",formation:z.formation||"",period:z.period||"Unknown",contact:z.contact||"Unknown",strike:z.strike||"",dip:z.dip||"",points:z.points};})));
      // Stratigraphic column — upsert (one row per project)
      inserts.push(supabase.from("stratigraphic_columns").upsert(
        {project_id:pid,formations:stratFormations,updated_at:new Date().toISOString()},
        {onConflict:"project_id"}
      ));
      // Contour lines — delete all then re-insert
      await supabase.from("contour_lines").delete().eq("project_id",pid);
      if(contourLines.length>0)inserts.push(supabase.from("contour_lines").insert(contourLines.map(function(c){return{project_id:pid,elevation:c.elevation,points:c.points,source:c.source||"field"};})));
      await Promise.all(inserts);
      setSaveStatus("saved");
    }catch(e){console.error("Save error:",e);setSaveStatus("error");}
  },[currentProject,user,projName,projStudyArea,projLGA,projState,mapTypes,mapLayout,stratFormations,contourLines,center,zoom,towns,roads,rivers,samples,geoZones]);

  useEffect(function(){if(currentProject)setSaveStatus("unsaved");},[towns,roads,rivers,samples,geoZones,stratFormations,contourLines,projStudyArea,projLGA,projState]);

  var saveProjectRef=useRef(saveProject);
  useEffect(function(){saveProjectRef.current=saveProject;},[saveProject]);
  useEffect(function(){
    if(!currentProject)return;
    if(autoSaveRef.current)clearInterval(autoSaveRef.current);
    autoSaveRef.current=setInterval(function(){saveProjectRef.current();},AUTO_SAVE_INTERVAL);
    return function(){clearInterval(autoSaveRef.current);};
  },[currentProject]);

  useEffect(function(){
    function upd(){if(containerRef.current){var r=containerRef.current.getBoundingClientRect();setSize({w:Math.floor(r.width)||800,h:Math.floor(r.height)||560});}}
    upd();window.addEventListener("resize",upd);return function(){window.removeEventListener("resize",upd);};
  },[]);

  useEffect(function(){
    var cx=lon2tile(center.lon,zoom),cy=lat2tile(center.lat,zoom);
    var range=Math.ceil(Math.max(W,H)/TILE_SIZE/2)+2,next=[];
    for(var x=cx-range;x<=cx+range;x++){for(var y=cy-range;y<=cy+range;y++){var max=Math.pow(2,zoom);if(y<0||y>=max)continue;next.push({z:zoom,x:((x%max)+max)%max,y:y,ox:x});}}
    setTiles(next);
  },[center,zoom,W,H]);

  useEffect(function(){tiles.forEach(function(t){loadTile(t.z,t.x,t.y,function(){setTick(function(n){return n+1;});});});},[tiles]);

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
      ctx.strokeStyle=isSel?"#f0c040":"#2980d9";ctx.lineWidth=isSel?3:2;ctx.stroke();ctx.shadowBlur=0;
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

    // ── Contour lines ──────────────────────────────────────────────────────────
    var allElevs=contourLines.map(function(c){return c.elevation;});
    var cMin=allElevs.length?Math.min.apply(null,allElevs):0;
    var cMax=allElevs.length?Math.max.apply(null,allElevs):100;
    var cRange=Math.max(cMax-cMin,1);
    // Index interval: every 5th unique elevation level
    var sortedElevs=[...new Set(allElevs)].sort(function(a,b){return a-b;});
    var indexSet=new Set();
    sortedElevs.forEach(function(e,i){if(i%5===0)indexSet.add(e);});

    contourLines.forEach(function(cl,ci){
      if(cl.points.length<2)return;
      var pts=cl.points.map(function(pt){return p(pt.lat,pt.lon);});
      var isSel=selectedFeature&&selectedFeature.type==="contour"&&selectedFeature.id===ci;
      var isActive=ci===activeContourIdx;
      var isIndex=indexSet.has(cl.elevation);
      var isSRTM=cl.source==="srtm";

      ctx.strokeStyle=isSel?"#f0c040":isIndex?"rgba(60,30,0,0.95)":"rgba(60,30,0,0.55)";
      ctx.lineWidth=isSel?2.5:isIndex?1.6:0.8;
      if(isSRTM&&!isSel)ctx.setLineDash([]);
      ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
      for(var ci2=1;ci2<pts.length;ci2++){
        if(ci2<pts.length-1){
          var mx=(pts[ci2].x+pts[ci2+1].x)/2,my=(pts[ci2].y+pts[ci2+1].y)/2;
          ctx.quadraticCurveTo(pts[ci2].x,pts[ci2].y,mx,my);
        }else{ctx.lineTo(pts[ci2].x,pts[ci2].y);}
      }
      ctx.stroke();ctx.setLineDash([]);

      // Elevation label at midpoint
      if(pts.length>=4||(isSel&&pts.length>=2)){
        var mid=pts[Math.floor(pts.length/2)];
        ctx.save();
        ctx.font=(isIndex?"bold ":"")+"8px sans-serif";
        ctx.textAlign="center";
        ctx.strokeStyle="#fff";ctx.lineWidth=3;ctx.strokeText(cl.elevation+"m",mid.x,mid.y-3);
        ctx.fillStyle=isSel?"#f0c040":isIndex?"rgba(60,30,0,0.95)":"rgba(60,30,0,0.7)";
        ctx.fillText(cl.elevation+"m",mid.x,mid.y-3);
        ctx.restore();
      }

      // Node dots when active
      if(isActive){
        pts.forEach(function(pp2){
          ctx.fillStyle="#27ae60";ctx.beginPath();ctx.arc(pp2.x,pp2.y,3,0,Math.PI*2);ctx.fill();
        });
        if(mousePos&&pts.length>0){
          var last2=pts[pts.length-1],mp2=p(mousePos.lat,mousePos.lon);
          ctx.beginPath();ctx.moveTo(last2.x,last2.y);ctx.lineTo(mp2.x,mp2.y);
          ctx.strokeStyle="#27ae60";ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.stroke();ctx.setLineDash([]);
        }
      }
    });
    var ax=W-36,ay=36;ctx.save();ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(ax,ay,18,0,Math.PI*2);ctx.fill();ctx.fillStyle="#c0392b";ctx.beginPath();ctx.moveTo(ax,ay-14);ctx.lineTo(ax-6,ay+3);ctx.lineTo(ax+6,ay+3);ctx.closePath();ctx.fill();ctx.fillStyle="#333";ctx.beginPath();ctx.moveTo(ax,ay+14);ctx.lineTo(ax-6,ay-3);ctx.lineTo(ax+6,ay-3);ctx.closePath();ctx.fill();ctx.fillStyle="#c0392b";ctx.font="bold 10px sans-serif";ctx.textAlign="center";ctx.fillText("N",ax,ay-17);ctx.textAlign="left";ctx.restore();
    var mpp=(156543.03392*Math.cos(center.lat*Math.PI/180))/Math.pow(2,zoom),bm=zoom>=12?500:zoom>=10?2000:zoom>=8?20000:zoom>=6?100000:500000,bp=bm/mpp,sx=10,sy=H-20;
    ctx.save();ctx.fillStyle="rgba(255,255,255,0.88)";ctx.fillRect(sx-3,sy-12,bp+6,18);ctx.fillStyle="#222";ctx.fillRect(sx,sy-6,bp/2,7);ctx.fillStyle="#999";ctx.fillRect(sx+bp/2,sy-6,bp/2,7);ctx.strokeStyle="#222";ctx.lineWidth=1;ctx.strokeRect(sx,sy-6,bp,7);ctx.fillStyle="#222";ctx.font="8px sans-serif";ctx.fillText("0",sx,sy-8);ctx.fillText(bm>=1000?bm/1000+"km":bm+"m",sx+bp-6,sy-8);ctx.restore();
    ctx.save();ctx.fillStyle="rgba(0,0,0,0.55)";ctx.fillRect(8,8,160,22);ctx.fillStyle="#f0c040";ctx.font="bold 11px sans-serif";ctx.fillText("MODE: "+MODE_LABELS[mode],14,23);ctx.restore();
    ctx.save();ctx.fillStyle="rgba(255,255,255,0.7)";ctx.fillRect(W-185,H-15,185,15);ctx.fillStyle="#666";ctx.font="8px sans-serif";ctx.fillText("© OpenStreetMap contributors",W-182,H-4);ctx.restore();
  },[tiles,center,zoom,tick,towns,roads,rivers,samples,geoZones,contourLines,activeRoadIdx,activeRiverIdx,activeGeoIdx,activeContourIdx,mousePos,mode,geoRock,W,H,previewPin,selectedFeature]);

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
      for(var cni=0;cni<contourLines.length;cni++){for(var cnj=0;cnj<contourLines[cni].points.length;cnj++){var cnp=ll2px(contourLines[cni].points[cnj].lat,contourLines[cni].points[cnj].lon,center.lat,center.lon,zoom,W,H);if(dist(cp,cnp)<SNAP){setSelectedFeature({type:"contour",id:cni});setTab("draw");return;}}}
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
      var errs={};var idErr=validateSampleId(sampleForm.id,samples,-1);if(idErr)errs.id=idErr;var sErr=validateStrike(sampleForm.strike);if(sErr)errs.strike=sErr;var dErr=validateDip(sampleForm.dip);if(dErr)errs.dip=dErr;
      if(Object.keys(errs).length>0){setSampleFormErrs(errs);return;}
      var id=sampleForm.id||"SAMPLE-"+(samples.length+1);
      setSamples(function(s){return s.concat([{lat:ll.lat,lon:ll.lon,id:id,rock:sampleForm.rock,description:sampleForm.description||"",strike:sampleForm.strike||"",dip:sampleForm.dip||"",notes:sampleForm.notes||"",elevation:sampleForm.elevation||""}]);});
      setSampleForm(function(f){return Object.assign({},f,{id:"",description:"",strike:"",dip:"",notes:"",elevation:""});});setSampleFormErrs({});
    }
    else if(mode==="geology"){
      if(activeGeoIdx===null){var ng={rock:geoRock,formation:"",period:"Unknown",contact:"Unknown",strike:"",dip:"",points:[ll]};setGeoZones(function(prev){setActiveGeoIdx(prev.length);return prev.concat([ng]);});}
      else{var firstPt=geoZones[activeGeoIdx].points[0],fp2=ll2px(firstPt.lat,firstPt.lon,center.lat,center.lon,zoom,W,H),cp2=ll2px(ll.lat,ll.lon,center.lat,center.lon,zoom,W,H);
        if(geoZones[activeGeoIdx].points.length>2&&dist(fp2,cp2)<16){setActiveGeoIdx(null);return;}
        setGeoZones(function(prev){return prev.map(function(z,i){if(i===activeGeoIdx)return Object.assign({},z,{points:z.points.concat([ll])});return z;});});}
    }
    else if(mode==="contour"){
      var celev=parseFloat(contourElevInput);
      if(isNaN(celev)){setContourElevError("Set elevation (m) before placing nodes");return;}
      setContourElevError("");
      if(activeContourIdx===null){
        var nc={elevation:celev,points:[ll],source:"field"};
        setContourLines(function(prev){setActiveContourIdx(prev.length);return prev.concat([nc]);});
      }else{
        setContourLines(function(prev){return prev.map(function(c,i){
          if(i===activeContourIdx)return Object.assign({},c,{points:c.points.concat([ll])});
          return c;
        });});
      }
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
    else if(t==="contour"){setContourLines(function(a){return a.filter(function(_,i){return i!==id;});});setActiveContourIdx(null);}
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
    else if(t==="contour")setContourLines(function(a){return a.map(function(f,i){return i===id?Object.assign({},f,updates):f;});});
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
    else if(mode==="contour"&&activeContourIdx!==null){setContourLines(function(prev){return prev.map(function(c,i){if(i===activeContourIdx){if(c.points.length<=1){setActiveContourIdx(null);return null;}return Object.assign({},c,{points:c.points.slice(0,-1)});}return c;}).filter(Boolean);});}
  }

  function finishContour(){setActiveContourIdx(null);}
  
  function handleCSVImport(importedSamples,importedGeoZones){
    setSamples(function(prev){return prev.concat(importedSamples);});
    if(importedGeoZones&&importedGeoZones.length>0){setGeoZones(function(prev){return prev.concat(importedGeoZones);});}
    if(importedSamples.length>0){
      var lats=importedSamples.map(function(s){return s.lat;});
      var lons=importedSamples.map(function(s){return s.lon;});
      var minLat=Math.min.apply(null,lats),maxLat=Math.max.apply(null,lats);
      var minLon=Math.min.apply(null,lons),maxLon=Math.max.apply(null,lons);
      setCenter({lat:(minLat+maxLat)/2,lon:(minLon+maxLon)/2});
      var span=Math.max(maxLat-minLat,maxLon-minLon,0.01);
      setZoom(span>2?7:span>1?8:span>0.5?9:span>0.1?11:13);
    }
    setTab("draw");setMode("select");
  }

  function clearAll(){setTowns([]);setRoads([]);setRivers([]);setSamples([]);setGeoZones([]);setContourLines([]);setActiveRoadIdx(null);setActiveRiverIdx(null);setActiveGeoIdx(null);setActiveContourIdx(null);setPreviewPin(null);setSelectedFeature(null);}

  function placeFromCoord(ll){
    setPreviewPin(ll);setCenter({lat:ll.lat,lon:ll.lon});if(zoom<10)setZoom(10);
    if(mode==="town"){var name=townForm.name||"Town "+(towns.length+1);setTowns(function(t){return t.concat([{lat:ll.lat,lon:ll.lon,name:name,townType:townForm.townType||"Settlement"}]);});setTownForm({name:"",townType:"Settlement"});}
    else if(mode==="sample"){var errs={};var idErr=validateSampleId(sampleForm.id,samples,-1);if(idErr)errs.id=idErr;var sErr=validateStrike(sampleForm.strike);if(sErr)errs.strike=sErr;var dErr=validateDip(sampleForm.dip);if(dErr)errs.dip=dErr;if(Object.keys(errs).length>0){setSampleFormErrs(errs);return;}var id=sampleForm.id||"SAMPLE-"+(samples.length+1);setSamples(function(s){return s.concat([{lat:ll.lat,lon:ll.lon,id:id,rock:sampleForm.rock,description:sampleForm.description||"",strike:sampleForm.strike||"",dip:sampleForm.dip||"",notes:sampleForm.notes||"",elevation:sampleForm.elevation||""}]);});setSampleForm(function(f){return Object.assign({},f,{id:"",description:"",strike:"",dip:"",notes:"",elevation:""});});setSampleFormErrs({});}
    else if(mode==="road-major"||mode==="road-minor"){if(activeRoadIdx===null){var nr={type:mode==="road-major"?"major":"minor",points:[ll],name:"",surface:"Paved"};setRoads(function(prev){setActiveRoadIdx(prev.length);return prev.concat([nr]);});}else{setRoads(function(prev){return prev.map(function(r,i){if(i===activeRoadIdx)return Object.assign({},r,{points:r.points.concat([ll])});return r;});});}}
    else if(mode==="river"){if(activeRiverIdx===null){var nrv={points:[ll],name:"",flow:"Unknown"};setRivers(function(prev){setActiveRiverIdx(prev.length);return prev.concat([nrv]);});}else{setRivers(function(prev){return prev.map(function(r,i){if(i===activeRiverIdx)return Object.assign({},r,{points:r.points.concat([ll])});return r;});});}}
    else if(mode==="geology"){if(activeGeoIdx===null){var ng={rock:geoRock,formation:"",period:"Unknown",contact:"Unknown",strike:"",dip:"",points:[ll]};setGeoZones(function(prev){setActiveGeoIdx(prev.length);return prev.concat([ng]);});}else{setGeoZones(function(prev){return prev.map(function(z,i){if(i===activeGeoIdx)return Object.assign({},z,{points:z.points.concat([ll])});return z;});});}}
    else if(mode==="contour"){var celev2=parseFloat(contourElevInput);if(isNaN(celev2)){setContourElevError("Set elevation (m) before placing nodes");return;}setContourElevError("");if(activeContourIdx===null){var nc2={elevation:celev2,points:[ll],source:"field"};setContourLines(function(prev){setActiveContourIdx(prev.length);return prev.concat([nc2]);});}else{setContourLines(function(prev){return prev.map(function(c,i){if(i===activeContourIdx)return Object.assign({},c,{points:c.points.concat([ll])});return c;});});}}
    setTimeout(function(){setPreviewPin(null);},2500);  }

  var getMeta=useCallback(function(){return{studyArea:projStudyArea,lga:projLGA,state:projState};},[projStudyArea,projLGA,projState]);
  var openMap=useCallback(function(type){
    var data={towns,roads,rivers,samples,geoZones,center,zoom};
    var html=renderMap(type,data,getMeta(),exportDPI,exportPageSize);
    var w=window.open("","_blank");w.document.write(html);w.document.close();
  },[towns,roads,rivers,samples,geoZones,center,zoom,getMeta,exportDPI,exportPageSize]);

  var openStratColumn=useCallback(function(){
    if(stratFormations.length===0){alert("Add at least one formation before generating the column.");return;}
    var html=renderStratColumn(stratFormations,getMeta(),exportDPI,exportPageSize);
    var w=window.open("","_blank");w.document.write(html);w.document.close();
  },[stratFormations,getMeta,exportDPI,exportPageSize]);

  var openTopoMap=useCallback(function(){
    var data={towns,roads,rivers,samples,geoZones,contourLines,center,zoom};
    var html=renderTopoMap(data,getMeta(),exportDPI,exportPageSize,mapLayout);
    var w=window.open("","_blank");w.document.write(html);w.document.close();
  },[towns,roads,rivers,samples,geoZones,contourLines,center,zoom,getMeta,exportDPI,exportPageSize,mapLayout]);

  var activeRoad=activeRoadIdx!==null?roads[activeRoadIdx]:null;
  var activeRiver=activeRiverIdx!==null?rivers[activeRiverIdx]:null;
  var activeGeo=activeGeoIdx!==null?geoZones[activeGeoIdx]:null;
  // Computed bbox from all features — used by SRTM loader
  var allLats=[],allLons=[];
  towns.forEach(function(f){allLats.push(f.lat);allLons.push(f.lon);});
  samples.forEach(function(f){allLats.push(f.lat);allLons.push(f.lon);});
  roads.forEach(function(r){r.points.forEach(function(p){allLats.push(p.lat);allLons.push(p.lon);});});
  rivers.forEach(function(r){r.points.forEach(function(p){allLats.push(p.lat);allLons.push(p.lon);});});
  geoZones.forEach(function(z){z.points.forEach(function(p){allLats.push(p.lat);allLons.push(p.lon);});});
  var completeness=computeCompleteness(towns,roads,rivers,samples,geoZones);
  var btnBase={border:"none",borderRadius:6,cursor:"pointer",fontFamily:"sans-serif",fontWeight:"bold"};
  var validationErrors=[];
  var sampleIds=samples.map(function(s){return s.id;});
  var dupIds=sampleIds.filter(function(id,i){return sampleIds.indexOf(id)!==i;});
  if(dupIds.length>0)validationErrors.push("Duplicate sample IDs: "+[...new Set(dupIds)].join(", "));
  samples.forEach(function(s,i){if(s.strike){var n=parseFloat(s.strike);if(isNaN(n)||n<0||n>360)validationErrors.push("Sample "+(i+1)+": Strike out of range");}if(s.dip){var n=parseFloat(s.dip);if(isNaN(n)||n<0||n>90)validationErrors.push("Sample "+(i+1)+": Dip out of range");}});
  geoZones.forEach(function(z,i){if(z.points.length>0&&z.points.length<3)validationErrors.push("Geology zone "+(i+1)+" ("+z.rock+"): needs at least 3 nodes");});

  if(authLoading)return(<div style={{background:"#0d0d1f",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:"#f0c040",fontFamily:"sans-serif",fontSize:14}}>Loading…</div>);
  if(!user)return <AuthScreen/>;
  if(showDashboard)return <Dashboard user={user} onOpen={loadProject} onSignOut={async function(){await supabase.auth.signOut();}}/>;

  var saveColor=saveStatus==="saved"?"#27ae60":saveStatus==="saving"?"#f0c040":saveStatus==="error"?"#e74c3c":"#888";
  var saveLabel=saveStatus==="saved"?"✓ Saved":saveStatus==="saving"?"Saving…":saveStatus==="error"?"Save failed":"● Unsaved";

  return(
    <div style={{background:"#0d0d1f",height:"100vh",fontFamily:"sans-serif",color:"#eee",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{background:"#12122e",borderBottom:"1px solid #2a2a5a",padding:"7px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:30,height:30,background:"#f0c040",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🗺</div>
          <div>
            <div style={{fontWeight:"bold",fontSize:13,color:"#f0c040"}}>{projStudyArea||projName||"Geo Mapping System"}</div>
            <div style={{fontSize:9,color:"#555"}}>{projLGA&&projState?projLGA+" · "+projState+" State":"Nigeria Geological Survey — v0.7"}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:5,alignItems:"center"}}>
          <div style={{fontSize:9,color:saveColor,border:"1px solid "+saveColor,borderRadius:10,padding:"2px 8px"}}>{saveLabel}</div>
          <button onClick={saveProject} style={Object.assign({},btnBase,{background:"#1a3a1a",color:"#27ae60",border:"1px solid #27ae60",padding:"4px 10px",fontSize:10})}>💾 Save</button>
          {mapTypes.indexOf("sample")>=0&&<button onClick={function(){openMap("sample");}} style={Object.assign({},btnBase,{background:"#1a3a5a",color:"#4a9adf",border:"1px solid #2a5a8a",padding:"5px 10px",fontSize:10})}>📄 Sample Map</button>}
          {mapTypes.indexOf("geo")>=0&&<button onClick={function(){openMap("geo");}} style={Object.assign({},btnBase,{background:"#2a1a5a",color:"#9b59b6",border:"1px solid #5a2a8a",padding:"5px 10px",fontSize:10})}>🪨 Geologic Map</button>}
          {mapTypes.indexOf("topo")>=0&&<button onClick={openTopoMap} style={Object.assign({},btnBase,{background:"#1a2e1a",color:"#2e7d32",border:"1px solid #2e7d32",padding:"5px 10px",fontSize:10})}>🏔 Topo Map</button>}
          {mapTypes.indexOf("strat")>=0&&<button onClick={openStratColumn} style={Object.assign({},btnBase,{background:"#3a2000",color:"#e67e22",border:"1px solid #e67e22",padding:"5px 10px",fontSize:10})}>📊 Strat Column</button>}
          <button onClick={function(){setShowProjInfo(function(v){return !v;});}} style={Object.assign({},btnBase,{background:showProjInfo?"#2a2a0a":"#1a1a3a",color:"#f0c040",border:"1px solid "+(showProjInfo?"#f0c040":"#3a3a6a"),padding:"4px 10px",fontSize:10})}>⚙ Project Info</button>
          <button onClick={function(){setShowDashboard(true);}} style={Object.assign({},btnBase,{background:"#1a1a3a",color:"#888",border:"1px solid #3a3a6a",padding:"4px 10px",fontSize:10})}>← Projects</button>
          <div style={{background:"#1a1a3a",border:"1px solid #3a3a6a",borderRadius:10,padding:"2px 8px",fontSize:9,color:"#888"}}>z{zoom}</div>
        </div>
      </div>

      {showProjInfo&&(
        <div style={{background:"#0a0a1e",borderBottom:"1px solid #2a2a5a",padding:"10px 14px",display:"flex",gap:12,alignItems:"flex-end",flexShrink:0}}>
          <div style={{flex:2}}><div style={LABEL}>Study Area Name</div><input value={projStudyArea} onChange={function(e){setProjStudyArea(e.target.value);}} placeholder="e.g. Ogu Itumbuoso" style={Object.assign({},INP,{marginBottom:0})}/></div>
          <div style={{flex:1}}><div style={LABEL}>LGA</div><input value={projLGA} onChange={function(e){setProjLGA(e.target.value);}} placeholder="e.g. Itu" style={Object.assign({},INP,{marginBottom:0})}/></div>
          <div style={{flex:1}}><div style={LABEL}>State</div><select value={projState} onChange={function(e){setProjState(e.target.value);}} style={Object.assign({},SEL,{marginBottom:0})}>{NIGERIA_STATES.map(function(s){return <option key={s}>{s}</option>;})}</select></div>
          <div style={{flex:2}}><div style={LABEL}>Project Name (optional)</div><input value={projName} onChange={function(e){setProjName(e.target.value);}} placeholder="Defaults to study area name" style={Object.assign({},INP,{marginBottom:0})}/></div>
          <button onClick={function(){saveProject();setShowProjInfo(false);}} style={Object.assign({},btnBase,{background:"#27ae60",color:"#fff",padding:"5px 14px",fontSize:10,flexShrink:0})}>✓ Save Info</button>
        </div>
      )}

      <div style={{background:"#0a0a20",borderBottom:"1px solid #2a2a5a",padding:"6px 10px",display:"flex",gap:4,alignItems:"center",flexShrink:0,overflowX:"auto"}}>
        {MODES.filter(function(m){
          if(m==="geology"&&mapTypes.indexOf("geo")<0)return false;
          if(m==="contour"&&mapTypes.indexOf("topo")<0)return false;
          return true;
        }).map(function(m){return(
          <button key={m} onClick={function(){setMode(m);if(m==="pan"){setActiveRoadIdx(null);setActiveRiverIdx(null);setActiveGeoIdx(null);setActiveContourIdx(null);}if(m!=="select")setSelectedFeature(null);}}
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
          {mode==="contour"&&(<div style={{position:"absolute",bottom:28,left:"50%",transform:"translateX(-50%)",background:"rgba(0,20,10,0.85)",color:"#27ae60",borderRadius:8,padding:"6px 14px",fontSize:11,display:"flex",gap:8,alignItems:"center"}}><span>{activeContourIdx!==null?(contourLines[activeContourIdx]?.points.length||0)+" nodes · click to add more":"Set elevation in panel, then click to start"}</span>{activeContourIdx!==null&&<button onClick={finishContour} style={Object.assign({},btnBase,{background:"#27ae60",color:"#fff",padding:"3px 10px",fontSize:10})}>✓ Finish</button>}{activeContourIdx!==null&&<button onClick={undoLastNode} style={Object.assign({},btnBase,{background:"#e74c3c",color:"#fff",padding:"3px 8px",fontSize:10})}>↩ Undo</button>}</div>)}
          {mode==="select"&&(<div style={{position:"absolute",bottom:28,left:"50%",transform:"translateX(-50%)",background:"rgba(0,20,0,0.85)",color:"#27ae60",borderRadius:8,padding:"6px 14px",fontSize:11}}>Click any feature to select &amp; edit attributes</div>)}
        </div>

        <div style={{width:252,background:"#0a0a1e",borderLeft:"1px solid #2a2a5a",display:"flex",flexDirection:"column",flexShrink:0}}>
          <div style={{display:"flex",borderBottom:"1px solid #2a2a5a"}}>
            {["draw","data","output"].map(function(t){return(<button key={t} onClick={function(){setTab(t);}} style={Object.assign({},btnBase,{flex:1,padding:"8px 4px",fontSize:10,background:tab===t?"#1a1a3a":"transparent",color:tab===t?"#f0c040":"#555",borderRadius:0,borderBottom:tab===t?"2px solid #f0c040":"2px solid transparent"})}>{t==="draw"?"✏️ Draw":t==="data"?"📊 Data":"🗺 Output"}</button>);})}
          </div>
          <div style={{flex:1,overflowY:"auto",padding:12}}>
            {tab==="draw"&&(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {mode==="select"&&(selectedFeature?(
                  selectedFeature.type==="town"?<TownEditPanel town={towns[selectedFeature.id]} onSave={saveSelected} onDelete={deleteSelected} onDeselect={function(){setSelectedFeature(null);}}/>
                  :selectedFeature.type==="sample"?<SampleEditPanel sample={samples[selectedFeature.id]} allSamples={samples} editingIdx={selectedFeature.id} onSave={saveSelected} onDelete={deleteSelected} onDeselect={function(){setSelectedFeature(null);}}/>
                  :selectedFeature.type==="geology"?<GeoEditPanel zone={geoZones[selectedFeature.id]} stratFormations={stratFormations} onSave={saveSelected} onDelete={deleteSelected} onDeselect={function(){setSelectedFeature(null);}}/>
                  :selectedFeature.type==="road"?<RoadEditPanel road={roads[selectedFeature.id]} onSave={saveSelected} onDelete={deleteSelected} onDeselect={function(){setSelectedFeature(null);}}/>
                  :selectedFeature.type==="river"?<RiverEditPanel river={rivers[selectedFeature.id]} onSave={saveSelected} onDelete={deleteSelected} onDeselect={function(){setSelectedFeature(null);}}/>
                  :selectedFeature.type==="contour"?<ContourEditPanel contour={contourLines[selectedFeature.id]} onSave={saveSelected} onDelete={deleteSelected} onDeselect={function(){setSelectedFeature(null);}}/>
                  :null
                ):(<div style={{background:"#12122e",border:"1px solid #1a3a1a",borderRadius:8,padding:12,textAlign:"center"}}><div style={{fontSize:20,marginBottom:6}}>👆</div><div style={{fontSize:11,color:"#27ae60",fontWeight:"bold",marginBottom:4}}>SELECT MODE</div><div style={{fontSize:10,color:"#555",lineHeight:1.7}}>Click any feature on the map to select it and edit its attributes.</div></div>))}
                {mode==="town"&&(<div style={{background:"#12122e",border:"1px solid #1a3a5a",borderRadius:8,padding:10}}><div style={{fontSize:11,color:"#4a9adf",fontWeight:"bold",marginBottom:8}}>🏘 PLACE TOWN</div><Field label="Town Name"><input value={townForm.name} onChange={function(e){setTownForm(function(f){return Object.assign({},f,{name:e.target.value});});}} placeholder="e.g. Ananamong" style={INP}/></Field><Field label="Settlement Type"><select value={townForm.townType||"Settlement"} onChange={function(e){setTownForm(function(f){return Object.assign({},f,{townType:e.target.value});});}} style={SEL}>{TOWN_TYPES.map(function(t){return <option key={t}>{t}</option>;})}</select></Field><div style={{fontSize:10,color:"#555",marginBottom:4}}>Click map to place</div><CoordInput label="Place by Coordinates" onPlace={placeFromCoord}/></div>)}
                {(mode==="road-major"||mode==="road-minor")&&(<div style={{background:"#12122e",border:"1px solid #5a2a00",borderRadius:8,padding:10}}><div style={{fontSize:11,color:"#e07030",fontWeight:"bold",marginBottom:6}}>{mode==="road-major"?"🟠 MAJOR ROAD":"⬛ MINOR ROAD"}</div><div style={{fontSize:10,color:"#888",lineHeight:1.6,marginBottom:6}}>Click nodes · curves through all points · finish when done</div>{activeRoad&&<div style={{marginBottom:6,fontSize:10,color:"#f0c040"}}>{activeRoad.points.length} nodes placed</div>}<CoordInput label="Add Node by Coordinates" onPlace={placeFromCoord}/></div>)}
                {mode==="river"&&(<div style={{background:"#12122e",border:"1px solid #003a5a",borderRadius:8,padding:10}}><div style={{fontSize:11,color:"#2980d9",fontWeight:"bold",marginBottom:6}}>🌊 DRAW RIVER</div><div style={{fontSize:10,color:"#888",lineHeight:1.6,marginBottom:6}}>Click nodes · curves through all points · finish when done</div>{activeRiver&&<div style={{marginBottom:6,fontSize:10,color:"#f0c040"}}>{activeRiver.points.length} nodes placed</div>}<CoordInput label="Add Node by Coordinates" onPlace={placeFromCoord}/></div>)}
                {mode==="sample"&&(<div style={{background:"#12122e",border:"1px solid #5a1a1a",borderRadius:8,padding:10}}><div style={{fontSize:11,color:"#e74c3c",fontWeight:"bold",marginBottom:8}}>🔺 PLACE SAMPLE</div><Field label="Sample ID *"><input value={sampleForm.id} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{id:e.target.value});});setSampleFormErrs(function(e2){return Object.assign({},e2,{id:null});});}} placeholder="e.g. UU/GS/GLG/25/57" style={INP}/>{sampleFormErrs.id&&<div style={{fontSize:9,color:"#e74c3c",marginTop:-3,marginBottom:4}}>{sampleFormErrs.id}</div>}</Field><Field label="Rock Type"><select value={sampleForm.rock} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{rock:e.target.value});});}} style={SEL}>{ROCK_TYPES.map(function(r){return <option key={r}>{r}</option>;})}</select></Field><Field label="Field Description"><input value={sampleForm.description||""} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{description:e.target.value});});}} placeholder="e.g. dark grey, finely laminated" style={INP}/></Field><div style={{display:"flex",gap:6}}><div style={{flex:1}}><Field label="Strike (0–360°)"><input value={sampleForm.strike||""} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{strike:e.target.value});});setSampleFormErrs(function(e2){return Object.assign({},e2,{strike:null});});}} placeholder="e.g. 045" style={INP}/>{sampleFormErrs.strike&&<div style={{fontSize:9,color:"#e74c3c",marginTop:-3,marginBottom:4}}>{sampleFormErrs.strike}</div>}</Field></div><div style={{flex:1}}><Field label="Dip (0–90°)"><input value={sampleForm.dip||""} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{dip:e.target.value});});setSampleFormErrs(function(e2){return Object.assign({},e2,{dip:null});});}} placeholder="e.g. 32" style={INP}/>{sampleFormErrs.dip&&<div style={{fontSize:9,color:"#e74c3c",marginTop:-3,marginBottom:4}}>{sampleFormErrs.dip}</div>}</Field></div></div><Field label="Field Notes"><textarea value={sampleForm.notes||""} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{notes:e.target.value});});}} rows={2} placeholder="Additional observations…" style={Object.assign({},INP,{resize:"none"})}/></Field><Field label="Elevation (m asl)"><input value={sampleForm.elevation||""} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{elevation:e.target.value});});}} placeholder="e.g. 45 (GPS/hand level)" type="number" style={Object.assign({},INP,{marginBottom:2})}/><div style={{fontSize:8,color:"#555",marginBottom:4}}>Spot height on topo map</div></Field><CoordInput label="Place by Coordinates" onPlace={placeFromCoord}/></div>)}
                {mode==="geology"&&(<div style={{background:"#12122e",border:"1px solid #2a1a5a",borderRadius:8,padding:10}}><div style={{fontSize:11,color:"#9b59b6",fontWeight:"bold",marginBottom:8}}>🪨 GEOLOGY ZONE</div><Field label="Rock Type"><select value={geoRock} onChange={function(e){setGeoRock(e.target.value);}} style={SEL}>{ROCK_TYPES.map(function(r){return <option key={r}>{r}</option>;})}</select></Field><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}><div style={{width:18,height:18,background:ROCK_COLORS[geoRock],borderRadius:3,border:"1px solid #fff"}}/><span style={{fontSize:10,color:"#888"}}>{geoRock}</span></div><div style={{fontSize:10,color:"#888",lineHeight:1.6,marginBottom:6}}>Click nodes · green circle to close · min 3 points<br/>Use 👆 Select after placing to add formation name &amp; dip</div>{activeGeo&&<div style={{marginTop:6,fontSize:10,color:"#f0c040"}}>{activeGeo.points.length} nodes placed</div>}<CoordInput label="Add Node by Coordinates" onPlace={placeFromCoord}/></div>)}
                {mode==="pan"&&(<div style={{fontSize:11,color:"#555",textAlign:"center",padding:20,lineHeight:1.8}}>Select a drawing tool above to begin.<br/><br/>Use <span style={{color:"#27ae60"}}>👆 Select</span> to click any placed feature and edit its attributes.</div>)}
                {mode==="contour"&&(
                  <div style={{background:"#12122e",border:"1px solid #1a3a2a",borderRadius:8,padding:10}}>
                    <div style={{fontSize:11,color:"#27ae60",fontWeight:"bold",marginBottom:8}}>〰 DRAW CONTOUR</div>
                    <Field label="Elevation (m asl) *">
                      <input value={contourElevInput} onChange={function(e){setContourElevInput(e.target.value);setContourElevError("");}}
                        placeholder="e.g. 45" type="number"
                        style={INP}/>
                      {contourElevError&&<div style={{fontSize:9,color:"#e74c3c",marginTop:-3,marginBottom:4}}>{contourElevError}</div>}
                    </Field>
                    <div style={{fontSize:10,color:"#888",lineHeight:1.6,marginBottom:8}}>
                      Set elevation, then click nodes on the map to draw the contour line.<br/>
                      Use <strong style={{color:"#f0c040"}}>👆 Select</strong> to edit any contour's elevation.
                    </div>
                    {activeContourIdx!==null&&(
                      <div style={{fontSize:10,color:"#f0c040",marginBottom:6}}>
                        Drawing: {contourLines[activeContourIdx]?.elevation}m · {contourLines[activeContourIdx]?.points.length||0} nodes
                      </div>
                    )}
                    <CoordInput label="Add Node by Coordinates" onPlace={placeFromCoord}/>

                    {/* SRTM loader */}
                    <div style={{borderTop:"1px solid #2a2a5a",paddingTop:10,marginTop:8}}>
                      <div style={{fontSize:10,color:"#4a9adf",fontWeight:"bold",marginBottom:4}}>Load SRTM Draft Contours</div>
                      <div style={{fontSize:9,color:"#555",marginBottom:6,lineHeight:1.5}}>
                        Fetches elevation from OpenTopoData and generates contour lines as a starting draft. Edit any line's elevation to match your field data.
                      </div>
                      <button
                        onClick={function(){
                          if(!allLats||allLats.length===0){alert("Add some features to the map first to define the study area.");return;}
                          var bbox={
                            minLat:Math.min.apply(null,allLats)-0.01,
                            maxLat:Math.max.apply(null,allLats)+0.01,
                            minLon:Math.min.apply(null,allLons)-0.01,
                            maxLon:Math.max.apply(null,allLons)+0.01,
                          };
                          loadSRTMContours(bbox,setContourLines,setActiveContourIdx,setSrtmLoading);
                        }}
                        disabled={srtmLoading}
                        style={Object.assign({},btnBase,{width:"100%",background:srtmLoading?"#1a1a3a":"#1a2e4a",color:srtmLoading?"#555":"#4a9adf",border:"1px solid "+(srtmLoading?"#333":"#2a5a8a"),padding:"7px",fontSize:10})}>
                        {srtmLoading?"⟳ Loading SRTM data…":"⬇ Load SRTM Draft Contours"}
                      </button>
                      {contourLines.filter(function(c){return c.source==="srtm";}).length>0&&(
                        <div style={{fontSize:9,color:"#27ae60",marginTop:4}}>
                          ✓ {contourLines.filter(function(c){return c.source==="srtm";}).length} SRTM contours loaded
                          <button onClick={function(){setContourLines(function(prev){return prev.filter(function(c){return c.source!=="srtm";});});}}
                            style={{marginLeft:8,background:"none",border:"none",color:"#e74c3c",fontSize:9,cursor:"pointer",textDecoration:"underline"}}>
                            Clear SRTM
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <button onClick={function(){setShowCSVImport(true);}} style={Object.assign({},btnBase,{background:"#1a3a5a",color:"#4a9adf",border:"1px solid #2a5a8a",padding:"8px",fontSize:10,width:"100%",marginBottom:4})}>📥 Import CSV Field Data</button>
                <button onClick={clearAll} style={Object.assign({},btnBase,{background:"#3a1a1a",color:"#e74c3c",border:"1px solid #e74c3c",padding:"7px",fontSize:10,width:"100%"})}>🗑 Clear All Features</button>
                {/* ── STRATIGRAPHIC COLUMN EDITOR ── shows when strat map type active */}
                {mapTypes.indexOf("strat")>=0&&(
                  <div style={{borderTop:"1px solid #2a2a5a",paddingTop:10,marginTop:4}}>
                    <StratEditor
                      formations={stratFormations}
                      onChange={setStratFormations}
                      onExport={openStratColumn}
                    />
                  </div>
                )}
              </div>
            )}
            {tab==="data"&&(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <CompletenessBar score={completeness}/>
                <ValidationBanner errors={validationErrors}/>
                {[{label:"Towns",count:towns.length,color:"#3498db"},{label:"Major Roads",count:roads.filter(function(r){return r.type==="major";}).length,color:"#e07030"},{label:"Minor Roads",count:roads.filter(function(r){return r.type==="minor";}).length,color:"#888"},{label:"Rivers",count:rivers.length,color:"#2980d9"},{label:"Samples",count:samples.length,color:"#e74c3c"},{label:"Geology Zones",count:geoZones.length,color:"#9b59b6"}].map(function(item,i){return(<div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#12122e",borderRadius:6,padding:"7px 10px",borderLeft:"3px solid "+item.color}}><span style={{fontSize:11,color:"#aaa"}}>{item.label}</span><span style={{fontSize:16,fontWeight:"bold",color:item.color}}>{item.count}</span></div>);})}
                {samples.length>0&&(<div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10,marginTop:4}}><div style={{fontSize:11,color:"#f0c040",fontWeight:"bold",marginBottom:6}}>SAMPLES</div>{samples.map(function(s,i){var sc=scoreFeature("sample",s),pct=Math.round(sc.score/sc.max*100);return(<div key={i} style={{borderBottom:"1px solid #1a1a3a",padding:"5px 0",cursor:"pointer"}} onClick={function(){setSelectedFeature({type:"sample",id:i});setTab("draw");setMode("select");}}><div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:10,color:"#ffaaaa",fontWeight:"bold"}}>{s.id||"(unnamed)"}</span><span style={{fontSize:9,color:pct===100?"#27ae60":pct>=60?"#f0c040":"#e74c3c"}}>{pct}%</span></div><div style={{fontSize:9,color:"#888"}}>{s.rock}{s.description?" · "+s.description.slice(0,20):""}{s.strike&&s.dip?" · "+s.strike+"/"+s.dip+"°":""}</div><div style={{fontSize:8,color:"#444",fontFamily:"monospace"}}>{s.lat.toFixed(4)}, {s.lon.toFixed(4)}</div></div>);})}</div>)}
                {geoZones.length>0&&(<div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10}}><div style={{fontSize:11,color:"#f0c040",fontWeight:"bold",marginBottom:6}}>GEOLOGY ZONES</div>{geoZones.map(function(z,i){var sc=scoreFeature("geology",z),pct=Math.round(sc.score/sc.max*100);return(<div key={i} style={{borderBottom:"1px solid #1a1a3a",padding:"5px 0",cursor:"pointer"}} onClick={function(){setSelectedFeature({type:"geology",id:i});setTab("draw");setMode("select");}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:6}}><div style={{width:10,height:10,background:ROCK_COLORS[z.rock]||"#ccc",borderRadius:2,flexShrink:0}}/><span style={{fontSize:10,color:"#cca0ff",fontWeight:"bold",flex:1}}>{z.formation||z.rock}</span><span style={{fontSize:9,color:pct===100?"#27ae60":pct>=60?"#f0c040":"#e74c3c"}}>{pct}%</span></div><div style={{fontSize:9,color:"#666",marginLeft:16}}>{z.rock} · {z.period} · {z.points.length} nodes{z.dip?" · dip "+z.dip+"°":""}</div></div>);})}</div>)}
              </div>
            )}
            {tab==="output"&&(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {validationErrors.length>0&&<ValidationBanner errors={validationErrors}/>}
                <div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10}}>
                  <div style={{fontSize:11,color:"#f0c040",fontWeight:"bold",marginBottom:6}}>MAP TITLE PREVIEW</div>
                  <div style={{fontSize:10,color:"#fff",lineHeight:1.8}}>
                    {projStudyArea?(<><div style={{fontWeight:"bold"}}>SAMPLE LOCATION MAP OF {projStudyArea.toUpperCase()}</div><div>IN {projLGA?projLGA.toUpperCase()+", ":""}{projState.toUpperCase()} STATE</div></>):<div style={{color:"#555"}}>Set Study Area, LGA &amp; State in ⚙ Project Info above</div>}
                  </div>
                </div>
                <div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10}}>
                  <div style={{fontSize:11,color:"#f0c040",fontWeight:"bold",marginBottom:8}}>MAP LAYOUT</div>
                  <div style={{display:"flex",gap:6}}>
                    {[{key:"panel",label:"Panel",desc:"Right panel + legend"},{key:"full",label:"Full Page",desc:"Max map area"}].map(function(opt){
                      var active=mapLayout===opt.key;
                      return(
                        <button key={opt.key} onClick={function(){setMapLayout(opt.key);}}
                          style={Object.assign({},btnBase,{flex:1,padding:"8px 4px",fontSize:10,
                            background:active?"#1a3a1a":"#0f0f2a",
                            color:active?"#27ae60":"#aaa",
                            border:"1px solid "+(active?"#27ae60":"#2a2a5a")})}>
                          {opt.label}<br/>
                          <span style={{fontSize:8,fontWeight:"normal",color:active?"#8fbb8f":"#444"}}>{opt.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div style={{fontSize:8,color:"#444",marginTop:6,lineHeight:1.5}}>
                    Panel: consistent with MAP 2/3. Full: maximum contour detail, floating legend.
                  </div>
                </div>
                <div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10}}>
                  <div style={{fontSize:11,color:"#f0c040",fontWeight:"bold",marginBottom:8}}>PAGE SIZE</div>
                  <div style={{display:"flex",gap:6}}>
                    {["A3","A2"].map(function(sz){return(
                      <button key={sz} onClick={function(){setExportPageSize(sz);}} style={Object.assign({},btnBase,{flex:1,padding:"8px",fontSize:11,background:exportPageSize===sz?"#1a3a1a":"#0f0f2a",color:exportPageSize===sz?"#27ae60":"#aaa",border:"1px solid "+(exportPageSize===sz?"#27ae60":"#2a2a5a")})}>
                        {sz}<br/><span style={{fontSize:9,fontWeight:"normal",color:exportPageSize===sz?"#8fbb8f":"#444"}}>{sz==="A3"?"297×420mm":"420×594mm"}</span>
                      </button>
                    );})}
                  </div>
                </div>
                <div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10}}>
                  <div style={{fontSize:11,color:"#f0c040",fontWeight:"bold",marginBottom:8}}>EXPORT QUALITY</div>
                  {DPI_OPTIONS.map(function(opt){var active=exportDPI===opt.dpi;return(<div key={opt.dpi} onClick={function(){setExportDPI(opt.dpi);}} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:active?"#1a3a1a":"#0f0f2a",border:"1px solid "+(active?"#27ae60":"#2a2a5a"),borderRadius:5,padding:"6px 8px",marginBottom:4,cursor:"pointer"}}><span style={{fontSize:11,fontWeight:"bold",color:active?"#27ae60":"#aaa"}}>{opt.label}</span><span style={{fontSize:9,color:active?"#8fbb8f":"#444"}}>{opt.desc}</span>{active&&<span style={{fontSize:9,color:"#27ae60"}}>✓</span>}</div>);})}
                </div>
                <div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10}}>
                  <div style={{fontSize:11,color:"#f0c040",fontWeight:"bold",marginBottom:8}}>GENERATE MAPS</div>
                  {mapTypes.indexOf("sample")>=0&&<button onClick={function(){openMap("sample");}} style={Object.assign({},btnBase,{width:"100%",background:"#1a3a5a",color:"#4a9adf",border:"1px solid #2a5a8a",padding:"10px",fontSize:11,marginBottom:8})}>📄 Sample Location Map<br/><span style={{fontSize:9,fontWeight:"normal",color:"#888"}}>{exportPageSize} · {exportDPI}dpi · opens in new tab</span></button>}
                  {mapTypes.indexOf("geo")>=0&&<button onClick={function(){openMap("geo");}} style={Object.assign({},btnBase,{width:"100%",background:"#2a1a5a",color:"#9b59b6",border:"1px solid #5a2a8a",padding:"10px",fontSize:11,marginBottom:8})}>🪨 Geologic Map<br/><span style={{fontSize:9,fontWeight:"normal",color:"#888"}}>{exportPageSize} · {exportDPI}dpi · with cross-section</span></button>}
                  {mapTypes.indexOf("topo")>=0&&<button onClick={openTopoMap} style={Object.assign({},btnBase,{width:"100%",background:"#1a2e1a",color:"#2e7d32",border:"1px solid #2e7d32",padding:"10px",fontSize:11,marginBottom:8})}>🏔 Topographic Map (MAP 4)<br/><span style={{fontSize:9,fontWeight:"normal",color:"#888"}}>{exportPageSize} · {exportDPI}dpi · {mapLayout==="full"?"Full page":"Panel"} · elevation via OpenTopoData</span></button>}
                  {mapTypes.indexOf("strat")>=0&&<button onClick={openStratColumn} style={Object.assign({},btnBase,{width:"100%",background:"#3a2000",color:"#e67e22",border:"1px solid #e67e22",padding:"10px",fontSize:11})}>📊 Stratigraphic Column (MAP 5)<br/><span style={{fontSize:9,fontWeight:"normal",color:"#888"}}>{exportPageSize} · {exportDPI}dpi · {stratFormations.length} formation{stratFormations.length!==1?"s":""}</span></button>}
                </div>
                <div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10}}>
                  <div style={{fontSize:11,color:"#f0c040",fontWeight:"bold",marginBottom:6}}>GIS EXPORT</div>
                  <div style={{fontSize:9,color:"#555",marginBottom:8}}>Export for QGIS, ArcGIS, Google Earth, or Excel.</div>
                  <button onClick={function(){exportGeoJSON(towns,roads,rivers,samples,geoZones,projStudyArea||"Study_Area");}} style={Object.assign({},btnBase,{width:"100%",background:"#0a2a1a",color:"#27ae60",border:"1px solid #27ae60",padding:"7px",fontSize:10,marginBottom:5})}>⬇ GeoJSON — QGIS / ArcGIS</button>
                  <button onClick={function(){exportKML(towns,roads,rivers,samples,geoZones,projStudyArea||"Study_Area");}} style={Object.assign({},btnBase,{width:"100%",background:"#0a1a2a",color:"#4a9adf",border:"1px solid #4a9adf",padding:"7px",fontSize:10,marginBottom:5})}>⬇ KML — Google Earth</button>
                  <button onClick={function(){exportCSV(samples,projStudyArea||"Study_Area");}} style={Object.assign({},btnBase,{width:"100%",background:"#1a1a0a",color:"#f0c040",border:"1px solid #f0c040",padding:"7px",fontSize:10})}>⬇ CSV — Sample Data (Excel)</button>
                </div>
                <div style={{background:"#0f0f1e",border:"1px dashed #2a2a4a",borderRadius:8,padding:10}}>
                  <div style={{fontSize:10,color:"#444",fontWeight:"bold",marginBottom:4}}>NEXT: SEQUENCE 12</div>
                  <div style={{fontSize:10,color:"#333",lineHeight:1.6}}>AI Field Notes — photo upload, voice input, sketch-to-map.</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showCSVImport&&(<CSVImportPanel onImport={handleCSVImport} onClose={function(){setShowCSVImport(false);}} rockTypes={ROCK_TYPES}/>)}
      <div style={{background:"#0a0a1e",borderTop:"1px solid #2a2a5a",padding:"4px 14px",display:"flex",justifyContent:"space-between",flexShrink:0}}>
        <span style={{fontSize:9,color:"#333"}}>Geo Mapping System v1.0 — Seq 11 CSV Import</span>
        <span style={{fontSize:9,color:"#333"}}>Nigeria · WGS84 · OpenStreetMap · {user?.email}</span>
      </div>
    </div>
  );
}
