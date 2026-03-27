import { useState, useRef, useEffect, useCallback } from "react";

// ─── Shared GLSL noise & utility ────────────────────────────────
const GLSL_COMMON = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_seed;
uniform vec3 u_colors[5];
uniform float u_time;

vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec2 mod289(vec2 x){return x-floor(x*(1./289.))*289.;}
vec3 permute(vec3 x){return mod289(((x*34.)+1.)*x);}

float snoise(vec2 v){
  const vec4 C=vec4(.211324865405187,.366025403784439,-.577350269189626,.024390243902439);
  vec2 i=floor(v+dot(v,C.yy));
  vec2 x0=v-i+dot(i,C.xx);
  vec2 i1;i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
  vec4 x12=x0.xyxy+C.xxzz;
  x12.xy-=i1;
  i=mod289(i);
  vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
  vec3 m=max(.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.);
  m=m*m;m=m*m;
  vec3 x=2.*fract(p*C.www)-1.;
  vec3 h=abs(x)-.5;
  vec3 ox=floor(x+.5);
  vec3 a0=x-ox;
  m*=1.79284291400159-.85373472095314*(a0*a0+h*h);
  vec3 g;
  g.x=a0.x*x0.x+h.x*x0.y;
  g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.*dot(m,g);
}

float fbm(vec2 p,float seed){
  float v=0.;float a=.5;
  vec2 shift=vec2(100.+seed*13.7);
  mat2 rot=mat2(cos(.5),sin(.5),-sin(.5),cos(.5));
  for(int i=0;i<6;i++){
    v+=a*snoise(p+shift);
    p=rot*p*2.+shift;
    a*=.5;
  }
  return v;
}

float hash(float n){return fract(sin(n)*43758.5453123);}
float hash2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}

vec3 palette(float t){
  t=clamp(t,0.,0.999)*4.;
  float i=floor(t);
  float f=t-i;
  f=f*f*(3.-2.*f);
  vec3 c0=vec3(0.);
  vec3 c1=vec3(0.);
  for(int k=0;k<5;k++){
    float fk=float(k);
    if(fk==i) c0=u_colors[k];
    if(fk==i+1.) c1=u_colors[k];
  }
  return mix(c0,c1,f);
}

