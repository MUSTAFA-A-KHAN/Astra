"""
Retarget Mixamo emotes onto Arthur's skeleton and export them alone.

Arthur ships locomotion and no gestures. The clips we want are
Mixamo-rigged too, so the bones line up by name -- but nothing else
does, and each mismatch has to be handled or the dance comes out as
a seizure.

Rest poses differ. Arthur's GLB came back from a different exporter
with its own bone directions and rolls, so a bone's rotation cannot
be copied across. What does transfer between two rigs standing in
the same pose is each bone's rotation away from its own rest:

    delta       = source_pose_world * source_rest_world^-1
    target_pose = delta * target_rest_world

Reference poses differ. That formula only holds if both rigs are
standing the same way, and Arthur's bind pose is a T-pose lying
face down -- every clip he ships carries the quarter turn that puts
him on his feet. So the target's reference is the bind skeleton
stood upright, and the delta is carried between the two rigs'
landmark frames by conjugation:

    A           = target_frame * source_frame^-1
    target_pose = A * delta * A^-1 * target_reference

A is the identity when two rigs already agree, so this costs
nothing in the easy case.

Proportions differ. Scaled hip travel never lands two different
skeletons' feet in the same place, so the donor's travel is dropped
outright and the hips are anchored: height comes from putting the
lowest foot on the floor, every frame, with the floor read off the
model's own idle. That also keeps the clips honestly in place,
which is what the game expects of them.

The export is armature-only. Arthur's 21 MB mesh never enters it --
the emotes ride along as a small companion file and the game merges
the clips at load time, so the model that renders today is left
byte-for-byte alone.

Usage:
  blender --background --factory-startup
      --python tools/retarget-emotes.py -- <target.glb> <donor-dir>

  --verify also bakes one of the target's own clips back through
  this path, for the game to diff against the native one.
"""

import sys
import os

import bpy
from mathutils import Matrix

FPS = 30

# Bones every Mixamo rig shares. Arthur carries a few of his own
# (the coat tail); those get keyed at rest so a previous clip's
# pose never bleeds into an emote.
HIPS = 'mixamorigHips'
HEAD = 'mixamorigHead'
FOOT = 'mixamorigLeftFoot'
LEFT_LEG = 'mixamorigLeftUpLeg'
RIGHT_LEG = 'mixamorigRightUpLeg'


def log(*parts):
    print('[retarget]', *parts)
    sys.stdout.flush()


def armatures():
    return [
        o for o in bpy.context.scene.objects
        if o.type == 'ARMATURE'
    ]


def assign_action(obj, action):
    """Assign an action, bridging Blender 4.4+ slotted actions."""
    anim = obj.animation_data or obj.animation_data_create()
    anim.action = action

    if not hasattr(anim, 'action_slot'):
        return

    if action.slots:
        anim.action_slot = action.slots[0]
    else:
        anim.action_slot = action.slots.new(
            id_type='OBJECT', name=obj.name,
        )


def source_bone(armature, target_name):
    """Find the source bone matching one of Arthur's."""
    if not target_name.startswith('mixamorig'):
        return None

    stem = target_name[len('mixamorig'):]

    for candidate in (
        'mixamorig:' + stem,
        'mixamorig' + stem,
        stem,
    ):
        if candidate in armature.data.bones:
            return candidate

    return None


def parent_first(armature, names):
    """Order bones so a parent is always posed before its child."""
    order = []

    def walk(bone):
        if bone.name in names:
            order.append(bone.name)
        for child in bone.children:
            walk(child)

    for bone in armature.data.bones:
        if bone.parent is None:
            walk(bone)

    return order


def rest_world(obj, bone_name):
    return obj.matrix_world @ obj.data.bones[bone_name].matrix_local


def pose_world(obj, bone_name):
    return obj.matrix_world @ obj.pose.bones[bone_name].matrix


def landmark(obj, name):
    """Rest world position of a bone, by Arthur's name for it."""
    return rest_world(
        obj, source_bone(obj, name) or name,
    ).to_translation()


