/**
 * Library unit tests. Run from web/:  npx -y deno@2 run -A src/lib/lib.test.ts
 */
import { difficulty, probability, matchesPattern, packForGpu, validatePattern, formatDuration } from './pattern.ts';
import { privateKeyToAddress, toChecksum, create2Address, addScalars, splitKeyAddress, privateKeyToPublicKey, hexToBytes, bytesToHex, keccak256Hex, randomScalar, CURVE_N, bytesToBigInt } from './eth.ts';
import { encryptKeystoreV3, decryptKeystoreV3 } from './keystore.ts';
import { Kernel } from './kernel.ts';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`);
  if (!ok) failures++;
};

// --- eth
const one = new Uint8Array(32);
one[31] = 1;
check('key 1 address', privateKeyToAddress(one) === '7e5f4552091a69125d5dfcb7b8c2659029395bdf');
check('EIP-55 checksum', toChecksum('7e5f4552091a69125d5dfcb7b8c2659029395bdf') === '7E5F4552091A69125d5DfCb7b8C2659029395Bdf');
check('EIP-55 vector 2', toChecksum('0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359') === 'fB6916095ca1df60bB79Ce92cE3Ea74c37c5d359');
const deployer = hexToBytes('00000000000000000000000000000000deadbeef');
const salt = hexToBytes('00000000000000000000000000000000000000000000000000000000cafebabe');
check('CREATE2 EIP-1014 example', create2Address(deployer, salt, hexToBytes(keccak256Hex(hexToBytes('deadbeef')))) === '60f3f640a8508fc6a86d45df051962668e1e8ac7');

// split-key composition
const a = randomScalar();
const b = randomScalar();
const sum = addScalars(a, b);
check('split-key: addr(P_a + b*G) == addr(a + b)', splitKeyAddress(privateKeyToPublicKey(a), b) === privateKeyToAddress(sum));
check('scalar add wraps mod n', bytesToBigInt(sum) === (bytesToBigInt(a) + bytesToBigInt(b)) % CURVE_N);

// --- pattern
check('difficulty 16^n', difficulty({ prefix: 'abcd', suffix: '', caseSensitive: false }) === 65536);
check('difficulty case letters x2', difficulty({ prefix: 'Ab1', suffix: 'C', caseSensitive: true }) === 65536 * 8);
check('probability', Math.abs(probability(65536, 65536) - (1 - Math.exp(-1))) < 1e-12);
check('validate rejects non-hex', validatePattern({ prefix: 'xyz', suffix: '', caseSensitive: false }) !== null);
check('validate rejects > 40', validatePattern({ prefix: 'a'.repeat(30), suffix: 'b'.repeat(11), caseSensitive: false }) !== null);
const cs = '7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
check('matches case-insensitive', matchesPattern(cs.toLowerCase(), cs, { prefix: '7e5F', suffix: 'BDF', caseSensitive: false }));
check('matches case-sensitive ok', matchesPattern(cs.toLowerCase(), cs, { prefix: '7E5F', suffix: 'Bdf', caseSensitive: true }));
check('matches case-sensitive rejects', !matchesPattern(cs.toLowerCase(), cs, { prefix: '7e5F', suffix: 'Bdf', caseSensitive: true }));
const packed = packForGpu({ prefix: 'aB', suffix: 'C', caseSensitive: true });
check('gpu pack mask', packed.mask[0] === 0xff && packed.mask[4] === 0x0f000000, bytesToHex(new Uint8Array(packed.mask.buffer)));
check('gpu pack value', packed.value[0] === 0xab && packed.value[4] === 0x0c000000);
check('gpu pack case bits', packed.lowerLo === 1 && packed.upperLo === 2 && packed.upperHi === 1 << 7 && packed.lowerHi === 0);
check('formatDuration', formatDuration(90061) === '1 day' && formatDuration(3700).startsWith('1 hour'));

// --- keystore round trip + MAC rejection
const key = randomScalar();
const addr = privateKeyToAddress(key);
const json = await encryptKeystoreV3(key, 'correct horse battery staple', addr, { n: 1 << 12 });
const parsed = JSON.parse(json);
check('keystore shape', parsed.version === 3 && parsed.address === addr && parsed.crypto.kdf === 'scrypt' && parsed.crypto.cipher === 'aes-128-ctr');
check('keystore decrypts', bytesToHex(await decryptKeystoreV3(json, 'correct horse battery staple')) === bytesToHex(key));
let rejected = false;
try {
  await decryptKeystoreV3(json, 'wrong');
} catch {
  rejected = true;
}
check('keystore rejects wrong password', rejected);

// --- wasm kernel via the TS wrapper, cross-checked against noble
const wasm = await Deno.readFile(new URL('../kernel/cairn_kernel.wasm', import.meta.url));
const kernel = await Kernel.load(wasm);
const d = kernel.deriveAddress(key);
check('wasm derive == noble derive', bytesToHex(d.address) === addr);
kernel.setPattern('', addr.slice(-5), false);
const seed = randomScalar();
kernel.minerInit(seed, 64);
let found = false;
for (let i = 0; i < 20000 && !found; i++) found = kernel.mine(4);
const f = kernel.found();
check('wasm miner finds suffix and noble agrees', !!f && privateKeyToAddress(f.key) === bytesToHex(f.address) && bytesToHex(f.address).endsWith(addr.slice(-5)));

console.log(failures === 0 ? 'ALL LIB TESTS PASSED' : `${failures} FAILURE(S)`);
Deno.exit(failures === 0 ? 0 : 1);
