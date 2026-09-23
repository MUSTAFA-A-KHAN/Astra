"""Packs the supplied flashlight into the prop the heroes carry.

    python tools/pack-flashlight.py flashlight.glb assets/props/flashlight.glb

The supplied model is a Sketchfab export: 949 vertices under four 2048px
textures, eleven megabytes for something a few dozen pixels tall in play. It
also blends its whole surface to show a glass lens, which in three.js sorts
the barrel's back faces over its front ones. This writes the same mesh with
the textures at a size the prop is ever seen at, the surface opaque, and the
lens painted into the emission map, since the prop is only out while it is lit.

The mesh is baked into the frame the game holds it by: the lens looks down +Z,
the switch faces +Y, the grip is the origin and the prop is one unit long. A
node named `Lens` marks where the light leaves it.

Requires Pillow and NumPy.
"""

import io
import json
import struct
import sys

import numpy as np
from PIL import Image

GRIP = .4             # the grip, as a fraction of the length from the tail
TEXTURE = 512         # colour, surface and normal maps
EMISSION = 256        # the emission map is flat colour
LENS = (255, 244, 224)


def read_glb(path):
    data = open(path, 'rb').read()
    magic, _, _ = struct.unpack_from('<4sII', data, 0)
    if magic != b'glTF':
        raise ValueError(f'{path} is not a binary glTF')
    offset, gltf, binary = 12, None, None
    while offset < len(data):
        length, kind = struct.unpack_from('<I4s', data, offset)
        chunk = data[offset + 8:offset + 8 + length]
        if kind == b'JSON':
            gltf = json.loads(chunk)
        elif kind == b'BIN\x00':
            binary = chunk
        offset += 8 + length
    return gltf, binary


def view_bytes(gltf, binary, index):
    view = gltf['bufferViews'][index]
    start = view.get('byteOffset', 0)
    return binary[start:start + view['byteLength']], view.get('byteStride')


COMPONENTS = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def accessor(gltf, binary, index):
    spec = gltf['accessors'][index]
    raw, stride = view_bytes(gltf, binary, spec['bufferView'])
    dtype, width = np.dtype(COMPONENTS[spec['componentType']]), WIDTH[spec['type']]
    stride = stride or dtype.itemsize * width
    start = spec.get('byteOffset', 0)
    rows = np.frombuffer(raw, np.uint8, spec['count'] * stride - stride + dtype.itemsize * width, start)
    rows = np.lib.stride_tricks.as_strided(rows, (spec['count'], dtype.itemsize * width), (stride, 1))
    return np.ascontiguousarray(rows).view(dtype).reshape(spec['count'], width)


def node_matrix(node):
    if 'matrix' in node:
        return np.array(node['matrix'], float).reshape(4, 4).T
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    rotation = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    matrix = np.eye(4)
    matrix[:3, :3] = rotation * np.array(node.get('scale', [1, 1, 1]))
    matrix[:3, 3] = node.get('translation', [0, 0, 0])
    return matrix


def mesh_world_matrix(gltf):
    parents = {child: i for i, node in enumerate(gltf['nodes']) for child in node.get('children', [])}
    index = next(i for i, node in enumerate(gltf['nodes']) if 'mesh' in node)
    matrix = np.eye(4)
    while index is not None:
        matrix = node_matrix(gltf['nodes'][index]) @ matrix
        index = parents.get(index)
    return matrix, next(node['mesh'] for node in gltf['nodes'] if 'mesh' in node)


def image(gltf, binary, texture):
    source = gltf['textures'][texture['index']]['source']
    raw, _ = view_bytes(gltf, binary, gltf['images'][source]['bufferView'])
    return Image.open(io.BytesIO(raw))


def sample(picture, uv):
    """The texel under each UV, as glTF lays images: v runs down the rows."""
    pixels = np.asarray(picture)
    height, width = pixels.shape[:2]
    x = np.clip((uv[:, 0] % 1) * width, 0, width - 1).astype(int)
    y = np.clip((uv[:, 1] % 1) * height, 0, height - 1).astype(int)
    return pixels[y, x]


def jpeg(picture, size):
    out = io.BytesIO()
    # Full-resolution chroma: the surface and normal maps keep data, not colour, in their channels.
    picture.convert('RGB').resize((size, size), Image.LANCZOS).save(out, 'JPEG', quality=88, subsampling=0, optimize=True)
    return out.getvalue()


