// Original Astra performance keys, in actor-space radians. These are additive:
// the imported breathing/idle/talking clips and planted feet remain underneath.
// Runtime retargeting converts the actor axes into each rig's bone axes.
// No downloaded motion data or character geometry is contained in this file.
export const NPC_GESTURES = {
  Notice: { duration: 1.25, keys: [
    [0, {}], [.22, { head: [-.09, 0, 0], chest: [-.04, 0, 0] }],
    [.62, { head: [.1, 0, -.03] }], [1.25, {}],
  ] },
  Listen: { duration: 3.4, keys: [
    [0, {}], [.8, { head: [0, 0, -.055] }], [1.4, { head: [.085, 0, -.03] }],
    [1.7, { head: [-.025, 0, -.025] }], [2, { head: [.055, 0, -.02] }], [3.4, {}],
  ] },
  Talk: { duration: 3.8, keys: [
    [0, {}], [.55, { rightArm: [-.22, 0, .04], rightForearm: [-.28, 0, 0], chest: [0, -.025, 0] }],
    [1.05, { rightArm: [-.14, 0, .02], rightForearm: [-.18, 0, 0], head: [.045, 0, 0] }],
    [1.65, {}], [2.2, { leftArm: [-.17, 0, -.035], leftForearm: [-.2, 0, 0], head: [0, .045, 0] }],
    [2.65, { leftForearm: [-.11, 0, 0], head: [.05, 0, 0] }], [3.8, {}],
  ] },
  Point: { duration: 2.7, keys: [
    [0, {}], [.55, { rightArm: [-.65, -.12, .08], rightForearm: [-.3, 0, 0], chest: [0, -.06, 0], head: [0, -.14, 0] }],
    [1.65, { rightArm: [-.7, -.12, .08], rightForearm: [-.2, 0, 0], chest: [0, -.06, 0], head: [0, -.08, 0] }], [2.7, {}],
  ] },
  Concern: { duration: 2.4, keys: [
    [0, {}], [.3, { chest: [-.08, 0, 0], head: [-.13, .06, 0], rightForearm: [-.25, 0, 0], leftForearm: [-.2, 0, 0] }],
    [1.25, { chest: [-.045, 0, 0], head: [.045, -.08, .04], rightForearm: [-.15, 0, 0] }], [2.4, {}],
  ] },
  Shake: { duration: 1.6, keys: [
    [0, {}], [.3, { head: [0, -.12, 0] }], [.65, { head: [0, .12, 0] }],
    [.95, { head: [0, -.08, 0] }], [1.2, { head: [0, .055, 0] }], [1.6, {}],
  ] },
  LookAround: { duration: 4.8, keys: [
    [0, {}], [1, { head: [0, -.2, -.02], chest: [0, -.035, 0] }],
    [2, { head: [0, -.2, -.02] }], [3.1, { head: [0, .18, .025], chest: [0, .035, 0] }], [4.8, {}],
  ] },
};
