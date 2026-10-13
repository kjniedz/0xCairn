// 0xCairn WebGPU kernel
//
// Two entry points:
//   address_main  - affine secp256k1 point walking + keccak256 address matching
//   create2_main  - CREATE2 salt mining (keccak256 only)
//
// Every invocation of address_main owns K points. Each round it hashes and
// checks all K, then advances all K by DELTA = (threads * K) * G using one
// shared modular inversion (Montgomery's trick). Private keys never exist on
// the GPU: it only ever sees public points and reports (index, round) pairs
// that the host turns back into a key and independently re-verifies.
//
// Field arithmetic is 8 x u32 limbs, little-endian limb order, fully reduced
// (0 <= v < p) after every operation. WGSL has no 64-bit integers, so 32x32
// products are assembled from 16-bit halves.

const K: u32 = __K__;
const MAX_RESULTS: u32 = 256u;

alias Fe = array<u32, 8>;

// p = 2^256 - 2^32 - 977
const P: Fe = Fe(0xFFFFFC2Fu, 0xFFFFFFFEu, 0xFFFFFFFFu, 0xFFFFFFFFu, 0xFFFFFFFFu, 0xFFFFFFFFu, 0xFFFFFFFFu, 0xFFFFFFFFu);

struct Params {
  rounds: u32,
  round_base: u32,
  threads: u32,
  case_sensitive: u32,
  // Address match: 20 bytes packed little-endian into 5 words (byte b -> word b/4, shift 8*(b%4)).
  mask: array<u32, 5>,
  value: array<u32, 5>,
  // EIP-55 case constraints over the 40 hex positions (bit i = position i).
  upper_lo: u32,
  upper_hi: u32,
  lower_lo: u32,
  lower_hi: u32,
  // address_main: delta point, dx limbs 0..7, dy limbs 8..15
  delta: array<u32, 16>,
  // create2_main: 136-byte keccak block with 0xff || deployer || 0*32 || initCodeHash || padding,
  // packed little-endian as 34 words; salt_base is big-endian 8 words (word 0 = most significant).
  block: array<u32, 34>,
  salt_base: array<u32, 8>,
}

struct Results {
  count: atomic<u32>,
  entries: array<u32>,
}

@group(0) @binding(0) var<storage, read> params: Params;
@group(0) @binding(1) var<storage, read_write> points: array<u32>;
@group(0) @binding(2) var<storage, read_write> results: Results;

// ---------------------------------------------------------------------------
// 32-bit helpers
// ---------------------------------------------------------------------------

// Full 32x32 -> 64 product as (lo, hi).
fn mul32(a: u32, b: u32) -> vec2<u32> {
  let a0 = a & 0xffffu;
  let a1 = a >> 16u;
  let b0 = b & 0xffffu;
  let b1 = b >> 16u;
  let p00 = a0 * b0;
  let p01 = a0 * b1;
  let p10 = a1 * b0;
  let p11 = a1 * b1;
  let mid = (p00 >> 16u) + (p01 & 0xffffu) + (p10 & 0xffffu);
  let lo = (p00 & 0xffffu) | (mid << 16u);
  let hi = p11 + (p01 >> 16u) + (p10 >> 16u) + (mid >> 16u);
  return vec2<u32>(lo, hi);
}

fn bswap(x: u32) -> u32 {
  return ((x & 0xffu) << 24u) | ((x & 0xff00u) << 8u) | ((x >> 8u) & 0xff00u) | (x >> 24u);
}

// ---------------------------------------------------------------------------
// Field arithmetic mod p
// ---------------------------------------------------------------------------