def hip_height(obj):
    """Rest hips-to-foot reach, for scaling hip travel.

    Measured along the skeleton rather than up the world Z axis,
    because not every rig imports standing up.
    """
    return (landmark(obj, HIPS) - landmark(obj, FOOT)).length


LANDMARKS = (HIPS, HEAD, LEFT_LEG, RIGHT_LEG)

# What has to stay on the pavement.
FEET = (
    'mixamorigLeftFoot',
    'mixamorigRightFoot',
    'mixamorigLeftToeBase',
    'mixamorigRightToeBase',
)


def body_frame(positions):
    """An orthonormal frame built from four skeleton landmarks.

    Columns are the character's left, up and forward, so two rigs
    standing the same way produce frames that differ only by how
    each one happens to sit in the world.
    """
    up = (positions[HEAD] - positions[HIPS]).normalized()
    left = positions[LEFT_LEG] - positions[RIGHT_LEG]

    # Strip any lean out of the thigh axis so the frame is square.
    left = (left - up * left.dot(up)).normalized()
    forward = left.cross(up)

    return Matrix((
        (left.x, up.x, forward.x),
        (left.y, up.y, forward.y),
        (left.z, up.z, forward.z),
    ))


def rest_frame(obj):
    return body_frame({
        n: landmark(obj, n) for n in LANDMARKS
    })


def posed_frame(obj):
    return body_frame({
        n: pose_world(
            obj, source_bone(obj, n) or n,
        ).to_translation()
        for n in LANDMARKS
    })


def reference_action(actions):
    """The clip that shows a rig in its neutral standing pose."""
    for pattern in ('tpose', 't-pose', 't_pose', 'idle'):
        for action in actions:
            if pattern in action.name.lower().replace(' ', ''):
                return action
    return None


def standing_fix(obj, actions):
    """The rotation that stands a rig up the way its clips do.

    Arthur's bind pose is a perfectly good T-pose lying face
    down: every clip he ships carries the quarter turn that puts
    him on his feet. Retargeting onto the bind pose alone would
    therefore hand us a dance performed flat on the floor, so the
    reference pose has to be the one his own animations agree on.

    Only the whole-body rotation is taken. The bind pose's
    per-bone orientations -- arms out, legs down -- are already
    the T-pose the donor rigs are measured against, and a clip
    like an idle would ruin them.
    """
    action = reference_action(actions)

    if not action:
        log(
            '  no T-pose or idle to stand the rig up with; '
            'using the bind pose as-is'
        )
        return Matrix.Identity(3), 'bind pose'

    bind = rest_frame(obj)

    assign_action(obj, action)
    bpy.context.scene.frame_set(
        int(round(action.frame_range[0])),
    )
    bpy.context.view_layer.update()

    fix = posed_frame(obj) @ bind.transposed()

    obj.animation_data.action = None

    return fix, action.name


def sole_height(obj, up):
    """Height of the lowest foot in the pose currently applied."""
    return min(
        pose_world(obj, foot).to_translation().dot(up)
        for foot in FEET
        if foot in obj.pose.bones
    )


def floor_height(obj, actions, up):
    """Where the model itself thinks the ground is.

    Taken from the idle, because that is the clip an emote is
    entered from and returned to: matching its feet is what makes
    a gesture look like it happens on the same pavement the
    character was standing on. Constructing the floor from the
    bind skeleton instead lands it a few centimetres out, which
    is enough for a dance to scuff through the road surface.
    """
    idle = None
    for action in actions:
        if 'idle' in action.name.lower():
            idle = action
            break

    if not idle:
        idle = reference_action(actions)

    if not idle:
        return sole_height(obj, up)

    assign_action(obj, idle)

    lowest = None
    for frame in range(
        int(round(idle.frame_range[0])),
        int(round(idle.frame_range[1])) + 1,
    ):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        height = sole_height(obj, up)
        lowest = height if lowest is None else min(lowest, height)

    obj.animation_data.action = None

    return lowest


