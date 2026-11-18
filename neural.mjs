import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/ort.wasm.min.mjs';
ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';
let session;
window.neuralDewarp=async function(canvas){
 session ||= await ort.InferenceSession.create('https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main/correction/UVDoc_grid.onnx',{executionProviders:['wasm']});
 const small=document.createElement('canvas');small.width=488;small.height=712;const sc=small.getContext('2d',{willReadFrequently:true});sc.drawImage(canvas,0,0,488,712);const pix=sc.getImageData(0,0,488,712).data,N=488*712,input=new Float32Array(3*N);
 for(let i=0;i<N;i++){input[i]=pix[4*i+2]/255;input[N+i]=pix[4*i+1]/255;input[2*N+i]=pix[4*i]/255}
 const results=await session.run({[session.inputNames[0]]:new ort.Tensor('float32',input,[1,3,712,488])});const tensor=results[session.outputNames[0]],grid=tensor.data;const dims=tensor.dims,gh=dims[2],gw=dims[3],gn=gh*gw;
 if(dims[1]!==2||gh<2||gw<2)throw Error('곡선 보정 결과를 읽지 못했어요.');
 const ctx=canvas.getContext('2d',{willReadFrequently:true}),W=canvas.width,H=canvas.height,src=ctx.getImageData(0,0,W,H),out=ctx.createImageData(W,H);
 for(let y=0;y<H;y++){let gy=y*(gh-1)/(H-1),y0=Math.floor(gy),y1=Math.min(gh-1,y0+1),fy=gy-y0;for(let x=0;x<W;x++){let gx=x*(gw-1)/(W-1),x0=Math.floor(gx),x1=Math.min(gw-1,x0+1),fx=gx-x0;const sample=c=>{let a=grid[c*gn+y0*gw+x0]*(1-fx)+grid[c*gn+y0*gw+x1]*fx,b=grid[c*gn+y1*gw+x0]*(1-fx)+grid[c*gn+y1*gw+x1]*fx;return a*(1-fy)+b*fy};let sx=(sample(0)+1)*(W-1)/2,sy=(sample(1)+1)*(H-1)/2,di=(y*W+x)*4;if(sx<0||sy<0||sx>W-1||sy>H-1){out.data[di]=out.data[di+1]=out.data[di+2]=255;out.data[di+3]=255;continue}let ix=Math.floor(sx),iy=Math.floor(sy),ix1=Math.min(W-1,ix+1),iy1=Math.min(H-1,iy+1),dx=sx-ix,dy=sy-iy;for(let k=0;k<3;k++){let a=src.data[(iy*W+ix)*4+k]*(1-dx)+src.data[(iy*W+ix1)*4+k]*dx,b=src.data[(iy1*W+ix)*4+k]*(1-dx)+src.data[(iy1*W+ix1)*4+k]*dx;out.data[di+k]=a*(1-dy)+b*dy}out.data[di+3]=255}}
 ctx.putImageData(out,0,0);
};
