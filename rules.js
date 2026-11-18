function rectifyRules(pixels,w,h,sample=(x,y,out,i)=>samplePhoto(pixels,w,h,x,y,out,i)){
  // Follow continuous dark ridges from the middle toward both ends of each axis.
  function trace(vertical){
    const length=vertical?h:w, depth=vertical?w:h, bins=41, mid=20;
    const rows=Array.from({length:bins},()=>new Float32Array(depth));
    for(let b=0;b<bins;b++){
      const center=Math.round((length-1)*b/(bins-1)),radius=Math.max(2,Math.round(length/100));
      const start=Math.max(0,center-radius),end=Math.min(length-1,center+radius);
      for(let y=3;y<depth-3;y++){
        let sum=0;
        for(let x=start;x<=end;x++){
          const i=4*(vertical?x*w+y:y*w+x), step=vertical?4:w*4;
          sum+=Math.max(0,(pixels[i-3*step]+pixels[i+3*step])/2-pixels[i]);
        }
        rows[b][y]=sum/(end-start+1);
      }
    }
    let lines=[];
    for(let y=5;y<depth-5;y++){
      if(rows[mid][y]<12||rows[mid][y-1]>rows[mid][y]||rows[mid][y+1]>=rows[mid][y])continue;
      let path=new Float32Array(bins);path[mid]=y;let hits=1;
      for(const dir of [-1,1]){
        let pos=y,missing=0;
        for(let b=mid+dir;b>=0&&b<bins;b+=dir){
          let best=pos,score=0,reach=Math.max(3,Math.round(length/155));
          if(missing<3)for(let k=Math.max(3,pos-reach);k<=Math.min(depth-4,pos+reach);k++){
            const strength=rows[b][k]-1.8*Math.abs(k-pos);
            if(strength>score){best=k;score=strength}
          }
          if(score>10){pos=best;hits++;missing=0}else missing++;
          path[b]=pos;
        }
      }
      if(hits<bins*.65)continue;
      // Reject isolated detours onto handwriting and smooth the remaining path.
      const tracked=path.slice();
      for(let k=2;k<bins-2;k++)path[k]=[...tracked.slice(k-2,k+3)].sort((a,b)=>a-b)[2];
      for(let pass=0;pass<3;pass++){
        const prev=path.slice();
        for(let k=1;k<bins-1;k++)path[k]=(prev[k-1]+2*prev[k]+prev[k+1])/4;
      }
      const target=[...path].sort((a,b)=>a-b)[mid];
      if(lines.length&&path.some((v,b)=>v-lines.at(-1).path[b]<4))continue;
      lines.push({target,path});
    }
    if(lines.length<2)return null;
    // Continue the first and last measured offsets across the blank margins.
    // Anchoring those margins at zero would squeeze the outer text columns.
    const first=lines[0],last=lines.at(-1);
    const leading=first.path.map(v=>v-first.target);
    const trailing=last.path.map(v=>depth-1+v-last.target);
    lines.unshift({target:0,path:leading});
    lines.push({target:depth-1,path:trailing});
    const field=new Float32Array(depth*bins);let j=0;
    for(let y=0;y<depth;y++){
      while(lines[j+1].target<y)j++;
      let a=lines[j],b=lines[j+1],t=(y-a.target)/(b.target-a.target);
      for(let k=0;k<bins;k++)field[y*bins+k]=(1-t)*a.path[k]+t*b.path[k]-y;
    }
    return (x,y)=>{let z=x*40/(length-1),k=Math.floor(z),f=z-k,i=y*bins+k;return field[i]*(1-f)+field[y*bins+Math.min(40,k+1)]*f};
  }
  let horizontal=trace(false),vertical=trace(true);
  if(!horizontal&&!vertical)return null;
  // Trace remaining desk-coloured strips on all sides of the rectified page.
  function rim(length,depth,index){
    const edge=new Float32Array(length);
    const limit=Math.max(2,Math.floor(depth*.055));
    for(let k=0;k<length;k++){
      let last=-1;
      for(let d=0;d<limit;d++){
        const i=4*index(k,d);
        if(pixels[i]-pixels[i+2]>29 && pixels[i+1]-pixels[i+2]>8)last=d;
      }
      edge[k]=last+1;
    }
    const smooth=edge.slice();
    for(let k=0;k<length;k++)smooth[k]=Math.max(...edge.subarray(Math.max(0,k-3),Math.min(length,k+4)))+1;
    return smooth;
  }
  const top=rim(w,h,(x,d)=>d*w+x),bottom=rim(w,h,(x,d)=>(h-1-d)*w+x);
  const left=rim(h,w,(y,d)=>y*w+d),right=rim(h,w,(y,d)=>y*w+w-1-d);
  // Limit the change in displacement over a letter-sized neighbourhood.
  // A nearly constant displacement moves a glyph without squeezing its strokes.
  const spacing=Math.max(10,Math.round(Math.min(w,h)/32));
  const nx=Math.ceil((w-1)/spacing)+1,ny=Math.ceil((h-1)/spacing)+1;
  const dx=new Float32Array(nx*ny),dy=new Float32Array(nx*ny);
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const x=Math.round(i*(w-1)/(nx-1)),y=Math.round(j*(h-1)/(ny-1)),n=j*nx+i;
    dx[n]=vertical?vertical(y,x):0;
    dy[n]=horizontal?horizontal(x,y):0;
  }
  for(const field of [dx,dy]){
    for(let pass=0;pass<80;pass++){
      let change=0;
      for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
        const n=j*nx+i;
        for(const [next,limit] of [[i+1<nx?n+1:-1,(field===dx?.070:.065)*(w-1)/(nx-1)],[j+1<ny?n+nx:-1,(field===dx?.085:.045)*(h-1)/(ny-1)]]){
          if(next<0)continue;
          const gap=field[next]-field[n],excess=Math.max(0,Math.abs(gap)-limit)*.5;
          field[n]+=Math.sign(gap)*excess;field[next]-=Math.sign(gap)*excess;change=Math.max(change,excess);
        }
      }
      if(change<.002)break;
    }
  }
  const output=new Uint8ClampedArray(pixels.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const gx=x*(nx-1)/(w-1),gy=y*(ny-1)/(h-1),i=Math.min(nx-2,Math.floor(gx)),j=Math.min(ny-2,Math.floor(gy)),n=j*nx+i;
    const fx=gx-i,fy=gy-j;
    const offset=f=>(1-fy)*((1-fx)*f[n]+fx*f[n+1])+fy*((1-fx)*f[n+nx]+fx*f[n+nx+1]);
    const sx=x+offset(dx),sy=y+offset(dy);
    const index=4*(y*w+x);
    // Give the physical page a clean rectangular margin without pulling on text.
    if(sx<left[y]+1 || sx>w-2-right[y] || sy<top[x]+1 || sy>h-2-bottom[x]){
      output.fill(255,index,index+4);
    }else sample(sx,sy,output,index);
  }
  return alignTableSides(straightenFooter(evenPaperLight(output,w,h),w,h),w,h);
}
function samplePhoto(data,w,h,x,y,out,index){
  x=Math.max(0,Math.min(w-1,x));y=Math.max(0,Math.min(h-1,y));
  const i=Math.floor(x),j=Math.floor(y),a=Math.min(i+1,w-1),b=Math.min(j+1,h-1),fx=x-i,fy=y-j;
  for(let k=0;k<3;k++)out[index+k]=(1-fy)*((1-fx)*data[(j*w+i)*4+k]+fx*data[(j*w+a)*4+k])+fy*((1-fx)*data[(b*w+i)*4+k]+fx*data[(b*w+a)*4+k]);
  out[index+3]=255;
}
// Estimate the paper tone from bright pixels in neighbouring patches.
function evenPaperLight(data,w,h){
  const step=20,nx=Math.ceil(w/step)+1,ny=Math.ceil(h/step)+1,tones=new Float32Array(nx*ny);
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const hist=new Uint32Array(256);let count=0;
    for(let y=Math.max(0,j*step-step);y<Math.min(h,j*step+step);y+=2)
      for(let x=Math.max(0,i*step-step);x<Math.min(w,i*step+step);x+=2){const tone=data[4*(y*w+x)+1];if(tone<254){hist[tone]++;count++}}
    let k=0,total=0;while(k<255&&(total+=hist[k])<count*.80)k++;tones[j*nx+i]=count?Math.max(100,k):255;
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=Math.floor(x/step),j=Math.floor(y/step),fx=x/step-i,fy=y/step-j,n=j*nx+i;
    const light=(tones[n]*(1-fx)+tones[n+1]*fx)*(1-fy)+(tones[n+nx]*(1-fx)+tones[n+nx+1]*fx)*fy;
    const k=4*(y*w+x);
    for(let c=0;c<3;c++)data[k+c]=Math.max(0,255*data[k+c]/Math.max(light,1));
  }
  return data;
}
// Fit the last ruled box independently. Its short side edges may slope differently
// from the long table above it. Carry the enclosed lettering with the four edges.
function straightenFooter(src,w,h){
  const med=v=>v.slice().sort((a,b)=>a-b)[Math.floor(v.length/2)];
  const lum=(x,y)=>src[4*(y*w+x)+1];
  const ridge=(x,y,vertical)=>vertical?(lum(x-2,y)+lum(x+2,y))/2-lum(x,y):(lum(x,y-2)+lum(x,y+2))/2-lum(x,y);
  const peaks=[];
  for(let y=Math.floor(.71*h);y<.96*h;y++){
    let hits=0,total=0;
    for(let x=Math.floor(.15*w);x<.85*w;x+=2){hits+=ridge(x,y,false)>11;total++}
    if(hits/total>.60){
      if(peaks.length && y-peaks.at(-1).y<=4){if(hits>peaks.at(-1).hits)peaks[peaks.length-1]={y,hits}}
      else peaks.push({y,hits});
    }
  }
  if(peaks.length<2)return src;
  const [top,bottom]=peaks.slice(-2).map(p=>p.y);
  if(bottom-top<h*.025||bottom-top>h*.12)return src;
  function side(right){
    const start=Math.floor((right?.75:.025)*w),end=Math.floor((right?.98:.25)*w);
    let best=0,anchor=0;
    for(let x=start;x<=end;x++){
      let hit=0;
      for(let y=top+3;y<bottom-2;y++)if(Math.max(...[-2,-1,0,1,2].map(k=>ridge(x+k,y,true)))>14)hit++;
      if(hit>best){anchor=x;best=hit}
    }
    if(best<(bottom-top)*.68)return null;
    return anchor;
  }
  const left=side(false),right=side(true);
  if(left===null||right===null)return src;
  function profile(start,end,base,vertical){
    const a=[];
    for(let u=start;u<=end;u++){
      let best=-Infinity,at=base;
      for(let v=base-6;v<=base+6;v++){
        let score=0;
        for(let k=-3;k<=3;k++)score+=vertical?ridge(v,u+k,true):ridge(u+k,v,false);
        score-=2*Math.abs(v-base);
        if(score>best){best=score;at=v}
      }
      a.push(at);
    }
    // Estimate the smooth bend from block medians; letters touching the border
    // must not introduce a step in the baseline.
    const knots=[];
    const span=Math.max(7,Math.round(a.length/8));
    for(let i=0;i<a.length;i+=span){
      const part=a.slice(i,i+span);
      knots.push({u:i+(part.length-1)/2,value:med(part)});
    }
    return a.map((_,i)=>{
      let total=0,weight=0;
      for(const k of knots){
        const g=Math.exp(-.5*((i-k.u)/span)**2);
        total+=g*k.value;weight+=g;
      }
      return total/weight;
    });
  }
  const t=profile(left,right,top,false),b=profile(left,right,bottom,false);
  const l=profile(top,bottom,left,true),r=profile(top,bottom,right,true);
  // Use the top and bottom of each printed row as interior mesh guides.
  // Sample through the border map so the final image needs only one resampling here.
  const height=bottom-top,width=right-left;
  function ink(i,j){
    const u=i/width,v=j/height;
    const x=Math.round(left+i+(l[j]-left)*(1-u)+(r[j]-right)*u);
    const y=Math.round(top+j+(t[i]-top)*(1-v)+(b[i]-bottom)*v);
    return Math.max(0,205-lum(x,y));
  }
  const density=new Float32Array(height+1);
  for(let j=3;j<height-2;j++){
    for(let i=6;i<width-5;i++)density[j]+=ink(i,j)/width;
  }
  const threshold=Math.max(2,Math.max(...density)*.16);
  const guides=[{row:0,shift:new Float32Array(width+1)}];
  for(let j=3;j<height-2;j++){
    if(density[j]<threshold)continue;
    const first=j;
    while(j+1<height-2 && density[j+1]>=threshold)j++;
    if(j-first<3)continue;
    const knots=[],radius=Math.max(12,Math.round(width/23));
    for(let i=6;i<width-5;i+=radius){
      let upper=[],lower=[];
      for(let x=Math.max(5,i-radius);x<Math.min(width-4,i+radius);x++){
        let ys=[];
        for(let y=Math.max(3,first-2);y<=Math.min(height-3,j+2);y++)if(ink(x,y)>17)ys.push(y);
        if(ys.length>=2){upper.push(ys[0]);lower.push(ys.at(-1))}
      }
      if(upper.length>=radius*.4){
        upper.sort((a,b)=>a-b);lower.sort((a,b)=>a-b);
        knots.push({x:i,upper:upper[Math.floor(upper.length*.20)],lower:lower[Math.floor(lower.length*.80)]});
      }
    }
    if(knots.length<3)continue;
    for(const key of ['upper','lower']){
      const row=med(knots.map(k=>k[key]));
      if(row<=guides.at(-1).row+1)continue;
      const shift=new Float32Array(width+1);
      for(let x=0;x<=width;x++){
        let sum=0,weights=0;
        for(const k of knots){const g=Math.exp(-.5*((x-k.x)/radius)**2);sum+=g*(k[key]-row);weights+=g}
        shift[x]=Math.max(-2,Math.min(2,sum/Math.max(.02,weights)));
      }
      guides.push({row,shift});
    }
  }
  guides.push({row:height,shift:new Float32Array(width+1)});
  function textShift(x,y){
    const k=guides.findIndex(g=>g.row>=y);
    if(k<=0)return 0;
    const a=guides[k-1],b=guides[k],f=(y-a.row)/(b.row-a.row);
    return a.shift[x]*(1-f)+b.shift[x]*f;
  }
  const dst=src.slice(),pad=Math.max(8,Math.round(h*.025)),clip=(a,n)=>Math.max(0,Math.min(n-1,a));
  for(let y=Math.max(0,top-pad);y<=Math.min(h-1,bottom+pad);y++)for(let x=Math.max(0,left-pad);x<=Math.min(w-1,right+pad);x++){
    const i=clip(x-left,t.length),j=clip(y-top,l.length),u=i/(right-left),v=j/(bottom-top);
    const weight=Math.max(0,1-Math.max(left-x,x-right,top-y,y-bottom,0)/pad);
    const dx=(l[j]-left)*(1-u)+(r[j]-right)*u,dy=(t[i]-top)*(1-v)+(b[i]-bottom)*v;
    samplePhoto(src,w,h,x+dx*weight,y+(dy+textShift(i,j))*weight,dst,4*(y*w+x));
  }
  return dst;
}

