// No bundler/wasm-bindgen. Works with ordinary exports or EncoderPool.exports.
// const gpu = await EncoderGPU.create({exports: e, encoder: encoderHandle});
// await gpu.encode(imagePtr, contextPtr); e.decoder_run(decoder,contextPtr,...);
import {bindings, dispatchCount, entries, shaderSource} from './encoder_gpu_kernels.mjs';

const bytes = value => new Uint8Array(value.buffer || value, value.byteOffset || 0, value.byteLength);
const inPlace = kind => kind === 4 || kind === 5 || kind === 7;
function pushErrors(d){d.pushErrorScope('validation');d.pushErrorScope('out-of-memory');d.pushErrorScope('internal');}
async function popErrors(d){
  const internal=d.popErrorScope(),oom=d.popErrorScope(),validation=d.popErrorScope();
  const results=await Promise.allSettled([internal,oom,validation]);
  for(const r of results){if(r.status==='rejected')throw r.reason;if(r.value)throw Error(r.value.message);}
}
export function bitDifference(got, expected) {
  const a = got instanceof Uint32Array ? got : new Uint32Array(got);
  const b = expected instanceof Uint32Array ? expected : new Uint32Array(expected);
  if (a.length !== b.length) throw Error('comparison shape differs');
  let count = 0, first = null;
  for (let i=0;i<a.length;i++) if(a[i]!==b[i]) {count++;first??={index:i,got:a[i],expected:b[i]};}
  return {values:a.length,bit_differences:count,first};
}
export function specialBits(value) {
  let flags=0;
  for(const word of value) {const m=word&0x7fffffff;if(m && m<0x800000) flags|=1;if(m>=0x7f800000) flags|=2;if(m>0x4f800000)flags|=8;}
  return flags;
}
function storage(device, valueOrSize, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST) {
  const data=typeof valueOrSize === 'number' ? null : bytes(valueOrSize);
  // A vec4 runtime storage array needs a complete final vector, even when a
  // diagnostic input ends with 1..3 scalar words (e.g. the 19x47 load test).
  // WebGPU zero-initializes the padding. Readbacks still return requested bytes.
  const buffer=device.createBuffer({size:Math.max(16,Math.ceil((data?.byteLength??valueOrSize)/16)*16),usage,mappedAtCreation:!!data});
  if(data) {new Uint8Array(buffer.getMappedRange()).set(data);buffer.unmap();}
  return buffer;
}
function uniform(device,q) {return storage(device,new Uint32Array(q),GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);}
export async function readBuffer(device,source,size,offset=0) {
  const target=storage(device,size,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
  try {const cmd=device.createCommandEncoder();cmd.copyBufferToBuffer(source,offset,target,0,size);device.queue.submit([cmd.finish()]);
    await target.mapAsync(GPUMapMode.READ);return target.getMappedRange().slice(0,size);
  } finally {target.destroy();}
}

class Program {
  static async create(device,diagnosticUnguarded=false,legacy=false) {
    const code=shaderSource({diagnosticUnguarded,legacy}), module=device.createShaderModule({code});
    const info=await module.getCompilationInfo();
    const errors=info.messages.filter(m=>m.type==='error');if(errors.length) throw Error(JSON.stringify(errors));
    const names=[...entries,'math_probe','weights_scan','image_scan'];
    // Explicit layouts keep the guard binding present in the diagnostic
    // control even if a compiler proves its fault accumulator stays zero.
    const indices=names.map((_,kind)=>kind===8?[0,3,4,5]:kind===9?[1,4,5]:kind===10?[3,4,5]:bindings[kind]);
    const layouts=indices.map(list=>device.createBindGroupLayout({entries:list.map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,
      buffer:{type:binding===4?'uniform':binding===3||binding===5?'storage':'read-only-storage',minBindingSize:binding===4?64:binding===1||(binding===0&&!legacy)?16:4}}))}));
    const pipelines=await Promise.all(names.map((entryPoint,i)=>device.createComputePipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[layouts[i]]}),compute:{module,entryPoint}})));
    return Object.assign(new Program(),{device,pipelines,indices,layouts,diagnosticUnguarded,legacy});
  }
  group(kind,resources) {
    return this.device.createBindGroup({layout:this.layouts[kind],entries:this.indices[kind].map(binding=>({binding,resource:{buffer:resources[binding]}}))});
  }
  dispatch(command,kind,q,group,timestampWrites) {
    const pass=command.beginComputePass(timestampWrites?{timestampWrites}:{});
    pass.setPipeline(this.pipelines[kind]);pass.setBindGroup(0,group);
    if(kind===9){const groups=Math.ceil(q[14]/4/64);pass.dispatchWorkgroups(Math.min(65535,groups),Math.ceil(groups/65535));}
    else pass.dispatchWorkgroups(kind===8?Math.ceil(q[14]/64):kind===10?Math.ceil(q[14]/4/64):dispatchCount(q,{legacy:this.legacy}));pass.end();
  }
}

