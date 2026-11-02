// Ordered binary32 arithmetic. The host MUST write zero to p.round_mask.
// The runtime integer XOR is a rounding boundary: the compiler cannot fuse
// floating operations across an unknown integer transformation of their bits.
// Hardware RN-even add/mul/fused-fma are qualified by the load test and corpus,
// not guaranteed by WGSL. Division/sqrt additionally carry integer certificates.
// Erf/inner-exp arithmetic and coefficients follow ORT MLAS (MIT, Microsoft),
// as in src/encoder/simd.rs and src/decoder/activation.rs.
/* MLAS-derived polynomial sequences:
Copyright (c) Microsoft Corporation. All rights reserved.
MIT License
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
export const arithmetic = `
var<private> faults: u32;
const SUBNORMAL: u32 = 1u;
const NONFINITE: u32 = 2u;
const UNCERTIFIED: u32 = 4u;
const DOMAIN: u32 = 8u;
fn mag(x: f32) -> u32 { return bitcast<u32>(x) & 0x7fffffffu; }
fn probe_word(word:u32)->f32 {
  // Check storage bits *before* constructing a float (a backend may flush a
  // subnormal at a floating expression, not just at arithmetic instructions).
  let m=word&0x7fffffffu;
  if(m>0u && m<0x800000u){faults|=SUBNORMAL;return 0.0;}
  if(m>=0x7f800000u){faults|=NONFINITE;return 0.0;}
  return bitcast<f32>(word);
}
fn constructed(word:u32)->f32 {return inspect(probe_word(word));}
fn inspect(x: f32) -> f32 {
  let m = mag(x);
  if (m > 0u && m < 0x00800000u) { faults |= SUBNORMAL; return 0.0; }
  if (m >= 0x7f800000u) { faults |= NONFINITE; return 0.0; }
  // Stored operands <=2^32 keep scalar mul/fma finite; plus4 also consumes
  // proved vector prefixes <2^76. Clip before a later operation can overflow.
  if (m > 0x4f800000u) { faults |= DOMAIN; return 0.0; }
  return bitcast<f32>(bitcast<u32>(x) ^ p.round_mask);
}
fn wide(a: u32, b: u32) -> vec2<u32> {
  let a0 = a & 65535u; let a1 = a >> 16u;
  let b0 = b & 65535u; let b1 = b >> 16u;
  let t0 = a0 * b0;
  let t1 = a1 * b0 + (t0 >> 16u);
  let t2 = a0 * b1 + (t1 & 65535u);
  return vec2<u32>((t2 << 16u) | (t0 & 65535u), a1*b1 + (t1 >> 16u) + (t2 >> 16u));
}
fn shifted(a: u32, n: u32) -> vec2<u32> {
  // All callers have 1 <= n <= 31.
  return vec2<u32>(a << n, a >> (32u-n));
}
fn cmp(a: vec2<u32>, b: vec2<u32>) -> i32 {
  if (a.y < b.y || (a.y == b.y && a.x < b.x)) { return -1; }
  if (all(a == b)) { return 0; }
  return 1;
}
fn exact_cancel(a: f32, b: f32, c: f32) -> bool {
  let aa = bitcast<u32>(a); let bb = bitcast<u32>(b); let cc = bitcast<u32>(c);
  if (mag(a) == 0u || mag(b) == 0u) { return mag(c) == 0u; }
  if (mag(c) == 0u || ((aa ^ bb ^ cc) & 0x80000000u) == 0u) { return false; }
  let ea = i32((aa >> 23u) & 255u); let eb = i32((bb >> 23u) & 255u);
  let ec = i32((cc >> 23u) & 255u);
  let shift = ec - ea - eb + 150;
  if (ea == 0 || eb == 0 || ec == 0 || shift < 1 || shift > 31) { return false; }
  return all(wide((aa & 0x7fffffu) | 0x800000u, (bb & 0x7fffffu) | 0x800000u)
    == shifted((cc & 0x7fffffu) | 0x800000u, u32(shift)));
}
fn plus(a: f32, b: f32) -> f32 {
  let r = a + b;
  if (mag(r) == 0u && !(mag(a) == mag(b) &&
      (mag(a) == 0u || ((bitcast<u32>(a) ^ bitcast<u32>(b)) >> 31u) != 0u))) { faults |= SUBNORMAL; }
  return inspect(r);
}
fn minus(a: f32, b: f32) -> f32 { return plus(a, bitcast<f32>(bitcast<u32>(b) ^ 0x80000000u)); }
fn times(a: f32, b: f32) -> f32 {
  let r = a * b;
  if (mag(r) == 0u && mag(a) != 0u && mag(b) != 0u) { faults |= SUBNORMAL; }
  return inspect(r);
}
fn fused(a: f32, b: f32, c: f32) -> f32 {
  let r = fma(a, b, c);
  if (mag(r) == 0u) { if (!exact_cancel(a,b,c)) { faults |= SUBNORMAL; } }
  return inspect(r);
}
fn plus4(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(plus(a.x,b.x),plus(a.y,b.y),plus(a.z,b.z),plus(a.w,b.w));
}
fn fused4(a: vec4<f32>, b: vec4<f32>, c: vec4<f32>) -> vec4<f32> {
  // One explicit vector fma, preserving the fc1 probe's code generation.
  let r = fma(a,b,c);
  var bits = bitcast<vec4<u32>>(r);let magnitude = bits & vec4<u32>(0x7fffffffu);
  // Entry operands/weights are bounded by 2^32; K<=1536. Even with rounding,
  // every prefix stays below 2^76. Check only FTZ in the hot loop; store4
  // enforces the next op's magnitude domain. This avoids four more comparisons
  // and selects on every normal FMA, without relaxing any arithmetic order.
  if (any(magnitude < vec4<u32>(0x800000u))) {
    if (magnitude.x==0u) { if (!exact_cancel(a.x,b.x,c.x)) { faults |= SUBNORMAL; } }
    if (magnitude.y==0u) { if (!exact_cancel(a.y,b.y,c.y)) { faults |= SUBNORMAL; } }
    if (magnitude.z==0u) { if (!exact_cancel(a.z,b.z,c.z)) { faults |= SUBNORMAL; } }
    if (magnitude.w==0u) { if (!exact_cancel(a.w,b.w,c.w)) { faults |= SUBNORMAL; } }
    let tiny=(magnitude>vec4<u32>(0u)) & (magnitude<vec4<u32>(0x800000u));
    if(any(tiny)){faults|=SUBNORMAL;bits=select(bits,vec4<u32>(0u),tiny);}
  }
  return bitcast<vec4<f32>>(bits ^ vec4<u32>(p.round_mask));
}
fn correction(exact_value: vec2<u32>, low: vec2<u32>, high: vec2<u32>, m: u32) -> i32 {
  let lo = cmp(exact_value,low); let hi = cmp(exact_value,high); let odd = (m & 1u) != 0u;
  if (lo < 0 || (lo == 0 && odd)) { return -1; }
  if (hi > 0 || (hi == 0 && odd)) { return 1; }
  return 0;
}
fn assemble(m0: u32, exponent0: i32, sign: u32) -> f32 {
  var m = m0; var exponent = exponent0;
  if (m == 0x1000000u) { m = 0x800000u; exponent++; }
  if (m < 0x800000u || m > 0xffffffu) { faults |= UNCERTIFIED; return 0.0; }
  if (exponent < -126) { faults |= SUBNORMAL; return 0.0; }
  if (exponent > 127) { faults |= NONFINITE; return 0.0; }
  return bitcast<f32>(sign | (u32(exponent + 127) << 23u) | (m & 0x7fffffu));
}
fn divide(a: f32, b: f32) -> f32 {
  let ab = bitcast<u32>(a); let bb = bitcast<u32>(b);
  let ax = ab & 0x7fffffffu; let bx = bb & 0x7fffffffu;
  let sign = (ab ^ bb) & 0x80000000u;
  if (bx < 0x800000u || bx >= 0x7f800000u || ax >= 0x7f800000u) {
    faults |= UNCERTIFIED; return 0.0;
  }
  if (ax == 0u) { return bitcast<f32>(sign); }
  if (ax < 0x800000u) { faults |= SUBNORMAL; return 0.0; }
  let ma = (ab & 0x7fffffu) | 0x800000u; let mb = (bb & 0x7fffffu) | 0x800000u;
  let an = bitcast<f32>(0x3f800000u | (ab & 0x7fffffu));
  let bn = bitcast<f32>(0x3f800000u | (bb & 0x7fffffu));
  var reciprocal = bitcast<f32>(0x7ef311c3u - bitcast<u32>(bn));
  for (var i=0u; i<4u; i++) { reciprocal = fma(reciprocal, fma(-bn,reciprocal,1.0), reciprocal); }
  let q0 = an * reciprocal;
  let q = fma(fma(-q0,bn,an), reciprocal, q0);
  let e = select(-1,0,ma >= mb);
  // Clamp to the *proved* exact quotient bin; a bin-boundary seed may lie one
  // float outside it. No approximate operation participates in the certificate.
  let qb = clamp(bitcast<u32>(q),u32(127+e)<<23u,u32(128+e)<<23u);
  var m = ((qb & 0x7fffffu) | 0x800000u) << u32(i32(qb >> 23u)-127-e);
  let exact_value = shifted(ma,u32(24-e));
  var delta = correction(exact_value,wide(2u*m-1u,mb),wide(2u*m+1u,mb),m);
  m = u32(i32(m)+delta);
  delta = correction(exact_value,wide(2u*m-1u,mb),wide(2u*m+1u,mb),m);
  if (delta != 0) { faults |= UNCERTIFIED; return 0.0; }
  let exponent = e+i32(ax>>23u)-i32(bx>>23u);
  // At the normal/subnormal boundary the spacing below min-normal doubles
  // relative to this normalized bin. Certify its exact halfway threshold.
  if (exponent == -127 && cmp(exact_value,wide(0x1fffffeu,mb)) >= 0) {
    return bitcast<f32>(sign | 0x800000u);
  }
  return assemble(m,exponent,sign);
}
fn square_root(x: f32) -> f32 {
  let xb = bitcast<u32>(x); let ax = xb & 0x7fffffffu;
  if (ax == 0u) { return x; }
  if (ax < 0x800000u) { faults |= SUBNORMAL; return 0.0; }
  if ((xb & 0x80000000u) != 0u || ax >= 0x7f800000u) { faults |= UNCERTIFIED; return 0.0; }
  let e = i32(ax >> 23u)-127; let parity = u32(e & 1);
  let an = bitcast<f32>(((127u+parity)<<23u) | (xb & 0x7fffffu));
  var reciprocal = bitcast<f32>(0x5f375a86u - (bitcast<u32>(an)>>1u));
  for (var i=0u; i<4u; i++) { reciprocal *= fma(-0.5*an,reciprocal*reciprocal,1.5); }
  let q0 = an*reciprocal;
  let q = fma(fma(-q0,q0,an),0.5*reciprocal,q0);
  let qb = clamp(bitcast<u32>(q),0x3f800000u,0x40000000u);
  var m = ((qb & 0x7fffffu) | 0x800000u) << ((qb>>23u)-127u);
  let exact_value = shifted((xb & 0x7fffffu) | 0x800000u,25u+parity);
  var delta = correction(exact_value,wide(2u*m-1u,2u*m-1u),wide(2u*m+1u,2u*m+1u),m);
  m = u32(i32(m)+delta);
  delta = correction(exact_value,wide(2u*m-1u,2u*m-1u),wide(2u*m+1u,2u*m+1u),m);
  if (delta != 0) { faults |= UNCERTIFIED; return 0.0; }
  return assemble(m,(e-i32(parity))/2,0u);
}
fn erf_exp(x0: f32) -> f32 {
  let x = max(x0, bitcast<f32>(0xc2b0c0a5u));
  let biased = fused(x,bitcast<f32>(0x3fb8aa3bu),12582912.0);
  let m = minus(biased,12582912.0);
  let r0 = fused(m,bitcast<f32>(0xbf317200u),x);
  let r = fused(m,bitcast<f32>(0xb5bfbe8eu),r0);
  let scale = constructed((bitcast<u32>(biased)<<23u)+0x3f800000u);
  var v = bitcast<f32>(0x3ab54c6du);
  v=fused(v,r,bitcast<f32>(0x3c093965u));
  v=fused(v,r,bitcast<f32>(0x3d2aad10u));
  v=fused(v,r,bitcast<f32>(0x3e2aaa17u));
  v=fused(v,r,bitcast<f32>(0x3efffffbu));
  v=fused(v,r,1.0); v=fused(v,r,1.0);
  return times(v,scale);
}
fn erf_cpu(v: f32) -> f32 {
  let a = min(abs(v),bitcast<f32>(0x407b3333u));
  var result: f32;
  if (a <= 0.921875) {
    let a2 = times(a,a);
    var h = bitcast<f32>(0xba1d0d41u);
    h=fused(h,a2,bitcast<f32>(0x3ba39fa4u));
    h=fused(h,a2,bitcast<f32>(0xbcdb45e9u));
    h=fused(h,a2,bitcast<f32>(0x3de70d23u));
    h=fused(h,a2,bitcast<f32>(0xbec09370u));
    h=fused(h,a2,bitcast<f32>(0x3e0375d3u));
    result = fused(h,a,a);
  } else {
    var h = bitcast<f32>(0x37911480u);
    h=fused(h,a,bitcast<f32>(0xb9c8e966u));
    h=fused(h,a,bitcast<f32>(0x3b7e899bu));
    h=fused(h,a,bitcast<f32>(0xbcc6b180u));
    h=fused(h,a,bitcast<f32>(0x3ddaae58u));
    h=fused(h,a,bitcast<f32>(0x3f228550u));
    h=fused(h,a,bitcast<f32>(0x3e03ce86u));
    result = minus(1.0,erf_exp(-fused(h,a,a)));
  }
  return bitcast<f32>(bitcast<u32>(result) | (bitcast<u32>(v)&0x80000000u));
}
fn gelu_cpu(x: f32) -> f32 {
  let half = times(0.5,x);
  let z = times(x,bitcast<f32>(0x3f3504f3u));
  let e = plus(erf_cpu(z),1.0);
  return times(half,e);
}
`;
