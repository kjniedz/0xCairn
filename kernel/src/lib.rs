//! 0xCairn mining kernel.
//!
//! Compiled to `wasm32-unknown-unknown` and loaded by each Web Worker. The
//! kernel owns one miner instance per WebAssembly instance; all input and
//! output moves through a small fixed I/O buffer exposed by `io_ptr()`.
//!
//! Security notes
//! - Seeds are supplied by the host from `crypto.getRandomValues` and must be
//!   full 256-bit scalars. The kernel never generates randomness itself.
//! - The kernel increments a 256-bit seed; it never derives keys from a small
//!   counter (the Profanity flaw).
//! - The host independently re-derives every reported address from the
//!   reported key before showing it to the user.

use k256::elliptic_curve::group::prime::PrimeCurveAffine;
use k256::elliptic_curve::sec1::{FromEncodedPoint, ToEncodedPoint};
use k256::elliptic_curve::PrimeField;
use k256::{AffinePoint, EncodedPoint, FieldElement, ProjectivePoint, Scalar};
use tiny_keccak::{Hasher, Keccak};

const IO_SIZE: usize = 4096;
static mut IO: [u8; IO_SIZE] = [0; IO_SIZE];
static mut PATTERN: Option<Pattern> = None;
static mut MINER: Option<Miner> = None;
static mut CREATE2: Option<Create2> = None;
static mut EXPORT: Vec<u8> = Vec::new();

const HEX: &[u8; 16] = b"0123456789abcdef";

#[inline]
fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut k = Keccak::v256();
    k.update(data);
    let mut out = [0u8; 32];
    k.finalize(&mut out);
    out
}

/// Match pattern over a 20-byte address.
#[derive(Clone)]
pub struct Pattern {
    prefix: Vec<u8>, // nibbles, 0..15
    suffix: Vec<u8>, // nibbles, 0..15
    case_sensitive: bool,
    /// Per hex position (0..40): 0 = any, 1 = must be uppercase, 2 = must be lowercase.
    case_req: [u8; 40],
}

impl Pattern {
    pub fn parse(prefix: &[u8], suffix: &[u8], case_sensitive: bool) -> Option<Pattern> {
        if prefix.len() + suffix.len() > 40 {
            return None;
        }
        let mut case_req = [0u8; 40];
        let mut p = Vec::with_capacity(prefix.len());
        let mut s = Vec::with_capacity(suffix.len());
        for (i, &c) in prefix.iter().enumerate() {
            p.push(nibble(c)?);
            case_req[i] = case_of(c);
        }
        let off = 40 - suffix.len();
        for (i, &c) in suffix.iter().enumerate() {
            s.push(nibble(c)?);
            case_req[off + i] = case_of(c);
        }
        if !case_sensitive {
            case_req = [0u8; 40];
        }
        Some(Pattern { prefix: p, suffix: s, case_sensitive, case_req })
    }

    #[inline]
    pub fn matches(&self, addr: &[u8; 20]) -> bool {
        for (i, &nb) in self.prefix.iter().enumerate() {
            if addr_nibble(addr, i) != nb {
                return false;
            }
        }
        let off = 40 - self.suffix.len();
        for (j, &nb) in self.suffix.iter().enumerate() {
            if addr_nibble(addr, off + j) != nb {
                return false;
            }
        }
        if self.case_sensitive {
            return self.checksum_ok(addr);
        }
        true
    }

    fn checksum_ok(&self, addr: &[u8; 20]) -> bool {
        let mut hexs = [0u8; 40];
        for i in 0..20 {
            hexs[2 * i] = HEX[(addr[i] >> 4) as usize];
            hexs[2 * i + 1] = HEX[(addr[i] & 15) as usize];
        }
        let h = keccak256(&hexs);
        for pos in 0..40 {
            let req = self.case_req[pos];
            if req == 0 {
                continue;
            }
            let upper = addr_nibble_32(&h, pos) >= 8;
            if (req == 1) != upper {
                return false;
            }
        }
        true
    }
}