fn fe_add(a: Fe, b: Fe) -> Fe {
  var x = a;
  var y = b;
  var r: Fe;
  var carry = 0u;
  for (var i = 0u; i < 8u; i++) {
    let s = x[i] + y[i];
    let c1 = select(0u, 1u, s < x[i]);
    let t = s + carry;
    let c2 = select(0u, 1u, t < s);
    r[i] = t;
    carry = c1 + c2;
  }
  // trial subtract p
  var s: Fe;
  var borrow = 0u;
  for (var i = 0u; i < 8u; i++) {
    let d = r[i] - P[i];
    let b1 = select(0u, 1u, r[i] < P[i]);
    let t = d - borrow;
    let b2 = select(0u, 1u, d < borrow);
    s[i] = t;
    borrow = b1 + b2;
  }
  if (carry != 0u || borrow == 0u) {
    return s;
  }
  return r;
}

fn fe_sub(a: Fe, b: Fe) -> Fe {
  var x = a;
  var y = b;
  var r: Fe;
  var borrow = 0u;
  for (var i = 0u; i < 8u; i++) {
    let d = x[i] - y[i];
    let b1 = select(0u, 1u, x[i] < y[i]);
    let t = d - borrow;
    let b2 = select(0u, 1u, d < borrow);
    r[i] = t;
    borrow = b1 + b2;
  }
  if (borrow != 0u) {
    var carry = 0u;
    for (var i = 0u; i < 8u; i++) {
      let s = r[i] + P[i];
      let c1 = select(0u, 1u, s < r[i]);
      let t = s + carry;
      let c2 = select(0u, 1u, t < s);
      r[i] = t;
      carry = c1 + c2;
    }
  }
  return r;
}

// Add v at limb idx of a 10-limb accumulator, propagating carries upward.
fn add_at(r: ptr<function, array<u32, 10>>, idx: u32, v: u32) {
  var i = idx;
  var c = v;
  loop {
    if (c == 0u || i >= 10u) {
      break;
    }
    let s = (*r)[i] + c;
    c = select(0u, 1u, s < c);
    (*r)[i] = s;
    i++;
  }
}

// Reduce a 512-bit product (16 limbs) mod p using 2^256 = 2^32 + 977 (mod p).
fn fe_reduce(t: array<u32, 16>) -> Fe {
  var tt = t;
  var r: array<u32, 10>;
  for (var i = 0u; i < 8u; i++) {
    r[i] = tt[i];
  }
  r[8] = 0u;
  r[9] = 0u;
  // r += H * 977 + H << 32
  var carry = 0u;
  for (var i = 0u; i < 8u; i++) {
    let h = tt[8u + i];
    let p = mul32(h, 977u);
    let s = p.x + carry;
    let c = select(0u, 1u, s < p.x);
    add_at(&r, i, s);
    carry = p.y + c;
    add_at(&r, i + 1u, h);
  }
  add_at(&r, 8u, carry);
  // second fold: h = r[8] + r[9] * 2^32 (r[9] <= 1)
  let h8 = r[8];
  let h9 = r[9];
  r[8] = 0u;
  r[9] = 0u;
  let p8 = mul32(h8, 977u);
  add_at(&r, 0u, p8.x);
  add_at(&r, 1u, p8.y);
  add_at(&r, 1u, h8);
  add_at(&r, 1u, h9 * 977u);
  add_at(&r, 2u, h9);
  // third fold: r[8] is 0 or 1
  if (r[8] != 0u) {
    r[8] = 0u;
    add_at(&r, 0u, 977u);
    add_at(&r, 1u, 1u);
  }
  var out: Fe;
  for (var i = 0u; i < 8u; i++) {
    out[i] = r[i];
  }
  // conditional subtract p (value < 2^256 < 2p so once is enough)
  var s: Fe;
  var borrow = 0u;
  for (var i = 0u; i < 8u; i++) {
    let d = out[i] - P[i];
    let b1 = select(0u, 1u, out[i] < P[i]);
    let u = d - borrow;
    let b2 = select(0u, 1u, d < borrow);
    s[i] = u;
    borrow = b1 + b2;
  }
  if (borrow == 0u) {
    return s;
  }
  return out;
}

