import { useState, useEffect, useRef } from "react";

const NIGERIA_CENTER = [9.082, 8.6753];
const NIGERIA_ZOOM = 6;
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_SIZE = 256;
const ROCK_COLORS = {
  Shale: "#6b6b2a", Limestone: "#00bcd4", Sandstone: "#e8e04a",
  Clay: "#9c27b0", Siltstone: "#f4a460", Marl: "#b8860b", Gravel: "#a0a0a0",
};

var tileCache = {};

function lon2tile(lon, z) { return Math.floor(((lon+180)/360)*Math.pow(2,z)); }
function lat2tile(lat, z) {
  return Math.floor(((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2)*Math.pow(2,z));
}
function tile2lon(x,z){ return x/Math.pow(2,z)*360-180; }
function tile2lat(y,z){ var n=Math.PI-2*Math.PI*y/Math.pow(2,z); return 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))); }

function ll2px(lat,lon,clat,clon,z,W,H){
  var ws=TILE_SIZE*Math.pow(2,z);
  function ly(la){ var s=Math.sin(la*Math.PI/180); return ws/(2*Math.PI)*(Math.PI-Math.log((1+s)/(1-s))/2); }
  function lx(lo){ return ws*(lo+180)/360; }
  return {x:W/2+(lx(lon)-lx(clon)), y:H/2+(ly(lat)-ly(clat))};
}
function px2ll(px,py,clat,clon,z,W,H){
  var ws=TILE_SIZE*Math.pow(2,z);
  function ly(la){ var s=Math.sin(la*Math.PI/180); return ws/(2*Math.PI)*(Math.PI-Math.log((1+s)/(1-s))/2); }
  function lx(lo){ return ws*(lo+180)/360; }
  var wx=lx(clon)+(px-W/2), wy=ly(clat)+(py-H/2);
  var n=Math.PI-2*Math.PI*wy/ws;
  return {lat:180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))), lon:wx/ws*360-180};
}
function toDMS(deg,isLat){
  var d=Math.abs(deg),dd=Math.floor(d),mm=Math.floor((d-dd)*60),ss=Math.round(((d-dd)*60-mm)*60);
  return dd+"\u00b0"+mm+"'"+ss+'"'+(isLat?(deg>=0?"N":"S"):(deg>=0?"E":"W"));
}
function loadTile(z,x,y,cb){
  var k=z+"/"+x+"/"+y;
  if(tileCache[k]){cb(tileCache[k]);return;}
  var img=new Image(); img.crossOrigin="anonymous";
  img.onload=function(){tileCache[k]=img;cb(img);};
  img.onerror=function(){cb(null);};
  img.src=TILE_URL.replace("{z}",z).replace("{x}",x).replace("{y}",y);
}
function dist(p1,p2){ return Math.sqrt(Math.pow(p1.x-p2.x,2)+Math.pow(p1.y-p2.y,2)); }

const MODES = ["pan","town","road-major","road-minor","river","sample","geology","select"];
const MODE_LABELS = {
  pan:"✋ Pan", town:"🏘 Town", "road-major":"🟠 Major Road",
  "road-minor":"⬛ Minor Road", river:"🌊 River",
  sample:"🔺 Sample", geology:"🪨 Geology", select:"👆 Select"
};
const MODE_COLORS = {
  pan:"#2a2a4a", town:"#1a3a5a", "road-major":"#5a2a00",
  "road-minor":"#2a2a2a", river:"#003a5a",
  sample:"#5a1a1a", geology:"#2a1a5a", select:"#1a3a1a"
};