// Follow each outer rule continuously from the table into its footer. Apply
// its displacement to neighbouring pixels so corners and handwriting stay joined.
function alignTableSides(src,w,h){
  if(w<100 || h<140)return src;
  const mid=Math.floor(h/2);
  function ridge(x,y){
    const i=(y*w+x)*4+1;
    return (src[i-8]+src[i+8])/2-src[i];
  }
  function track(start,end,reverse){
    const step=reverse?-1:1;
    for(let seed=reverse?end:start;seed>=start && seed<=end;seed+=step){
      let hits=0;
      for(let y=mid-12;y<=mid+12;y++){
        if(ridge(seed,y)>12)hits++;
      }
      if(hits<19)continue;
      const path=new Float32Array(h).fill(seed);
      let validCount=0,first=mid,last=mid;
      for(const dir of [-1,1]){
        let pos=seed,miss=0;
        for(let y=mid;y>=3 && y<h-3;y+=dir){
          let best=-Infinity,peak=Math.round(pos);
          for(let x=Math.max(3,Math.round(pos)-3);x<=Math.min(w-4,Math.round(pos)+3);x++){
            let score=0;
            for(let k=-2;k<=2;k++)score+=ridge(x,y+k);
            score=score/5-3*Math.abs(x-pos);
            if(score>best){best=score;peak=x}
          }
          if(best>9){
            let sum=0,weight=0;
            for(let x=peak-1;x<=peak+1;x++){
              const strength=Math.max(0,ridge(x,y-1)+ridge(x,y)+ridge(x,y+1));
              sum+=strength*x;weight+=strength;
            }
            pos=weight?sum/weight:peak;miss=0;validCount++;
            first=Math.min(first,y);last=Math.max(last,y);
          }else if(++miss>5)break;
          path[y]=pos;
        }
      }
      if(validCount<h*.38 || last<h*.75)continue;
      const positions=Array.from(path.slice(first,last+1)).sort((a,b)=>a-b);
      const target=positions[Math.floor(positions.length/2)];
      if(positions.at(-1)-positions[0]>w*.065)continue;
      const offset=new Float32Array(h);
      for(let y=0;y<h;y++){
        const center=Math.max(first,Math.min(last,y));
        let sum=0;
        for(let k=-2;k<=2;k++)sum+=path[Math.max(first,Math.min(last,center+k))];
        const fade=Math.max(0,1-Math.abs(y-center)/Math.max(12,h*.035));
        offset[y]=(sum/5-target)*fade;
      }
      return {target,offset};
    }
    return null;
  }
  const left=track(Math.max(4,Math.floor(.025*w)),Math.floor(.24*w),false);
  const right=track(Math.floor(.76*w),Math.min(w-5,Math.floor(.98*w)),true);
  if(!left && !right)return src;
  const dst=src.slice(),span=w*.20;
  for(const side of [left,right]){
    if(!side)continue;
    for(let y=0;y<h;y++){
      if(Math.abs(side.offset[y])<.04)continue;
      for(let x=Math.max(0,Math.floor(side.target-span));x<=Math.min(w-1,Math.ceil(side.target+span));x++){
        const t=Math.min(1,Math.abs(x-side.target)/span);
        const weight=1-t*t*(3-2*t);
        samplePhoto(src,w,h,x+weight*side.offset[y],y,dst,4*(y*w+x));
      }
    }
  }
  return dst;
}