fn fe_mul(a: Fe, b: Fe) -> Fe {
  var x = a;
  var y = b;
  var t: array<u32, 16>;
  var c0 = 0u;
  var c1 = 0u;
  var c2 = 0u;
  for (var k = 0u; k < 15u; k++) {
    var lo_s = 0u;
    var lo_c = 0u;
    var hi_s = 0u;
    var hi_c = 0u;
    for (var i = 0u; i < 8u; i++) {
      let j = k - i; // wraps when i > k
      if (j < 8u) {
        let p = mul32(x[i], y[j]);
        lo_s += p.x;
        lo_c += select(0u, 1u, lo_s < p.x);
        hi_s += p.y;
        hi_c += select(0u, 1u, hi_s < p.y);
      }
    }
    c0 += lo_s;
    let k0 = select(0u, 1u, c0 < lo_s);
    c1 += hi_s;
    var k1 = select(0u, 1u, c1 < hi_s);
    c1 += lo_c;
    k1 += select(0u, 1u, c1 < lo_c);
    c1 += k0;
    k1 += select(0u, 1u, c1 < k0);
    c2 += hi_c + k1;
    t[k] = c0;
    c0 = c1;
    c1 = c2;
    c2 = 0u;
  }
  t[15] = c0;
  return fe_reduce(t);
}

fn fe_sqr(a: Fe) -> Fe {
  return fe_mul(a, a);
}

fn fe_sqr_n(a: Fe, n: u32) -> Fe {
  var x = a;
  for (var i = 0u; i < n; i++) {
    x = fe_mul(x, x);
  }
  return x;
}

// a^(p-2) via the libsecp256k1 addition chain (255 squarings, 15 multiplies).
fn fe_inv(a: Fe) -> Fe {
  let x2 = fe_mul(fe_sqr(a), a);
  let x3 = fe_mul(fe_sqr(x2), a);
  let x6 = fe_mul(fe_sqr_n(x3, 3u), x3);
  let x9 = fe_mul(fe_sqr_n(x6, 3u), x3);
  let x11 = fe_mul(fe_sqr_n(x9, 2u), x2);
  let x22 = fe_mul(fe_sqr_n(x11, 11u), x11);
  let x44 = fe_mul(fe_sqr_n(x22, 22u), x22);
  let x88 = fe_mul(fe_sqr_n(x44, 44u), x44);
  let x176 = fe_mul(fe_sqr_n(x88, 88u), x88);
  let x220 = fe_mul(fe_sqr_n(x176, 44u), x44);
  let x223 = fe_mul(fe_sqr_n(x220, 3u), x3);
  var t1 = fe_mul(fe_sqr_n(x223, 23u), x22);
  t1 = fe_mul(fe_sqr_n(t1, 5u), a);
  t1 = fe_mul(fe_sqr_n(t1, 3u), x2);
  return fe_mul(fe_sqr_n(t1, 2u), a);
}

// ---------------------------------------------------------------------------
// Keccak-f[1600] on 25 lanes stored as 50 u32 (lo, hi) pairs
// ---------------------------------------------------------------------------

const RC: array<u32, 48> = array<u32, 48>(
  0x00000001u, 0x00000000u, 0x00008082u, 0x00000000u, 0x0000808Au, 0x80000000u, 0x80008000u, 0x80000000u,
  0x0000808Bu, 0x00000000u, 0x80000001u, 0x00000000u, 0x80008081u, 0x80000000u, 0x00008009u, 0x80000000u,
  0x0000008Au, 0x00000000u, 0x00000088u, 0x00000000u, 0x80008009u, 0x00000000u, 0x8000000Au, 0x00000000u,
  0x8000808Bu, 0x00000000u, 0x0000008Bu, 0x80000000u, 0x00008089u, 0x80000000u, 0x00008003u, 0x80000000u,
  0x00008002u, 0x80000000u, 0x00000080u, 0x80000000u, 0x0000800Au, 0x00000000u, 0x8000000Au, 0x80000000u,
  0x80008081u, 0x80000000u, 0x00008080u, 0x80000000u, 0x80000001u, 0x00000000u, 0x80008008u, 0x80000000u
);