def plant(target, up, ground):
    """Set the rig's height from where its feet are.

    The hips are anchored at the reference pose, so the donor's
    own travel across the floor is dropped entirely and the only
    thing left to decide is how high the body sits. The lowest
    foot decides it: whichever one is nearest the floor is put on
    the floor, which lets a dip bend the knees and a step lift the
    free leg without either one leaving the ground behind.

    Dropping the travel is not just tidiness. The game strips root
    motion by pinning two of the hips' three translation channels,
    which assumes the rig's local Y is vertical -- true for most
    models and false for this one, whose bind pose is rotated.
    Feeding it a clip whose hips never translate sidesteps the
    guess entirely.

    Every bone below the hips holds its pose through rotation
    alone and carries no translation of its own, so moving the
    hips carries the whole body rigidly.
    """
    lowest = min(
        pose_world(target, foot).to_translation().dot(up)
        for foot in FEET
        if foot in target.pose.bones
    )

    shift = ground - lowest

    hips = target.pose.bones[HIPS]
    world = target.matrix_world @ hips.matrix
    local = target.matrix_world.inverted() @ (
        Matrix.Translation(shift * up) @ world
    )

    hips.matrix = (
        Matrix.Translation(local.to_translation())
        @ local.to_3x3().normalized().to_4x4()
    )

    return abs(shift)


