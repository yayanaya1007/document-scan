// Detect the text direction inside each detected sheet, independently of the desk.
function sidewaysText(photo, corners) {
  const c=document.createElement('canvas'); c.width=180;c.height=180;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  const bounds=axis=>corners.map(p=>p[axis]);
  const xs=bounds(0),ys=bounds(1),x=Math.min(...xs),y=Math.min(...ys);
  ctx.drawImage(photo,x,y,Math.max(...xs)-x,Math.max(...ys)-y,0,0,180,180);
  const data=ctx.getImageData(0,0,180,180).data;
  const rows=new Float64Array(180),cols=new Float64Array(180);
  for(let j=14;j<166;j++)for(let i=14;i<166;i++){
    const k=(j*180+i)*4+1;
    const bg=Math.max(data[k-16],data[k+16],data[k-2880],data[k+2880]);
    const ink=Math.max(0,bg-data[k]-18);
    rows[j]+=ink;cols[i]+=ink;
  }
  const energy=a=>a.reduce((s,v,i)=>s+(i>=16&&i<166?(v-a[i-2])**2:0),0);
  return energy(cols)>1.65*Math.max(1,energy(rows));
}

// Estimate the smooth common bend of several printed baselines by maximizing
// the concentration of ink along rows. Never change horizontal letter spacing.
function flattenTextPage(src,w,h){
  const points=[];
  const stride=Math.max(1,Math.ceil(Math.max(w,h)/850)),r=Math.max(3,3*stride);
  for(let y=Math.max(r,Math.floor(h*.035));y<h*.965-r;y+=stride){
    for(let x=Math.max(r,Math.floor(w*.035));x<w*.965-r;x+=stride){
      const i=(y*w+x)*4+1;
      const contrast=Math.max(src[i-r*4],src[i+r*4],src[i-r*w*4],src[i+r*w*4])-src[i];
      if(contrast>40)points.push([x/w-.5,y,Math.min(110,contrast)]);
    }
  }
  if(points.length<100)return evenPaperLight(src.slice(),w,h);
  const hist=new Float64Array(h);
  function score(slope,bend){
    hist.fill(0);
    for(const [u,y,v] of points){
      const pos=y-w*(slope*u+bend*u*u),j=Math.floor(pos),f=pos-j;
      if(j<0||j+1>=h)continue;
      hist[j]+=v*(1-f);hist[j+1]+=v*f;
    }
    let energy=0;
    for(let i=1;i<h-1;i++)energy+=(hist[i-1]+2*hist[i]+hist[i+1])**2;
    return energy;
  }
  let slope=0,bend=0,base=score(0,0),best=base;
  for(const step of [.02,.005,.00125]){
    const s=slope,b=bend;
    for(let j=-3;j<=3;j++)for(let k=-3;k<=3;k++){
      const a=s+j*step,c=b+k*step;
      const v=score(a,c)/(1+.1*Math.abs(c));
      if(v>best){best=v;slope=a;bend=c}
    }
  }
  const out=src.slice();
  if(best>base*1.012){
    for(let x=0;x<w;x++){
      const u=x/w-.5,shift=w*(slope*u+bend*u*u);
      for(let y=0;y<h;y++)samplePhoto(src,w,h,x,y+shift,out,4*(y*w+x));
    }
  }
  const lit=evenPaperLight(out,w,h);
  const result=lit.slice();
  // Refine long lines of print locally. Track the lower ink envelope across
  // neighbouring character groups, ignoring short signatures and isolated ink.
  const density=new Uint32Array(h);
  for(let y=0;y<h;y++)for(let x=4;x<w-4;x+=2)if(lit[(y*w+x)*4+1]<165)density[y]++;
  const block=Math.max(15,Math.round(w/22));
  for(let y=Math.ceil(h*.035);y<h*.92;y++){
    if(density[y]<w*.019)continue;
    const start=y;
    while(y+1<h && density[y+1]>=w*.019)y++;
    if(y-start<4 || y-start>h*.035)continue;
    const knots=[];
    for(let x=block;x<w-block;x+=block){
      const bottoms=[];
      for(let k=x-block;k<x+block;k++){
        for(let j=y+2;j>=start;j--)if(lit[(j*w+k)*4+1]<165){bottoms.push(j);break}
      }
      if(bottoms.length<block*.65)continue;
      bottoms.sort((a,b)=>a-b);
      knots.push([x,bottoms[Math.floor(bottoms.length*.75)]]);
    }
    if(knots.length<8 || knots.at(-1)[0]-knots[0][0]<w*.55)continue;
    const levels=knots.map(k=>k[1]).sort((a,b)=>a-b);
    const target=levels[levels.length>>1],pad=Math.max(3,Math.round((y-start)*.45));
    for(let x=0;x<w;x++){
      let total=0,weights=0;
      for(const [cx,level] of knots){const g=Math.exp(-.5*((x-cx)/(1.4*block))**2);total+=g*(level-target);weights+=g}
      const shift=Math.max(-pad*.8,Math.min(pad*.8,total/Math.max(.3,weights)));
      for(let j=Math.max(0,start-pad);j<=Math.min(h-1,y+pad);j++){
        const fade=Math.max(0,1-Math.max(start-j,j-y,0)/pad);
        if(Math.abs(shift*fade)>.06)samplePhoto(lit,w,h,x,j+shift*fade,result,(j*w+x)*4);
      }
    }
  }
  // Remove a thin strip of the dark backing only when it runs along the
  // page edge and a continuous bright margin separates it from the content.
  const depth=Math.min(24,Math.floor(h*.022));
  for(const lower of [false,true]){
    const row=d=>lower?h-1-d:d;
    let dark=0,bright=0;
    for(let x=0;x<w;x++){
      let minimum=255;
      for(let j=0;j<depth;j++)minimum=Math.min(minimum,result[(row(j)*w+x)*4+1]);
      if(minimum<120)dark++;
      if(result[(row(depth)*w+x)*4+1]>210)bright++;
    }
    if(dark<w*.14 || bright<w*.98)continue;
    for(let x=0;x<w;x++){
      let last=-1;
      for(let j=0;j<depth;j++)if(result[(row(j)*w+x)*4+1]<175)last=j;
      for(let j=0;j<=last;j++)result.copyWithin((row(j)*w+x)*4,(row(depth)*w+x)*4,(row(depth)*w+x)*4+4);
    }
  }
  return result;
}

function hasRuledRows(data,w,h){
  if(w<80 || h<100)return false;
  const x0=Math.round(w*.16),x1=Math.round(w*.84),step=Math.max(3,Math.round(w/80));
  const slopes=[0,-.015,.015,-.035,.035,-.06,.06];
  let rows=0;
  for(let y=Math.ceil(h*.08);y<h*.92;y++){
    let found=false;
    for(const slope of slopes){
      let hits=0,total=0;
      for(let x=x0;x<x1;x+=step){
        const j=Math.round(y+(x-w/2)*slope);
        if(j<3||j>=h-3)continue;
        const i=(j*w+x)*4+1;
        const bg=(data[i-12*w]+data[i+12*w])/2;
        if(bg-Math.min(data[i-4*w],data[i],data[i+4*w])>15)hits++;
        total++;
      }
      if(total && hits>total*.7){found=true;break}
    }
    if(found){if(++rows>=3)return true;y+=Math.max(5,Math.round(h*.009))}
  }
  return false;
}