// rotation offsets, index = x + 5*y
const RHO: array<u32, 25> = array<u32, 25>(
  0u, 1u, 62u, 28u, 27u,
  36u, 44u, 6u, 55u, 20u,
  3u, 10u, 43u, 25u, 39u,
  41u, 45u, 15u, 21u, 8u,
  18u, 2u, 61u, 56u, 14u
);

fn rotl64(v: vec2<u32>, n: u32) -> vec2<u32> {
  if (n == 0u) {
    return v;
  }
  if (n < 32u) {
    return vec2<u32>((v.x << n) | (v.y >> (32u - n)), (v.y << n) | (v.x >> (32u - n)));
  }
  if (n == 32u) {
    return vec2<u32>(v.y, v.x);
  }
  let m = n - 32u;
  return vec2<u32>((v.y << m) | (v.x >> (32u - m)), (v.x << m) | (v.y >> (32u - m)));
}

fn keccak_f(st: ptr<function, array<u32, 50>>) {
  for (var round = 0u; round < 24u; round++) {
    // theta
    var c: array<u32, 10>;
    for (var x = 0u; x < 5u; x++) {
      c[2u * x] = (*st)[2u * x] ^ (*st)[2u * (x + 5u)] ^ (*st)[2u * (x + 10u)] ^ (*st)[2u * (x + 15u)] ^ (*st)[2u * (x + 20u)];
      c[2u * x + 1u] = (*st)[2u * x + 1u] ^ (*st)[2u * (x + 5u) + 1u] ^ (*st)[2u * (x + 10u) + 1u] ^ (*st)[2u * (x + 15u) + 1u] ^ (*st)[2u * (x + 20u) + 1u];
    }
    for (var x = 0u; x < 5u; x++) {
      let xm = (x + 4u) % 5u;
      let xp = (x + 1u) % 5u;
      let r = rotl64(vec2<u32>(c[2u * xp], c[2u * xp + 1u]), 1u);
      let dlo = c[2u * xm] ^ r.x;
      let dhi = c[2u * xm + 1u] ^ r.y;
      for (var y = 0u; y < 5u; y++) {
        let i = x + 5u * y;
        (*st)[2u * i] ^= dlo;
        (*st)[2u * i + 1u] ^= dhi;
      }
    }
    // rho + pi
    var b: array<u32, 50>;
    for (var x = 0u; x < 5u; x++) {
      for (var y = 0u; y < 5u; y++) {
        let i = x + 5u * y;
        let j = y + 5u * ((2u * x + 3u * y) % 5u);
        let r = rotl64(vec2<u32>((*st)[2u * i], (*st)[2u * i + 1u]), RHO[i]);
        b[2u * j] = r.x;
        b[2u * j + 1u] = r.y;
      }
    }
    // chi
    for (var y = 0u; y < 5u; y++) {
      for (var x = 0u; x < 5u; x++) {
        let i = x + 5u * y;
        let i1 = ((x + 1u) % 5u) + 5u * y;
        let i2 = ((x + 2u) % 5u) + 5u * y;
        (*st)[2u * i] = b[2u * i] ^ ((~b[2u * i1]) & b[2u * i2]);
        (*st)[2u * i + 1u] = b[2u * i + 1u] ^ ((~b[2u * i1 + 1u]) & b[2u * i2 + 1u]);
      }
    }
    // iota
    (*st)[0] ^= RC[2u * round];
    (*st)[1] ^= RC[2u * round + 1u];
  }
}