#[inline]
fn addr_nibble(addr: &[u8; 20], i: usize) -> u8 {
    let b = addr[i >> 1];
    if i & 1 == 0 { b >> 4 } else { b & 15 }
}

#[inline]
fn addr_nibble_32(h: &[u8; 32], i: usize) -> u8 {
    let b = h[i >> 1];
    if i & 1 == 0 { b >> 4 } else { b & 15 }
}

fn nibble(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

fn case_of(c: u8) -> u8 {
    match c {
        b'A'..=b'F' => 1,
        b'a'..=b'f' => 2,
        _ => 0,
    }
}

#[inline]
fn address_of_xy(x: &FieldElement, y: &FieldElement) -> [u8; 20] {
    let mut pk = [0u8; 64];
    pk[..32].copy_from_slice(&x.to_bytes());
    pk[32..].copy_from_slice(&y.to_bytes());
    let h = keccak256(&pk);
    let mut a = [0u8; 20];
    a.copy_from_slice(&h[12..]);
    a
}

fn affine_xy(p: &AffinePoint) -> (FieldElement, FieldElement) {
    let enc = p.to_encoded_point(false);
    let x = FieldElement::from_bytes(enc.x().expect("x")).expect("fe x");
    let y = FieldElement::from_bytes(enc.y().expect("y")).expect("fe y");
    (x.normalize(), y.normalize())
}

fn scalar_mul_g(k: &Scalar) -> AffinePoint {
    (ProjectivePoint::GENERATOR * k).to_affine()
}

/// Lane-parallel affine point walker.
///
/// Lane `i` holds `S + (i + round * n) * G`. Each round every lane advances by
/// `n * G` using one shared modular inversion (Montgomery's trick).
pub struct Miner {
    seed: Scalar,
    n: usize,
    xs: Vec<FieldElement>,
    ys: Vec<FieldElement>,
    dx: FieldElement,
    dy: FieldElement,
    round: u64,
    attempts: u64,
    scratch_d: Vec<FieldElement>,
    scratch_c: Vec<FieldElement>,
    found: Option<(usize, u64, [u8; 20])>,
}

impl Miner {
    pub fn new(seed: Scalar, base: Option<AffinePoint>, n: usize) -> Option<Miner> {
        if n == 0 || n > (1 << 22) {
            return None;
        }
        let mut start = ProjectivePoint::GENERATOR * seed;
        if let Some(b) = base {
            start += ProjectivePoint::from(b);
        }
        let start = start.to_affine();
        if bool::from(start.is_identity()) {
            return None;
        }
        let (sx, sy) = affine_xy(&start);
        let mut m = Miner {
            seed,
            n,
            xs: vec![FieldElement::ZERO; n],
            ys: vec![FieldElement::ZERO; n],
            dx: FieldElement::ZERO,
            dy: FieldElement::ZERO,
            round: 0,
            attempts: 0,
            scratch_d: vec![FieldElement::ZERO; n],
            scratch_c: vec![FieldElement::ZERO; n],
            found: None,
        };
        m.xs[0] = sx;
        m.ys[0] = sy;
        // Expand lanes by doubling the filled region: lanes[m..m+cnt] = lanes[0..cnt] + m*G.
        let mut filled = 1usize;
        while filled < n {
            let cnt = core::cmp::min(filled, n - filled);
            let (qx, qy) = affine_xy(&scalar_mul_g(&Scalar::from(filled as u64)));
            m.batch_add(0, filled, cnt, &qx, &qy);
            filled += cnt;
        }
        let (dx, dy) = affine_xy(&scalar_mul_g(&Scalar::from(n as u64)));
        m.dx = dx;
        m.dy = dy;
        Some(m)
    }

    /// lanes[to..to+cnt] = lanes[from..from+cnt] + Q, with one inversion.
    fn batch_add(&mut self, from: usize, to: usize, cnt: usize, qx: &FieldElement, qy: &FieldElement) {
        let nqx = qx.negate(1);
        let nqy = qy.negate(1);
        for i in 0..cnt {
            self.scratch_d[i] = (self.xs[from + i] + nqx).normalize_weak();
        }
        self.scratch_c[0] = self.scratch_d[0];
        for i in 1..cnt {
            self.scratch_c[i] = self.scratch_c[i - 1] * self.scratch_d[i];
        }
        let mut inv = self.scratch_c[cnt - 1].invert().unwrap_or(FieldElement::ZERO);
        for i in (0..cnt).rev() {
            let inv_i = if i == 0 { inv } else { inv * self.scratch_c[i - 1] };
            if i > 0 {
                inv = inv * self.scratch_d[i];
            }
            let x1 = self.xs[from + i];
            let y1 = self.ys[from + i];
            // lambda = (y1 - qy) / (x1 - qx)
            let lam = (y1 + nqy).normalize_weak() * inv_i;
            // x3 = lambda^2 - x1 - qx
            let x3 = (lam.square() + x1.negate(1) + nqx).normalize();
            // y3 = lambda * (x1 - x3) - y1
            let y3 = (lam * (x1 + x3.negate(1)).normalize_weak() + y1.negate(1)).normalize();
            self.xs[to + i] = x3;
            self.ys[to + i] = y3;
        }
    }

    fn advance(&mut self) {
        let n = self.n;
        let dx = self.dx;
        let dy = self.dy;
        self.batch_add(0, 0, n, &dx, &dy);
        self.round += 1;
    }

    /// Run `rounds` rounds. Returns true as soon as a match is found (the state
    /// is advanced past the matching round so mining can resume).
    pub fn mine(&mut self, rounds: u32, pat: &Pattern) -> bool {
        for _ in 0..rounds {
            let mut hit = None;
            for i in 0..self.n {
                let addr = address_of_xy(&self.xs[i], &self.ys[i]);
                if pat.matches(&addr) {
                    hit = Some((i, self.round, addr));
                    break;
                }
            }
            self.attempts += self.n as u64;
            self.advance();
            if let Some(h) = hit {
                self.found = Some(h);
                return true;
            }
        }
        false
    }

    pub fn found_key(&self) -> Option<([u8; 32], [u8; 20])> {
        let (i, round, addr) = self.found?;
        let idx = (i as u128) + (round as u128) * (self.n as u128);
        let k = self.seed + scalar_from_u128(idx);
        Some((k.to_bytes().into(), addr))
    }

    /// Export all lane coordinates as big-endian x||y (64 bytes per lane).
    pub fn export_lanes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.n * 64);
        for i in 0..self.n {
            out.extend_from_slice(&self.xs[i].to_bytes());
            out.extend_from_slice(&self.ys[i].to_bytes());
        }
        out
    }
}

