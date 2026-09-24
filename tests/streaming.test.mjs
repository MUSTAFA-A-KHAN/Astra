import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHUNK_SIZE, DRAW_DISTANCE, REACH, chunkMeshes, createStreamer } from '../streaming.js';

// A few chunks of street, in the city's manner: batches spanning several
// chunks, placed by a node that is itself moved and scaled.
function district() {
  const layout = new THREE.Group();
  layout.position.set(10, 2, -5); layout.scale.setScalar(.5);
  const material = new THREE.MeshStandardMaterial(), other = new THREE.MeshStandardMaterial();
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(CHUNK_SIZE * 8, CHUNK_SIZE * 2, 24, 6).rotateX(-Math.PI / 2), material);
  strip.name = 'city_streets'; strip.position.set(3, 0, 1); strip.castShadow = true;
  const kerb = new THREE.Mesh(new THREE.BoxGeometry(CHUNK_SIZE * 4, 2, 2, 12, 1, 1), material);
  kerb.name = 'city_streets_kerb'; kerb.position.set(0, 1, 30); kerb.rotation.y = .3; kerb.castShadow = true;
  const house = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), other);
  house.name = 'city_houses'; house.position.set(-40, 10, -20); house.castShadow = true;
  layout.add(strip, kerb, house);
  return { layout, meshes: [strip, kerb, house], material, other };
}

// Every triangle as its three world-space corners, rounded and sorted, so two
// sets of meshes can be compared however their triangles are batched.
function triangles(meshes) {
  const out = [], v = new THREE.Vector3();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const { position } = mesh.geometry.attributes, index = mesh.geometry.index;
    for (let i = 0, count = index ? index.count : position.count; i < count; i += 3) {
      const corners = [0, 1, 2].map(k => v.fromBufferAttribute(position, index ? index.getX(i + k) : i + k).applyMatrix4(mesh.matrixWorld).toArray().map(n => n.toFixed(3)).join());
      out.push(`${mesh.material.uuid}|${corners.sort().join('|')}`);
    }
  }
  return out.sort();
}

test('chunks keep every triangle where it was, each in the chunk its centre falls in', () => {
  const { layout, meshes, material, other } = district();
  const before = triangles(meshes);
  const chunks = chunkMeshes(layout, meshes);
  assert.deepEqual(triangles(chunks), before);
  assert.ok(chunks.length > 8, `${chunks.length} chunks`);
  for (const mesh of meshes) assert.equal(mesh.parent, null);
  const centre = new THREE.Vector3(), v = new THREE.Vector3();
  for (const chunk of chunks) {
    assert.equal(chunk.parent, layout);
    const { position } = chunk.geometry.attributes, index = chunk.geometry.index;
    const cells = new Set();
    for (let i = 0; i < index.count; i += 3) {
      centre.set(0, 0, 0);
      for (let k = 0; k < 3; k++) centre.add(v.fromBufferAttribute(position, index.getX(i + k)).applyMatrix4(chunk.matrixWorld));
      centre.divideScalar(3);
      cells.add(`${Math.floor(centre.x / CHUNK_SIZE)},${Math.floor(centre.z / CHUNK_SIZE)}`);
    }
    assert.equal(cells.size, 1, `${chunk.name} spans ${[...cells].join(' ')}`);
    // Bounds are the chunk's own, so the frustum can skip it.
    assert.ok(chunk.geometry.boundingSphere.radius < CHUNK_SIZE * 2);
  }
  // Batches of one material share chunks; another material never joins them.
  assert.ok(chunks.some(chunk => chunk.material === material));
  assert.equal(chunks.filter(chunk => chunk.material === other).length, 1);
  assert.ok(chunks.every(chunk => chunk.castShadow));
});

test('batches read differently are kept apart, and keep their names', () => {
  const { layout, meshes } = district();
  const [strip, kerb] = meshes;
  kerb.receiveShadow = true;
  const chunks = chunkMeshes(layout, [strip, kerb]);
  for (const chunk of chunks) assert.equal(chunk.receiveShadow, chunk.name === 'city_streets_kerb');
  // A key splits them further: the city keeps streets and houses apart.
  const again = district(), named = chunkMeshes(again.layout, again.meshes.slice(0, 2), { key: mesh => mesh.name });
  assert.ok(named.some(chunk => chunk.name === 'city_streets') && named.some(chunk => chunk.name === 'city_streets_kerb'));
});

test('the streamer draws what is in reach, and puts away what is past it', () => {
  const streamer = createStreamer({ quality: 'balanced' }), range = DRAW_DISTANCE.balanced;
  const box = x => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10)); mesh.position.set(x, 0, 0); return mesh; };
  const near = streamer.add(box(0)), edge = streamer.add(box(range)), far = streamer.add(box(range * 2));
  const prop = streamer.add(box(range * .9), { kind: 'props' });
  // Nothing is put away before the streamer knows where the player is.
  assert.ok([near, edge, far, prop].every(object => object.visible));
  streamer.update(new THREE.Vector3(0, 0, 0));
  assert.equal(near.visible, true);
  assert.equal(edge.visible, true, 'measured to its nearest side, not its middle');
  assert.equal(far.visible, false);
  assert.equal(prop.visible, false, `props go at ${REACH.props} of the draw distance`);
  assert.equal(streamer.diagnostics.drawn, 2);
  // Walking out to the far one brings it in, and the first one goes.
  streamer.update(new THREE.Vector3(range * 1.5, 0, 0));
  assert.deepEqual([near.visible, far.visible, prop.visible], [false, true, true]);
  // Added later, a thing is placed at once by where the player last was.
  assert.equal(streamer.add(box(0)).visible, false);
});

test('a chunk on the edge of reach does not flicker as the player walks along it', () => {
  const streamer = createStreamer({ quality: 'low' }), range = DRAW_DISTANCE.low;
  const chunk = streamer.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)));
  streamer.update(new THREE.Vector3(range - 1, 0, 0));
  assert.equal(chunk.visible, true);
  // Just past the edge it stays, until the player is well past it.
  streamer.update(new THREE.Vector3(range + 3, 0, 0));
  assert.equal(chunk.visible, true);
  streamer.update(new THREE.Vector3(range + 12, 0, 0));
  assert.equal(chunk.visible, false);
  // And back just inside the edge, it returns.
  streamer.update(new THREE.Vector3(range - 1, 0, 0));
  assert.equal(chunk.visible, true);
});

test('quality moves the edge, and something that moves about is streamed by its whole stretch', () => {
  const streamer = createStreamer({ quality: 'high' });
  const whale = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4));
  streamer.add(whale, { bounds: { x: 500, z: 0, radius: 60 } });
  streamer.update(new THREE.Vector3(500 - 60 - DRAW_DISTANCE.high + 20, 0, 0));
  assert.equal(whale.visible, true);
  streamer.setQuality('low');
  streamer.update(new THREE.Vector3(500 - 60 - DRAW_DISTANCE.high + 20, 0, 0));
  assert.equal(whale.visible, false);
  assert.equal(streamer.reach('props'), DRAW_DISTANCE.low * REACH.props);
});

test('nothing that holds a light is streamed: hiding it would recompile every shader', () => {
  const streamer = createStreamer(), lamp = new THREE.Group();
  lamp.add(new THREE.PointLight());
  assert.throws(() => streamer.add(lamp), /holds a light/);
});