def main(source, destination):
    gltf, binary = read_glb(source)
    world, mesh_index = mesh_world_matrix(gltf)
    primitive, = gltf['meshes'][mesh_index]['primitives']
    attributes = primitive['attributes']
    positions = accessor(gltf, binary, attributes['POSITION']).astype(float)
    normals = accessor(gltf, binary, attributes['NORMAL']).astype(float)
    uvs = accessor(gltf, binary, attributes['TEXCOORD_0']).astype(np.float32)
    triangles = accessor(gltf, binary, primitive['indices']).reshape(-1, 3).astype(np.int64)
    material = gltf['materials'][primitive.get('material', 0)]
    pbr = material['pbrMetallicRoughness']
    colour = image(gltf, binary, pbr['baseColorTexture']).convert('RGBA')
    surface = image(gltf, binary, pbr['metallicRoughnessTexture'])
    normal_map = image(gltf, binary, material['normalTexture'])
    emission = image(gltf, binary, material['emissiveTexture']).convert('RGB')

    linear = world[:3, :3]
    positions = positions @ linear.T + world[:3, 3]
    normals = normals @ np.linalg.inv(linear)

    # The glass is the only part of the colour map that is see-through.
    centres = uvs[triangles].mean(axis=1)
    texels = sample(colour, centres)
    glass = texels[:, 3] < 250
    copper = (texels[:, 0] > 150) & (texels[:, 0].astype(int) - texels[:, 2] > 60) & (texels[:, 3] >= 250)
    if not glass.any() or not copper.any():
        raise ValueError('Could not find the lens or the switch in the colour map')

    # The barrel runs along the longest axis; the lens sets which way is forward.
    centre = positions.mean(axis=0)
    _, _, axes = np.linalg.svd(positions - centre, full_matrices=False)
    forward = axes[0]
    corners = positions[triangles]
    if (corners[glass].mean(axis=(0, 1)) - centre) @ forward < 0:
        forward = -forward
    up = corners[copper].mean(axis=(0, 1)) - centre
    up -= forward * (up @ forward)
    if np.linalg.norm(up) < 1e-6:
        raise ValueError('The switch sits on the barrel axis')
    up /= np.linalg.norm(up)
    right = np.cross(up, forward)
    rotation = np.stack([right, up, forward])

    local = (positions - centre) @ rotation.T
    low, high = local.min(axis=0), local.max(axis=0)
    length = high[2] - low[2]
    origin = np.array([(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, low[2] + GRIP * length])
    local = (local - origin) / length
    normals = normals @ rotation.T
    normals /= np.linalg.norm(normals, axis=1, keepdims=True)
    if np.linalg.det(rotation @ linear) < 0:
        triangles = triangles[:, ::-1]
    lens = local[np.unique(triangles[glass])][:, 2].max()

    # Emission: what the model already lights, and the glass.
    lit = np.asarray(emission).copy()
    lit[np.asarray(colour)[..., 3] < 250] = LENS
    emission = Image.fromarray(lit)

    blobs = [jpeg(colour, TEXTURE), jpeg(surface, TEXTURE), jpeg(normal_map, TEXTURE), jpeg(emission, EMISSION)]
    geometry = [local.astype(np.float32), normals.astype(np.float32), uvs, triangles.astype(np.uint16 if len(local) < 65536 else np.uint32)]

    buffer, views = bytearray(), []
    def append(data, target=None):
        while len(buffer) % 4:
            buffer.append(0)
        views.append({'buffer': 0, 'byteOffset': len(buffer), 'byteLength': len(data), **({'target': target} if target else {})})
        buffer.extend(data)
        return len(views) - 1
    accessors = []
    for i, (array, kind) in enumerate(zip(geometry, ['VEC3', 'VEC3', 'VEC2', 'SCALAR'])):
        view = append(array.tobytes(), 34963 if kind == 'SCALAR' else 34962)
        spec = {'bufferView': view, 'componentType': {np.float32: 5126, np.uint16: 5123, np.uint32: 5125}[array.dtype.type],
                'count': array.size // WIDTH[kind], 'type': kind}
        if i == 0:
            spec.update(min=array.min(axis=0).tolist(), max=array.max(axis=0).tolist())
        accessors.append(spec)
    images = [{'bufferView': append(blob), 'mimeType': 'image/jpeg'} for blob in blobs]

    extras = dict(gltf['asset'].get('extras', {}))
    extras['packing'] = 'Textures reduced and the lens made opaque by tools/pack-flashlight.py'
    packed = {
        'asset': {'version': '2.0', 'generator': 'Astra tools/pack-flashlight.py', 'extras': extras},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'name': 'Flashlight', 'mesh': 0, 'children': [1]}, {'name': 'Lens', 'translation': [0, 0, float(lens)]}],
        'meshes': [{'name': 'Flashlight', 'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 3, 'material': 0}]}],
        'materials': [{
            'name': 'Flashlight', 'doubleSided': True,
            'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicRoughnessTexture': {'index': 1}},
            'normalTexture': {'index': 2}, 'emissiveTexture': {'index': 3}, 'emissiveFactor': [1, 1, 1],
        }],
        'samplers': gltf.get('samplers', [{}])[:1],
        'textures': [{'sampler': 0, 'source': i} for i in range(4)],
        'images': images,
        'accessors': accessors,
        'bufferViews': views,
        'buffers': [{'byteLength': len(buffer)}],
    }
    text = json.dumps(packed, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    while len(buffer) % 4:
        buffer.append(0)
    total = 12 + 8 + len(text) + 8 + len(buffer)
    with open(destination, 'wb') as out:
        out.write(struct.pack('<4sII', b'glTF', 2, total))
        out.write(struct.pack('<I4s', len(text), b'JSON') + text)
        out.write(struct.pack('<I4s', len(buffer), b'BIN\x00') + buffer)
    print(f'{destination}: {total / 1024:.0f} KB, {len(local)} vertices, lens at z={lens:.3f}, '
          f'{glass.sum()} glass and {copper.sum()} switch triangles, source length {length:.4f}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(*sys.argv[1:])