fn scalar_from_u128(v: u128) -> Scalar {
    let hi = Scalar::from((v >> 64) as u64);
    let lo = Scalar::from(v as u64);
    let two64 = Scalar::from(u64::MAX) + Scalar::ONE;
    hi * two64 + lo
}

/// CREATE2 salt miner: address = keccak256(0xff ++ deployer ++ salt ++ initCodeHash)[12..].
pub struct Create2 {
    buf: [u8; 85],
    salt: [u8; 32],
    attempts: u64,
    found: Option<([u8; 32], [u8; 20])>,
}

impl Create2 {
    pub fn new(deployer: &[u8; 20], init_hash: &[u8; 32], salt_seed: &[u8; 32]) -> Create2 {
        let mut buf = [0u8; 85];
        buf[0] = 0xff;
        buf[1..21].copy_from_slice(deployer);
        buf[21..53].copy_from_slice(salt_seed);
        buf[53..85].copy_from_slice(init_hash);
        Create2 { buf, salt: *salt_seed, attempts: 0, found: None }
    }

    pub fn mine(&mut self, count: u32, pat: &Pattern) -> bool {
        for _ in 0..count {
            self.buf[21..53].copy_from_slice(&self.salt);
            let h = keccak256(&self.buf);
            let mut a = [0u8; 20];
            a.copy_from_slice(&h[12..]);
            self.attempts += 1;
            let hit = pat.matches(&a);
            let salt = self.salt;
            // increment big-endian salt
            for b in self.salt.iter_mut().rev() {
                let (v, overflow) = b.overflowing_add(1);
                *b = v;
                if !overflow {
                    break;
                }
            }
            if hit {
                self.found = Some((salt, a));
                return true;
            }
        }
        false
    }
}