def retarget(
    target, source, action, name, hold=0, fix=None, floor=0.0,
):
    """Bake one source action onto the target rig as `name`."""
    scene = bpy.context.scene
    layer = bpy.context.view_layer

    if fix is None:
        fix = Matrix.Identity(3)

    bone_map = {}
    for bone in target.data.bones:
        match = source_bone(source, bone.name)
        if match:
            bone_map[bone.name] = match

    if HIPS not in bone_map:
        raise RuntimeError(
            name + ': no hips match; rigs are not compatible',
        )

    order = parent_first(
        target, set(b.name for b in target.data.bones),
    )

    # The reference pose: the bind skeleton, stood upright. Every
    # delta from the donor lands on this, not on the bind pose.
    target_rest = {
        b.name: fix @ rest_world(
            target, b.name,
        ).to_3x3().normalized()
        for b in target.data.bones
    }

    source_rest = {
        tb: rest_world(source, sb).to_3x3().normalized()
        for tb, sb in bone_map.items()
    }

    target_hips_rest = rest_world(target, HIPS).to_translation()
    source_hips_rest = rest_world(
        source, bone_map[HIPS],
    ).to_translation()

    # Carries a world-space rotation out of the donor's world and
    # into Arthur's, which are not the same way up. Measured
    # against the upright reference pose, not the bind pose.
    align = (
        (fix @ rest_frame(target))
        @ rest_frame(source).transposed()
    )
    align_inv = align.transposed()

    # Arthur and the donor are different heights. Hip travel has to
    # shrink or grow with them or the dance lifts him off the floor.
    ratio = hip_height(target) / max(hip_height(source), 1e-6)

    assign_action(source, action)

    start, end = (int(round(v)) for v in action.frame_range)
    frames = list(range(start, end + 1))

    # A Mixamo "pose" clip is a single frame. three.js needs a clip
    # with duration, so hold it.
    if len(frames) < 2 and hold:
        frames = [start, start]
        out_frames = [0, hold]
    else:
        out_frames = list(range(len(frames)))

    baked = bpy.data.actions.new(name)
    assign_action(target, baked)

    for bone in target.pose.bones:
        bone.rotation_mode = 'QUATERNION'

    # The reference pose's up axis and floor height, for planting.
    up_axis = (fix @ rest_frame(target)).col[1].normalized()
    ground = floor

    travel_peak = 0.0
    float_peak = 0.0
    contact_lo = 1e9
    contact_hi = -1e9

    for index, frame in enumerate(frames):
        scene.frame_set(frame)
        layer.update()

        delta = {}
        for tb, sb in bone_map.items():
            delta[tb] = align @ (
                pose_world(source, sb).to_3x3().normalized()
                @ source_rest[tb].inverted()
            ) @ align_inv

        # Measured, reported, and deliberately not applied: how
        # far the donor would have carried the hips if the clip
        # kept its travel. Worth seeing in the log, because a
        # large number says the donor wanders and the planting
        # below is doing real work.
        travel_peak = max(
            travel_peak,
            (
                (
                    pose_world(
                        source, bone_map[HIPS],
                    ).to_translation()
                    - source_hips_rest
                ) * ratio
            ).length,
        )

        out = out_frames[index]

        for bone_name in order:
            pose_bone = target.pose.bones[bone_name]

            rotation = (
                delta[bone_name] @ target_rest[bone_name]
                if bone_name in delta
                else target_rest[bone_name]
            )

            if bone_name == HIPS:
                # Anchored. `plant` sets the height from the feet
                # and the donor's floor travel is discarded.
                location = target_hips_rest
            else:
                # The parent is already posed, so this bone's head
                # is wherever the chain now puts it.
                location = pose_world(
                    target, bone_name,
                ).to_translation()

            world = Matrix.Translation(location) @ rotation.to_4x4()

            # Into the armature's own space -- and strip the scale
            # that conversion carries in. The armature object is
            # scaled down by ~100x, so its inverse multiplies the
            # linear part by ~100. Children cancel that against
            # their parent and come out at 1, but the root bone
            # keeps it, which inflates the whole skeleton.
            local = target.matrix_world.inverted() @ world

            pose_bone.matrix = (
                Matrix.Translation(local.to_translation())
                @ local.to_3x3().normalized().to_4x4()
            )

            layer.update()

        before = min(
            pose_world(target, foot).to_translation().dot(up_axis)
            for foot in FEET
            if foot in target.pose.bones
        ) - ground

        contact_lo = min(contact_lo, before)
        contact_hi = max(contact_hi, before)

        float_peak = max(
            float_peak, plant(target, up_axis, ground),
        )

        layer.update()

        # Keyed after planting, so the shift is in the clip rather
        # than something the game has to re-derive.
        for bone_name in order:
            pose_bone = target.pose.bones[bone_name]

            pose_bone.keyframe_insert(
                'rotation_quaternion', frame=out,
            )
            pose_bone.keyframe_insert('location', frame=out)

            # Keyed explicitly so the exported clip pins it rather
            # than inheriting whatever the last clip left behind.
            pose_bone.scale = (1, 1, 1)
            pose_bone.keyframe_insert('scale', frame=out)

        if index % 60 == 0:
            log('  {}: frame {}/{}'.format(
                name, index + 1, len(frames),
            ))

    baked.use_fake_user = True

    log(
        '  {}: {} frames, {}/{} bones mapped, hip scale {:.3f}, '
        'align {:.0f} deg, hip travel {:.2f} leg, '
        'planted {:.2f} leg, contact {:.2f}..{:.2f} leg'.format(
            name,
            len(out_frames),
            len(bone_map),
            len(target.data.bones),
            ratio,
            align.to_quaternion().angle * 57.2958,
            travel_peak / max(hip_height(target), 1e-6),
            float_peak / max(hip_height(target), 1e-6),
            contact_lo / max(hip_height(target), 1e-6),
            contact_hi / max(hip_height(target), 1e-6),
        )
    )

    return baked


def import_source(path):
    """Import a clip donor and hand back its armature."""
    before = set(bpy.context.scene.objects)
    actions_before = set(bpy.data.actions)

    if path.lower().endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        bpy.ops.import_scene.gltf(filepath=path)

    added = [
        o for o in bpy.context.scene.objects
        if o not in before
    ]

    armature = next(o for o in added if o.type == 'ARMATURE')
    actions = [
        a for a in bpy.data.actions if a not in actions_before
    ]

    return armature, actions, added