float grain(vec2 uv,float strength){
  return(hash2(uv*vec2(1234.56,789.01)+u_seed)-.5)*strength;
}
`;

// ─── Fragment shaders ───────────────────────────────────────────

const SHADER_MESH = GLSL_COMMON + `
void main(){
  vec2 uv=gl_FragCoord.xy/u_resolution;
  vec2 p=uv*3.;
  float n1=fbm(p*.8,u_seed);
  float n2=fbm(p*1.2+vec2(5.2,1.3),u_seed+1.);
  float n3=fbm(p+vec2(n1,n2)*.6,u_seed+2.);
  vec2 warped=p+vec2(n1,n2)*.4;
  float finalN=fbm(warped,u_seed+3.);
  float t=finalN*.5+.5;
  vec3 col=palette(t);
  vec2 glowCenter=vec2(.5+n1*.15,.5+n2*.15);
  float glow=1.-length(uv-glowCenter)*1.3;
  glow=pow(max(glow,0.),2.);
  col+=col*glow*.8;
  vec2 gc2=vec2(.3+n2*.2,.7+n1*.1);
  float g2=1.-length(uv-gc2)*1.5;
  g2=pow(max(g2,0.),3.);
  col+=palette(t+.3)*g2*.5;
  col=col/(1.+col)*.95;
  col*=1.1;
  col+=grain(uv,.04);
  float vig=1.-pow(length(uv-.5)*1.2,2.5);
  col*=mix(.15,1.,vig);
  gl_FragColor=vec4(col,1.);
}
`;

const SHADER_GLASS = GLSL_COMMON + `
void main(){
  vec2 uv=gl_FragCoord.xy/u_resolution;
  vec2 p=uv;
  vec3 col=vec3(.02);
  for(float i=0.;i<40.;i++){
    float offset=hash(i+u_seed*7.);
    float x=offset;
    float width=.003+hash(i*3.7+u_seed)*.015;
    float distFromRibbon=abs(p.x-x);
    float ribbon=smoothstep(width,width*.2,distFromRibbon);
    float yVar=sin(p.y*6.28*(.5+hash(i+1.)*3.)+hash(i*2.3+u_seed)*6.28)*.5+.5;
    yVar=pow(yVar,1.5+hash(i+5.)*2.);
    ribbon*=yVar;
    float colorT=hash(i*1.1+u_seed*.3);
    vec3 ribbonCol=palette(colorT);
    float fresnel=pow(max(1.-distFromRibbon/(width+.001),0.),3.);
    ribbonCol+=vec3(.15)*fresnel;
    col+=ribbonCol*ribbon*(.15+hash(i*9.+u_seed)*.35);
  }
  for(float i=0.;i<3.;i++){
    vec2 gc=vec2(hash(i*33.+u_seed),hash(i*77.+u_seed));
    float d=length(uv-gc);
    float g=exp(-d*d*3.);
    col+=palette(hash(i*5.+u_seed))*.15*g;
  }
  for(float i=0.;i<8.;i++){
    float x=hash(i*17.+u_seed+100.);
    float w=.001+hash(i*4.3)*.004;
    float streak=exp(-pow((p.x-x)/w,2.));
    float yMask=smoothstep(0.,1.,sin(p.y*3.14159+hash(i*2.)*6.28)*.5+.5);
    col+=vec3(.08)*streak*yMask;
  }
  float n=fbm(uv*8.,u_seed+10.)*.08;
  col+=n*palette(.5)*.15;
  col=col/(1.+col);
  col+=grain(uv,.035);
  float vig=1.-pow(length(uv-.5)*1.1,3.);
  col*=mix(.1,1.,vig);
  gl_FragColor=vec4(col,1.);
}
`;

const SHADER_HALFTONE = GLSL_COMMON + `
void main(){
  vec2 uv=gl_FragCoord.xy/u_resolution;
  float aspect=u_resolution.x/u_resolution.y;
  vec3 col=vec3(.02);
  vec2 center=vec2(.5+fbm(uv,u_seed)*.15,.5+fbm(uv+5.,u_seed)*.15);
  float d=length((uv-center)*vec2(aspect,1.));
  float intensity=pow(1.-smoothstep(0.,.7,d),1.5);
  vec2 c2=vec2(.3+hash(u_seed)*.4,.3+hash(u_seed+1.)*.4);
  float d2=length((uv-c2)*vec2(aspect,1.));
  float i2=pow(1.-smoothstep(0.,.5,d2),2.);
  intensity=max(intensity,i2*.7);
  float dotSize=.012;
  vec2 grid=uv/dotSize;
  vec2 gridId=floor(grid);
  vec2 gridUv=fract(grid)-.5;
  float jitter=hash2(gridId+u_seed)*.1;
  gridUv+=jitter-.05;
  vec2 samplePos=gridId*dotSize+dotSize*.5;
  float sD=length((samplePos-center)*vec2(aspect,1.));
  float sI=pow(1.-smoothstep(0.,.7,sD),1.5);
  float sD2=length((samplePos-c2)*vec2(aspect,1.));
  sI=max(sI,pow(1.-smoothstep(0.,.5,sD2),2.)*.7);
  float radius=sI*.48;
  float dot_=1.-smoothstep(radius-.02,radius+.02,length(gridUv));
  float colorT=hash2(gridId*.1+u_seed*.01)*.3+sI*.5;
  vec3 dotCol=palette(colorT);
  col+=dotCol*dot_*(.5+sI*.5);
  col+=palette(.3)*intensity*.08;
  col=col/(1.+col);
  col+=grain(uv,.025);
  float vig=1.-pow(length(uv-.5)*1.15,3.);
  col*=mix(.08,1.,vig);
  gl_FragColor=vec4(col,1.);
}
`;

const SHADER_LINES = GLSL_COMMON + `
void main(){
  vec2 uv=gl_FragCoord.xy/u_resolution;
  vec3 col=vec3(.02);
  for(float i=0.;i<80.;i++){
    float x=hash(i+u_seed*3.);
    float width=.001+hash(i*7.1+u_seed)*.006;
    float speed=.5+hash(i*2.3)*2.;
    float amp=.005+hash(i*5.7+u_seed)*.04;
    float phase=hash(i*11.+u_seed)*6.28;
    float wave=sin(uv.y*speed*12.+phase)*amp;
    float dist=abs(uv.x-x-wave);
    float line=exp(-dist*dist/(width*width*2.));
    float yI=sin(uv.y*3.14159*(.5+hash(i+2.)*1.5)+phase)*.5+.5;
    yI=pow(yI,1.+hash(i*3.)*2.);
    line*=.2+yI*.8;
    float t=hash(i*1.7+u_seed*.5);
    vec3 lineCol=palette(t);
    float glow=exp(-dist*dist/(width*width*20.));
    col+=lineCol*glow*.03;
    col+=lineCol*line*(.15+hash(i*9.)*.25);
  }
  vec2 lightPos=vec2(.5+fbm(uv*.5,u_seed)*.1,.5);
  float lightD=length(uv-lightPos);
  float light=exp(-lightD*lightD*4.);
  col+=palette(.5)*light*.2;
  float horizGlow=exp(-pow((uv.y-.5)*2.,2.)*3.);
  col+=palette(.3)*horizGlow*.06;
  col=col/(1.+col);
  col+=grain(uv,.03);
  float vig=1.-pow(length(uv-.5)*1.2,2.5);
  col*=mix(.1,1.,vig);
  gl_FragColor=vec4(col,1.);
}
`;

const SHADER_BOKEH = GLSL_COMMON + `
void main(){
  vec2 uv=gl_FragCoord.xy/u_resolution;
  float aspect=u_resolution.x/u_resolution.y;
  vec3 col=vec3(.02);
  vec2 washC=vec2(.5+hash(u_seed)*.3-.15,.5+hash(u_seed+1.)*.3-.15);
  float washD=length((uv-washC)*vec2(aspect,1.));
  col+=palette(.3)*exp(-washD*washD*2.)*.2;
  for(float i=0.;i<12.;i++){
    vec2 pos=vec2(hash(i*3.+u_seed),hash(i*7.+u_seed+1.));
    float r=.06+hash(i*11.+u_seed)*.12;
    float d=length((uv-pos)*vec2(aspect,1.));
    float circle=smoothstep(r,r-.005,d);
    float ring=smoothstep(r+.003,r,d)*smoothstep(r-.008,r-.003,d);
    vec3 bCol=palette(hash(i*1.3+u_seed*.7));
    col+=bCol*(circle*.03+ring*.06);
  }
  for(float i=0.;i<25.;i++){
    vec2 pos=vec2(hash(i*5.+u_seed+50.),hash(i*9.+u_seed+51.));
    float r=.02+hash(i*13.+u_seed)*.06;
    float d=length((uv-pos)*vec2(aspect,1.));
    float circle=smoothstep(r,r-.003,d);
    float ring=smoothstep(r+.002,r,d)*smoothstep(r-.005,r-.002,d);
    float glow=exp(-d*d/(r*r*8.));
    vec3 bCol=palette(hash(i*1.7+u_seed*.3));
    col+=bCol*(circle*.06+ring*.1+glow*.02);
  }
  for(float i=0.;i<40.;i++){
    vec2 pos=vec2(hash(i*4.+u_seed+100.),hash(i*8.+u_seed+101.));
    float r=.005+hash(i*17.+u_seed)*.02;
    float d=length((uv-pos)*vec2(aspect,1.));
    float circle=smoothstep(r,r-.002,d);
    float ring=smoothstep(r+.001,r,d)*smoothstep(r-.003,r-.001,d);
    float glow=exp(-d*d/(r*r*6.));
    vec3 bCol=palette(hash(i*2.1+u_seed*.9));
    col+=bCol*(circle*.12+ring*.15+glow*.04);
  }
  col=col/(1.+col);
  col+=grain(uv,.025);
  float vig=1.-pow(length(uv-.5)*1.1,3.);
  col*=mix(.05,1.,vig);
  gl_FragColor=vec4(col,1.);
}
`;

const SHADER_SPHERE = GLSL_COMMON + `
void main(){
  vec2 uv=gl_FragCoord.xy/u_resolution;
  float aspect=u_resolution.x/u_resolution.y;
  vec2 p=(uv-.5)*vec2(aspect,1.);
  vec3 col=vec3(.02);
  float sphereR=.32+hash(u_seed)*.08;
  vec2 sphereC=vec2(0.);
  float d=length(p-sphereC);
  float outerGlow=exp(-pow(d-sphereR,2.)*8.);
  col+=palette(.4)*outerGlow*.25;
  float farGlow=exp(-d*d*1.5);
  col+=palette(.6)*farGlow*.08;
  if(d<sphereR){
    vec3 normal;
    normal.xy=(p-sphereC)/sphereR;
    normal.z=sqrt(1.-dot(normal.xy,normal.xy));
    vec3 lightDir=normalize(vec3(-.4,.5,.7));
    vec3 viewDir=vec3(0.,0.,1.);
    vec3 halfDir=normalize(lightDir+viewDir);
    float diff=pow(max(dot(normal,lightDir),0.),1.5);
    float spec=pow(max(dot(normal,halfDir),0.),64.);
    float fresnel=pow(1.-max(dot(normal,viewDir),0.),3.5);
    float n=fbm(normal.xy*2.5+u_seed,u_seed);
    float colorT=n*.3+.5+normal.y*.2;
    vec3 surfCol=palette(colorT);
    float sss=pow(max(dot(-normal,lightDir),0.),2.)*.2;
    vec3 sphereCol=surfCol*(diff*.7+.15)+vec3(spec*.6)+palette(.7)*fresnel*.35+surfCol*sss;
    float edge=pow(d/sphereR,4.);
    sphereCol*=1.-edge*.5;
    col=sphereCol;
  }
  float hLine=exp(-pow((uv.y-.35)*5.,2.));
  col+=palette(.3)*hLine*.04;
  col=col/(1.+col);
  col+=grain(uv,.02);
  float vig=1.-pow(length(uv-.5)*1.15,2.8);
  col*=mix(.08,1.,vig);
  gl_FragColor=vec4(col,1.);
}
`;

// ─── Config ─────────────────────────────────────────────────────

const PALETTES = [
  { name: "Ember", colors: ["#FF6B35", "#F7931E", "#D94F04", "#FF4500", "#FFB347"] },
  { name: "Coral Drift", colors: ["#FF6F61", "#FF8C69", "#E8575A", "#FFB088", "#D4574E"] },
  { name: "Solar", colors: ["#FFB800", "#FF8C00", "#FF6200", "#FFD700", "#E67E00"] },
  { name: "Obsidian Fire", colors: ["#FF4500", "#8B1A1A", "#CD3700", "#FF6347", "#B22222"] },
  { name: "Warm Spectrum", colors: ["#FF6B6B", "#FFA07A", "#FFD93D", "#FF8C42", "#C0392B"] },
  { name: "Dusk", colors: ["#FF6B35", "#4A2FBD", "#7B3FA0", "#FF8C69", "#2D1B69"] },
];

const MODES = [
  { id: "mesh", label: "Gradient Mesh", shader: SHADER_MESH },
  { id: "glass", label: "Glass Fractal", shader: SHADER_GLASS },
  { id: "halftone", label: "Halftone", shader: SHADER_HALFTONE },
  { id: "lines", label: "Vertical Lines", shader: SHADER_LINES },
  { id: "bokeh", label: "Bokeh", shader: SHADER_BOKEH },
  { id: "sphere", label: "Sphere", shader: SHADER_SPHERE },
];

const RATIOS = [
  { id: "square", label: "1:1", w: 1024, h: 1024 },
  { id: "portrait", label: "9:16", w: 1080, h: 1920 },
  { id: "landscape", label: "16:9", w: 1920, h: 1080 },
  { id: "ultrawide", label: "21:9", w: 2520, h: 1080 },
];

const VERTEX_SHADER = `attribute vec2 a_position;void main(){gl_Position=vec4(a_position,0.,1.);}`;

function hexToGL(hex) {
  return [parseInt(hex.slice(1,3),16)/255, parseInt(hex.slice(3,5),16)/255, parseInt(hex.slice(5,7),16)/255];
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ─── Component ──────────────────────────────────────────────────

export default function ArtGen() {
  const canvasRef = useRef(null);
  const glRef = useRef(null);
  const programRef = useRef(null);
  const [mode, setMode] = useState("mesh");
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [ratioIdx, setRatioIdx] = useState(0);
  const [seed, setSeed] = useState(Math.random() * 1000);
  const [history, setHistory] = useState([]);

  const ratio = RATIOS[ratioIdx];
  const palette = PALETTES[paletteIdx];
  const modeObj = MODES.find((m) => m.id === mode);

  const compileShader = useCallback((gl, type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Shader compile error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = ratio.w;
    canvas.height = ratio.h;
    let gl = canvas.getContext("webgl", { preserveDrawingBuffer: true, antialias: false });
    if (!gl) return;
    glRef.current = gl;
    if (programRef.current) gl.deleteProgram(programRef.current);
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, modeObj.shader);
    if (!vs || !fs) return;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Link error:", gl.getProgramInfoLog(program));
      return;
    }
    programRef.current = program;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(program, "u_resolution"), ratio.w, ratio.h);
    gl.uniform1f(gl.getUniformLocation(program, "u_seed"), seed);
    gl.uniform1f(gl.getUniformLocation(program, "u_time"), performance.now() / 1000);
    gl.uniform3fv(gl.getUniformLocation(program, "u_colors"), palette.colors.flatMap(hexToGL));
    gl.viewport(0, 0, ratio.w, ratio.h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.deleteBuffer(buffer);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
  }, [mode, paletteIdx, ratio, seed, modeObj, palette, compileShader]);

  useEffect(() => { render(); }, [render]);

  const regenerate = () => setSeed(Math.random() * 10000);
  const randomAll = () => {
    setMode(pick(MODES).id);
    setPaletteIdx(Math.floor(Math.random() * PALETTES.length));
    setSeed(Math.random() * 10000);
  };

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `bb-${mode}-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const saveToHistory = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const thumb = document.createElement("canvas");
    const thumbH = Math.round(120 * (ratio.h / ratio.w));
    thumb.width = 120; thumb.height = thumbH;
    thumb.getContext("2d").drawImage(canvas, 0, 0, 120, thumbH);
    setHistory((prev) => [
      { src: thumb.toDataURL(), mode, palette: palette.name, seed, time: Date.now() },
      ...prev.slice(0, 11),
    ]);
  };

  const loadFromHistory = (item) => {
    setMode(item.mode);
    const pIdx = PALETTES.findIndex((p) => p.name === item.palette);
    if (pIdx >= 0) setPaletteIdx(pIdx);
    setSeed(item.seed);
  };

  const maxW = 780;
  const displayW = Math.min(maxW, ratio.w);
  const displayH = Math.round(displayW * (ratio.h / ratio.w));

  const lbl = {
    fontSize: 11, fontWeight: 600, color: "#555", textTransform: "uppercase",
    letterSpacing: "0.08em", fontFamily: "'JetBrains Mono',monospace",
    display: "block", marginBottom: 8,
  };

  const pillActive = (active) => ({
    background: active ? "rgba(255,107,53,0.12)" : "rgba(255,255,255,0.03)",
    border: `1px solid ${active ? "rgba(255,107,53,0.35)" : "rgba(255,255,255,0.06)"}`,
    color: active ? "#FF6B35" : "#777",
    padding: "6px 14px", borderRadius: 6, fontSize: 13, fontWeight: 500,
    cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
  });

  return (
    <div style={{
      minHeight: "100vh", background: "#0A0A0A", color: "#E5E5E5",
      fontFamily: "'DM Sans',system-ui,sans-serif", padding: "24px", boxSizing: "border-box",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: maxW, margin: "0 auto 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em", color: "#FFF" }}>
            bb artgen <span style={{ fontSize: 12, fontWeight: 400, color: "#444", fontFamily: "'JetBrains Mono',monospace", marginLeft: 8 }}>WebGL</span>
          </h1>
          <p style={{ fontSize: 13, color: "#555", margin: "4px 0 0", fontFamily: "'JetBrains Mono',monospace" }}>generative art · brightbase</p>
        </div>
        <button onClick={randomAll} style={{
          background: "rgba(255,107,53,0.1)", border: "1px solid rgba(255,107,53,0.2)",
          color: "#FF6B35", padding: "8px 16px", borderRadius: 8, fontSize: 13,
          fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
        }}>✦ Surprise Me</button>
      </div>

      <div style={{ maxWidth: maxW, margin: "0 auto 20px" }}>
        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>Mode</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {MODES.map((m) => (
              <button key={m.id} onClick={() => setMode(m.id)} style={pillActive(mode === m.id)}>{m.label}</button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={lbl}>Palette</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PALETTES.map((p, i) => (
                <button key={p.name} onClick={() => setPaletteIdx(i)} style={{
                  background: paletteIdx === i ? "rgba(255,255,255,0.07)" : "transparent",
                  border: `1px solid ${paletteIdx === i ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.04)"}`,
                  borderRadius: 6, padding: "6px 10px", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <div style={{ display: "flex", gap: 2 }}>
                    {p.colors.slice(0, 4).map((c, j) => (
                      <div key={j} style={{ width: 10, height: 10, borderRadius: 2, background: c }} />
                    ))}
                  </div>
                  <span style={{ fontSize: 12, color: paletteIdx === i ? "#CCC" : "#555", fontWeight: 500 }}>{p.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={lbl}>Ratio</label>
            <div style={{ display: "flex", gap: 6 }}>
              {RATIOS.map((r, i) => (
                <button key={r.id} onClick={() => setRatioIdx(i)} style={{
                  ...pillActive(ratioIdx === i),
                  fontSize: 12, fontFamily: "'JetBrains Mono',monospace", padding: "6px 12px",
                }}>{r.label}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{
        maxWidth: maxW, margin: "0 auto 16px", borderRadius: 12, overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.05)", background: "#050505",
      }}>
        <canvas ref={canvasRef} style={{ display: "block", width: displayW, height: displayH }} />
      </div>

      <div style={{ maxWidth: maxW, margin: "0 auto 12px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={regenerate} style={{
          flex: 1, minWidth: 140, background: "#FF6B35", border: "none", color: "#FFF",
          padding: "12px 20px", borderRadius: 8, fontSize: 14, fontWeight: 600,
          cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
        }}>↻ Regenerate</button>
        <button onClick={saveToHistory} style={{
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
          color: "#999", padding: "12px 20px", borderRadius: 8, fontSize: 14,
          fontWeight: 500, cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
        }}>♡ Save</button>
        <button onClick={download} style={{
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
          color: "#999", padding: "12px 20px", borderRadius: 8, fontSize: 14,
          fontWeight: 500, cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
        }}>↓ Download PNG</button>
      </div>

      <div style={{
        maxWidth: maxW, margin: "0 auto 32px", padding: "10px 14px",
        background: "rgba(255,255,255,0.015)", borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.04)",
      }}>
        <span style={{ fontSize: 12, color: "#444", fontFamily: "'JetBrains Mono',monospace" }}>
          {ratio.w}×{ratio.h}px · {modeObj.label} · {palette.name} · seed {seed.toFixed(1)}
        </span>
      </div>

      {history.length > 0 && (
        <div style={{ maxWidth: maxW, margin: "0 auto" }}>
          <label style={lbl}>Saved</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {history.map((item) => (
              <div key={item.time} onClick={() => loadFromHistory(item)} style={{
                borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.05)",
                cursor: "pointer", position: "relative",
              }}>
                <img src={item.src} alt="" style={{ width: 100, height: "auto", display: "block" }} />
                <div style={{
                  position: "absolute", bottom: 0, left: 0, right: 0,
                  padding: "14px 6px 4px",
                  background: "linear-gradient(transparent,rgba(0,0,0,0.85))",
                  fontSize: 9, color: "#777", fontFamily: "'JetBrains Mono',monospace",
                }}>{item.mode} · {item.palette}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
