import * as THREE from 'three';

// Author contact points in fitted character units, then let their bones carry
// them through animation (including rigs exported with different units/axes).
export function createRidingAnchor(group, holder, point) {
  const anchor = new THREE.Object3D();
  anchor.name = 'Riding contact';
  anchor.position.copy(holder.worldToLocal(group.localToWorld(point.clone())));
  holder.add(anchor);
  return anchor;
}

const riderPoint = new THREE.Vector3();
const saddlePoint = new THREE.Vector3();

export function alignRider(avatar, riderAnchor, saddle) {
  riderAnchor.getWorldPosition(riderPoint);
  saddle.getWorldPosition(saddlePoint);
  // Convert both points to the avatar parent's space before translating it.
  if (avatar.parent) {
    avatar.parent.worldToLocal(riderPoint);
    avatar.parent.worldToLocal(saddlePoint);
  }
  avatar.position.add(saddlePoint.sub(riderPoint));
  avatar.updateWorldMatrix(false, true);
}
