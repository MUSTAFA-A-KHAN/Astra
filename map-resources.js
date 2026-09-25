// glTF textures may hold ImageBitmaps in addition to GPU allocations. Closing
// both is necessary when a district leaves memory after a portal crossing.
export function disposeMapResources(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) materials.add(material);
    object.skeleton?.dispose();
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    for (const uniform of Object.values(material.uniforms ?? {})) if (uniform?.value?.isTexture) textures.add(uniform.value);
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    const source = texture.source?.data;
    for (const image of Array.isArray(source) ? source : [source]) if (image) images.add(image);
    texture.dispose();
    if (texture.source) texture.source.data = null;
  }
  for (const image of images) if (typeof image.close === 'function') image.close();
  root.removeFromParent();
  root.clear();
}
