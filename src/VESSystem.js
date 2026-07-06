import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { invert, suggestLayerCount, forwardModel, computeRMS } from "./ves_inversion";

var NIGERIA_STATES = ["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","FCT","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara"];
var ARRAY_TYPES = ["Schlumberger","Wenner","Dipole-Dipole"];
var CURVE_TYPES = ["H","A","K","Q","HA","HK","KH","KQ","AK","QH","HKH","KHK"];

var INP = {width:"100%",background:"#1e2e3e",color:"#fff",border:"1px solid #3a5a7a",borderRadius:4,padding:"5px 7px",fontSize:10,boxSizing:"border-box",marginBottom:5};
var SEL = Object.assign({},INP,{cursor:"pointer"});
var LABEL = {fontSize:9,color:"#7ab",marginBottom:2,display:"block"};
var BTN = {border:"none",borderRadius:6,cursor:"pointer",fontFamily:"sans-serif",fontWeight:"bold"};

function computeK(ab2,mn2){if(!ab2||!mn2||isNaN(ab2)||isNaN(mn2)||mn2<=0)return null;return (Math.PI/2)*(ab2*ab2-mn2*mn2)/mn2;}
function computeRhoA(K,R){if(K===null||R===undefined||R===null||R==="")return null;var rho=K*parseFloat(R);return isNaN(rho)?null:rho;}
function detectCurveType(rhoA){
  if(!rhoA||rhoA.length<3)return "";
  var turns=[];
  for(var i=1;i<rhoA.length-1;i++){if(rhoA[i]<rhoA[i-1]&&rhoA[i]<rhoA[i+1])turns.push("min");else if(rhoA[i]>rhoA[i-1]&&rhoA[i]>rhoA[i+1])turns.push("max");}
  var first=rhoA[0],last=rhoA[rhoA.length-1];
  if(turns.length===0){if(last>first)return "A";if(last<first)return "Q";return "";}
  if(turns.length===1){if(turns[0]==="min")return "H";if(turns[0]==="max")return "K";}
  if(turns.length===2){if(turns[0]==="min"&&turns[1]==="max")return "HK";if(turns[0]==="max"&&turns[1]==="min")return "KH";}
  return "";
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
      <div style={{width:360,background:"#12122e",border:"1px solid #1a3a2a",borderRadius:12,padding:32}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
          <div style={{width:40,height:40,background:"#27ae60",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>⚡</div>
          <div><div style={{fontSize:16,fontWeight:"bold",color:"#27ae60"}}>VES Module</div><div style={{fontSize:10,color:"#555"}}>Hydrogeophysics Platform</div></div>
        </div>
        <div style={{display:"flex",gap:4,marginBottom:20}}>{["login","register"].map(function(m){return(<button key={m} onClick={function(){setMode(m);setErr("");setMsg("");}} style={{flex:1,padding:"7px",border:"none",borderRadius:6,cursor:"pointer",fontSize:11,fontWeight:"bold",background:mode===m?"#27ae60":"#1a1a3a",color:mode===m?"#fff":"#666"}}>{m==="login"?"Sign In":"Register"}</button>);})}</div>
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

function VESDashboard({user,onOpen,onSignOut,onBackToModules}){
  var [projects,setProjects]=useState([]);
  var [loading,setLoading]=useState(true);
  var [creating,setCreating]=useState(false);
  var [form,setForm]=useState({name:"",studyArea:"",lga:"",state:"Akwa Ibom"});
  var [deleting,setDeleting]=useState(null);
  useEffect(function(){loadProjects();},[]);
  async function loadProjects(){setLoading(true);var {data,error}=await supabase.from("ves_projects").select("*").order("updated_at",{ascending:false});if(!error)setProjects(data||[]);setLoading(false);}
  async function createProject(){if(!form.studyArea.trim())return;var name=form.name.trim()||form.studyArea.trim();var {data,error}=await supabase.from("ves_projects").insert({user_id:user.id,name,study_area:form.studyArea.trim(),lga:form.lga.trim(),state:form.state}).select().single();if(!error&&data){setCreating(false);setForm({name:"",studyArea:"",lga:"",state:"Akwa Ibom"});onOpen(data);}}
  async function deleteProject(id){await supabase.from("ves_projects").delete().eq("id",id);setDeleting(null);setProjects(function(p){return p.filter(function(x){return x.id!==id;});});}
  function fmtDate(ts){var d=new Date(ts),now=new Date(),diff=Math.floor((now-d)/1000);if(diff<60)return "just now";if(diff<3600)return Math.floor(diff/60)+"m ago";if(diff<86400)return Math.floor(diff/3600)+"h ago";return d.toLocaleDateString();}
  return(
    <div style={{background:"#0d0d1f",height:"100vh",fontFamily:"sans-serif",color:"#eee",display:"flex",flexDirection:"column"}}>
      <div style={{background:"#12122e",borderBottom:"1px solid #1a3a2a",padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:32,height:32,background:"#27ae60",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>⚡</div><div><div style={{fontWeight:"bold",fontSize:14,color:"#27ae60"}}>VES — Vertical Electrical Sounding</div><div style={{fontSize:9,color:"#555"}}>Signed in as {user.email}</div></div></div>
        <div style={{display:"flex",gap:8}}><button onClick={onBackToModules} style={Object.assign({},BTN,{background:"#1a1a3a",color:"#888",border:"1px solid #3a3a6a",padding:"5px 12px",fontSize:10})}>← Modules</button><button onClick={onSignOut} style={Object.assign({},BTN,{background:"#1a1a3a",color:"#888",border:"1px solid #3a3a6a",padding:"5px 12px",fontSize:10})}>Sign Out</button></div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:24,maxWidth:800,margin:"0 auto",width:"100%"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}><div style={{fontSize:18,fontWeight:"bold",color:"#27ae60"}}>VES Projects</div><button onClick={function(){setCreating(true);}} style={Object.assign({},BTN,{background:"#27ae60",color:"#fff",padding:"8px 16px",fontSize:11})}>+ New Project</button></div>
        {creating&&(<div style={{background:"#12122e",border:"1px solid #27ae60",borderRadius:10,padding:16,marginBottom:16}}><div style={{fontSize:11,color:"#27ae60",fontWeight:"bold",marginBottom:12}}>New VES Project</div><div style={{display:"flex",gap:8,marginBottom:8}}><div style={{flex:1}}><div style={LABEL}>Study Area *</div><input value={form.studyArea} onChange={function(e){setForm(function(f){return Object.assign({},f,{studyArea:e.target.value});});}} placeholder="e.g. Ogu Itumbuoso" autoFocus style={Object.assign({},INP,{marginBottom:0})}/></div><div style={{flex:1}}><div style={LABEL}>LGA</div><input value={form.lga} onChange={function(e){setForm(function(f){return Object.assign({},f,{lga:e.target.value});});}} placeholder="e.g. Itu" style={Object.assign({},INP,{marginBottom:0})}/></div></div><div style={{marginBottom:8}}><div style={LABEL}>State</div><select value={form.state} onChange={function(e){setForm(function(f){return Object.assign({},f,{state:e.target.value});});}} style={SEL}>{NIGERIA_STATES.map(function(s){return <option key={s}>{s}</option>;})}</select></div><div style={{marginBottom:12}}><div style={LABEL}>Project Name (optional)</div><input value={form.name} onChange={function(e){setForm(function(f){return Object.assign({},f,{name:e.target.value});});}} onKeyDown={function(e){if(e.key==="Enter")createProject();}} placeholder="Defaults to study area name" style={Object.assign({},INP,{marginBottom:0})}/></div><div style={{display:"flex",gap:8}}><button onClick={createProject} style={Object.assign({},BTN,{flex:1,background:"#27ae60",color:"#fff",padding:"8px",fontSize:11})}>✓ Create Project</button><button onClick={function(){setCreating(false);}} style={Object.assign({},BTN,{background:"#1a1a3a",color:"#888",border:"1px solid #3a3a6a",padding:"8px 14px",fontSize:11})}>Cancel</button></div></div>)}
        {loading?(<div style={{textAlign:"center",padding:40,color:"#555"}}>Loading projects…</div>):projects.length===0?(<div style={{textAlign:"center",padding:60,color:"#333"}}><div style={{fontSize:32,marginBottom:12}}>⚡</div><div style={{fontSize:14,color:"#555",marginBottom:8}}>No VES projects yet</div><div style={{fontSize:11,color:"#333"}}>Create your first project to begin data entry</div></div>):(<div style={{display:"flex",flexDirection:"column",gap:10}}>{projects.map(function(p){return(<div key={p.id} style={{background:"#12122e",border:"1px solid #1a3a2a",borderRadius:10,padding:16,display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={function(){if(deleting!==p.id)onOpen(p);}}><div style={{flex:1}}><div style={{fontSize:13,fontWeight:"bold",color:"#27ae60",marginBottom:2}}>{p.name||p.study_area||"Untitled"}</div>{p.study_area&&<div style={{fontSize:10,color:"#7ab",marginBottom:3}}>{p.study_area}{p.lga?" · "+p.lga:""}{p.state?" · "+p.state+" State":""}</div>}<div style={{fontSize:10,color:"#555"}}>Last saved {fmtDate(p.updated_at)}</div></div><div style={{display:"flex",gap:8,alignItems:"center"}}><button onClick={function(e){e.stopPropagation();onOpen(p);}} style={Object.assign({},BTN,{background:"#1a3a2a",color:"#27ae60",border:"1px solid #2a5a3a",padding:"6px 14px",fontSize:10})}>Open →</button>{deleting===p.id?(<div style={{display:"flex",gap:4}}><button onClick={function(e){e.stopPropagation();deleteProject(p.id);}} style={Object.assign({},BTN,{background:"#3a0a0a",color:"#e74c3c",border:"1px solid #e74c3c",padding:"6px 10px",fontSize:10})}>Delete</button><button onClick={function(e){e.stopPropagation();setDeleting(null);}} style={Object.assign({},BTN,{background:"#1a1a3a",color:"#888",border:"1px solid #3a3a6a",padding:"6px 8px",fontSize:10})}>✕</button></div>):(<button onClick={function(e){e.stopPropagation();setDeleting(p.id);}} style={{background:"transparent",color:"#3a3a6a",border:"none",borderRadius:6,padding:"6px 8px",fontSize:12,cursor:"pointer"}}>🗑</button>)}</div></div>);})}</div>)}
      </div>
    </div>
  );
}

// ── SOUNDING CURVE — with optional theoretical overlay ────────────────────────
function SoundingCurve({readings, stationId, theoretical}){
  var canvasRef=useRef(null);
  var valid=readings.filter(function(r){return r.ab2&&r.rhoA&&!isNaN(r.rhoA)&&r.rhoA>0&&parseFloat(r.ab2)>0;});

  useEffect(function(){
    var canvas=canvasRef.current;if(!canvas)return;
    var ctx=canvas.getContext("2d");
    var W=canvas.width,H=canvas.height;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle="#0a0a1e";ctx.fillRect(0,0,W,H);
    if(valid.length<2){ctx.fillStyle="#444";ctx.font="11px sans-serif";ctx.textAlign="center";ctx.fillText("Enter at least 2 valid readings to plot the curve",W/2,H/2);ctx.textAlign="left";return;}
    var ML=56,MR=16,MT=20,MB=44;
    var PW=W-ML-MR,PH=H-MT-MB;
    var ab2vals=valid.map(function(r){return parseFloat(r.ab2);});
    var rhovals=valid.map(function(r){return r.rhoA;});
    var allRho=theoretical&&theoretical.length>0?rhovals.concat(theoretical):rhovals;
    var minAB=Math.min.apply(null,ab2vals),maxAB=Math.max.apply(null,ab2vals);
    var minRho=Math.min.apply(null,allRho),maxRho=Math.max.apply(null,allRho);
    var logMinAB=Math.floor(Math.log10(minAB*0.8)),logMaxAB=Math.ceil(Math.log10(maxAB*1.2));
    var logMinRho=Math.floor(Math.log10(minRho*0.7)),logMaxRho=Math.ceil(Math.log10(maxRho*1.4));
    function xPos(v){return ML+((Math.log10(v)-logMinAB)/(logMaxAB-logMinAB))*PW;}
    function yPos(v){return MT+PH-((Math.log10(v)-logMinRho)/(logMaxRho-logMinRho))*PH;}
    // Grid
    ctx.strokeStyle="rgba(255,255,255,0.06)";ctx.lineWidth=0.5;ctx.font="8px sans-serif";ctx.fillStyle="#555";
    for(var lx=logMinAB;lx<=logMaxAB;lx++){for(var sub=1;sub<10;sub++){var v=sub*Math.pow(10,lx);if(v<Math.pow(10,logMinAB)||v>Math.pow(10,logMaxAB))continue;var x=xPos(v);ctx.beginPath();ctx.moveTo(x,MT);ctx.lineTo(x,MT+PH);ctx.stroke();if(sub===1){ctx.textAlign="center";ctx.fillText(v>=1000?(v/1000)+"k":v,x,MT+PH+13);}}}
    for(var ly=logMinRho;ly<=logMaxRho;ly++){for(var sub2=1;sub2<10;sub2++){var v2=sub2*Math.pow(10,ly);if(v2<Math.pow(10,logMinRho)||v2>Math.pow(10,logMaxRho))continue;var y=yPos(v2);ctx.beginPath();ctx.moveTo(ML,y);ctx.lineTo(ML+PW,y);ctx.stroke();if(sub2===1){ctx.textAlign="right";ctx.fillText(v2>=1000?(v2/1000)+"k":v2,ML-4,y+3);}}}
    // Axes
    ctx.strokeStyle="#27ae60";ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(ML,MT);ctx.lineTo(ML,MT+PH);ctx.lineTo(ML+PW,MT+PH);ctx.stroke();
    // Labels
    ctx.fillStyle="#888";ctx.font="9px sans-serif";ctx.textAlign="center";ctx.fillText("AB/2  (m)",ML+PW/2,H-6);
    ctx.save();ctx.translate(11,MT+PH/2);ctx.rotate(-Math.PI/2);ctx.fillText("\u03c1a  (\u03a9\u00b7m)",0,0);ctx.restore();
    ctx.fillStyle="#27ae60";ctx.font="bold 9px sans-serif";ctx.textAlign="left";ctx.fillText(stationId||"VES",ML+4,MT+13);
    // Theoretical curve overlay (dashed orange)
    if(theoretical&&theoretical.length===valid.length){
      ctx.strokeStyle="#e67e22";ctx.lineWidth=1.8;ctx.setLineDash([6,3]);
      ctx.beginPath();
      valid.forEach(function(r,i){
        if(!theoretical[i]||theoretical[i]<=0)return;
        var x=xPos(parseFloat(r.ab2)),y=yPos(theoretical[i]);
        if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      });
      ctx.stroke();ctx.setLineDash([]);
    }
    // Field curve (solid green)
    ctx.strokeStyle="#27ae60";ctx.lineWidth=2;
    ctx.beginPath();valid.forEach(function(r,i){var x=xPos(parseFloat(r.ab2)),y=yPos(r.rhoA);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
    // Points
    valid.forEach(function(r){var x=xPos(parseFloat(r.ab2)),y=yPos(r.rhoA);ctx.fillStyle="#27ae60";ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#0a0a1e";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.stroke();});
    // Legend if theoretical shown
    if(theoretical&&theoretical.length===valid.length){
      ctx.fillStyle="rgba(10,10,30,0.85)";ctx.fillRect(ML+4,MT+20,130,32);
      ctx.strokeStyle="#27ae60";ctx.lineWidth=2;ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(ML+10,MT+32);ctx.lineTo(ML+30,MT+32);ctx.stroke();
      ctx.fillStyle="#27ae60";ctx.font="8px sans-serif";ctx.textAlign="left";ctx.fillText("Field curve",ML+33,MT+35);
      ctx.strokeStyle="#e67e22";ctx.lineWidth=1.8;ctx.setLineDash([5,3]);ctx.beginPath();ctx.moveTo(ML+10,MT+44);ctx.lineTo(ML+30,MT+44);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle="#e67e22";ctx.fillText("Theoretical",ML+33,MT+47);
    }
  },[valid,stationId,theoretical]);
  return(<canvas ref={canvasRef} width={520} height={300} style={{width:"100%",height:"auto",borderRadius:6,border:"1px solid #1a3a2a",display:"block"}}/>);
}

function DarZarrouk({layers}){
  if(!layers||layers.length===0)return null;
  var rows=layers.map(function(l,i){var h=parseFloat(l.thickness),rho=parseFloat(l.resistivity);var S=(!isNaN(h)&&!isNaN(rho)&&rho>0)?h/rho:null;var T=(!isNaN(h)&&!isNaN(rho))?h*rho:null;return{layer:i+1,h,rho,S,T,interp:l.interpretation||""};});
  var totalS=rows.reduce(function(s,r){return s+(r.S||0);},0);
  var totalT=rows.reduce(function(s,r){return s+(r.T||0);},0);
  return(
    <div style={{background:"#0a1a0a",border:"1px solid #1a3a2a",borderRadius:8,padding:10}}>
      <div style={{fontSize:11,color:"#27ae60",fontWeight:"bold",marginBottom:8}}>Dar Zarrouk Parameters</div>
      <div style={{overflowX:"auto"}}>
        <table style={{borderCollapse:"collapse",width:"100%",fontSize:9}}>
          <thead><tr style={{background:"#12122e"}}>{["Layer","h (m)","\u03c1 (\u03a9\u00b7m)","S = h/\u03c1","T = h\u00b7\u03c1","Interpretation"].map(function(h){return <th key={h} style={{padding:"4px 6px",textAlign:"left",color:"#7ab",borderBottom:"1px solid #1a3a2a",whiteSpace:"nowrap"}}>{h}</th>;})}</tr></thead>
          <tbody>{rows.map(function(r){return(<tr key={r.layer} style={{borderBottom:"1px solid #0d1a0d"}}><td style={{padding:"4px 6px",color:"#27ae60",fontWeight:"bold"}}>{r.layer}</td><td style={{padding:"4px 6px",color:"#eee",fontFamily:"monospace"}}>{isNaN(r.h)?"—":r.h}</td><td style={{padding:"4px 6px",color:"#eee",fontFamily:"monospace"}}>{isNaN(r.rho)?"—":r.rho}</td><td style={{padding:"4px 6px",color:"#4a9adf",fontFamily:"monospace"}}>{r.S!==null?r.S.toFixed(4):"—"}</td><td style={{padding:"4px 6px",color:"#e67e22",fontFamily:"monospace"}}>{r.T!==null?r.T.toFixed(1):"—"}</td><td style={{padding:"4px 6px",color:"#888"}}>{r.interp}</td></tr>);})}</tbody>
          <tfoot><tr style={{background:"#12122e",borderTop:"2px solid #27ae60"}}><td colSpan={3} style={{padding:"4px 6px",color:"#f0c040",fontWeight:"bold",fontSize:9}}>TOTAL</td><td style={{padding:"4px 6px",color:"#4a9adf",fontWeight:"bold",fontFamily:"monospace"}}>{totalS.toFixed(4)}</td><td style={{padding:"4px 6px",color:"#e67e22",fontWeight:"bold",fontFamily:"monospace"}}>{totalT.toFixed(1)}</td><td/></tr></tfoot>
        </table>
      </div>
      <div style={{fontSize:8,color:"#444",marginTop:6,lineHeight:1.6}}>S = Longitudinal Conductance · T = Transverse Resistance</div>
    </div>
  );
}

function StationEditor({station,onBack}){
  var [stationId,setStationId]=useState(station.station_id||"");
  var [lat,setLat]=useState(station.lat||"");
  var [lon,setLon]=useState(station.lon||"");
  var [elevation,setElevation]=useState(station.elevation||"");
  var [arrayType,setArrayType]=useState(station.array_type||"Schlumberger");
  var [notes,setNotes]=useState(station.notes||"");
  var [curveType,setCurveType]=useState(station.curve_type||"");
  var [readings,setReadings]=useState(function(){return(station.readings||[]).map(function(r){var K=computeK(parseFloat(r.ab2),parseFloat(r.mn2));var rhoA=computeRhoA(K,parseFloat(r.R));return Object.assign({},r,{K,rhoA});});});
  var [layers,setLayers]=useState(station.layer_model||[]);
  var [layerCount,setLayerCount]=useState(station.layer_model&&station.layer_model.length>0?station.layer_model.length:3);
  var [tab,setTab]=useState("data");
  var [saving,setSaving]=useState(false);
  var [saveMsg,setSaveMsg]=useState("");
  // Inversion state
  var [invertRunning,setInvertRunning]=useState(false);
  var [invertResult,setInvertResult]=useState(null);
  var [invertError,setInvertError]=useState("");
  var [suggestedLayers,setSuggestedLayers]=useState(null);
  var [userLayerCount,setUserLayerCount]=useState(null);

  var validReadings=readings.filter(function(r){return r.ab2&&r.rhoA&&!isNaN(r.rhoA)&&r.rhoA>0&&parseFloat(r.ab2)>0;});
  var validRhoA=validReadings.map(function(r){return r.rhoA;});
  var detectedCurve=detectCurveType(validRhoA);

  // Run Layer Count Assist when entering inversion tab
  function handleInversionTabEnter(){
    setTab("inversion");
    if(validRhoA.length>=3){
      var s=suggestLayerCount(validRhoA);
      setSuggestedLayers(s);
      if(userLayerCount===null)setUserLayerCount(s.count);
    }
  }

  async function runInversion(){
    if(validReadings.length<3){setInvertError("Need at least 3 valid readings to run inversion.");return;}
    setInvertRunning(true);setInvertError("");setInvertResult(null);
    var ab2vals=validReadings.map(function(r){return parseFloat(r.ab2);});
    var fieldRhoA=validReadings.map(function(r){return r.rhoA;});
    var nLayers=userLayerCount||3;
    try{
      // Run in a timeout to allow UI to update first
      await new Promise(function(resolve){setTimeout(resolve,50);});
      var result=invert(ab2vals,fieldRhoA,nLayers,60,null);
      setInvertResult(result);
    }catch(e){
      setInvertError("Inversion failed: "+e.message);
    }
    setInvertRunning(false);
  }

  function applyInversionToLayers(){
    if(!invertResult)return;
    var newLayers=invertResult.resistivities.map(function(rho,i){
      var isLast=i===invertResult.resistivities.length-1;
      var rhoVal=Math.round(rho*10)/10;
      var hVal=invertResult.thicknesses[i]?Math.round(invertResult.thicknesses[i]*10)/10:null;
      var badge=rhoVal<50?"Saturated / Clay":rhoVal<200?"Weathered layer / Aquifer":rhoVal<1000?"Fractured rock":"Fresh basement";
      return{
        thickness:isLast?"":String(hVal||""),
        resistivity:String(rhoVal),
        interpretation:badge
      };
    });
    setLayers(newLayers);
    setLayerCount(newLayers.length);
    setTab("layers");
  }

  function addRow(){setReadings(function(p){return p.concat([{ab2:"",mn2:"",R:"",K:null,rhoA:null}]);});}
  function removeRow(i){setReadings(function(p){return p.filter(function(_,idx){return idx!==i;});});}
  function updateRow(i,field,val){
    setReadings(function(prev){return prev.map(function(r,idx){
      if(idx!==i)return r;
      var next=Object.assign({},r,{[field]:val});
      var ab2=parseFloat(field==="ab2"?val:next.ab2);
      var mn2=parseFloat(field==="mn2"?val:next.mn2);
      var R=field==="R"?val:next.R;
      var K=computeK(ab2,mn2);var rhoA=computeRhoA(K,parseFloat(R));
      next.K=K;next.rhoA=rhoA;return next;
    });});
  }
  function updateLayer(i,field,val){setLayers(function(p){return p.map(function(l,idx){return idx===i?Object.assign({},l,{[field]:val}):l;});});}
  function applyLayerCount(n){setLayerCount(n);setLayers(function(prev){var next=[];for(var i=0;i<n;i++){next.push(prev[i]||{thickness:"",resistivity:"",interpretation:""});}return next;});}
  async function handleSave(){
    setSaving(true);setSaveMsg("");
    var cleanReadings=readings.map(function(r){return{ab2:r.ab2,mn2:r.mn2,R:r.R,K:r.K,rhoA:r.rhoA};});
    var {error}=await supabase.from("ves_stations").update({station_id:stationId,lat:lat||null,lon:lon||null,elevation:elevation||null,array_type:arrayType,notes,curve_type:curveType||detectedCurve,readings:cleanReadings,layer_model:layers}).eq("id",station.id);
    setSaving(false);
    if(error){setSaveMsg("Save failed: "+error.message);}else{setSaveMsg("Saved \u2713");setTimeout(function(){setSaveMsg("");},2000);}
  }

  var TABS=[
    {key:"data",label:"📋 Readings",onClick:function(){setTab("data");}},
    {key:"curve",label:"📈 Curve",onClick:function(){setTab("curve");}},
    {key:"inversion",label:"⚙ Inversion",onClick:handleInversionTabEnter},
    {key:"layers",label:"🪨 Layer Model",onClick:function(){setTab("layers");}},
    {key:"dz",label:"📊 Dar Zarrouk",onClick:function(){setTab("dz");}}
  ];

  // Theoretical curve for overlay (from inversion result)
  var theoreticalOverlay=invertResult&&invertResult.theoretical&&invertResult.theoretical.length===validReadings.length?invertResult.theoretical:null;

  return(
    <div style={{background:"#0d0d1f",height:"100vh",fontFamily:"sans-serif",color:"#eee",display:"flex",flexDirection:"column"}}>
      <div style={{background:"#12122e",borderBottom:"1px solid #1a3a2a",padding:"8px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:28,height:28,background:"#27ae60",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>⚡</div><div><div style={{fontWeight:"bold",fontSize:13,color:"#27ae60"}}>{stationId||"New Station"}</div><div style={{fontSize:9,color:"#555"}}>VES Station · {arrayType}</div></div></div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          {saveMsg&&<div style={{fontSize:9,color:"#27ae60",border:"1px solid #27ae60",borderRadius:10,padding:"2px 8px"}}>{saveMsg}</div>}
          <button onClick={handleSave} disabled={saving} style={Object.assign({},BTN,{background:"#1a4a2a",color:"#27ae60",border:"1px solid #27ae60",padding:"5px 12px",fontSize:10})}>{saving?"Saving…":"💾 Save"}</button>
          <button onClick={onBack} style={Object.assign({},BTN,{background:"#1a1a3a",color:"#888",border:"1px solid #3a3a6a",padding:"5px 12px",fontSize:10})}>← Stations</button>
        </div>
      </div>

      <div style={{background:"#0a0a1e",borderBottom:"1px solid #1a1a3a",padding:"8px 14px",display:"flex",gap:10,flexShrink:0,flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:90}}><div style={LABEL}>Station ID</div><input value={stationId} onChange={function(e){setStationId(e.target.value);}} placeholder="e.g. VES-01" style={Object.assign({},INP,{marginBottom:0})}/></div>
        <div style={{flex:1,minWidth:80}}><div style={LABEL}>Latitude</div><input value={lat} onChange={function(e){setLat(e.target.value);}} placeholder="5.3241" style={Object.assign({},INP,{marginBottom:0})}/></div>
        <div style={{flex:1,minWidth:80}}><div style={LABEL}>Longitude</div><input value={lon} onChange={function(e){setLon(e.target.value);}} placeholder="7.4112" style={Object.assign({},INP,{marginBottom:0})}/></div>
        <div style={{flex:1,minWidth:70}}><div style={LABEL}>Elevation (m)</div><input value={elevation} onChange={function(e){setElevation(e.target.value);}} placeholder="45" style={Object.assign({},INP,{marginBottom:0})}/></div>
        <div style={{flex:1,minWidth:120}}><div style={LABEL}>Array Type</div><select value={arrayType} onChange={function(e){setArrayType(e.target.value);}} style={Object.assign({},SEL,{marginBottom:0})}>{ARRAY_TYPES.map(function(a){return <option key={a}>{a}</option>;})}</select></div>
        <div style={{flex:1,minWidth:100}}><div style={LABEL}>Curve Type <span style={{color:"#27ae60"}}>{detectedCurve?"("+detectedCurve+")":""}</span></div><select value={curveType||detectedCurve} onChange={function(e){setCurveType(e.target.value);}} style={Object.assign({},SEL,{marginBottom:0})}><option value="">— auto —</option>{CURVE_TYPES.map(function(c){return <option key={c}>{c}</option>;})}</select></div>
      </div>

      <div style={{display:"flex",borderBottom:"1px solid #1a1a3a",background:"#0a0a1e",flexShrink:0}}>
        {TABS.map(function(t){return(<button key={t.key} onClick={t.onClick} style={Object.assign({},BTN,{padding:"8px 12px",fontSize:10,background:"transparent",color:tab===t.key?"#27ae60":"#555",borderRadius:0,borderBottom:tab===t.key?"2px solid #27ae60":"2px solid transparent",fontWeight:tab===t.key?"bold":"normal"})}>{t.label}</button>);})}
      </div>

      <div style={{flex:1,overflowY:"auto",padding:14}}>

        {tab==="data"&&(
          <div>
            <div style={{fontSize:10,color:"#888",marginBottom:10,lineHeight:1.7}}>Enter field readings. K and ρa computed automatically.<br/><span style={{color:"#27ae60",fontFamily:"monospace",fontSize:9}}>K = π × [(AB/2)² − (MN/2)²] / MN</span>{"  ·  "}<span style={{color:"#4a9adf",fontFamily:"monospace",fontSize:9}}>ρa = K × R</span></div>
            <div style={{overflowX:"auto"}}>
              <table style={{borderCollapse:"collapse",fontSize:10,minWidth:480}}>
                <thead><tr style={{background:"#12122e"}}>{["#","AB/2 (m)","MN/2 (m)","R (Ω)","K","ρa (Ω·m)",""].map(function(h,i){return <th key={i} style={{padding:"6px 8px",textAlign:"left",color:"#7ab",borderBottom:"1px solid #1a3a2a",whiteSpace:"nowrap",fontSize:9}}>{h}</th>;})}</tr></thead>
                <tbody>{readings.map(function(r,i){var hasRho=r.rhoA!==null&&!isNaN(r.rhoA)&&r.rhoA>0;return(<tr key={i} style={{borderBottom:"1px solid #0d0d1a",background:i%2===0?"#0a0a18":"transparent"}}><td style={{padding:"4px 8px",color:"#555",fontSize:9}}>{i+1}</td><td style={{padding:"3px 4px"}}><input value={r.ab2} onChange={function(e){updateRow(i,"ab2",e.target.value);}} placeholder="e.g. 1" type="number" min="0" style={{width:72,background:"#1e2e3e",color:"#fff",border:"1px solid #2a4a6a",borderRadius:3,padding:"3px 5px",fontSize:10}}/></td><td style={{padding:"3px 4px"}}><input value={r.mn2} onChange={function(e){updateRow(i,"mn2",e.target.value);}} placeholder="e.g. 0.5" type="number" min="0" style={{width:72,background:"#1e2e3e",color:"#fff",border:"1px solid #2a4a6a",borderRadius:3,padding:"3px 5px",fontSize:10}}/></td><td style={{padding:"3px 4px"}}><input value={r.R} onChange={function(e){updateRow(i,"R",e.target.value);}} placeholder="e.g. 45.2" type="number" min="0" style={{width:80,background:"#1e2e3e",color:"#fff",border:"1px solid #2a4a6a",borderRadius:3,padding:"3px 5px",fontSize:10}}/></td><td style={{padding:"4px 8px",color:"#888",fontFamily:"monospace",fontSize:9,whiteSpace:"nowrap"}}>{r.K!==null&&!isNaN(r.K)?r.K.toFixed(2):"—"}</td><td style={{padding:"4px 8px",fontFamily:"monospace",fontSize:10,fontWeight:"bold",whiteSpace:"nowrap",color:hasRho?"#27ae60":"#444"}}>{hasRho?r.rhoA.toFixed(2):"—"}</td><td style={{padding:"3px 4px"}}><button onClick={function(){removeRow(i);}} style={{background:"none",border:"none",color:"#e74c3c",cursor:"pointer",fontSize:12,padding:"2px 4px"}}>✕</button></td></tr>);})}</tbody>
              </table>
            </div>
            <button onClick={addRow} style={Object.assign({},BTN,{background:"#1a2e1a",color:"#27ae60",border:"1px solid #27ae60",padding:"7px 14px",fontSize:10,marginTop:10})}>+ Add Reading</button>
            {validReadings.length>0&&(<div style={{marginTop:12,background:"#0a1a0a",border:"1px solid #1a3a2a",borderRadius:6,padding:"8px 12px"}}><div style={{fontSize:9,color:"#7ab",marginBottom:4}}>SUMMARY</div><div style={{display:"flex",gap:20,flexWrap:"wrap"}}><div><span style={{fontSize:9,color:"#555"}}>Valid readings: </span><span style={{fontSize:11,color:"#27ae60",fontWeight:"bold"}}>{validReadings.length}</span></div><div><span style={{fontSize:9,color:"#555"}}>AB/2: </span><span style={{fontSize:11,color:"#eee"}}>{Math.min.apply(null,validReadings.map(function(r){return parseFloat(r.ab2);}))} – {Math.max.apply(null,validReadings.map(function(r){return parseFloat(r.ab2);}))} m</span></div><div><span style={{fontSize:9,color:"#555"}}>Detected: </span><span style={{fontSize:11,color:"#f0c040",fontWeight:"bold"}}>{detectedCurve||"—"}</span></div>{detectedCurve==="H"&&<span style={{fontSize:9,color:"#27ae60"}}>✓ Aquifer signature</span>}</div></div>)}
            <div style={{marginTop:10,background:"#0a0a1e",border:"1px dashed #1a1a3a",borderRadius:6,padding:"8px 12px"}}><div style={{fontSize:9,color:"#555",lineHeight:1.7}}><strong style={{color:"#7ab"}}>Field note:</strong> Shift MN when AB/2 exceeds 5 × MN/2. Enter the new MN/2 from that row onward — each row calculates independently.</div></div>
          </div>
        )}

        {tab==="curve"&&(
          <div>
            <div style={{fontSize:10,color:"#888",marginBottom:10}}>Log-log sounding curve. {invertResult?"Orange dashed = theoretical model fit.":""}</div>
            <SoundingCurve readings={readings} stationId={stationId} theoretical={theoreticalOverlay}/>
            {invertResult&&(<div style={{marginTop:8,background:"#0a1a0a",border:"1px solid #1a3a2a",borderRadius:6,padding:"8px 12px"}}><div style={{display:"flex",gap:16,flexWrap:"wrap"}}><div><span style={{fontSize:9,color:"#555"}}>RMS Error: </span><span style={{fontSize:12,fontWeight:"bold",color:invertResult.rms<5?"#27ae60":invertResult.rms<15?"#f0c040":"#e74c3c"}}>{invertResult.rms.toFixed(1)}%</span></div><div><span style={{fontSize:9,color:"#555"}}>Fit: </span><span style={{fontSize:11,color:invertResult.converged?"#27ae60":"#f0c040"}}>{invertResult.converged?"Good":"Check layer count"}</span></div></div></div>)}
            {detectedCurve&&(<div style={{marginTop:10,background:"#0a1a0a",border:"1px solid #1a3a2a",borderRadius:6,padding:"8px 12px"}}><div style={{fontSize:10,color:"#27ae60",fontWeight:"bold",marginBottom:4}}>Curve Type: {detectedCurve}</div><div style={{fontSize:9,color:"#888",lineHeight:1.7}}>{detectedCurve==="H"&&"ρ₁ > ρ₂ < ρ₃ — Low-resistivity middle layer. Classic aquifer signature."}{detectedCurve==="A"&&"ρ₁ < ρ₂ < ρ₃ — Resistivity increases with depth."}{detectedCurve==="K"&&"ρ₁ < ρ₂ > ρ₃ — High-resistivity middle layer."}{detectedCurve==="Q"&&"ρ₁ > ρ₂ > ρ₃ — Decreasing resistivity with depth."}{detectedCurve==="HK"&&"Two-bend HK curve — 4 layers."}{detectedCurve==="KH"&&"Two-bend KH — aquifer below K peak."}{!["H","A","K","Q","HK","KH"].includes(detectedCurve)&&"Complex curve — consider 4–5 layer model."}</div></div>)}
          </div>
        )}

        {tab==="inversion"&&(
          <div>
            <div style={{fontSize:10,color:"#888",marginBottom:12,lineHeight:1.7}}>The platform analyses your sounding curve and fits a layer model automatically using least-squares inversion.</div>

            {/* Layer Count Assist */}
            {suggestedLayers&&(
              <div style={{background:"#0a1a0a",border:"1px solid #27ae60",borderRadius:8,padding:12,marginBottom:14}}>
                <div style={{fontSize:11,color:"#27ae60",fontWeight:"bold",marginBottom:6}}>⚡ Layer Count Assist</div>
                <div style={{fontSize:10,color:"#eee",marginBottom:4}}>{suggestedLayers.reason}</div>
                <div style={{fontSize:9,color:"#555",marginBottom:10}}>{suggestedLayers.turns} inflection point{suggestedLayers.turns!==1?"s":""} detected · Curve type: <strong style={{color:"#f0c040"}}>{suggestedLayers.curveType||"undetermined"}</strong></div>
                <div style={{fontSize:10,color:"#7ab",marginBottom:6}}>Confirm or adjust layer count before running:</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                  {[2,3,4,5,6].map(function(n){return(<button key={n} onClick={function(){setUserLayerCount(n);}} style={Object.assign({},BTN,{padding:"6px 14px",fontSize:11,background:userLayerCount===n?"#27ae60":"#1a1a3a",color:userLayerCount===n?"#fff":"#888",border:"1px solid "+(userLayerCount===n?"#27ae60":"#3a3a6a")})}>{n}{n===suggestedLayers.count?" ✓":""}</button>);})}
                  <span style={{fontSize:9,color:"#444",marginLeft:4}}>✓ = suggested</span>
                </div>
              </div>
            )}

            {validReadings.length<3&&(
              <div style={{background:"#2a1a0a",border:"1px solid #e67e22",borderRadius:6,padding:"10px 12px",marginBottom:12}}>
                <div style={{fontSize:10,color:"#e67e22"}}>⚠ Need at least 3 valid readings — go to the Readings tab and enter your data first.</div>
              </div>
            )}

            <button onClick={runInversion} disabled={invertRunning||validReadings.length<3}
              style={Object.assign({},BTN,{width:"100%",background:invertRunning?"#1a1a3a":validReadings.length<3?"#111":"#27ae60",color:invertRunning||validReadings.length<3?"#444":"#fff",padding:"12px",fontSize:12,marginBottom:12})}>
              {invertRunning?"⟳ Running inversion…":"⚙ Run Inversion ("+( userLayerCount||3)+" layers)"}
            </button>

            {invertError&&(<div style={{background:"#2a0a0a",border:"1px solid #e74c3c",borderRadius:6,padding:"8px 10px",marginBottom:10,fontSize:9,color:"#ffaaaa"}}>{invertError}</div>)}

            {invertResult&&(
              <div>
                <div style={{background:"#0a1a0a",border:"1px solid #1a3a2a",borderRadius:8,padding:12,marginBottom:10}}>
                  <div style={{fontSize:11,color:"#27ae60",fontWeight:"bold",marginBottom:8}}>Inversion Result</div>
                  <div style={{display:"flex",gap:16,marginBottom:10,flexWrap:"wrap"}}>
                    <div><span style={{fontSize:9,color:"#555"}}>RMS Error: </span><span style={{fontSize:14,fontWeight:"bold",color:invertResult.rms<5?"#27ae60":invertResult.rms<15?"#f0c040":"#e74c3c"}}>{invertResult.rms.toFixed(1)}%</span></div>
                    <div><span style={{fontSize:9,color:"#555"}}>Fit quality: </span><span style={{fontSize:11,color:invertResult.rms<5?"#27ae60":invertResult.rms<15?"#f0c040":"#e74c3c"}}>{invertResult.rms<5?"Excellent":invertResult.rms<10?"Good":invertResult.rms<20?"Fair":"Poor — try different layer count"}</span></div>
                  </div>
                  <table style={{borderCollapse:"collapse",width:"100%",fontSize:10,marginBottom:8}}>
                    <thead><tr style={{background:"#12122e"}}>{["Layer","Thickness (m)","True ρ (Ω·m)","Interpretation"].map(function(h){return <th key={h} style={{padding:"4px 8px",textAlign:"left",color:"#7ab",borderBottom:"1px solid #1a3a2a",fontSize:9}}>{h}</th>;})}</tr></thead>
                    <tbody>{invertResult.resistivities.map(function(rho,i){
                      var isLast=i===invertResult.resistivities.length-1;
                      var h=invertResult.thicknesses[i];
                      var rhoRound=Math.round(rho*10)/10;
                      var hRound=h?Math.round(h*10)/10:null;
                      var badge=rhoRound<50?"Saturated / Clay":rhoRound<200?"Weathered / Aquifer":rhoRound<1000?"Fractured Rock":"Fresh Basement";
                      var badgeColor=rhoRound<50?"#4a9adf":rhoRound<200?"#27ae60":rhoRound<1000?"#f0c040":"#e74c3c";
                      return(<tr key={i} style={{borderBottom:"1px solid #0d0d1a",background:i%2===0?"#0a0a18":"transparent"}}><td style={{padding:"4px 8px",color:"#27ae60",fontWeight:"bold"}}>Layer {i+1}</td><td style={{padding:"4px 8px",color:"#eee",fontFamily:"monospace"}}>{isLast?"∞":hRound!==null?hRound+" m":"—"}</td><td style={{padding:"4px 8px",color:"#eee",fontFamily:"monospace"}}>{rhoRound} Ω·m</td><td style={{padding:"4px 8px"}}><span style={{fontSize:8,padding:"2px 5px",borderRadius:3,background:"#0a0a1a",color:badgeColor,border:"1px solid "+badgeColor}}>{badge}</span></td></tr>);
                    })}</tbody>
                  </table>
                  {invertResult.rms>20&&(<div style={{fontSize:9,color:"#f0c040",marginBottom:8,lineHeight:1.6}}>⚠ High RMS — try a different layer count above, or check your field readings for outliers.</div>)}
                  <button onClick={applyInversionToLayers} style={Object.assign({},BTN,{width:"100%",background:"#1a3a5a",color:"#4a9adf",border:"1px solid #2a5a8a",padding:"9px",fontSize:11})}>→ Apply to Layer Model tab</button>
                </div>
                <div style={{fontSize:9,color:"#555",lineHeight:1.7,background:"#0a0a1e",border:"1px dashed #1a1a3a",borderRadius:6,padding:"8px 12px"}}>The theoretical curve is now overlaid on the Curve tab. Switch there to compare the fit visually against your field data.</div>
              </div>
            )}
          </div>
        )}

        {tab==="layers"&&(
          <div>
            <div style={{fontSize:10,color:"#888",marginBottom:10,lineHeight:1.7}}>Enter or review the layer model. Auto-populated from inversion if you ran it.</div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,background:"#0a1a0a",border:"1px solid #1a3a2a",borderRadius:6,padding:"10px 12px",flexWrap:"wrap"}}>
              <div style={{fontSize:10,color:"#7ab"}}>Layers:</div>
              {[2,3,4,5,6].map(function(n){return(<button key={n} onClick={function(){applyLayerCount(n);}} style={Object.assign({},BTN,{padding:"5px 12px",fontSize:11,background:layerCount===n?"#27ae60":"#1a1a3a",color:layerCount===n?"#fff":"#888",border:"1px solid "+(layerCount===n?"#27ae60":"#3a3a6a")})}>{n}</button>);})}
              {detectedCurve&&<div style={{fontSize:9,color:"#444",marginLeft:4}}>Curve suggests: {detectedCurve.length+2}</div>}
            </div>
            <table style={{borderCollapse:"collapse",width:"100%",fontSize:10}}>
              <thead><tr style={{background:"#12122e"}}>{["Layer","Thickness (m)","True ρ (Ω·m)","Interpretation",""].map(function(h,i){return <th key={i} style={{padding:"6px 8px",textAlign:"left",color:"#7ab",borderBottom:"1px solid #1a3a2a",fontSize:9}}>{h}</th>;})}</tr></thead>
              <tbody>{layers.map(function(l,i){var isLast=i===layers.length-1;var rhoVal=parseFloat(l.resistivity);var badge=!isNaN(rhoVal)?(rhoVal<50?"Saturated/Clay":rhoVal<200?"Weathered/Aquifer":rhoVal<1000?"Fractured Rock":"Fresh Basement"):null;var badgeColor=!isNaN(rhoVal)?(rhoVal<50?"#4a9adf":rhoVal<200?"#27ae60":rhoVal<1000?"#f0c040":"#e74c3c"):null;return(<tr key={i} style={{borderBottom:"1px solid #0d0d1a",background:i%2===0?"#0a0a18":"transparent"}}><td style={{padding:"4px 8px",color:"#27ae60",fontWeight:"bold",fontSize:10,whiteSpace:"nowrap"}}>Layer {i+1}{isLast?" (basement)":""}</td><td style={{padding:"3px 4px"}}>{isLast?<span style={{padding:"3px 8px",fontSize:10,color:"#555"}}>∞</span>:<input value={l.thickness||""} onChange={function(e){updateLayer(i,"thickness",e.target.value);}} placeholder="e.g. 4.2" type="number" min="0" style={{width:90,background:"#1e2e3e",color:"#fff",border:"1px solid #2a4a6a",borderRadius:3,padding:"3px 5px",fontSize:10}}/>}</td><td style={{padding:"3px 4px"}}><input value={l.resistivity||""} onChange={function(e){updateLayer(i,"resistivity",e.target.value);}} placeholder="e.g. 320" type="number" min="0" style={{width:90,background:"#1e2e3e",color:"#fff",border:"1px solid #2a4a6a",borderRadius:3,padding:"3px 5px",fontSize:10}}/></td><td style={{padding:"3px 4px"}}><input value={l.interpretation||""} onChange={function(e){updateLayer(i,"interpretation",e.target.value);}} placeholder="e.g. Weathered basement / Aquifer" style={{width:190,background:"#1e2e3e",color:"#fff",border:"1px solid #2a4a6a",borderRadius:3,padding:"3px 5px",fontSize:10}}/></td><td style={{padding:"4px 8px"}}>{badge&&<span style={{fontSize:8,padding:"2px 5px",borderRadius:3,background:"#0a0a1a",color:badgeColor,border:"1px solid "+badgeColor}}>{badge}</span>}</td></tr>);})}</tbody>
            </table>
            <div style={{marginTop:10,background:"#0a0a1e",border:"1px dashed #1a1a3a",borderRadius:6,padding:"8px 12px"}}><div style={{fontSize:9,color:"#555",lineHeight:1.7}}><strong style={{color:"#7ab"}}>Tip:</strong> Run the Inversion tab to auto-populate this table from the curve fit. The last layer (basement) has infinite thickness by convention.</div></div>
          </div>
        )}

        {tab==="dz"&&(
          <div>
            <div style={{fontSize:10,color:"#888",marginBottom:10}}>Computed from your layer model.</div>
            {layers.length===0?(<div style={{textAlign:"center",padding:30,color:"#444",fontSize:11}}>No layer model yet — run inversion or fill the Layer Model tab first.</div>):<DarZarrouk layers={layers}/>}
            {layers.length>0&&(
              <div style={{marginTop:12,background:"#0a1a0a",border:"1px solid #1a3a2a",borderRadius:6,padding:"10px 12px"}}>
                <div style={{fontSize:10,color:"#27ae60",fontWeight:"bold",marginBottom:6}}>Aquifer Potential Assessment</div>
                {(function(){var totalS=layers.reduce(function(s,l){var h=parseFloat(l.thickness),r=parseFloat(l.resistivity);return s+((!isNaN(h)&&!isNaN(r)&&r>0)?h/r:0);},0);var potential=totalS>0.5?"High":totalS>0.2?"Moderate":"Low";var potColor=potential==="High"?"#27ae60":potential==="Moderate"?"#f0c040":"#e74c3c";var aquifer=layers.find(function(l){var r=parseFloat(l.resistivity);return r>=10&&r<=200;});return(<div><div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:8}}><div><span style={{fontSize:9,color:"#555"}}>Groundwater Potential: </span><span style={{fontSize:13,fontWeight:"bold",color:potColor}}>{potential}</span></div><div><span style={{fontSize:9,color:"#555"}}>Total S: </span><span style={{fontSize:11,color:"#4a9adf",fontFamily:"monospace"}}>{totalS.toFixed(4)}</span></div>{aquifer&&<div><span style={{fontSize:9,color:"#555"}}>Aquifer: </span><span style={{fontSize:11,color:"#27ae60"}}>Layer {layers.indexOf(aquifer)+1} ({aquifer.resistivity} Ω·m)</span></div>}</div><div style={{fontSize:9,color:"#555",lineHeight:1.7}}>{potential==="High"&&"High longitudinal conductance — good aquifer protection and yield. Recommend borehole."}{potential==="Moderate"&&"Moderate conductance — further investigation recommended before drilling."}{potential==="Low"&&"Low conductance — limited aquifer protection. Consider alternative locations."}</div></div>);})()} 
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{background:"#0a0a1e",borderTop:"1px solid #1a1a3a",padding:"6px 14px",flexShrink:0}}>
        <input value={notes} onChange={function(e){setNotes(e.target.value);}} placeholder="Station notes (geology, access, field conditions…)" style={{width:"100%",background:"transparent",color:"#555",border:"none",fontSize:9,outline:"none",boxSizing:"border-box"}}/>
      </div>
    </div>
  );
}

function VESProjectEditor({project,onBack,onBackToModules}){
  var [stations,setStations]=useState([]);
  var [loading,setLoading]=useState(true);
  var [activeStation,setActiveStation]=useState(null);
  var [creating,setCreating]=useState(false);
  var [newStationId,setNewStationId]=useState("");
  useEffect(function(){loadStations();},[]);
  async function loadStations(){setLoading(true);var {data}=await supabase.from("ves_stations").select("*").eq("project_id",project.id).order("created_at",{ascending:true});setStations(data||[]);setLoading(false);}
  async function addStation(){if(!newStationId.trim())return;var {data,error}=await supabase.from("ves_stations").insert({project_id:project.id,station_id:newStationId.trim(),array_type:"Schlumberger",readings:[],layer_model:[],curve_type:"",notes:""}).select().single();if(!error&&data){setStations(function(p){return p.concat([data]);});setNewStationId("");setCreating(false);setActiveStation(data);}}
  async function deleteStation(id){await supabase.from("ves_stations").delete().eq("id",id);setStations(function(p){return p.filter(function(s){return s.id!==id;});});}
  if(activeStation){return <StationEditor station={activeStation} onBack={function(){loadStations();setActiveStation(null);}}/>;}
  return(
    <div style={{background:"#0d0d1f",height:"100vh",fontFamily:"sans-serif",color:"#eee",display:"flex",flexDirection:"column"}}>
      <div style={{background:"#12122e",borderBottom:"1px solid #1a3a2a",padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:32,height:32,background:"#27ae60",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>⚡</div><div><div style={{fontWeight:"bold",fontSize:14,color:"#27ae60"}}>{project.name||project.study_area}</div><div style={{fontSize:9,color:"#555"}}>{project.study_area}{project.lga?" · "+project.lga:""}{project.state?" · "+project.state+" State":""}</div></div></div>
        <div style={{display:"flex",gap:8}}><button onClick={onBack} style={Object.assign({},BTN,{background:"#1a1a3a",color:"#888",border:"1px solid #3a3a6a",padding:"5px 12px",fontSize:10})}>← Projects</button><button onClick={onBackToModules} style={Object.assign({},BTN,{background:"#1a1a3a",color:"#555",border:"1px solid #2a2a5a",padding:"5px 12px",fontSize:10})}>⊞ Modules</button></div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:24,maxWidth:700,margin:"0 auto",width:"100%"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}><div style={{fontSize:16,fontWeight:"bold",color:"#27ae60"}}>VES Stations</div><button onClick={function(){setCreating(true);}} style={Object.assign({},BTN,{background:"#27ae60",color:"#fff",padding:"7px 14px",fontSize:11})}>+ Add Station</button></div>
        {creating&&(<div style={{background:"#12122e",border:"1px solid #27ae60",borderRadius:8,padding:12,marginBottom:14,display:"flex",gap:8,alignItems:"flex-end"}}><div style={{flex:1}}><div style={LABEL}>Station ID *</div><input value={newStationId} onChange={function(e){setNewStationId(e.target.value);}} onKeyDown={function(e){if(e.key==="Enter")addStation();}} autoFocus placeholder="e.g. VES-01" style={Object.assign({},INP,{marginBottom:0})}/></div><button onClick={addStation} style={Object.assign({},BTN,{background:"#27ae60",color:"#fff",padding:"7px 14px",fontSize:10})}>✓ Add</button><button onClick={function(){setCreating(false);setNewStationId("");}} style={Object.assign({},BTN,{background:"#1a1a3a",color:"#888",border:"1px solid #3a3a6a",padding:"7px 10px",fontSize:10})}>Cancel</button></div>)}
        {loading?(<div style={{textAlign:"center",padding:40,color:"#555"}}>Loading stations…</div>):stations.length===0?(<div style={{textAlign:"center",padding:60,color:"#333"}}><div style={{fontSize:32,marginBottom:12}}>📡</div><div style={{fontSize:14,color:"#555",marginBottom:8}}>No stations yet</div><div style={{fontSize:11,color:"#333"}}>Add your first VES station to begin data entry</div></div>):(<div style={{display:"flex",flexDirection:"column",gap:8}}>{stations.map(function(s){var readingCount=(s.readings||[]).filter(function(r){return r.rhoA&&!isNaN(r.rhoA);}).length;var hasLayers=(s.layer_model||[]).length>0;return(<div key={s.id} style={{background:"#12122e",border:"1px solid #1a3a2a",borderRadius:8,padding:14,display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={function(){setActiveStation(s);}}><div style={{flex:1}}><div style={{fontSize:13,fontWeight:"bold",color:"#27ae60",marginBottom:3}}>{s.station_id||"Unnamed"}</div><div style={{display:"flex",gap:12,flexWrap:"wrap"}}><span style={{fontSize:9,color:"#555"}}>{s.array_type}</span>{s.lat&&s.lon&&<span style={{fontSize:9,color:"#555",fontFamily:"monospace"}}>{parseFloat(s.lat).toFixed(4)}, {parseFloat(s.lon).toFixed(4)}</span>}<span style={{fontSize:9,color:readingCount>0?"#27ae60":"#444"}}>{readingCount} readings</span>{s.curve_type&&<span style={{fontSize:9,fontWeight:"bold",color:"#f0c040",border:"1px solid #f0c040",borderRadius:3,padding:"0 4px"}}>{s.curve_type}</span>}{hasLayers&&<span style={{fontSize:9,color:"#4a9adf"}}>{s.layer_model.length} layers</span>}</div></div><div style={{display:"flex",gap:6,alignItems:"center"}}><button onClick={function(e){e.stopPropagation();setActiveStation(s);}} style={Object.assign({},BTN,{background:"#1a3a2a",color:"#27ae60",border:"1px solid #2a5a3a",padding:"5px 12px",fontSize:10})}>Open →</button><button onClick={function(e){e.stopPropagation();if(window.confirm("Delete "+s.station_id+"?"))deleteStation(s.id);}} style={{background:"transparent",color:"#3a3a6a",border:"none",borderRadius:4,padding:"5px 6px",fontSize:12,cursor:"pointer"}}>🗑</button></div></div>);})}</div>)}
      </div>
    </div>
  );
}

export default function VESSystem({onBackToModules}){
  var [user,setUser]=useState(null);
  var [authLoading,setAuthLoading]=useState(true);
  var [currentProject,setCurrentProject]=useState(null);
  var [showDashboard,setShowDashboard]=useState(false);
  useEffect(function(){
    supabase.auth.getSession().then(function(res){var u=res.data.session?res.data.session.user:null;setUser(u);setAuthLoading(false);if(u)setShowDashboard(true);});
    var {data:{subscription}}=supabase.auth.onAuthStateChange(function(_event,session){setUser(session?session.user:null);if(!session){setCurrentProject(null);setShowDashboard(false);}});
    return function(){subscription.unsubscribe();};
  },[]);
  async function handleSignOut(){await supabase.auth.signOut();setUser(null);setCurrentProject(null);setShowDashboard(false);}
  if(authLoading)return(<div style={{background:"#0d0d1f",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:"#27ae60",fontFamily:"sans-serif",fontSize:14}}>Loading…</div>);
  if(!user)return <AuthScreen/>;
  if(currentProject)return <VESProjectEditor project={currentProject} onBack={function(){setCurrentProject(null);setShowDashboard(true);}} onBackToModules={onBackToModules}/>;
  if(showDashboard)return <VESDashboard user={user} onOpen={function(p){setCurrentProject(p);setShowDashboard(false);}} onSignOut={handleSignOut} onBackToModules={onBackToModules}/>;
  return <AuthScreen/>;
}