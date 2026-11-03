"use strict";
const __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/** Offline mobile transport -> actual Phase 4 handlers/service/codec. Native storage and DB are fixture ports. */
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const {Buffer}=require('node:buffer');
const captureDelivery_1 = require("../src/services/captureDelivery");
const captureTransport_1 = require("../src/services/captureTransport");
const service_1 = require("../backend/src/user-import/media/service");
const routes_1 = require("../backend/src/user-import/media/routes");
const contracts_1 = require("../backend/src/user-import/media/contracts");
const contracts_2 = require("../backend/src/user-import/share/contracts");
(0, node_test_1.test)('mobile upload survives a lost server acknowledgement and restart through the real private API and codec', async () => {
    const owner = '44444444-4444-4444-8444-444444444444', id = '11111111-1111-4111-8111-111111111111', uploadId = '22222222-2222-4222-8222-222222222222', importId = '33333333-3333-4333-8333-333333333333';
    const exec = (0, node_util_1.promisify)(node_child_process_1.execFile), fixture = await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=16x12', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'], { encoding: 'buffer', timeout: 10000, maxBuffer: 1024 * 1024 });
    const bytes = fixture.stdout, objects = new Map(), path = `${owner}/${uploadId}/input`;
    let asset, accepts = 0, uploads = 0, loseReply = true;
    const store = { async command(account, action, _id = null, input = {}) {
            if (account !== owner)
                throw new contracts_2.ShareError('image_not_found', 404);
            if (action === 'initialize' && !asset)
                asset = { id: uploadId, user_id: owner, capture_id: id, request_digest: String(input.requestDigest), expected_digest: (0, contracts_1.imageDigest)(bytes), expected_size: bytes.length, mime: 'image/jpeg', state: 'open', staging_path: path, original_path: `${owner}/${uploadId}/original.jpg`, thumbnail_path: `${owner}/${uploadId}/thumbnail.jpg`, source_id: null, import_id: null, upload_expires_at: new Date(Date.now() + 10800000).toISOString(), verify_lease: null, cleanup_lease: null, normalized_digest: null };
            if (!asset)
                throw Error('No allocation');
            if (action === 'claim' && !asset.import_id) {
                asset.state = 'verifying';
                asset.verify_lease = String(input.lease);
            }
            if (action === 'verifyLease')
                strict_1.default.equal(asset.verify_lease, input.lease);
            if (action === 'accept') {
                accepts++;
                asset = { ...asset, state: 'accepted', source_id: uploadId, import_id: importId, normalized_digest: String(input.digest), verify_lease: null };
            }
            return { ...asset };
        } };
    const service = new service_1.PrivateImageService(store, { signUpload: async () => ({ signedUrl: `https://storage.example.test/storage/v1/object/upload/sign/find-private-images/${path}?token=PRIVATE_SIGNED_CAPABILITY`, token: 'PRIVATE_SIGNED_CAPABILITY' }), read: async (key) => { const data = objects.get(key); if (!data)
            throw new contracts_2.ShareError('image_storage_unavailable', 503); return data; }, put: async (key, data) => { objects.set(key, data); }, remove: async (keys) => { keys.forEach(key => objects.delete(key)); } });
    const routes = new Map(), app = Object.fromEntries(['get', 'post', 'delete'].map(method => [method, (route, handler) => routes.set(`${method} ${route}`, handler)]));
    (0, routes_1.registerPrivateImageHandlers)(app, { service, authenticate: async (req) => req.headers.authorization === 'Bearer fixture-access' ? { userId: owner } : null, enabled: () => true });
    const transport = (0, captureTransport_1.createCaptureTransport)({ base: () => 'https://api.example.test', storage: () => 'https://storage.example.test', session: async () => ({ userId: owner, accessToken: 'fixture-access' }), fetch: async (url, init) => {
            const target = new URL(String(url));
            if (target.hostname === 'storage.example.test') {
                uploads++;
                strict_1.default.equal(init.method, 'PUT');
                strict_1.default.ok(!JSON.stringify(init.headers).includes('fixture-access'));
                objects.set(path, Buffer.from(init.body));
                return Response.json({});
            }
            const body = init.body ? JSON.parse(String(init.body)) : undefined;
            if (target.pathname === '/finds/batch')
                return Response.json({ items: asset?.import_id ? [{ id: importId }] : [], unavailableIds: [] });
            const completing = target.pathname.endsWith('/complete'), key = completing ? 'post /finds/media/uploads/:uploadId/complete' : 'post /finds/media/uploads';
            let status = 200, result;
            const res = { headersSent: false, setHeader() { }, status(value) { status = value; return this; }, json(value) { result = value; this.headersSent = true; } };
            await routes.get(key)({ headers: { authorization: init.headers.Authorization }, body, params: { uploadId } }, res);
            if (completing && loseReply) {
                loseReply = false;
                throw Error('Acknowledgement lost after commit');
            }
            return Response.json(result, { status });
        } });
    let local = { version: 1, id, owner, origin: 'gallery', mime: 'image/jpeg', sha256: (0, contracts_1.imageDigest)(bytes), size: bytes.length, state: 'pending', createdAt: 1, attempts: 0, notBefore: 0 }, pixels = bytes.toString('base64');
    const outbox = { list: async () => local ? [{ ...local }] : [], bytes: async () => pixels, update: async (_id, _owner, patch) => { local = { ...local, ...patch }; if (patch.state === 'accepted')
            pixels = null; }, remove: async () => { local = null; pixels = null; } };
    const first = (0, captureDelivery_1.createCaptureDelivery)(outbox, transport, () => { });
    first.configure(owner);
    await first.pump();
    strict_1.default.equal(accepts, 1);
    strict_1.default.ok(pixels);
    strict_1.default.equal(local.state, 'pending');
    const resumed = (0, captureDelivery_1.createCaptureDelivery)(outbox, transport, () => { });
    resumed.configure(owner);
    await resumed.pump(true);
    strict_1.default.equal(accepts, 1);
    strict_1.default.equal(uploads, 1);
    strict_1.default.equal(local, null);
    strict_1.default.equal(pixels, null);
    strict_1.default.ok(objects.has(`${owner}/${uploadId}/thumbnail.jpg`));
});