// ---------------------------------------------------------------------------
// FFI surface (no wasm-bindgen; raw exports loaded with WebAssembly.instantiate)
// ---------------------------------------------------------------------------

#[allow(static_mut_refs)]
fn io() -> &'static mut [u8; IO_SIZE] {
    unsafe { &mut IO }
}

#[no_mangle]
pub extern "C" fn io_ptr() -> *mut u8 {
    io().as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn io_len() -> u32 {
    IO_SIZE as u32
}

/// IO[0..prefix_len] = prefix ascii hex, IO[prefix_len..prefix_len+suffix_len] = suffix.
/// Returns 0 on success, 1 on invalid pattern.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn set_pattern(prefix_len: u32, suffix_len: u32, case_sensitive: u32) -> u32 {
    let io = io();
    let p = prefix_len as usize;
    let s = suffix_len as usize;
    if p + s > 40 {
        return 1;
    }
    match Pattern::parse(&io[..p], &io[p..p + s], case_sensitive != 0) {
        Some(pat) => {
            unsafe { PATTERN = Some(pat) };
            0
        }
        None => 1,
    }
}

/// IO[0..32] = 256-bit seed scalar (big-endian). If has_base != 0,
/// IO[32..97] = uncompressed SEC1 public key to offset from (split-key mode).
/// Returns 0 on success, 1 bad seed, 2 bad base point, 3 bad lane count.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn miner_init(lanes: u32, has_base: u32) -> u32 {
    let io = io();
    let mut seed_bytes = [0u8; 32];
    seed_bytes.copy_from_slice(&io[..32]);
    let seed = match Option::<Scalar>::from(Scalar::from_repr(seed_bytes.into())) {
        Some(s) if !bool::from(s.is_zero()) => s,
        _ => return 1,
    };
    let base = if has_base != 0 {
        let enc = match EncodedPoint::from_bytes(&io[32..97]) {
            Ok(e) => e,
            Err(_) => return 2,
        };
        match Option::<AffinePoint>::from(AffinePoint::from_encoded_point(&enc)) {
            Some(p) if !bool::from(p.is_identity()) => Some(p),
            _ => return 2,
        }
    } else {
        None
    };
    match Miner::new(seed, base, lanes as usize) {
        Some(m) => {
            unsafe { MINER = Some(m) };
            0
        }
        None => 3,
    }
}

/// Runs `rounds` rounds against the current pattern. Returns 1 if found, 0 if
/// not, 2 if the miner or pattern is not initialised.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn miner_mine(rounds: u32) -> u32 {
    let (m, p) = unsafe {
        match (MINER.as_mut(), PATTERN.as_ref()) {
            (Some(m), Some(p)) => (m, p),
            _ => return 2,
        }
    };
    if m.mine(rounds, p) { 1 } else { 0 }
}

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn miner_attempts() -> f64 {
    unsafe { MINER.as_ref().map(|m| m.attempts as f64).unwrap_or(0.0) }
}

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn miner_lanes() -> u32 {
    unsafe { MINER.as_ref().map(|m| m.n as u32).unwrap_or(0) }
}

/// Writes IO[0..32] = private key (or offset in split-key mode), IO[32..52] = address.
/// Returns 1 if a result was available.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn miner_found() -> u32 {
    let m = unsafe {
        match MINER.as_ref() {
            Some(m) => m,
            None => return 0,
        }
    };
    match m.found_key() {
        Some((k, a)) => {
            let io = io();
            io[..32].copy_from_slice(&k);
            io[32..52].copy_from_slice(&a);
            1
        }
        None => 0,
    }
}