def find_action(actions, needle):
    for action in actions:
        if needle.lower() in action.name.lower():
            return action
    return None


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    target_path, donor_dir = argv[0], argv[1]
    verify = '--verify' in argv
    here = os.path.dirname(target_path)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS

    log('loading target', target_path)
    bpy.ops.import_scene.gltf(filepath=target_path)

    target = armatures()[0]
    original = list(bpy.data.actions)

    log('target {}: {} bones, existing clips {}'.format(
        target.name,
        len(target.data.bones),
        [a.name for a in original],
    ))

    fix, reference = standing_fix(target, original)

    up_axis = (fix @ rest_frame(target)).col[1].normalized()
    floor = floor_height(target, original, up_axis)

    log(
        'reference pose: {} ({:.0f} deg off the bind pose), '
        'floor at {:.3f}'.format(
            reference,
            fix.to_quaternion().angle * 57.2958,
            floor,
        )
    )

    # Clip donors, both from three.js's own example assets and
    # both Mixamo-rigged, which is what makes them retargetable
    # onto Arthur at all. Fetch them into <donor-dir> first:
    #
    #   threejs.org/examples/models/fbx/Samba%20Dancing.fbx
    #     -> SambaDancing.fbx
    #   threejs.org/examples/models/gltf/Xbot.glb
    #
    # The trailing number holds a single-frame pose open for that
    # many frames, since a clip of no duration cannot be played.
    jobs = [
        ('SambaDancing.fbx', 'mixamo', 'Dance', 0),
        ('Xbot.glb', 'agree', 'Nod', 0),
        ('Xbot.glb', 'headShake', 'Shake', 0),
        ('Xbot.glb', 'sad_pose', 'Sad', 45),
    ]

    # Blender does not hand back the same bone rest rotations it
    # was given, so the exported clips have to stand on their own:
    # every bone keyed every frame, rest values never consulted.
    # `--verify` proves that by running one of Arthur's own clips
    # back through this exact path, for the game to diff against
    # the native one. Identity alignment, no scaling -- any drift
    # that shows up is the pipeline's, not the retarget's.
    if verify:
        jobs.append((target_path, 'Walk', 'WalkCheck', 0))

    baked = []
    cache = {}

    for filename, needle, name, hold in jobs:
        path = (
            filename if os.path.isabs(filename)
            else os.path.join(donor_dir, filename)
        )

        if path not in cache:
            bpy.context.scene.render.fps = FPS
            cache[path] = import_source(path)
            bpy.context.scene.render.fps = FPS

        armature, actions, _ = cache[path]
        action = find_action(actions, needle)

        if not action:
            log('  !! {}: no source action matching "{}"'.format(
                name, needle,
            ))
            continue

        log('{} <- {} :: {}'.format(name, os.path.basename(path), action.name))
        baked.append(
            retarget(
                target, armature, action, name, hold, fix,
                floor,
            ),
        )

    # Everything but Arthur's own rig goes: the donors, his mesh,
    # and his locomotion clips. What ships is the skeleton and the
    # emotes, which the game merges onto the model at load.
    donors = set()
    for _, _, added in cache.values():
        donors.update(added)

    for obj in list(bpy.context.scene.objects):
        if obj in donors or obj.type == 'MESH':
            bpy.data.objects.remove(obj, do_unlink=True)

    assign_action(target, baked[0])

    for action in list(bpy.data.actions):
        if action not in baked:
            action.use_fake_user = False
            bpy.data.actions.remove(action)

    out = os.path.join(here, 'arthur-emotes.glb')

    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        use_selection=False,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_force_sampling=True,
        export_bake_animation=True,
        export_optimize_animation_size=True,
        export_apply=False,
        export_skins=True,
        export_morph=False,
        export_lights=False,
        export_cameras=False,
    )

    log('wrote {} ({:.0f} KB)'.format(
        out, os.path.getsize(out) / 1024,
    ))
    log('clips', [a.name for a in baked])


main()
