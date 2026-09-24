// Bakes the clips the harbour villager stands and talks with.
//
//   node tools/bake-villager-clips.mjs
//
// The villager (assets/story/harbour-villager.glb) comes from Sketchfab rigged
// but with nothing to play: its one clip is a single frame of T-pose. Gwen's
// model carries the same 66-bone Mixamo skeleton, and a Mixamo bone turns about
// the same axes whichever character it belongs to, so her idles transfer by
// copying each bone's rotation across by name. The neck and head are left at
// rest: hers are posed for a taller, slighter figure, and on him they tip his
// face to the sky. Hip travel is dropped too; the villager stands where placed.
//
// The output is three.js AnimationClip JSON, keyed by the node names
// GLTFLoader gives the villager's bones, for AnimationClip.parse.
import { readFileSync, writeFileSync } from 'node:fs';

const DONOR = 'gwen_stacy.glb', TARGET = 'assets/story/harbour-villager.glb';
const OUT = 'assets/story/harbour-villager-clips.json';
const CLIPS = [['Idle', /^Idle$/], ['Talk', /Idle_Talking_Loop$/]];
const HELD = /^(Neck|Head)$/;

function readGLB(path) {
  const data = readFileSync(path), length = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + length).toString());
  const binary = data.subarray(28 + length, 28 + length + data.readUInt32LE(20 + length));
  const floats = index => {
    const accessor = json.accessors[index], view = json.bufferViews[accessor.bufferView];
    const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[accessor.type];
    if (accessor.componentType !== 5126 || (view.byteStride && view.byteStride !== width * 4)) throw new Error(`${path}: accessor ${index} is not tightly packed float`);
    const start = binary.byteOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0);
    return new Float32Array(binary.buffer.slice(start, start + accessor.count * width * 4));
  };
  return { json, floats };
}
// The same Mixamo bone, whatever prefix and index an exporter hung on it.
const bone = name => name.replace(/^mixamorig[:_]?/, '').replace(/_\d+$/, '');
// What GLTFLoader renames a node to (PropertyBinding.sanitizeNodeName).
const sanitize = name => name.replace(/\s/g, '_').replace(/[[\].:/]/g, '');
const round = value => Math.round(value * 1e5) / 1e5;

const donor = readGLB(DONOR), target = readGLB(TARGET);
const bones = new Map(target.json.skins[0].joints.map(i => target.json.nodes[i].name).map(name => [bone(name), sanitize(name)]));
const clips = CLIPS.map(([name, pattern]) => {
  const source = donor.json.animations.find(clip => pattern.test(clip.name));
  if (!source) throw new Error(`${DONOR} has no clip matching ${pattern}`);
  let duration = 0;
  const tracks = [];
  for (const channel of source.channels) {
    const node = bone(donor.json.nodes[channel.target.node].name), sampler = source.samplers[channel.sampler];
    if (channel.target.path !== 'rotation' || HELD.test(node) || !bones.has(node)) continue;
    if (sampler.interpolation && sampler.interpolation !== 'LINEAR') throw new Error(`${source.name}: ${sampler.interpolation} sampler`);
    const times = [...donor.floats(sampler.input)].map(round);
    duration = Math.max(duration, times.at(-1));
    tracks.push({ name: `${bones.get(node)}.quaternion`, type: 'quaternion', times, values: [...donor.floats(sampler.output)].map(round) });
  }
  console.log(`${name.padEnd(5)} <- ${source.name}: ${tracks.length} bones, ${duration.toFixed(2)} s`);
  return { name, duration, tracks };
});
writeFileSync(OUT, JSON.stringify(clips));
console.log(`wrote ${OUT} (${(readFileSync(OUT).length / 1024).toFixed(0)} KB)`);