// keccak256(x || y) for a 64-byte uncompressed public key body. Returns the
// 20-byte address as 5 little-endian-packed words.
fn address_of(x: Fe, y: Fe) -> array<u32, 5> {
  var xx = x;
  var yy = y;
  var st: array<u32, 50>;
  for (var i = 0u; i < 50u; i++) {
    st[i] = 0u;
  }
  for (var k = 0u; k < 4u; k++) {
    st[2u * k] = bswap(xx[7u - 2u * k]);
    st[2u * k + 1u] = bswap(xx[6u - 2u * k]);
    st[2u * (k + 4u)] = bswap(yy[7u - 2u * k]);
    st[2u * (k + 4u) + 1u] = bswap(yy[6u - 2u * k]);
  }
  st[16] = 0x01u;          // lane 8 lo: byte 64 = 0x01 (keccak pad start)
  st[33] = 0x80000000u;    // lane 16 hi: byte 135 |= 0x80 (pad end)
  keccak_f(&st);
  return array<u32, 5>(st[3], st[4], st[5], st[6], st[7]);
}

fn hex_char(n: u32) -> u32 {
  return select(n + 87u, n + 48u, n < 10u);
}

// EIP-55 check: hash the 40 lowercase hex chars and compare the case bits.
fn checksum_ok(addr: array<u32, 5>) -> bool {
  var a = addr;
  var st: array<u32, 50>;
  for (var i = 0u; i < 50u; i++) {
    st[i] = 0u;
  }
  for (var c = 0u; c < 40u; c++) {
    let byte = (a[(c >> 1u) >> 2u] >> (8u * ((c >> 1u) & 3u))) & 0xffu;
    let nib = select(byte & 15u, byte >> 4u, (c & 1u) == 0u);
    st[c >> 2u] |= hex_char(nib) << (8u * (c & 3u));
  }
  st[10] = 0x01u;          // byte 40 = 0x01
  st[33] = 0x80000000u;    // byte 135 |= 0x80
  keccak_f(&st);
  var up_lo = 0u;
  var up_hi = 0u;
  for (var i = 0u; i < 40u; i++) {
    let byte = (st[(i >> 1u) >> 2u] >> (8u * ((i >> 1u) & 3u))) & 0xffu;
    let nib = select(byte & 15u, byte >> 4u, (i & 1u) == 0u);
    let up = select(0u, 1u, nib >= 8u);
    if (i < 32u) {
      up_lo |= up << i;
    } else {
      up_hi |= up << (i - 32u);
    }
  }
  let want_upper = ((up_lo & params.upper_lo) == params.upper_lo) && ((up_hi & params.upper_hi) == params.upper_hi);
  let want_lower = ((up_lo & params.lower_lo) == 0u) && ((up_hi & params.lower_hi) == 0u);
  return want_upper && want_lower;
}

fn matches(addr: array<u32, 5>) -> bool {
  var a = addr;
  for (var i = 0u; i < 5u; i++) {
    if ((a[i] & params.mask[i]) != params.value[i]) {
      return false;
    }
  }
  if (params.case_sensitive != 0u) {
    return checksum_ok(a);
  }
  return true;
}

fn report(idx: u32, round: u32) {
  let slot = atomicAdd(&results.count, 1u);
  if (slot < MAX_RESULTS) {
    results.entries[2u * slot] = idx;
    results.entries[2u * slot + 1u] = round;
  }
}

// ---------------------------------------------------------------------------
// Entry: address mining
// ---------------------------------------------------------------------------