/// Exports all lane coordinates (64 bytes each, x||y big-endian) and returns a
/// pointer to them. Valid until the next call. Length = lanes * 64.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn miner_export_lanes() -> *const u8 {
    unsafe {
        EXPORT = MINER.as_ref().map(|m| m.export_lanes()).unwrap_or_default();
        EXPORT.as_ptr()
    }
}

/// IO[0..32] = private key. Writes IO[32..52] = address, IO[52..117] = uncompressed pubkey.
/// Returns 0 on success, 1 on invalid key.
#[no_mangle]
pub extern "C" fn derive_address() -> u32 {
    let io = io();
    let mut kb = [0u8; 32];
    kb.copy_from_slice(&io[..32]);
    let k = match Option::<Scalar>::from(Scalar::from_repr(kb.into())) {
        Some(s) if !bool::from(s.is_zero()) => s,
        _ => return 1,
    };
    let p = scalar_mul_g(&k);
    let enc = p.to_encoded_point(false);
    let (x, y) = affine_xy(&p);
    let a = address_of_xy(&x, &y);
    io[32..52].copy_from_slice(&a);
    io[52..117].copy_from_slice(enc.as_bytes());
    0
}

/// IO[0..20] deployer, IO[20..52] init code hash, IO[52..84] salt seed.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn create2_init() -> u32 {
    let io = io();
    let mut d = [0u8; 20];
    let mut h = [0u8; 32];
    let mut s = [0u8; 32];
    d.copy_from_slice(&io[..20]);
    h.copy_from_slice(&io[20..52]);
    s.copy_from_slice(&io[52..84]);
    unsafe { CREATE2 = Some(Create2::new(&d, &h, &s)) };
    0
}

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn create2_mine(count: u32) -> u32 {
    let (c, p) = unsafe {
        match (CREATE2.as_mut(), PATTERN.as_ref()) {
            (Some(c), Some(p)) => (c, p),
            _ => return 2,
        }
    };
    if c.mine(count, p) { 1 } else { 0 }
}

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn create2_attempts() -> f64 {
    unsafe { CREATE2.as_ref().map(|c| c.attempts as f64).unwrap_or(0.0) }
}

