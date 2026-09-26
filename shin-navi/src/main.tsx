import { createRoot } from 'react-dom/client'
import { MirrorBall } from './ui/MirrorBall'
import { LightField } from './ui/fx'
import { faceCount, type Face } from './ui/mirrorBall'
import './styles/base.css'

const colors = ['#ff2e88', '#7df9ff', '#ffe066', '#c77dff', '#06d6a0', '#ff8a00']
const faces: Face[] = Array.from({ length: faceCount() }, (_, i) => {
  const r = (Math.sin(i * 12.9898) * 43758.5453) % 1
  const v = Math.abs(r)
  return { state: (v < 0.55 ? 0 : v < 0.7 ? 1 : v < 0.82 ? 2 : v < 0.94 ? 3 : 4) as Face['state'], color: colors[i % colors.length] }
})
createRoot(document.getElementById('root')!).render(
  <div style={{ position: 'relative', height: '100vh', background: 'radial-gradient(80% 60% at 50% 30%, #2a1060, #0b0620 70%)', display: 'grid', placeItems: 'center' }}>
    <LightField colors={colors} level={0.6} />
    <MirrorBall faces={faces} size={300} glow={0.6} />
  </div>,
)
