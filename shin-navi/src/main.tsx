import { createRoot } from 'react-dom/client'
import { SongArt } from './ui/SongArt'
import { SONGS } from './data/songs'

const pick = SONGS.filter((_, i) => i % 11 === 0).slice(0, 12)
createRoot(document.getElementById('root')!).render(
  <div style={{ background: '#07030f', minHeight: '100vh', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, padding: 6 }}>
    {pick.map(s => (
      <div key={s.id} style={{ aspectRatio: '1', borderRadius: 16, overflow: 'hidden', position: 'relative' }}>
        <SongArt seed={s.id} energy={s.energy} />
        <div style={{ position: 'absolute', bottom: 6, left: 8, color: '#fff', font: '700 12px sans-serif', textShadow: '0 1px 4px #000' }}>{s.title}</div>
      </div>
    ))}
  </div>,
)