export function mathKnownAnswers() {
  const cases=[];
  const add=(kind,a,b=0,c=0,guard=false)=>cases.push({record:[kind,a>>>0,b>>>0,c>>>0],guard});
  add(0,0x3f800001,0x3f7ffffe,0xbf800000); // fusion
  add(0,0x3f800001,0x3f7ffffe,0x4b800001); // f64 double-round trap
  add(0,0x80000000,0x3f800000,0x80000000);add(0,0x3f800000,0x3f800000,0xbf800000);
  add(0,0x1c800000,0x1c800000,0x00800000); // product underflows, fused result normal
  add(0,0x4b800000,0x3f800000,0x3f800000); // exact halfway, even below
  for(const x of [0,0x80000000,0x00800000,0x00800001,0x3effffff,0x3f000000,0x3f7fffff,0x3f800000,0x3f800001,0x3fffffff,0x40000000,0x7f7fffff]) {
    add(1,x,0x3f800000);add(1,x,0x3fc00000,0,(x&0x7fffffff)>0&&(x&0x7fffffff)<0xc00000);
    add(2,x);
  }
  for(const x of [0,0x80000000,0x3e800000,0x3f6bffff,0x3f6c0000,0x3f6c0001,0x3f800000,0x407b3333,0x40800000,0xbf800000,0xc0800000]) {add(3,x);add(4,x);}
  for(const x of [0,0xbf000000,0xbf800000,0xc0800000,0xc1800000]) add(5,x);
  add(6,0x80000000,0x80000000);add(6,0x3f800000,0xbf800000);
  add(6,0x3f800000,0x33800000);add(6,0x3f800001,0x33800000); // both tie parities
  add(7,0x3f800002,0x3fa00000); // product halfway, even below
  add(7,0x3f800001,0x3f7ffffe);add(8,0x3f800001,0x3f800000);
  add(0,1,0x3f000000,1,true);add(7,0x17800000,0x17800000,0,true);
  add(0,0x3f800001,0x0c000001,0x8c000002,true); // normal operands -> minsub
  add(8,0x00800001,0x00800000,0,true);add(2,1,0,0,true);
  return cases;
}

