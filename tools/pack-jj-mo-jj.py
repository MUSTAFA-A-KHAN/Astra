"""Blender: convert JJ-MO-JJ.fbx and retarget all of gwen_stacy.glb's clips.

Run with blender --background --factory-startup --python tools/pack-jj-mo-jj.py.
The game currently uses gwen_stacy.glb for its Spiderman roster entry.
"""
import bpy
import os
import re
import subprocess
from mathutils import Matrix, Quaternion

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.scene.render.fps = 30
bpy.ops.import_scene.fbx(filepath=os.path.join(ROOT, 'JJ-MO-JJ.fbx'))
target_objects = list(bpy.context.scene.objects)
target = next(o for o in target_objects if o.type == 'ARMATURE')
target.animation_data_clear()
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
# Canonical names match the game's Mixamo bone detection.
for bone in target.data.bones:
    bone.name = bone.name.replace('mixamorig:', 'mixamorig')

bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'gwen_stacy.glb'))
source = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE' and o != target)
donors = list(bpy.data.actions)
def canonical(name):
    return re.sub(r'_\d+$', '', name.replace('mixamorig:', 'mixamorig'))
source_names = {canonical(b.name): b.name for b in source.data.bones}
mapping = {b.name: source_names[b.name] for b in target.data.bones if b.name in source_names}
assert len(mapping) >= 60, 'Incomplete Mixamo bone mapping'
source.animation_data.action = None
bpy.context.view_layer.update()
source_rest = {n: (source.matrix_world @ source.data.bones[s].matrix_local).to_quaternion()
               for n, s in mapping.items()}
target_rest = {b.name: (target.matrix_world @ b.matrix_local).to_quaternion() for b in target.data.bones}
# Align the rigs' body frames without importing their different bone rolls.
def frame(rig, names):
    def pos(n):
        return (rig.matrix_world @ rig.data.bones[names[n]].matrix_local).translation
    up = (pos('mixamorigHead') - pos('mixamorigHips')).normalized()
    left = pos('mixamorigLeftUpLeg') - pos('mixamorigRightUpLeg')
    left = (left - up * left.dot(up)).normalized()
    return Matrix((left, up, left.cross(up))).transposed()
alignment = (frame(target, {n: n for n in mapping}) @ frame(source, mapping).transposed()).to_quaternion()
source_hip = (source.matrix_world @ source.data.bones[mapping['mixamorigHips']].matrix_local).translation
target_hip = (target.matrix_world @ target.data.bones['mixamorigHips'].matrix_local).translation
def reach(rig, names):
    return ((rig.matrix_world @ rig.data.bones[names['mixamorigHips']].matrix_local).translation -
            (rig.matrix_world @ rig.data.bones[names['mixamorigLeftFoot']].matrix_local).translation).length
scale = reach(target, {n: n for n in mapping}) / reach(source, mapping)
inverse_target = target.matrix_world.inverted()
order = []
def visit(bone):
    order.append(bone)
    for child in bone.children:
        visit(child)
for bone in target.data.bones:
    if bone.parent is None:
        visit(bone)

baked = []
for donor in donors:
    source.animation_data_create()
    source.animation_data.action = donor
    if donor.slots:
        source.animation_data.action_slot = donor.slots[0]
    start, end = [int(round(v)) for v in donor.frame_range]
    samples = {b.name: [] for b in order}
    hip_samples = []
    previous = {}
    for f in range(start, end + 1):
        bpy.context.scene.frame_set(f)
        poses = {}
        for bone in order:
            name = bone.name
            if name in mapping:
                posed = source.matrix_world @ source.pose.bones[mapping[name]].matrix
                delta = posed.to_quaternion() @ source_rest[name].inverted()
                world_rotation = alignment @ delta @ alignment.inverted() @ target_rest[name]
            else:
                world_rotation = target_rest[name]
            local_rotation = inverse_target.to_quaternion() @ world_rotation
            rest = bone.matrix_local
            parent = bone.parent
            relative_rest = parent.matrix_local.inverted() @ rest if parent else rest
            rotation = (poses[parent.name].inverted() @ local_rotation) if parent else local_rotation
            basis = relative_rest.to_quaternion().inverted() @ rotation
            if name in previous and basis.dot(previous[name]) < 0:
                basis.negate()
            previous[name] = basis.copy()
            poses[name] = local_rotation
            samples[name].append(tuple(basis))
        hip_pose = (source.matrix_world @ source.pose.bones[mapping['mixamorigHips']].matrix).translation
        displacement = alignment @ ((hip_pose - source_hip) * scale)
        # Keep source vertical movement (jumps, crouches); the runtime handles travel.
        hip_basis = target.data.bones['mixamorigHips'].matrix_local.inverted() @ (inverse_target @ (target_hip + displacement))
        hip_samples.append(tuple(hip_basis))
    action = bpy.data.actions.new(donor.name + '__jj')
    target.animation_data_create()
    target.animation_data.action = action
    slot = action.slots.new(id_type='OBJECT', name=target.name)
    target.animation_data.action_slot = slot
    strip = action.layers.new('Retargeted').strips.new(type='KEYFRAME')
    bag = strip.channelbag(slot, ensure=True)
    def curves(path, values, width):
        for axis in range(width):
            curve = bag.fcurves.new(data_path=path, index=axis)
            curve.keyframe_points.add(len(values))
            curve.keyframe_points.foreach_set('co', [v for i, row in enumerate(values) for v in (i, row[axis])])
            for key in curve.keyframe_points:
                key.interpolation = 'LINEAR'
    for bone in order:
        target.pose.bones[bone.name].rotation_mode = 'QUATERNION'
        curves(f'pose.bones["{bone.name}"].rotation_quaternion', samples[bone.name], 4)
    curves('pose.bones["mixamorigHips"].location', hip_samples, 3)
    baked.append((action, donor.name))
    print('RETARGET', donor.name, end - start + 1, flush=True)

target.animation_data.action = None
for obj in list(bpy.context.scene.objects):
    if obj not in target_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
for donor in donors:
    bpy.data.actions.remove(donor)
for action, name in baked:
    action.name = name
    action.use_fake_user = True
bpy.context.scene.frame_set(0)
bpy.ops.object.select_all(action='DESELECT')
for obj in target_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = target
bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT, 'jj-mo-jj.glb'),
    export_format='GLB', use_selection=True, export_animation_mode='ACTIONS',
    export_force_sampling=False, export_anim_slide_to_zero=True)
print('EXPORTED', len(baked), 'animations', flush=True)
# Remove redundant keys without changing bone names or requiring a decoder.
output = os.path.join(ROOT, 'jj-mo-jj.glb')
packed = os.path.join(ROOT, 'jj-mo-jj-packed.glb')
subprocess.run(['node', os.path.join(ROOT, 'node_modules', 'gltfpack', 'cli.js'),
    '-i', output, '-o', packed, '-kn', '-ke', '-noq', '-af', '0'], check=True)
os.replace(packed, output)
print('PACKED', os.path.getsize(output), 'bytes', flush=True)
