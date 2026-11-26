import { Float32BufferAttribute, MathUtils } from 'three'
import type { BufferGeometry, MeshBasicMaterial, MeshDepthMaterial, MeshStandardMaterial } from 'three'

type MotionTime = { value: number }

export function addPlantWind(geometry: BufferGeometry, root: readonly [number, number, number],
  strength: number, reach: number, phase: number) {
  const position = geometry.attributes.position
  const wind = new Float32Array(position.count * 2)
  const [ox, oy, oz] = root
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) - ox, y = position.getY(i) - oy, z = position.getZ(i) - oz
    const fromRoot = Math.hypot(x, y, z)
    const flexibility = MathUtils.smoothstep(fromRoot, 0.15, reach)
    wind[i * 2] = strength * flexibility * flexibility
    wind[i * 2 + 1] = phase + x * 0.61 + z * 0.76 + y * 0.19
  }
  geometry.setAttribute('plantWind', new Float32BufferAttribute(wind, 2))
  return geometry
}

export function animateFoliage(material: MeshStandardMaterial | MeshDepthMaterial, time: MotionTime) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.environmentMotionSeconds = time
    shader.vertexShader = shader.vertexShader.replace('#include <common>', /* glsl */`
      #include <common>
      uniform float environmentMotionSeconds;
      attribute vec2 plantWind;
    `).replace('#include <begin_vertex>', /* glsl */`
      #include <begin_vertex>
      float seconds = environmentMotionSeconds;
      float breeze = sin(seconds * 1.38 + plantWind.y);
      float eddy = sin(seconds * 2.78 + plantWind.y * 2.14 + position.y * 1.31);
      float bend = plantWind.x * smoothstep(0.0, 1.8, seconds);
      transformed += bend * vec3(breeze * 0.77 + eddy * 0.23, eddy * 0.09,
        sin(seconds * 1.71 + plantWind.y + 0.76) * 0.49 + eddy * 0.12);
    `)
  }
}

export function animateWindowView(material: MeshBasicMaterial, time: MotionTime,
  { canopy = [0.30, 0.44], cloudAmount = 0.036 }: { canopy?: [number, number]; cloudAmount?: number } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.environmentMotionSeconds = time
    shader.uniforms.windowCanopy = { value: canopy }
    shader.uniforms.windowCloudAmount = { value: cloudAmount }
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', /* glsl */`
      #include <common>
      uniform float environmentMotionSeconds;
      uniform vec2 windowCanopy;
      uniform float windowCloudAmount;
    `).replace('#include <map_fragment>', /* glsl */`
      #ifdef USE_MAP
        vec2 uv = vMapUv;
        vec4 view = texture2D(map, uv);
        float time = environmentMotionSeconds;
        if (time > 0.0) {
          float ease = smoothstep(0.0, 2.5, time);
          // Filter by color as well as height to keep the blue-gray buildings still.
          float foliage = (1.0 - smoothstep(windowCanopy.x, windowCanopy.y, uv.y))
            * smoothstep(0.022, 0.105, view.g - view.b)
            * smoothstep(0.01, 0.07, view.g - 0.80 * view.r);
          if (foliage > 0.002) {
            float phase = uv.x * 43.0 + uv.y * 17.0;
            vec2 breeze = vec2(
              sin(time * 1.26 + phase) * 0.00128 + sin(time * 2.22 - phase * 0.49) * 0.00052,
              sin(time * 1.55 + phase * 1.39) * 0.00061
            );
            vec3 nearbyLeaves = texture2D(map, clamp(uv + breeze * foliage * ease, 0.0, 1.0)).rgb;
            view.rgb = mix(view.rgb, nearbyLeaves, foliage);
          }
          if (windowCloudAmount > 0.0) {
            // The Office sky lies above the right towers and to the right of the tall left building.
            float sky = smoothstep(0.33, 0.42, uv.x) * smoothstep(0.62, 0.74, uv.y)
              * smoothstep(0.25, 0.44, view.b) * smoothstep(-0.01, 0.07, view.b - view.r);
            float wisps = smoothstep(0.53, 0.93, 0.64 * sin(33.0 * uv.y + 12.0 * uv.x - time * 0.038)
              + 0.36 * sin(48.0 * uv.y - 21.0 * uv.x + time * 0.021));
            view.rgb = mix(view.rgb, vec3(0.92, 0.95, 0.99), windowCloudAmount * wisps * sky * ease);
          }
        }
        diffuseColor *= view;
      #endif
    `)
  }
}
