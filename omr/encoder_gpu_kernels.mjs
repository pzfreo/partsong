import {arithmetic} from './encoder_gpu_math.mjs';

export const entries = ['matmul', 'conv', 'depthwise', 'norm', 'activation', 'scale', 'add', 'position'];
// Default limits only: 64 invocations, < 2 KiB workgroup storage, four storage
// bindings and one 64-byte uniform. No optional arithmetic features required.
export function shaderSource({diagnosticUnguarded = false} = {}) {
  let math = arithmetic;
  if (diagnosticUnguarded) {
    // Benchmark control only. The production host never selects this program.
    const replaceBody=(name,body)=>{
      const start=math.indexOf('fn '+name+'('),open=math.indexOf('{',start);let end=open+1,depth=1;
      while(depth){if(math[end]==='{')depth++;if(math[end]==='}')depth--;end++;}
      math=math.slice(0,open+1)+body+math.slice(end-1);
    };
    replaceBody('inspect','return bitcast<f32>(bitcast<u32>(x)^p.round_mask);');
    replaceBody('probe_word','return bitcast<f32>(word);');
    for(const [name,expression]of [['plus','a+b'],['times','a*b'],['fused','fma(a,b,c)']])
      replaceBody(name,`return inspect(${expression});`);
    replaceBody('fused4','return bitcast<vec4<f32>>(bitcast<vec4<u32>>(fma(a,b,c))^vec4<u32>(p.round_mask));');
  }
  return `
struct Params {
 kind:u32, rows:u32, k:u32, n:u32, weights:u32, bias:u32, epsilon:u32,
 h:u32, w:u32, c:u32, kernel:u32, stride:u32, pad:u32, ow:u32,
 math_count:u32, round_mask:u32,
}
@group(0) @binding(0) var<storage,read> a:array<u32>;
@group(0) @binding(1) var<storage,read> weights:array<vec4<u32>>;
@group(0) @binding(2) var<storage,read> residual:array<u32>;
@group(0) @binding(3) var<storage,read_write> output:array<u32>;
@group(0) @binding(4) var<uniform> p:Params;
@group(0) @binding(5) var<storage,read_write> guard:array<atomic<u32>>;
${math}
fn load_a(i:u32)->f32 { return bitcast<f32>(a[i]); }
fn load_w(i:u32)->f32 { return bitcast<f32>(weights[i>>2u][i&3u]); }
// All packed fields and matrix columns are four-float aligned by the plan.
fn w4(i:u32)->vec4<f32> { return bitcast<vec4<f32>>(weights[i>>2u]); }
fn store4(i:u32,v:vec4<f32>) {
 output[i]=bitcast<u32>(inspect(v.x));output[i+1u]=bitcast<u32>(inspect(v.y));
 output[i+2u]=bitcast<u32>(inspect(v.z));output[i+3u]=bitcast<u32>(inspect(v.w));
}
fn finish() { if (faults!=0u) { atomicOr(&guard[0],faults); } }
@compute @workgroup_size(64) fn matmul(@builtin(global_invocation_id) id:vec3<u32>) {
 let i=id.x; if(i>=p.rows*(p.n/4u)) {return;}
 let row=i/(p.n/4u);let col=(i%(p.n/4u))*4u;
 var sum=vec4<f32>(0.0);
 for(var k=0u;k<p.k;k++) {sum=fused4(vec4<f32>(load_a(row*p.k+k)),w4(p.weights+k*p.n+col),sum);}
 store4(row*p.n+col,plus4(sum,w4(p.bias+col)));finish();
}
fn gather_patch(row:u32,k:u32)->f32 {
 let channel=k/(p.kernel*p.kernel);let ky=(k/p.kernel)%p.kernel;let kx=k%p.kernel;
 let iy=i32((row/p.ow)*p.stride+ky)-i32(p.pad);
 let ix=i32((row%p.ow)*p.stride+kx)-i32(p.pad);
 if(iy<0 || ix<0 || iy>=i32(p.h) || ix>=i32(p.w)) {return 0.0;}
 return load_a((u32(iy)*p.w+u32(ix))*p.c+channel);
}
@compute @workgroup_size(64) fn conv(@builtin(global_invocation_id) id:vec3<u32>) {
 let i=id.x;if(i>=p.rows*(p.n/4u)){return;}
 let row=i/(p.n/4u);let col=(i%(p.n/4u))*4u;
 var result=vec4<f32>(0.0);
 if(p.c==1u) {
   result=w4(p.bias+col);
   for(var k=0u;k<p.k;k++){result=fused4(vec4<f32>(gather_patch(row,k)),w4(p.weights+k*p.n+col),result);}
 } else {
   for(var start=0u;start<p.k;start+=128u) {
     var partial=vec4<f32>(0.0);
     for(var k=start;k<min(start+128u,p.k);k++) {partial=fused4(vec4<f32>(gather_patch(row,k)),w4(p.weights+k*p.n+col),partial);}
     result=plus4(result,partial);
   }
   result=plus4(result,w4(p.bias+col));
 }
 store4(row*p.n+col,result);finish();
}
@compute @workgroup_size(64) fn depthwise(@builtin(global_invocation_id) id:vec3<u32>) {
 let i=id.x;if(i>=p.rows*(p.n/4u)){return;}
 let row=i/(p.n/4u);let col=(i%(p.n/4u))*4u;
 var sum=vec4<f32>(0.0);
 for(var ky=0u;ky<p.kernel;ky++){for(var kx=0u;kx<p.kernel;kx++){
   let iy=i32(row/p.w+ky)-i32(p.pad);let ix=i32(row%p.w+kx)-i32(p.pad);
   var value=vec4<f32>(0.0);
   if(iy>=0 && ix>=0 && iy<i32(p.h) && ix<i32(p.w)){
     let offset=(u32(iy)*p.w+u32(ix))*p.c+col;
     value=vec4<f32>(load_a(offset),load_a(offset+1u),load_a(offset+2u),load_a(offset+3u));
   }
   sum=fused4(value,w4(p.weights+(ky*p.kernel+kx)*p.c+col),sum);
 }}
 store4(row*p.n+col,plus4(sum,w4(p.bias+col)));finish();
}
var<workgroup> values:array<f32,384>;
var<workgroup> row_mean:f32;
var<workgroup> row_std:f32;
@compute @workgroup_size(64) fn norm(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_id) local:vec3<u32>) {
 let row=group.x;
 for(var j=local.x;j<p.n;j+=64u){values[j]=load_a(row*p.n+j);}
 workgroupBarrier();
 if(local.x==0u){
   var mean=0.0;var m2=0.0;
   for(var j=0u;j<p.n;j++){
     let delta=minus(values[j],mean);
     mean=plus(mean,inspect(divide(delta,f32(j+1u))));
     m2=fused(delta,minus(values[j],mean),m2);
   }
   row_mean=mean;row_std=inspect(square_root(plus(inspect(divide(m2,f32(p.n))),constructed(p.epsilon))));
 }
 workgroupBarrier();
 for(var j=local.x;j<p.n;j+=64u){
   output[row*p.n+j]=bitcast<u32>(fused(inspect(divide(minus(values[j],row_mean),row_std)),load_w(p.weights+j),load_w(p.bias+j)));
 }
 finish();
}
@compute @workgroup_size(64) fn activation(@builtin(global_invocation_id) id:vec3<u32>){
 let start=id.x*4u;if(start>=p.rows*p.n){return;}
 for(var j=0u;j<4u;j++){output[start+j]=bitcast<u32>(gelu_cpu(inspect(bitcast<f32>(output[start+j]))));}finish();
}
@compute @workgroup_size(64) fn scale(@builtin(global_invocation_id) id:vec3<u32>){
 let start=id.x*4u;if(start>=p.rows*p.n){return;}
 for(var j=0u;j<4u;j++){let i=start+j;output[i]=bitcast<u32>(times(inspect(bitcast<f32>(output[i])),load_w(p.weights+i%p.n)));}finish();
}
@compute @workgroup_size(64) fn add(@builtin(global_invocation_id) id:vec3<u32>){
 let start=id.x*4u;if(start>=p.rows*p.n){return;}
 for(var j=0u;j<4u;j++){let i=start+j;output[i]=bitcast<u32>(plus(load_a(i),inspect(bitcast<f32>(residual[i]))));}finish();
}
@compute @workgroup_size(64) fn position(@builtin(global_invocation_id) id:vec3<u32>){
 let start=id.x*4u;if(start>=p.rows*p.n){return;}
 for(var j=0u;j<4u;j++){let i=start+j;output[i]=bitcast<u32>(plus(inspect(bitcast<f32>(output[i])),load_w(p.weights+i)));}finish();
}
// vec4<u32> records: operation, a bits, b bits, c bits. Per-case flags are
// returned beside the output, so a guard can never disguise a failed probe.
@compute @workgroup_size(64) fn math_probe(@builtin(global_invocation_id) id:vec3<u32>){
 let i=id.x;if(i>=p.math_count){return;}
 let kind=a[i*4u];
 var x=probe_word(a[i*4u+1u]);var y=probe_word(a[i*4u+2u]);var z=probe_word(a[i*4u+3u]);
 if(kind!=1u && kind!=2u){x=inspect(x);y=inspect(y);z=inspect(z);}
 var value:f32;
 switch(kind){
  case 0u:{value=fused(x,y,z);}case 1u:{value=divide(x,y);}case 2u:{value=square_root(x);}
  case 3u:{value=erf_cpu(x);}case 4u:{value=gelu_cpu(x);}case 5u:{value=erf_exp(x);}
  case 6u:{value=plus(x,y);}case 7u:{value=times(x,y);}case 8u:{value=minus(x,y);}
  default:{faults|=UNCERTIFIED;value=0.0;}
 }
 output[i*2u]=bitcast<u32>(value);output[i*2u+1u]=faults;finish();
}
fn invalid_word(word:u32)->bool {
 let m=word&0x7fffffffu;var invalid=false;
 if(m>0u&&m<0x800000u){faults|=SUBNORMAL;invalid=true;}
 if(m>=0x7f800000u){faults|=NONFINITE;invalid=true;}
 if(m>0x4f800000u){faults|=DOMAIN;invalid=true;}
 return invalid;
}
@compute @workgroup_size(64) fn weights_scan(@builtin(global_invocation_id) id:vec3<u32>){
 // A second grid dimension also accommodates a full 128 MiB default binding.
 let i=id.x+id.y*(65535u*64u);if(i>=p.math_count/4u){return;}
 let word=weights[i];
 let x=invalid_word(word.x);let y=invalid_word(word.y);let z=invalid_word(word.z);let w=invalid_word(word.w);
 finish();
}
@compute @workgroup_size(64) fn image_scan(@builtin(global_invocation_id) id:vec3<u32>){
 let start=id.x*4u;if(start>=p.math_count){return;}
 for(var j=0u;j<4u;j++){let i=start+j;if(invalid_word(output[i])){output[i]=0u;}}
 finish();
}
`;
}

// Bind only statically used resources. In-place kernels read/write binding 3;
// they never alias it with a read-only binding in a WebGPU usage scope.
export const bindings = [[0,1,3,4,5],[0,1,3,4,5],[0,1,3,4,5],[0,1,3,4,5],
  [3,4,5],[1,3,4,5],[0,2,3,4,5],[1,3,4,5]];
export function dispatchCount(q) {return q[0] === 3 ? q[1] : Math.ceil(q[1]*q[3]/4/64);}