@compute @workgroup_size(64)
fn address_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let t = gid.x;
  if (t >= params.threads) {
    return;
  }
  var xs: array<Fe, K>;
  var ys: array<Fe, K>;
  let base = t * K * 16u;
  for (var j = 0u; j < K; j++) {
    for (var l = 0u; l < 8u; l++) {
      xs[j][l] = points[base + j * 16u + l];
      ys[j][l] = points[base + j * 16u + 8u + l];
    }
  }
  var dx: Fe;
  var dy: Fe;
  for (var l = 0u; l < 8u; l++) {
    dx[l] = params.delta[l];
    dy[l] = params.delta[8u + l];
  }

  for (var r = 0u; r < params.rounds; r++) {
    for (var j = 0u; j < K; j++) {
      if (matches(address_of(xs[j], ys[j]))) {
        report(t * K + j, params.round_base + r);
      }
    }
    // batch inversion of (x_j - dx)
    var d: array<Fe, K>;
    var c: array<Fe, K>;
    for (var j = 0u; j < K; j++) {
      d[j] = fe_sub(xs[j], dx);
    }
    c[0] = d[0];
    for (var j = 1u; j < K; j++) {
      c[j] = fe_mul(c[j - 1u], d[j]);
    }
    var inv = fe_inv(c[K - 1u]);
    var j = K - 1u;
    loop {
      var inv_j: Fe;
      if (j == 0u) {
        inv_j = inv;
      } else {
        inv_j = fe_mul(inv, c[j - 1u]);
        inv = fe_mul(inv, d[j]);
      }
      // (x3, y3) = (x_j, y_j) + (dx, dy)
      let lam = fe_mul(fe_sub(ys[j], dy), inv_j);
      let x3 = fe_sub(fe_sub(fe_mul(lam, lam), xs[j]), dx);
      let y3 = fe_sub(fe_mul(lam, fe_sub(xs[j], x3)), ys[j]);
      xs[j] = x3;
      ys[j] = y3;
      if (j == 0u) {
        break;
      }
      j--;
    }
  }

  for (var j = 0u; j < K; j++) {
    for (var l = 0u; l < 8u; l++) {
      points[base + j * 16u + l] = xs[j][l];
      points[base + j * 16u + 8u + l] = ys[j][l];
    }
  }
}

// ---------------------------------------------------------------------------
// Entry: CREATE2 salt mining
// ---------------------------------------------------------------------------

@compute @workgroup_size(64)
fn create2_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let t = gid.x;
  if (t >= params.threads) {
    return;
  }
  for (var r = 0u; r < params.rounds; r++) {
    // 64-bit offset = (round_base + r) * threads + t
    let prod = mul32(params.round_base + r, params.threads);
    var off_lo = prod.x + t;
    var off_hi = prod.y + select(0u, 1u, off_lo < t);
    // salt = salt_base + offset (big-endian words, word 7 least significant)
    var salt: array<u32, 8>;
    for (var i = 0u; i < 8u; i++) {
      salt[i] = params.salt_base[i];
    }
    var s7 = salt[7] + off_lo;
    var carry = select(0u, 1u, s7 < off_lo);
    salt[7] = s7;
    var s6 = salt[6] + off_hi;
    var c6 = select(0u, 1u, s6 < off_hi);
    s6 += carry;
    c6 += select(0u, 1u, s6 < carry);
    salt[6] = s6;
    carry = c6;
    var i = 5u;
    loop {
      if (carry == 0u) {
        break;
      }
      let s = salt[i] + carry;
      carry = select(0u, 1u, s < carry);
      salt[i] = s;
      if (i == 0u) {
        break;
      }
      i--;
    }
    var st: array<u32, 50>;
    for (var w = 0u; w < 34u; w++) {
      st[w] = params.block[w];
    }
    for (var w = 34u; w < 50u; w++) {
      st[w] = 0u;
    }
    // salt occupies bytes 21..52 of the block (big-endian byte order)
    for (var b = 0u; b < 32u; b++) {
      let word = salt[b >> 2u];
      let byte = (word >> (8u * (3u - (b & 3u)))) & 0xffu;
      let p = 21u + b;
      st[p >> 2u] |= byte << (8u * (p & 3u));
    }
    keccak_f(&st);
    let addr = array<u32, 5>(st[3], st[4], st[5], st[6], st[7]);
    if (matches(addr)) {
      report(t, params.round_base + r);
    }
  }
}