/// Writes IO[0..32] = salt, IO[32..52] = address. Returns 1 if available.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn create2_found() -> u32 {
    let c = unsafe {
        match CREATE2.as_ref() {
            Some(c) => c,
            None => return 0,
        }
    };
    match c.found {
        Some((s, a)) => {
            let io = io();
            io[..32].copy_from_slice(&s);
            io[32..52].copy_from_slice(&a);
            1
        }
        None => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn addr_hex(a: &[u8; 20]) -> String {
        hex::encode(a)
    }

    fn checksum(a: &[u8; 20]) -> String {
        let lower = hex::encode(a);
        let h = keccak256(lower.as_bytes());
        lower
            .bytes()
            .enumerate()
            .map(|(i, c)| {
                if c.is_ascii_alphabetic() && addr_nibble_32(&h, i) >= 8 {
                    (c as char).to_ascii_uppercase()
                } else {
                    c as char
                }
            })
            .collect()
    }

    fn key_address(k: &Scalar) -> [u8; 20] {
        let (x, y) = affine_xy(&scalar_mul_g(k));
        address_of_xy(&x, &y)
    }

    #[test]
    fn key_one_address() {
        let a = key_address(&Scalar::ONE);
        assert_eq!(addr_hex(&a), "7e5f4552091a69125d5dfcb7b8c2659029395bdf");
        assert_eq!(checksum(&a), "7E5F4552091A69125d5DfCb7b8C2659029395Bdf");
    }

    #[test]
    fn lanes_match_direct_derivation() {
        let seed = Scalar::from(123456789u64);
        let n = 37usize; // deliberately not a power of two
        let mut m = Miner::new(seed, None, n).unwrap();
        for i in 0..n {
            let k = seed + Scalar::from(i as u64);
            assert_eq!(address_of_xy(&m.xs[i], &m.ys[i]), key_address(&k), "lane {i}");
        }
        m.advance();
        for i in 0..n {
            let k = seed + Scalar::from((i + n) as u64);
            assert_eq!(address_of_xy(&m.xs[i], &m.ys[i]), key_address(&k), "lane {i} round 1");
        }
    }

    #[test]
    fn mine_finds_exact_target() {
        let seed = Scalar::from(987654321u64);
        let n = 16usize;
        let target_idx = 3 + 2 * n; // lane 3, round 2
        let target_key = seed + Scalar::from(target_idx as u64);
        let target = key_address(&target_key);
        let full = addr_hex(&target);
        let pat = Pattern::parse(full.as_bytes(), b"", false).unwrap();
        let mut m = Miner::new(seed, None, n).unwrap();
        assert!(!m.mine(2, &pat));
        assert!(m.mine(1, &pat));
        let (k, a) = m.found_key().unwrap();
        assert_eq!(k, <[u8; 32]>::from(target_key.to_bytes()));
        assert_eq!(a, target);
        assert_eq!(m.attempts, 3 * n as u64);
    }

    #[test]
    fn mine_case_sensitive_checksum() {
        let seed = Scalar::from(42u64);
        let n = 8usize;
        let target_key = seed + Scalar::from(5u64);
        let target = key_address(&target_key);
        let cs = checksum(&target);
        let (pre, suf) = cs.split_at(10);
        let suf = &suf[suf.len() - 6..];
        let pat = Pattern::parse(pre.as_bytes(), suf.as_bytes(), true).unwrap();
        assert!(pat.matches(&target));
        // flipping the case of a letter in the pattern must break the match
        let flipped: String = pre
            .chars()
            .map(|c| if c.is_ascii_alphabetic() { if c.is_ascii_uppercase() { c.to_ascii_lowercase() } else { c.to_ascii_uppercase() } } else { c })
            .collect();
        if flipped != pre {
            let bad = Pattern::parse(flipped.as_bytes(), suf.as_bytes(), true).unwrap();
            assert!(!bad.matches(&target));
        }
        let mut m = Miner::new(seed, None, n).unwrap();
        assert!(m.mine(4, &pat));
        let (k, _) = m.found_key().unwrap();
        assert_eq!(k, <[u8; 32]>::from(target_key.to_bytes()));
    }

    #[test]
    fn split_key_offsets_compose() {
        let user = Scalar::from(777u64);
        let user_pub = scalar_mul_g(&user);
        let seed = Scalar::from(31337u64);
        let n = 4usize;
        let m = Miner::new(seed, Some(user_pub), n).unwrap();
        for i in 0..n {
            let k = user + seed + Scalar::from(i as u64);
            assert_eq!(address_of_xy(&m.xs[i], &m.ys[i]), key_address(&k));
        }
    }

    #[test]
    fn create2_known_vector() {
        // EIP-1014 example: deployer 0x00000000000000000000000000000000deadbeef,
        // salt 0x...cafebabe, init code 0xdeadbeef -> 0x60f3f640a8508fC6a86d45DF051962668E1e8AC7
        let mut deployer = [0u8; 20];
        deployer[16..].copy_from_slice(&[0xde, 0xad, 0xbe, 0xef]);
        let mut salt = [0u8; 32];
        salt[28..].copy_from_slice(&[0xca, 0xfe, 0xba, 0xbe]);
        let init_hash = keccak256(&[0xde, 0xad, 0xbe, 0xef]);
        let pat = Pattern::parse(b"60f3f640a8508fc6a86d45df051962668e1e8ac7", b"", false).unwrap();
        let mut c = Create2::new(&deployer, &init_hash, &salt);
        assert!(c.mine(1, &pat));
        let (s, a) = c.found.unwrap();
        assert_eq!(s, salt);
        assert_eq!(addr_hex(&a), "60f3f640a8508fc6a86d45df051962668e1e8ac7");
    }

    #[test]
    fn scalar_u128_roundtrip() {
        let v: u128 = (1u128 << 70) + 12345;
        let s = scalar_from_u128(v);
        let expect = Scalar::from(1u64 << 63) * Scalar::from(128u64) + Scalar::from(12345u64);
        assert_eq!(s, expect);
    }
}