export class EncoderGPU {
  static async create({exports:e,encoder,gpu=globalThis.navigator?.gpu,onReport=()=>{},timestamps=false,retainPlan=false}={}) {
    if(!e?.memory||typeof e.encoder_run!=='function'||!Number.isInteger(encoder)||encoder<=0)throw Error('Live Rust encoder handle and exports required');
    const self=Object.assign(new EncoderGPU(),{e,encoder,onReport,enabled:false,busy:false,resources:[],status:{backend:'cpu',self_test:null}});
    const start=performance.now();
    let scoped=false;
    try {
      if(!gpu) throw Error('WebGPU unavailable');
      const adapter=await gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter) throw Error('No WebGPU adapter');
      self.status.adapter=Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,adapter.info?.[k]??'']));
      if(adapter.isFallbackAdapter || /swiftshader|llvmpipe|software/i.test(JSON.stringify(self.status.adapter))) throw Error('Software/fallback adapter');
      const features=timestamps&&adapter.features.has('timestamp-query')?['timestamp-query']:[];
      self.device=await adapter.requestDevice({requiredFeatures:features});self.timestamp=features.length>0;
      self.status.timestamp_query=self.timestamp;self.status.timestamp_query_available=adapter.features.has('timestamp-query');
      pushErrors(self.device);scoped=true;
      self.device.lost.then(info=>{if(!self.closed&&!self.retiredDevice)self.disable(`Device lost: ${info.reason}: ${info.message}`);});
      self.device.addEventListener('uncapturederror',event=>{if(!self.closed&&!self.retiredDevice)self.disable(`WebGPU error: ${event.error.message}`);});
      for(const name of ['encoder_gpu_plan_create','encoder_gpu_plan_drop','encoder_gpu_plan_json','encoder_gpu_plan_json_len','encoder_gpu_plan_weights','encoder_gpu_plan_weights_len','encoder_gpu_math_reference']) if(!e[name]) throw Error(`Missing ABI export ${name}`);
      self.plan=e.encoder_gpu_plan_create(encoder);if(!self.plan) throw Error('GPU plan rejected');
      const pointer=e.encoder_gpu_plan_json(self.plan),length=e.encoder_gpu_plan_json_len(self.plan);
      self.meta=JSON.parse(new TextDecoder().decode(new Uint8Array(e.memory.buffer,pointer,length).slice()));
      self.validateLimits();
      const wp=e.encoder_gpu_plan_weights(self.plan),wn=e.encoder_gpu_plan_weights_len(self.plan);
      if(wn!==self.meta.weights)throw Error('GPU weight getter/metadata shape mismatch');
      const weights=new Uint32Array(e.memory.buffer,wp,wn);
      self.weights=storage(self.device,weights);self.resources.push(self.weights);
      self.status.operand_guard='GPU raw-bit load-time weights scan; per-staff sanitizing image scan';
      const compile=performance.now();self.program=await Program.create(self.device);self.status.compile_ms=performance.now()-compile;
      self.status.schedule='dense 16x32/K16, depthwise 4x4/C16, one norm row per invocation';
      self.status.self_test=await self.selfTest();
      if(!self.status.self_test.passed) throw Error('GPU known-answer self-test failed');
      self.buffers=self.meta.buffers.map(n=>storage(self.device,n*4));self.resources.push(...self.buffers);
      self.guard=storage(self.device,4);self.resources.push(self.guard);
      self.scanParams=new Uint32Array(16);self.scanParams[14]=256*1280;self.scanQ=uniform(self.device,self.scanParams);self.resources.push(self.scanQ);
      self.scanGroup=self.program.group(10,[null,null,null,self.buffers[0],self.scanQ,self.guard]);
      self.ops=self.meta.ops.map(op=>{const q=uniform(self.device,op.params);self.resources.push(q);return {...op,q,group:self.program.group(op.params[0],[self.buffers[op.input],self.weights,self.buffers[op.residual],self.buffers[op.output],q,self.guard])};});
      self.contextBytes=self.meta.buffers[self.meta.output]*4;
      self.readback=storage(self.device,self.contextBytes+24,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);self.resources.push(self.readback);
      if(self.timestamp){self.queries=self.device.createQuerySet({type:'timestamp',count:2});self.resolve=storage(self.device,16,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC);self.resources.push(self.resolve);}
      scoped=false;await popErrors(self.device);
      if(self.broken) throw Error(self.status.reason);
      if(!retainPlan){e.encoder_gpu_plan_drop(self.plan);self.plan=0;}
      self.status.retained_cpu_plan=retainPlan;self.enabled=true;self.status.backend='gpu';
    } catch(error) {if(scoped){try{await popErrors(self.device);}catch{}}self.disable(String(error.stack||error));self.releaseGPU();}
    self.status.initialization_ms=performance.now()-start;
    self.status.initialization_within_100ms=self.status.initialization_ms<100;
    self.emitStatus();return self;
  }
  validateLimits() {
    const m=this.meta,l=this.device.limits;
    if(m.abi!==1||m.buffers.length!==7||m.max_channels>384||m.weights%4) throw Error('Unsupported GPU plan ABI');
    if(l.maxStorageBuffersPerShaderStage<4||l.maxComputeInvocationsPerWorkgroup<64||l.maxComputeWorkgroupSizeX<64||l.maxComputeWorkgroupStorageSize<12608) throw Error('Missing default compute limits');
    for(const n of [...m.buffers,m.weights]) if(n*4>l.maxStorageBufferBindingSize||n*4>l.maxBufferSize) throw Error(`Buffer exceeds device limit: ${n*4}`);
    for(const op of m.ops) {const q=op.params;if(q.length!==16||q[15]!==0||q[0]>7||!q[1]||!q[3]||q[3]%4||(q[0]===3&&q[3]>384)||dispatchCount(q)>l.maxComputeWorkgroupsPerDimension) throw Error(`Unsupported op ${op.name}`);
      if(q[0]<3&&(q[4]%4||q[5]%4))throw Error('Unaligned packed matrix field');
      if(q[0]<3&&q[2]>1536)throw Error('GPU prefix-bound certificate requires K<=1536');
      if(q[0]===2&&(q[10]>7||!q[10]||q[1]!==q[7]*q[8]||q[3]!==q[9]))throw Error('Unsupported depthwise tile shape');
      if(q[0]===3&&(specialBits(new Uint32Array([q[6]]))||!(new Float32Array(new Uint32Array([q[6]]).buffer)[0]>0)))throw Error('GPU norm requires finite positive bounded epsilon');}
  }
  emitStatus(){try{this.onReport({...this.status});}catch(error){this.status.report_error=String(error);}}
  disable(reason) {this.broken=true;this.enabled=false;this.status.backend='cpu';this.status.reason=reason;this.emitStatus();}
  mathReference(records) {
    const e=this.e,ip=e.decoder_alloc(records.byteLength),op=e.decoder_alloc(records.length);
    try {new Uint32Array(e.memory.buffer,ip,records.length).set(records);e.encoder_gpu_math_reference(ip,op,records.length/4);return new Uint32Array(e.memory.buffer,op,records.length/4).slice();}
    finally {e.decoder_free(ip,records.byteLength);e.decoder_free(op,records.length);}
  }
  async probeMath(records,expected=this.mathReference(records),requiredGuards=null,{allowGuards=false}={}) {
    const d=this.device,count=records.length/4,q=new Uint32Array(16);q[14]=count;
    pushErrors(d);let scoped=true;const resources=[];
    try {
      const input=storage(d,records),output=storage(d,count*8),params=uniform(d,q),guard=storage(d,4);resources.push(input,output,params,guard);
      const cmd=d.createCommandEncoder();this.program.dispatch(cmd,8,q,this.program.group(8,[input,null,null,output,params,guard]));d.queue.submit([cmd.finish()]);
      const actual=new Uint32Array(await readBuffer(d,output,count*8));let differences=0,guards=0,rawDifferences=0,missingGuards=0,first=null;
      for(let i=0;i<count;i++) {const f=actual[i*2+1];if(f) guards++;
        if(actual[i*2]!==expected[i])rawDifferences++;
        const required=requiredGuards?.[i]??false;
        if(required){if(!(f&1)){missingGuards++;first??={index:i,reason:'missing subnormal guard'};}}
        else if(!(allowGuards&&f)&&(f||actual[i*2]!==expected[i])) {differences++;first??={index:i,got:actual[i*2],expected:expected[i],flags:f};}
      }
      scoped=false;await popErrors(d);
      return {cases:count,differences,raw_differences:rawDifferences,guards,missing_guards:missingGuards,first,passed:!differences&&!missingGuards};
    } finally {if(scoped){try{await popErrors(d);}catch{}}for(const b of resources) b.destroy();}
  }
  async selfTest() {
    const start=performance.now(),d=this.device,cases=this.meta.self_tests,live=[],rows=[];
    try {
      const cmd=d.createCommandEncoder();let bytesNeeded=0;
      for(const test of cases) {
        const q=test.params,kind=q[0],aa=new Uint32Array(test.a),expected=new Uint32Array(test.expected);
        const input=storage(d,aa),w=storage(d,new Uint32Array(test.weights)),r=storage(d,new Uint32Array(test.r));
        const out=storage(d,inPlace(kind)?aa:expected.byteLength),params=uniform(d,q),guard=storage(d,4);
        live.push(input,w,r,out,params,guard);
        this.program.dispatch(cmd,kind,q,this.program.group(kind,[input,w,r,out,params,guard]));
        rows.push({kind,expected,out,guard,expectedGuard:0,offset:bytesNeeded});bytesNeeded+=expected.byteLength+4;
      }
      // Raw-word checks exercise the operand guard itself, including a flush
      // at bitcast/load, independently of the arithmetic known answers.
      for(const test of [{kind:9,word:null,expected:[],flags:0},
        {kind:9,word:[1,0x3f800000,0x80000000,0],expected:[],flags:1},
        {kind:10,word:[1,0x7f800000,0x50000000,0x80000000],expected:[0,0,0,0x80000000],flags:11}]){
        const q=new Uint32Array(16);q[14]=test.word?test.word.length:this.meta.weights;
        const data=test.word?storage(d,new Uint32Array(test.word)):this.weights,params=uniform(d,q),guard=storage(d,4);
        if(test.word)live.push(data);live.push(params,guard);
        this.program.dispatch(cmd,test.kind,q,this.program.group(test.kind,[null,test.kind===9?data:null,null,test.kind===10?data:null,params,guard]));
        const expected=new Uint32Array(test.expected);rows.push({kind:test.kind,checkedWords:q[14],expected,out:data,guard,expectedGuard:test.flags,offset:bytesNeeded});bytesNeeded+=expected.byteLength+4;
      }
      const read=storage(d,bytesNeeded,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);live.push(read);
      for(const row of rows){if(row.expected.byteLength)cmd.copyBufferToBuffer(row.out,0,read,row.offset,row.expected.byteLength);cmd.copyBufferToBuffer(row.guard,0,read,row.offset+row.expected.byteLength,4);}
      d.queue.submit([cmd.finish()]);await read.mapAsync(GPUMapMode.READ);const mapped=read.getMappedRange();
      const kernels=rows.map(row=>({kind:row.kind,checked_words:row.checkedWords,...bitDifference(new Uint32Array(mapped,row.offset,row.expected.length),row.expected),expected_guard:row.expectedGuard,guard:new Uint32Array(mapped,row.offset+row.expected.byteLength,1)[0]}));read.unmap();
      const known=mathKnownAnswers(),records=new Uint32Array(known.flatMap(c=>c.record));
      const math=await this.probeMath(records,this.mathReference(records),known.map(c=>c.guard));
      const ms=performance.now()-start;
      return {passed:math.passed&&kernels.every(k=>!k.bit_differences&&k.guard===k.expected_guard),ms,within_100ms:ms<100,kernels,math,
        policy:'Qualifies observed RN-even fused arithmetic; WGSL alone does not promise it. Corpus qualification remains required.'};
    } finally {for(const b of live)b.destroy();}
  }
  cpu(image,context,reason,extra={}) {
    const start=performance.now();
    if(this.e.encoder_run(this.encoder,image,context)!==1) throw Error('CPU encoder rejected image');
    const cpu_ms=performance.now()-start;
    return {backend:'cpu',reason,...extra,cpu_ms,wall_ms:(extra.wall_ms??0)+cpu_ms};
  }
  async encode(image,context,{captureRaw=false,observe=null}={}) {
    if(this.closed)throw Error('EncoderGPU is closed');
    if(this.busy) throw Error('Serialize encoder calls and WASM memory access');this.busy=true;
    const start=performance.now();let fallingBack=false,scoped=false;
    const fallback=(...args)=>{fallingBack=true;return this.cpu(...args);};
    try {
      if(!this.enabled) {if(this.resources?.length)this.releaseGPU();return fallback(image,context,this.status.reason);}
      const input=new Uint32Array(this.e.memory.buffer,image,256*1280);
      pushErrors(this.device);scoped=true;
      // Fresh ordinary ArrayBuffer: works even where writeBuffer rejects SAB views.
      this.device.queue.writeBuffer(this.buffers[0],0,input.slice());this.device.queue.writeBuffer(this.guard,0,new Uint32Array(1));
      let command=this.device.createCommandEncoder();
      this.program.dispatch(command,10,this.scanParams,this.scanGroup,this.timestamp&&!observe?{querySet:this.queries,beginningOfPassWriteIndex:0}:null);
      if(observe){this.device.queue.submit([command.finish()]);command=this.device.createCommandEncoder();}
      for(let i=0;i<this.ops.length;i++) {
        const op=this.ops[i],q=op.params;
        if(observe) await observe(this,op,i,'before');
        const stamp=this.timestamp&&!observe&&i===this.ops.length-1?{querySet:this.queries,endOfPassWriteIndex:1}:null;
        // No empty timestampWrites descriptors on intermediate passes.
        this.program.dispatch(command,q[0],q,op.group,stamp&&(stamp.beginningOfPassWriteIndex!==undefined||stamp.endOfPassWriteIndex!==undefined)?stamp:null);
        if(observe){this.device.queue.submit([command.finish()]);await observe(this,op,i,'after');command=this.device.createCommandEncoder();}
      }
      command.copyBufferToBuffer(this.buffers[this.meta.output],0,this.readback,0,this.contextBytes);
      command.copyBufferToBuffer(this.guard,0,this.readback,this.contextBytes,4);
      if(this.timestamp&&!observe){command.resolveQuerySet(this.queries,0,2,this.resolve,0);command.copyBufferToBuffer(this.resolve,0,this.readback,this.contextBytes+8,16);}
      this.device.queue.submit([command.finish()]);await this.readback.mapAsync(GPUMapMode.READ);
      let raw,guard,gpu_ms;
      try {
        scoped=false;await popErrors(this.device);
        const data=this.readback.getMappedRange();guard=new Uint32Array(data,this.contextBytes,1)[0];
        raw=captureRaw?new Uint32Array(data,0,this.contextBytes/4).slice():undefined;
        gpu_ms=this.timestamp&&!observe?Number(new BigUint64Array(data,this.contextBytes+8,2)[1]-new BigUint64Array(data,this.contextBytes+8,2)[0])/1e6:null;
        if(!guard&&this.enabled) new Uint8Array(this.e.memory.buffer,context,this.contextBytes).set(new Uint8Array(data,0,this.contextBytes));
      } finally {this.readback.unmap();}
      const stats={guard,gpu_ms,wall_ms:performance.now()-start,raw};
      if(guard||!this.enabled) {if(!this.enabled)this.releaseGPU();return fallback(image,context,guard?'GPU arithmetic guard':this.status.reason,stats);}
      return {backend:'gpu',...stats};
    } catch(error) {if(scoped){scoped=false;try{await popErrors(this.device);}catch{}}if(fallingBack)throw error;this.disable(String(error.stack||error));this.releaseGPU();return fallback(image,context,this.status.reason,{wall_ms:performance.now()-start});}
    finally {this.busy=false;}
  }
  // Diagnostic timing control only; never writes a context or affects fallback.
  async profile(image,{trials=3,reference=null}={}) {
    if(!this.enabled||!this.timestamp||this.busy)return {available:false,reason:'Need idle qualified GPU with timestamp-query'};
    if(!Number.isInteger(trials)||trials<1||trials>20)throw Error('profile trials must be 1..20');
    this.busy=true;const d=this.device,live=[];let scoped=false;
    try {
      pushErrors(d);scoped=true;
      const compile=performance.now(),control=await Program.create(d,true),legacy=await Program.create(d,false,true),control_compile_ms=performance.now()-compile;
      const groups=program=>this.ops.map(op=>program.group(op.params[0],[this.buffers[op.input],this.weights,this.buffers[op.residual],this.buffers[op.output],op.q,this.guard]));
      const variants=[{name:'tiled_guarded',program:this.program,groups:this.ops.map(op=>op.group),guarded:true,legacy:false},
        {name:'tiled_arithmetic_control',program:control,groups:groups(control),guarded:false,legacy:false},
        {name:'legacy_guarded',program:legacy,groups:groups(legacy),guarded:true,legacy:true}];
      const count=2*(this.ops.length+1),queries=d.createQuerySet({type:'timestamp',count});live.push(queries);
      const resolved=storage(d,count*8,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC);live.push(resolved);
      const rows=[],scan=[];let expected=reference instanceof Uint32Array?reference:reference?new Uint32Array(reference):null;
      for(let trial=-1;trial<trials;trial++)for(let turn=0;turn<variants.length;turn++){
        const variant=variants[(turn+trial+1)%variants.length],{guarded,program}=variant;
        // Restore raw input for each control: a preceding guarded run must not
        // silently sanitize the unguarded control's input.
        d.queue.writeBuffer(this.buffers[0],0,new Uint32Array(this.e.memory.buffer,image,256*1280).slice());
        d.queue.writeBuffer(this.guard,0,new Uint32Array(1));
        const cmd=d.createCommandEncoder();
        if(guarded)program.dispatch(cmd,10,this.scanParams,program.group(10,[null,null,null,this.buffers[0],this.scanQ,this.guard]),{querySet:queries,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1});
        for(let i=0;i<this.ops.length;i++){
          const op=this.ops[i];program.dispatch(cmd,op.params[0],op.params,variant.groups[i],{querySet:queries,beginningOfPassWriteIndex:2*(i+1),endOfPassWriteIndex:2*(i+1)+1});
        }
        // Unwritten scan queries are not resolved in the unguarded control.
        cmd.resolveQuerySet(queries,guarded?0:2,count-(guarded?0:2),resolved,0);d.queue.submit([cmd.finish()]);
        const times=new BigUint64Array(await readBuffer(d,resolved,(count-(guarded?0:2))*8));
        const flags=new Uint32Array(await readBuffer(d,this.guard,4))[0];
        const actual=new Uint32Array(await readBuffer(d,this.buffers[this.meta.output],this.contextBytes));expected??=actual;
        const diff=bitDifference(actual,expected),offset=guarded?2:0;
        const kernels=this.ops.map((op,i)=>({index:i,name:op.name,kind:op.params[0],gpu_ms:Number(times[offset+2*i+1]-times[offset+2*i])/1e6}));
        if(trial>=0)rows.push({trial,variant:variant.name,legacy:variant.legacy,guarded,flags,...diff,image_scan_ms:guarded?Number(times[1]-times[0])/1e6:0,kernels,
          dispatch_span_ms:Number(times.at(-1)-times[0])/1e6});
      }
      // Weight scanning is a one-time initialization cost, never per-staff.
      const q=new Uint32Array(16);q[14]=this.meta.weights;const params=uniform(d,q);live.push(params);
      const group=this.program.group(9,[null,this.weights,null,null,params,this.guard]);
      for(let trial=-1;trial<trials;trial++){
        d.queue.writeBuffer(this.guard,0,new Uint32Array(1));const cmd=d.createCommandEncoder();
        this.program.dispatch(cmd,9,q,group,{querySet:queries,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1});
        cmd.resolveQuerySet(queries,0,2,resolved,0);d.queue.submit([cmd.finish()]);
        const t=new BigUint64Array(await readBuffer(d,resolved,16)),flags=new Uint32Array(await readBuffer(d,this.guard,4))[0];
        if(trial>=0)scan.push({gpu_ms:Number(t[1]-t[0])/1e6,flags});
      }
      const median=xs=>xs.toSorted((a,b)=>a-b)[Math.floor(xs.length/2)],valid=rows.every(r=>!r.flags&&!r.bit_differences)&&scan.every(r=>!r.flags);
      const kernels=this.ops.map((op,i)=>{const guarded=median(rows.filter(r=>r.guarded&&!r.legacy).map(r=>r.kernels[i].gpu_ms)),arithmetic=median(rows.filter(r=>!r.guarded).map(r=>r.kernels[i].gpu_ms)),old=median(rows.filter(r=>r.legacy).map(r=>r.kernels[i].gpu_ms));
        return {index:i,name:op.name,kind:op.params[0],guarded_ms:guarded,arithmetic_control_ms:arithmetic,guard_delta_ms:valid?guarded-arithmetic:null,legacy_guarded_ms:old,speedup:valid&&guarded>0?old/guarded:null};});
      const totals={};for(const k of kernels){const t=totals[k.kind]??={kind:k.kind,kernel:entries[k.kind],guarded_ms:0,arithmetic_control_ms:0,legacy_guarded_ms:0};t.guarded_ms+=k.guarded_ms;t.arithmetic_control_ms+=k.arithmetic_control_ms;t.legacy_guarded_ms+=k.legacy_guarded_ms;}
      const image_scan_ms=median(rows.filter(r=>r.guarded&&!r.legacy).map(r=>r.image_scan_ms)),guarded_ms=kernels.reduce((n,k)=>n+k.guarded_ms,0)+image_scan_ms,arithmetic_control_ms=kernels.reduce((n,k)=>n+k.arithmetic_control_ms,0);
      const legacy_guarded_ms=kernels.reduce((n,k)=>n+k.legacy_guarded_ms,0)+median(rows.filter(r=>r.legacy).map(r=>r.image_scan_ms));
      scoped=false;await popErrors(d);
      return {available:true,valid,trials,control_compile_ms,kernels,by_kind:Object.values(totals),image_scan_ms,weight_scan_once_ms:median(scan.map(r=>r.gpu_ms)),guarded_ms,arithmetic_control_ms,legacy_guarded_ms,speedup:valid&&guarded_ms>0?legacy_guarded_ms/guarded_ms:null,
        guard_and_image_delta_ms:valid?guarded_ms-arithmetic_control_ms:null,guard_and_image_fraction:valid?(guarded_ms-arithmetic_control_ms)/guarded_ms:null,rows,weight_scan:scan,
        policy:'Per-pass timestamps; one warm-up and interleaved trials. Weight scan is a warm scan of resident weights, separate from initialization wall time. Deltas are noisy differential estimates, not additive hardware counters. Control removes wrapper FTZ/domain checks; rounding barriers and certified div/sqrt (including their flags) remain arithmetic. No control output is used for encoding.'};
    } finally {if(scoped){try{await popErrors(d);}catch{}}for(const b of live)b.destroy();this.busy=false;}
  }
  // Diagnostic timing control only; never writes a context or affects fallback.
  async measureGuardCost(image,{trials=3,reference=null}={}) {
    if(!this.enabled||!this.timestamp||this.busy) return {available:false,reason:'Need idle qualified GPU with timestamp-query'};
    this.busy=true;
    let scoped=false;
    try {
      pushErrors(this.device);scoped=true;
      const unguarded=await Program.create(this.device,true);
      const groups=this.ops.map(op=>unguarded.group(op.params[0],[this.buffers[op.input],this.weights,this.buffers[op.residual],this.buffers[op.output],op.q,this.guard]));
      const rows=[];let expected=reference instanceof Uint32Array?reference:reference?new Uint32Array(reference):null;
      this.device.queue.writeBuffer(this.buffers[0],0,new Uint32Array(this.e.memory.buffer,image,256*1280).slice());
      for(let trial=-1;trial<trials;trial++)for(const enabled of ((trial+1)%2?[false,true]:[true,false])){
        const program=enabled?this.program:unguarded,cmd=this.device.createCommandEncoder();
        this.device.queue.writeBuffer(this.guard,0,new Uint32Array(1));
        if(enabled)program.dispatch(cmd,10,this.scanParams,this.scanGroup,{querySet:this.queries,beginningOfPassWriteIndex:0});
        for(let i=0;i<this.ops.length;i++){const op=this.ops[i],timestampWrites=i===0&&!enabled?{querySet:this.queries,beginningOfPassWriteIndex:0}:i===this.ops.length-1?{querySet:this.queries,endOfPassWriteIndex:1}:null;
          program.dispatch(cmd,op.params[0],op.params,enabled?op.group:groups[i],timestampWrites);}
        cmd.resolveQuerySet(this.queries,0,2,this.resolve,0);this.device.queue.submit([cmd.finish()]);
        const times=new BigUint64Array(await readBuffer(this.device,this.resolve,16));
        const flags=new Uint32Array(await readBuffer(this.device,this.guard,4))[0];
        const actual=new Uint32Array(await readBuffer(this.device,this.buffers[this.meta.output],this.contextBytes));expected??=actual;
        const diff=bitDifference(actual,expected);
        if(trial>=0)rows.push({trial,guarded:enabled,gpu_ms:Number(times[1]-times[0])/1e6,flags,...diff});
      }
      const median=xs=>xs.toSorted((a,b)=>a-b)[Math.floor(xs.length/2)];
      const on=median(rows.filter(r=>r.guarded).map(r=>r.gpu_ms)),off=median(rows.filter(r=>!r.guarded).map(r=>r.gpu_ms));
      const valid=rows.every(r=>!r.flags&&!r.bit_differences);
      scoped=false;await popErrors(this.device);
      return {available:true,valid,rows,guarded_gpu_ms:on,unguarded_gpu_ms:off,overhead_percent:valid?(on/off-1)*100:null,policy:'Unguarded control is never used as an encoder result; finite-domain and FTZ checks removed, rounding barriers and certificates retained.'};
    } finally {if(scoped){try{await popErrors(this.device);}catch{}}this.busy=false;}
  }
  destroy() {
    if(this.busy) throw Error('Wait for encode before destroy');
    this.closed=true;this.releaseGPU();
  }
  releaseGPU(){
    this.enabled=false;this.retiredDevice=true;for(const b of this.resources)b.destroy();this.resources=[];this.queries?.destroy();this.device?.destroy();
    if(this.plan){this.e.encoder_gpu_plan_drop(this.plan);this.plan=0;}
  }
}