export default function GeoMappingSystem() {
  var canvasRef=useRef(null), containerRef=useRef(null);
  var [center,setCenter]=useState({lat:NIGERIA_CENTER[0],lon:NIGERIA_CENTER[1]});
  var [zoom,setZoom]=useState(NIGERIA_ZOOM);
  var [mode,setMode]=useState("pan");
  var [tiles,setTiles]=useState([]);
  var [tick,setTick]=useState(0);
  var [size,setSize]=useState({w:800,h:560});
  var [tab,setTab]=useState("draw"); // draw | data | info

  // Feature state
  var [towns,setTowns]=useState([]);
  var [roads,setRoads]=useState([]); // {type,points,active}
  var [rivers,setRivers]=useState([]);
  var [samples,setSamples]=useState([]);
  var [geoZones,setGeoZones]=useState([]);

  // Active drawing
  var [activeRoad,setActiveRoad]=useState(null);
  var [activeRiver,setActiveRiver]=useState(null);
  var [activeGeo,setActiveGeo]=useState(null);
  var [mousePos,setMousePos]=useState(null);

  // Selected feature for editing
  var [selected,setSelected]=useState(null);

  // Form state
  var [townForm,setTownForm]=useState({name:""});
  var [sampleForm,setSampleForm]=useState({id:"",rock:"Shale",notes:""});
  var [geoRock,setGeoRock]=useState("Shale");

  // Drag
  var dragRef=useRef(null);
  var centerRef=useRef(center); centerRef.current=center;
  var zoomRef=useRef(zoom); zoomRef.current=zoom;
  var W=size.w, H=size.h;

  useEffect(function(){
    function upd(){
      if(containerRef.current){
        var r=containerRef.current.getBoundingClientRect();
        setSize({w:Math.floor(r.width)||800,h:Math.floor(r.height)||560});
      }
    }
    upd(); window.addEventListener("resize",upd);
    return function(){window.removeEventListener("resize",upd);};
  },[]);

  useEffect(function(){
    var cx=lon2tile(center.lon,zoom), cy=lat2tile(center.lat,zoom);
    var range=Math.ceil(Math.max(W,H)/TILE_SIZE/2)+2, next=[];
    for(var x=cx-range;x<=cx+range;x++){
      for(var y=cy-range;y<=cy+range;y++){
        var max=Math.pow(2,zoom);
        if(y<0||y>=max)continue;
        next.push({z:zoom,x:((x%max)+max)%max,y:y,ox:x});
      }
    }
    setTiles(next);
  },[center,zoom,W,H]);

  useEffect(function(){
    tiles.forEach(function(t){ loadTile(t.z,t.x,t.y,function(){setTick(function(n){return n+1;});}); });
  },[tiles]);

  // ── DRAW ──────────────────────────────────────────────────────────────
  useEffect(function(){
    var canvas=canvasRef.current; if(!canvas)return;
    var ctx=canvas.getContext("2d");
    ctx.clearRect(0,0,W,H);

    function p(lat,lon){return ll2px(lat,lon,center.lat,center.lon,zoom,W,H);}

    // Tiles
    tiles.forEach(function(t){
      var img=tileCache[t.z+"/"+t.x+"/"+t.y];
      var pt=p(tile2lat(t.y,zoom),tile2lon(t.ox,zoom));
      if(img) ctx.drawImage(img,Math.round(pt.x),Math.round(pt.y),TILE_SIZE,TILE_SIZE);
      else{ ctx.fillStyle="#e8e8e8"; ctx.fillRect(Math.round(pt.x),Math.round(pt.y),TILE_SIZE,TILE_SIZE); }
    });

    // Vignette
    var g=ctx.createRadialGradient(W/2,H/2,H*0.25,W/2,H/2,H*0.75);
    g.addColorStop(0,"rgba(0,0,0,0)"); g.addColorStop(1,"rgba(0,0,0,0.1)");
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);

    // Grid
    ctx.save();
    ctx.strokeStyle="rgba(255,255,255,0.25)"; ctx.lineWidth=0.7; ctx.setLineDash([4,4]);
    ctx.font="9px monospace"; ctx.fillStyle="rgba(255,255,255,0.8)";
    var step=zoom<=6?5:zoom<=8?2:zoom<=10?1:0.5;
    var tl=px2ll(0,0,center.lat,center.lon,zoom,W,H);
    var br=px2ll(W,H,center.lat,center.lon,zoom,W,H);
    for(var lo=Math.ceil(tl.lon/step)*step;lo<=br.lon;lo+=step){
      var px2=p(center.lat,lo).x;
      ctx.beginPath();ctx.moveTo(px2,0);ctx.lineTo(px2,H);ctx.stroke();
      ctx.fillText(toDMS(lo,false),px2+2,H-5);
    }
    for(var la=Math.floor(tl.lat/step)*step;la>=br.lat;la-=step){
      var py2=p(la,center.lon).y;
      ctx.beginPath();ctx.moveTo(0,py2);ctx.lineTo(W,py2);ctx.stroke();
      ctx.fillText(toDMS(la,true),3,py2-3);
    }
    ctx.setLineDash([]); ctx.restore();

    // Geology polygons
    geoZones.forEach(function(z2){
      if(z2.points.length<2)return;
      ctx.beginPath();
      z2.points.forEach(function(pt,i){
        var pp=p(pt.lat,pt.lon);
        if(i===0)ctx.moveTo(pp.x,pp.y); else ctx.lineTo(pp.x,pp.y);
      });
      if(z2.points.length>2)ctx.closePath();
      ctx.globalAlpha=0.55; ctx.fillStyle=ROCK_COLORS[z2.rock]||"#aaa"; ctx.fill();
      ctx.globalAlpha=1; ctx.strokeStyle=ROCK_COLORS[z2.rock]||"#aaa"; ctx.lineWidth=2; ctx.stroke();
      // label centroid
      if(z2.points.length>2){
        var cx2=z2.points.reduce(function(s,pt){return s+pt.lon;},0)/z2.points.length;
        var cy2=z2.points.reduce(function(s,pt){return s+pt.lat;},0)/z2.points.length;
        var cp=p(cy2,cx2);
        ctx.fillStyle="#fff"; ctx.font="bold 9px sans-serif"; ctx.textAlign="center";
        ctx.fillText(z2.rock,cp.x,cp.y); ctx.textAlign="left";
      }
    });

    // Active geology being drawn
    if(activeGeo&&activeGeo.points.length>0){
      ctx.beginPath();
      activeGeo.points.forEach(function(pt,i){
        var pp=p(pt.lat,pt.lon);
        if(i===0)ctx.moveTo(pp.x,pp.y); else ctx.lineTo(pp.x,pp.y);
      });
      if(mousePos){ var mp=p(mousePos.lat,mousePos.lon); ctx.lineTo(mp.x,mp.y); }
      ctx.strokeStyle=ROCK_COLORS[geoRock]||"#aaa"; ctx.lineWidth=2; ctx.setLineDash([5,3]); ctx.stroke(); ctx.setLineDash([]);
      activeGeo.points.forEach(function(pt){
        var pp=p(pt.lat,pt.lon);
        ctx.fillStyle="#fff"; ctx.beginPath(); ctx.arc(pp.x,pp.y,4,0,Math.PI*2); ctx.fill();
      });
      // close hint
      if(activeGeo.points.length>2){
        var fp=p(activeGeo.points[0].lat,activeGeo.points[0].lon);
        ctx.strokeStyle="#27ae60"; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(fp.x,fp.y,8,0,Math.PI*2); ctx.stroke();
      }
    }

    // Roads
    roads.forEach(function(road){
      if(road.points.length<1)return;
      ctx.beginPath();
      road.points.forEach(function(pt,i){
        var pp=p(pt.lat,pt.lon);
        if(i===0)ctx.moveTo(pp.x,pp.y); else ctx.lineTo(pp.x,pp.y);
      });
      if(road===activeRoad&&mousePos){ var mp=p(mousePos.lat,mousePos.lon); ctx.lineTo(mp.x,mp.y); }
      ctx.strokeStyle=road.type==="major"?"#e07030":"#888";
      ctx.lineWidth=road.type==="major"?3:1.5; ctx.stroke();
      // nodes
      if(road===activeRoad){
        road.points.forEach(function(pt){
          var pp=p(pt.lat,pt.lon);
          ctx.fillStyle=road.type==="major"?"#e07030":"#888";
          ctx.beginPath(); ctx.arc(pp.x,pp.y,3,0,Math.PI*2); ctx.fill();
        });
      }
    });

    // Rivers
    rivers.forEach(function(river){
      if(river.points.length<1)return;
      ctx.beginPath();
      river.points.forEach(function(pt,i){
        var pp=p(pt.lat,pt.lon);
        if(i===0)ctx.moveTo(pp.x,pp.y); else ctx.lineTo(pp.x,pp.y);
      });
      if(river===activeRiver&&mousePos){ var mp=p(mousePos.lat,mousePos.lon); ctx.lineTo(mp.x,mp.y); }
      ctx.strokeStyle="#2980d9"; ctx.lineWidth=2; ctx.stroke();
    });

    // Towns
    towns.forEach(function(town){
      var pp=p(town.lat,town.lon);
      ctx.fillStyle="#000";
      ctx.beginPath(); ctx.arc(pp.x,pp.y,4,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="#fff";
      ctx.beginPath(); ctx.arc(pp.x,pp.y,2.5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="#000"; ctx.font="bold 9px sans-serif";
      ctx.fillText(town.name||"Town",pp.x+6,pp.y-3);
    });

    // Samples
    samples.forEach(function(s){
      var pp=p(s.lat,s.lon);
      ctx.fillStyle="#c0392b";
      ctx.beginPath(); ctx.moveTo(pp.x,pp.y-9); ctx.lineTo(pp.x+6,pp.y+4); ctx.lineTo(pp.x-6,pp.y+4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle="#c0392b"; ctx.font="6px sans-serif";
      ctx.fillText(s.id,pp.x+7,pp.y+2);
    });

    // North arrow
    var ax=W-36,ay=36;
    ctx.save();
    ctx.shadowColor="rgba(0,0,0,0.3)"; ctx.shadowBlur=5;
    ctx.fillStyle="#fff"; ctx.beginPath(); ctx.arc(ax,ay,18,0,Math.PI*2); ctx.fill();
    ctx.shadowBlur=0;
    ctx.fillStyle="#c0392b"; ctx.beginPath(); ctx.moveTo(ax,ay-14); ctx.lineTo(ax-6,ay+3); ctx.lineTo(ax+6,ay+3); ctx.closePath(); ctx.fill();
    ctx.fillStyle="#333"; ctx.beginPath(); ctx.moveTo(ax,ay+14); ctx.lineTo(ax-6,ay-3); ctx.lineTo(ax+6,ay-3); ctx.closePath(); ctx.fill();
    ctx.fillStyle="#c0392b"; ctx.font="bold 10px sans-serif"; ctx.textAlign="center";
    ctx.fillText("N",ax,ay-17); ctx.textAlign="left"; ctx.restore();

    // Scale
    var mpp=(156543.03392*Math.cos(center.lat*Math.PI/180))/Math.pow(2,zoom);
    var bm=zoom>=12?500:zoom>=10?2000:zoom>=8?20000:zoom>=6?100000:500000;
    var bp=bm/mpp, sx=10, sy=H-20;
    ctx.save();
    ctx.fillStyle="rgba(255,255,255,0.88)"; ctx.fillRect(sx-3,sy-12,bp+6,18);
    ctx.fillStyle="#222"; ctx.fillRect(sx,sy-6,bp/2,7);
    ctx.fillStyle="#999"; ctx.fillRect(sx+bp/2,sy-6,bp/2,7);
    ctx.strokeStyle="#222"; ctx.lineWidth=1; ctx.strokeRect(sx,sy-6,bp,7);
    ctx.fillStyle="#222"; ctx.font="8px sans-serif";
    ctx.fillText("0",sx,sy-8);
    ctx.fillText(bm>=1000?bm/1000+"km":bm+"m",sx+bp-6,sy-8);
    ctx.restore();

    // Mode indicator
    ctx.save();
    ctx.fillStyle="rgba(0,0,0,0.55)"; ctx.fillRect(8,8,140,22); ctx.fillStyle="#f0c040";
    ctx.font="bold 11px sans-serif";
    ctx.fillText("MODE: "+MODE_LABELS[mode],14,23);
    ctx.restore();

    // Attribution
    ctx.save();
    ctx.fillStyle="rgba(255,255,255,0.7)"; ctx.fillRect(W-185,H-15,185,15);
    ctx.fillStyle="#666"; ctx.font="8px sans-serif";
    ctx.fillText("\u00a9 OpenStreetMap contributors",W-182,H-4);
    ctx.restore();

  },[tiles,center,zoom,tick,towns,roads,rivers,samples,geoZones,activeRoad,activeRiver,activeGeo,mousePos,mode,geoRock,W,H]);

  // ── EVENT HELPERS ──────────────────────────────────────────────────────
  function getLL(e){
    var r=canvasRef.current.getBoundingClientRect();
    return px2ll((e.clientX-r.left)*(W/r.width),(e.clientY-r.top)*(H/r.height),center.lat,center.lon,zoom,W,H);
  }
  function getPX(e){
    var r=canvasRef.current.getBoundingClientRect();
    return {x:(e.clientX-r.left)*(W/r.width),y:(e.clientY-r.top)*(H/r.height)};
  }

  // ── CLICK HANDLER ──────────────────────────────────────────────────────
  function handleClick(e){
    var ll=getLL(e);

    if(mode==="town"){
      var name=townForm.name||"Town "+(towns.length+1);
      setTowns(function(t){return t.concat([{lat:ll.lat,lon:ll.lon,name:name}]);});
      setTownForm({name:""});
    }

    else if(mode==="road-major"||mode==="road-minor"){
      if(!activeRoad){
        var road={type:mode==="road-major"?"major":"minor",points:[ll]};
        setRoads(function(r){return r.concat([road]);});
        setActiveRoad(road);
      } else {
        setRoads(function(prev){
          return prev.map(function(r){
            if(r===activeRoad){return Object.assign({},r,{points:r.points.concat([ll])});}
            return r;
          });
        });
        setActiveRoad(function(prev){return prev?Object.assign({},prev,{points:prev.points.concat([ll])}):null;});
      }
    }

    else if(mode==="river"){
      if(!activeRiver){
        var river={points:[ll]};
        setRivers(function(r){return r.concat([river]);});
        setActiveRiver(river);
      } else {
        setRivers(function(prev){
          return prev.map(function(r){
            if(r===activeRiver){return Object.assign({},r,{points:r.points.concat([ll])});}
            return r;
          });
        });
        setActiveRiver(function(prev){return prev?Object.assign({},prev,{points:prev.points.concat([ll])}):null;});
      }
    }

    else if(mode==="sample"){
      var id=sampleForm.id||"SAMPLE-"+(samples.length+1);
      setSamples(function(s){return s.concat([{lat:ll.lat,lon:ll.lon,id:id,rock:sampleForm.rock,notes:sampleForm.notes}]);});
      setSampleForm(function(f){return Object.assign({},f,{id:"",notes:""});});
    }

    else if(mode==="geology"){
      if(!activeGeo){
        var zone={rock:geoRock,points:[ll]};
        setActiveGeo(zone);
      } else {
        // Check if closing polygon (click near first point)
        if(activeGeo.points.length>2){
          var fp=ll2px(activeGeo.points[0].lat,activeGeo.points[0].lon,center.lat,center.lon,zoom,W,H);
          var cp=ll2px(ll.lat,ll.lon,center.lat,center.lon,zoom,W,H);
          if(dist(fp,cp)<16){
            setGeoZones(function(z){return z.concat([activeGeo]);});
            setActiveGeo(null); return;
          }
        }
        setActiveGeo(function(prev){return prev?Object.assign({},prev,{points:prev.points.concat([ll])}):null;});
      }
    }
  }

  // ── MOUSE EVENTS ───────────────────────────────────────────────────────
  function onMouseDown(e){
    if(mode==="pan"){
      dragRef.current={sx:e.clientX,sy:e.clientY,clat:center.lat,clon:center.lon};
    }
  }
  function onMouseMove(e){
    if(mode==="pan"&&dragRef.current){
      var d=dragRef.current;
      var ws=TILE_SIZE*Math.pow(2,zoom);
      var r=canvasRef.current.getBoundingClientRect();
      setCenter({
        lat:Math.max(-85,Math.min(85,d.clat+((e.clientY-d.sy)*(H/r.height)/ws)*180)),
        lon:d.clon+(-(e.clientX-d.sx)*(W/r.width)/ws)*360,
      });
    } else {
      setMousePos(getLL(e));
    }
  }
  function onMouseUp(e){
    if(mode==="pan"){ dragRef.current=null; }
    else { handleClick(e); }
  }
  function onWheel(e){
    e.preventDefault();
    setZoom(function(z){return Math.max(4,Math.min(18,z+(e.deltaY>0?-1:1)));});
  }

  // ── FINISH LINE/POLYGON ────────────────────────────────────────────────
  function finishRoad(){ setActiveRoad(null); }
  function finishRiver(){ setActiveRiver(null); }
  function finishGeo(){
    if(activeGeo&&activeGeo.points.length>2){
      setGeoZones(function(z){return z.concat([activeGeo]);});
    }
    setActiveGeo(null);
  }
  function undoLastNode(){
    if(mode==="road-major"||mode==="road-minor"){
      if(activeRoad&&activeRoad.points.length>1){
        setRoads(function(prev){return prev.map(function(r){if(r===activeRoad){var np=r.points.slice(0,-1);var nr=Object.assign({},r,{points:np});setActiveRoad(nr);return nr;}return r;});});
      }
    } else if(mode==="river"){
      if(activeRiver&&activeRiver.points.length>1){
        setRivers(function(prev){return prev.map(function(r){if(r===activeRiver){var np=r.points.slice(0,-1);var nr=Object.assign({},r,{points:np});setActiveRiver(nr);return nr;}return r;});});
      }
    } else if(mode==="geology"){
      if(activeGeo&&activeGeo.points.length>1){
        setActiveGeo(function(prev){return prev?Object.assign({},prev,{points:prev.points.slice(0,-1)}):null;});
      }
    }
  }
  function clearAll(){
    setTowns([]); setRoads([]); setRivers([]); setSamples([]); setGeoZones([]);
    setActiveRoad(null); setActiveRiver(null); setActiveGeo(null);
  }

  // ── COUNTS ─────────────────────────────────────────────────────────────
  var totalNodes=roads.reduce(function(s,r){return s+r.points.length;},0)+rivers.reduce(function(s,r){return s+r.points.length;},0);

  var btnBase={border:"none",borderRadius:6,cursor:"pointer",fontFamily:"sans-serif",fontWeight:"bold"};

  return (
    <div style={{background:"#0d0d1f",height:"100vh",fontFamily:"sans-serif",color:"#eee",display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {/* Header */}
      <div style={{background:"#12122e",borderBottom:"1px solid #2a2a5a",padding:"7px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:30,height:30,background:"#f0c040",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🗺</div>
          <div>
            <div style={{fontWeight:"bold",fontSize:14,color:"#f0c040"}}>Geo Mapping System</div>
            <div style={{fontSize:9,color:"#555"}}>Nigeria Geological Survey — Sequence 2</div>
          </div>
        </div>
        <div style={{display:"flex",gap:5}}>
          <div style={{background:"#1a3a1a",border:"1px solid #27ae60",borderRadius:10,padding:"2px 8px",fontSize:9,color:"#27ae60"}}>● Live</div>
          <div style={{background:"#1a1a3a",border:"1px solid #3a3a6a",borderRadius:10,padding:"2px 8px",fontSize:9,color:"#888"}}>z{zoom}</div>
        </div>
      </div>

      {/* Mode toolbar */}
      <div style={{background:"#0a0a20",borderBottom:"1px solid #2a2a5a",padding:"6px 10px",display:"flex",gap:4,alignItems:"center",flexShrink:0,overflowX:"auto"}}>
        {MODES.map(function(m){
          return (
            <button key={m} onClick={function(){setMode(m); if(m==="pan"){setActiveRoad(null);setActiveRiver(null);setActiveGeo(null);}}}
              style={Object.assign({},btnBase,{
                background:mode===m?"#f0c040":MODE_COLORS[m]||"#2a2a4a",
                color:mode===m?"#000":"#ccc",
                padding:"6px 10px",fontSize:10,whiteSpace:"nowrap",
                border:"1px solid "+(mode===m?"#f0c040":"#3a3a6a"),
              })}>
              {MODE_LABELS[m]}
            </button>
          );
        })}
        <div style={{marginLeft:"auto",display:"flex",gap:4}}>
          <button onClick={function(){setZoom(function(z){return Math.min(18,z+1);});}} style={Object.assign({},btnBase,{background:"#1e1e3a",color:"#fff",padding:"6px 11px",border:"1px solid #3a3a6a"})}>+</button>
          <button onClick={function(){setZoom(function(z){return Math.max(4,z-1);});}} style={Object.assign({},btnBase,{background:"#1e1e3a",color:"#fff",padding:"6px 11px",border:"1px solid #3a3a6a"})}>−</button>
          <button onClick={function(){setCenter({lat:NIGERIA_CENTER[0],lon:NIGERIA_CENTER[1]});setZoom(NIGERIA_ZOOM);}} style={Object.assign({},btnBase,{background:"#1e1e3a",color:"#aaa",padding:"6px 10px",fontSize:10,border:"1px solid #3a3a6a"})}>🇳🇬</button>
        </div>
      </div>

      {/* Body */}
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>

        {/* Map */}
        <div ref={containerRef} style={{flex:1,position:"relative",overflow:"hidden"}}>
          <canvas ref={canvasRef} width={W} height={H}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
            onMouseLeave={function(){dragRef.current=null;setMousePos(null);}}
            onWheel={onWheel}
            style={{display:"block",width:"100%",height:"100%",cursor:mode==="pan"?(dragRef.current?"grabbing":"grab"):"crosshair"}}
          />
          {/* Drawing hints */}
          {(mode==="road-major"||mode==="road-minor")&&(
            <div style={{position:"absolute",bottom:40,left:"50%",transform:"translateX(-50%)",background:"rgba(0,0,0,0.75)",color:"#fff",borderRadius:8,padding:"6px 14px",fontSize:11,display:"flex",gap:8}}>
              <span>Click to add nodes</span>
              {activeRoad&&<button onClick={finishRoad} style={Object.assign({},btnBase,{background:"#27ae60",color:"#fff",padding:"3px 10px",fontSize:10})}>✓ Finish Road</button>}
              {activeRoad&&<button onClick={undoLastNode} style={Object.assign({},btnBase,{background:"#e74c3c",color:"#fff",padding:"3px 8px",fontSize:10})}>↩ Undo</button>}
            </div>
          )}
          {mode==="river"&&(
            <div style={{position:"absolute",bottom:40,left:"50%",transform:"translateX(-50%)",background:"rgba(0,0,0,0.75)",color:"#fff",borderRadius:8,padding:"6px 14px",fontSize:11,display:"flex",gap:8}}>
              <span>Click to add nodes</span>
              {activeRiver&&<button onClick={finishRiver} style={Object.assign({},btnBase,{background:"#27ae60",color:"#fff",padding:"3px 10px",fontSize:10})}>✓ Finish River</button>}
              {activeRiver&&<button onClick={undoLastNode} style={Object.assign({},btnBase,{background:"#e74c3c",color:"#fff",padding:"3px 8px",fontSize:10})}>↩ Undo</button>}
            </div>
          )}
          {mode==="geology"&&(
            <div style={{position:"absolute",bottom:40,left:"50%",transform:"translateX(-50%)",background:"rgba(0,0,0,0.75)",color:"#fff",borderRadius:8,padding:"6px 14px",fontSize:11,display:"flex",gap:8,alignItems:"center"}}>
              {!activeGeo?<span>Click to start polygon</span>:<span>Click nodes · click first node (green circle) to close</span>}
              {activeGeo&&activeGeo.points.length>2&&<button onClick={finishGeo} style={Object.assign({},btnBase,{background:"#27ae60",color:"#fff",padding:"3px 10px",fontSize:10})}>✓ Close</button>}
              {activeGeo&&<button onClick={undoLastNode} style={Object.assign({},btnBase,{background:"#e74c3c",color:"#fff",padding:"3px 8px",fontSize:10})}>↩ Undo</button>}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div style={{width:240,background:"#0a0a1e",borderLeft:"1px solid #2a2a5a",display:"flex",flexDirection:"column",flexShrink:0}}>

          {/* Tabs */}
          <div style={{display:"flex",borderBottom:"1px solid #2a2a5a"}}>
            {["draw","data","info"].map(function(t){
              return(
                <button key={t} onClick={function(){setTab(t);}}
                  style={Object.assign({},btnBase,{flex:1,padding:"8px 4px",fontSize:10,background:tab===t?"#1a1a3a":"transparent",color:tab===t?"#f0c040":"#555",borderRadius:0,borderBottom:tab===t?"2px solid #f0c040":"2px solid transparent"})}>
                  {t==="draw"?"✏️ Draw":t==="data"?"📊 Data":"ℹ️ Info"}
                </button>
              );
            })}
          </div>

          <div style={{flex:1,overflowY:"auto",padding:12}}>

            {/* DRAW TAB */}
            {tab==="draw"&&(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>

                {mode==="town"&&(
                  <div style={{background:"#12122e",border:"1px solid #1a3a5a",borderRadius:8,padding:10}}>
                    <div style={{fontSize:11,color:"#4a9adf",fontWeight:"bold",marginBottom:8}}>🏘 PLACE TOWN</div>
                    <label style={{fontSize:10,color:"#888",display:"block",marginBottom:3}}>Town Name</label>
                    <input value={townForm.name} onChange={function(e){setTownForm({name:e.target.value});}}
                      placeholder="e.g. Ananamong"
                      style={{width:"100%",background:"#1e1e3a",color:"#fff",border:"1px solid #3a3a6a",borderRadius:5,padding:"6px 8px",fontSize:11,boxSizing:"border-box"}}/>
                    <div style={{fontSize:10,color:"#555",marginTop:6}}>Click anywhere on the map to place</div>
                  </div>
                )}

                {(mode==="road-major"||mode==="road-minor")&&(
                  <div style={{background:"#12122e",border:"1px solid #5a2a00",borderRadius:8,padding:10}}>
                    <div style={{fontSize:11,color:"#e07030",fontWeight:"bold",marginBottom:6}}>{mode==="road-major"?"🟠 MAJOR ROAD":"⬛ MINOR ROAD"}</div>
                    <div style={{fontSize:10,color:"#888",lineHeight:1.6}}>
                      1. Click on map to place first node<br/>
                      2. Keep clicking to add more nodes<br/>
                      3. Click <strong style={{color:"#27ae60"}}>Finish Road</strong> when done
                    </div>
                    {activeRoad&&<div style={{marginTop:8,fontSize:10,color:"#f0c040"}}>{activeRoad.points.length} nodes placed</div>}
                  </div>
                )}

                {mode==="river"&&(
                  <div style={{background:"#12122e",border:"1px solid #003a5a",borderRadius:8,padding:10}}>
                    <div style={{fontSize:11,color:"#2980d9",fontWeight:"bold",marginBottom:6}}>🌊 DRAW RIVER</div>
                    <div style={{fontSize:10,color:"#888",lineHeight:1.6}}>
                      Click upstream to downstream.<br/>
                      Finish when you reach the map edge.
                    </div>
                    {activeRiver&&<div style={{marginTop:8,fontSize:10,color:"#f0c040"}}>{activeRiver.points.length} nodes placed</div>}
                  </div>
                )}

                {mode==="sample"&&(
                  <div style={{background:"#12122e",border:"1px solid #5a1a1a",borderRadius:8,padding:10}}>
                    <div style={{fontSize:11,color:"#e74c3c",fontWeight:"bold",marginBottom:8}}>🔺 PLACE SAMPLE</div>
                    <label style={{fontSize:10,color:"#888",display:"block",marginBottom:3}}>Sample ID *</label>
                    <input value={sampleForm.id} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{id:e.target.value});});}}
                      placeholder="e.g. UU/GS/GLG/25/57"
                      style={{width:"100%",background:"#1e1e3a",color:"#fff",border:"1px solid #3a3a6a",borderRadius:5,padding:"6px 8px",fontSize:10,boxSizing:"border-box",marginBottom:6}}/>
                    <label style={{fontSize:10,color:"#888",display:"block",marginBottom:3}}>Rock Type</label>
                    <select value={sampleForm.rock} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{rock:e.target.value});});}}
                      style={{width:"100%",background:"#1e1e3a",color:"#fff",border:"1px solid #3a3a6a",borderRadius:5,padding:"6px 8px",fontSize:10,boxSizing:"border-box",marginBottom:6}}>
                      {Object.keys(ROCK_COLORS).map(function(r){return <option key={r}>{r}</option>;})}
                    </select>
                    <label style={{fontSize:10,color:"#888",display:"block",marginBottom:3}}>Field Notes</label>
                    <textarea value={sampleForm.notes} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{notes:e.target.value});});}}
                      placeholder="Colour, texture, structure..."
                      rows={2} style={{width:"100%",background:"#1e1e3a",color:"#fff",border:"1px solid #3a3a6a",borderRadius:5,padding:"6px 8px",fontSize:10,boxSizing:"border-box",resize:"none"}}/>
                    <div style={{fontSize:10,color:"#555",marginTop:6}}>Click map to place sample</div>
                  </div>
                )}

                {mode==="geology"&&(
                  <div style={{background:"#12122e",border:"1px solid #2a1a5a",borderRadius:8,padding:10}}>
                    <div style={{fontSize:11,color:"#9b59b6",fontWeight:"bold",marginBottom:8}}>🪨 GEOLOGY ZONE</div>
                    <label style={{fontSize:10,color:"#888",display:"block",marginBottom:3}}>Rock Type</label>
                    <select value={geoRock} onChange={function(e){setGeoRock(e.target.value);}}
                      style={{width:"100%",background:"#1e1e3a",color:"#fff",border:"1px solid #3a3a6a",borderRadius:5,padding:"6px 8px",fontSize:10,boxSizing:"border-box",marginBottom:8}}>
                      {Object.keys(ROCK_COLORS).map(function(r){return <option key={r}>{r}</option>;})}
                    </select>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                      <div style={{width:18,height:18,background:ROCK_COLORS[geoRock],borderRadius:3,border:"1px solid #fff"}}/>
                      <span style={{fontSize:10,color:"#888"}}>{geoRock}</span>
                    </div>
                    <div style={{fontSize:10,color:"#888",lineHeight:1.6}}>
                      Click to place boundary nodes.<br/>
                      Click the green circle to close polygon.<br/>
                      Min 3 nodes required.
                    </div>
                    {activeGeo&&<div style={{marginTop:8,fontSize:10,color:"#f0c040"}}>{activeGeo.points.length} nodes · {activeGeo.points.length>2?"click green circle or Finish to close":"need "+(3-activeGeo.points.length)+" more"}</div>}
                  </div>
                )}

                {mode==="pan"&&(
                  <div style={{fontSize:11,color:"#555",textAlign:"center",padding:20,lineHeight:1.8}}>
                    Select a drawing tool above to start placing features on the map.
                  </div>
                )}

                <button onClick={clearAll}
                  style={Object.assign({},btnBase,{background:"#3a1a1a",color:"#e74c3c",border:"1px solid #e74c3c",padding:"7px",fontSize:10,width:"100%"})}>
                  🗑 Clear All Features
                </button>
              </div>
            )}

            {/* DATA TAB */}
            {tab==="data"&&(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {[
                  {label:"Towns",count:towns.length,color:"#3498db"},
                  {label:"Major Roads",count:roads.filter(function(r){return r.type==="major";}).length,color:"#e07030"},
                  {label:"Minor Roads",count:roads.filter(function(r){return r.type==="minor";}).length,color:"#888"},
                  {label:"Rivers",count:rivers.length,color:"#2980d9"},
                  {label:"Samples",count:samples.length,color:"#e74c3c"},
                  {label:"Geology Zones",count:geoZones.length,color:"#9b59b6"},
                  {label:"Road Nodes",count:totalNodes,color:"#f0c040"},
                ].map(function(item,i){
                  return(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#12122e",borderRadius:6,padding:"8px 10px",borderLeft:"3px solid "+item.color}}>
                      <span style={{fontSize:11,color:"#aaa"}}>{item.label}</span>
                      <span style={{fontSize:16,fontWeight:"bold",color:item.color}}>{item.count}</span>
                    </div>
                  );
                })}

                {samples.length>0&&(
                  <div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10,marginTop:4}}>
                    <div style={{fontSize:11,color:"#f0c040",fontWeight:"bold",marginBottom:6}}>SAMPLE LIST</div>
                    {samples.map(function(s,i){
                      return(
                        <div key={i} style={{fontSize:10,borderBottom:"1px solid #1a1a3a",padding:"4px 0",display:"flex",justifyContent:"space-between"}}>
                          <span style={{color:"#ffaaaa"}}>{s.id}</span>
                          <span style={{color:"#888"}}>{s.rock}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* INFO TAB */}
            {tab==="info"&&(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10}}>
                  <div style={{fontSize:11,color:"#f0c040",fontWeight:"bold",marginBottom:8}}>SEQUENCE STATUS</div>
                  {[
                    ["Real base map",true],["Click-to-draw towns",true],
                    ["Road polylines",true],["River polylines",true],
                    ["Sample points",true],["Geology polygons",true],
                    ["Undo last node",true],["Feature data panel",true],
                    ["Save to database",false],["300dpi export",false],
                  ].map(function(item,i){
                    return(
                      <div key={i} style={{display:"flex",gap:8,fontSize:10,marginBottom:3}}>
                        <span style={{color:item[1]?"#27ae60":"#444"}}>{item[1]?"✓":"○"}</span>
                        <span style={{color:item[1]?"#8fbb8f":"#555"}}>{item[0]}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{background:"#0f0f1e",border:"1px dashed #2a2a4a",borderRadius:8,padding:10}}>
                  <div style={{fontSize:10,color:"#444",fontWeight:"bold",marginBottom:4}}>NEXT: SEQUENCE 3</div>
                  <div style={{fontSize:10,color:"#333",lineHeight:1.6}}>Map output generation — MAP 2 Sample Location Map and MAP 3 Geological Map at print quality.</div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{background:"#0a0a1e",borderTop:"1px solid #2a2a5a",padding:"4px 14px",display:"flex",justifyContent:"space-between",flexShrink:0}}>
        <span style={{fontSize:9,color:"#333"}}>Geo Mapping System v0.2 — Sequence 2</span>
        <span style={{fontSize:9,color:"#333"}}>Nigeria · WGS84 · OpenStreetMap</span>
      </div>
    </div>
  );
}