import { useState, useEffect } from 'react'
import './App.css'

// ── Persistence helpers ──────────────────────────────────────────────────────
const STORAGE_KEYS = {
  likedTracks: 'aidj_liked_tracks',
  dislikedTracks: 'aidj_disliked_tracks',
  likedArtists: 'aidj_liked_artists',
  dislikedArtists: 'aidj_disliked_artists',
  genres: 'aidj_genres',
  songCount: 'aidj_song_count',
}

const load = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key)
    return raw !== null ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

// ── Component ────────────────────────────────────────────────────────────────
function App() {
  // ── Persistent state ───────────────────────────────────────────────────────
  const [likedTracks, setLikedTracksRaw] = useState(() =>
    load(STORAGE_KEYS.likedTracks, [])
  )
  const [dislikedTracks, setDislikedTracksRaw] = useState(() =>
    load(STORAGE_KEYS.dislikedTracks, [])
  )
  const [likedArtists, setLikedArtistsRaw] = useState(() =>
    load(STORAGE_KEYS.likedArtists, [])
  )
  const [dislikedArtists, setDislikedArtistsRaw] = useState(() =>
    load(STORAGE_KEYS.dislikedArtists, [])
  )
  const [genres, setGenresRaw] = useState(() => load(STORAGE_KEYS.genres, []))
  const [songCount, setSongCountRaw] = useState(() =>
    load(STORAGE_KEYS.songCount, 12)
  )

  // Wrapped setters that also persist to localStorage
  const setLikedTracks = (fn) =>
    setLikedTracksRaw((prev) => {
      const next = typeof fn === 'function' ? fn(prev) : fn
      save(STORAGE_KEYS.likedTracks, next)
      return next
    })
  const setDislikedTracks = (fn) =>
    setDislikedTracksRaw((prev) => {
      const next = typeof fn === 'function' ? fn(prev) : fn
      save(STORAGE_KEYS.dislikedTracks, next)
      return next
    })
  const setLikedArtists = (fn) =>
    setLikedArtistsRaw((prev) => {
      const next = typeof fn === 'function' ? fn(prev) : fn
      save(STORAGE_KEYS.likedArtists, next)
      return next
    })
  const setDislikedArtists = (fn) =>
    setDislikedArtistsRaw((prev) => {
      const next = typeof fn === 'function' ? fn(prev) : fn
      save(STORAGE_KEYS.dislikedArtists, next)
      return next
    })
  const setGenres = (fn) =>
    setGenresRaw((prev) => {
      const next = typeof fn === 'function' ? fn(prev) : fn
      save(STORAGE_KEYS.genres, next)
      return next
    })
  const setSongCount = (val) => {
    save(STORAGE_KEYS.songCount, val)
    setSongCountRaw(val)
  }

  // ── Ephemeral state ────────────────────────────────────────────────────────
  const [playlist, setPlaylist] = useState([])
  const [loadingPlaylist, setLoadingPlaylist] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [context, setContext] = useState('')

  const [manualLike, setManualLike] = useState('')
  const [manualDislike, setManualDislike] = useState('')
  const [manualLikeArtist, setManualLikeArtist] = useState('')
  const [manualDislikeArtist, setManualDislikeArtist] = useState('')

  const [songSearch, setSongSearch] = useState('')
  const [songResults, setSongResults] = useState([])
  const [songSearching, setSongSearching] = useState(false)

  const [artistSearch, setArtistSearch] = useState('')
  const [artistResults, setArtistResults] = useState([])
  const [artistSearching, setArtistSearching] = useState(false)

  // ── Search: Songs ──────────────────────────────────────────────────────────
  const searchSongs = async () => {
    if (!songSearch.trim()) return
    setSongSearching(true)
    setError('')
    try {
      const res = await fetch(
        `http://localhost:3001/api/search?q=${encodeURIComponent(songSearch)}`
      )
      const data = await res.json()
      setSongResults(data.tracks || [])
    } catch (err) {
      console.error(err)
      setError('Song search failed — is the backend running?')
    } finally {
      setSongSearching(false)
    }
  }

  // ── Search: Artists ────────────────────────────────────────────────────────
  // Tries /api/search-artists first; falls back to /api/search with type=artist
  const searchArtists = async () => {
    if (!artistSearch.trim()) return
    setArtistSearching(true)
    setError('')
    try {
      let data = null

      // Primary: dedicated artists endpoint
      try {
        const res = await fetch(
          `http://localhost:3001/api/search-artists?q=${encodeURIComponent(artistSearch)}`
        )
        if (res.ok) {
          data = await res.json()
        }
      } catch {}

      // Fallback: generic search endpoint with type param
      if (!data || !data.artists) {
        const res = await fetch(
          `http://localhost:3001/api/search?q=${encodeURIComponent(artistSearch)}&type=artist`
        )
        if (res.ok) {
          data = await res.json()
        }
      }

      setArtistResults(data?.artists || [])
      if (!data?.artists?.length) {
        setError(
          'No artists found. Make sure your backend exposes /api/search-artists.'
        )
      }
    } catch (err) {
      console.error(err)
      setError('Artist search failed — is the backend running?')
    } finally {
      setArtistSearching(false)
    }
  }

  // ── Already-added guard ────────────────────────────────────────────────────
  const alreadyLikedTrack = (id) => likedTracks.some((t) => t.id === id)
  const alreadyDislikedTrack = (id) => dislikedTracks.some((t) => t.id === id)
  const alreadyLikedArtist = (name) => likedArtists.includes(name)
  const alreadyDislikedArtist = (name) => dislikedArtists.includes(name)

  // ── Manual add helpers ─────────────────────────────────────────────────────
  const addManualLike = () => {
    if (!manualLike.trim()) return
    setLikedTracks((p) => [
      ...p,
      { id: `manual-like-${Date.now()}`, name: manualLike.trim(), artist: '' },
    ])
    setManualLike('')
  }
  const addManualDislike = () => {
    if (!manualDislike.trim()) return
    setDislikedTracks((p) => [
      ...p,
      { id: `manual-dislike-${Date.now()}`, name: manualDislike.trim(), artist: '' },
    ])
    setManualDislike('')
  }
  const addLikedArtist = () => {
    if (!manualLikeArtist.trim()) return
    setLikedArtists((p) => [...p, manualLikeArtist.trim()])
    setManualLikeArtist('')
  }
  const addDislikedArtist = () => {
    if (!manualDislikeArtist.trim()) return
    setDislikedArtists((p) => [...p, manualDislikeArtist.trim()])
    setManualDislikeArtist('')
  }

  const removeFromList = (setter, idOrName) => {
    setter((prev) =>
      prev.filter((v) =>
        typeof v === 'string' ? v !== idOrName : v.id !== idOrName
      )
    )
  }

  // ── Generate playlist ──────────────────────────────────────────────────────
  const handleGeneratePlaylist = async () => {
    setError('')
    setMessage('')
    setLoadingPlaylist(true)

    const preferences = {
      likedTracks: likedTracks.map((t) => ({ name: t.name, artist: t.artist })),
      dislikedTracks: dislikedTracks.map((t) => ({ name: t.name, artist: t.artist })),
      likedArtists,
      dislikedArtists,
      genres,
      songCount,
      context: context.trim() || undefined,  // ✅ now sent to backend
    }

    try {
      const res = await fetch('http://localhost:3001/api/generate-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences }),
      })

      if (!res.ok) throw new Error('Server returned ' + res.status)

      const data = await res.json()
      setPlaylist(data.playlist || [])
      setMessage(`Generated ${data.playlist?.length || 0} songs`)
    } catch (err) {
      console.error(err)
      setError('Could not generate playlist — is the backend running?')
    } finally {
      setLoadingPlaylist(false)
    }
  }

  const clearAll = () => {
    setLikedTracks([])
    setDislikedTracks([])
    setLikedArtists([])
    setDislikedArtists([])
    setGenres([])
    setSongCount(12)
    setPlaylist([])
    setMessage('')
    setError('')
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <header className="hero">
        <h1>AI DJ</h1>
        <p>Personalized AI music curator</p>
        <p className="credits">Created by Ragan, Molly, and Talia</p>
      </header>

      {error && <p className="error">{error}</p>}
      {message && <p className="message">{message}</p>}
      {loadingPlaylist && <p className="loading">Generating mix…</p>}

      {/* ── SONG SEARCH ── */}
      <section>
        <h2>Search Songs</h2>
        <div className="input-row">
          <input
            value={songSearch}
            onChange={(e) => setSongSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchSongs()}
            placeholder="Search Spotify songs…"
          />
          <button onClick={searchSongs} disabled={songSearching}>
            {songSearching ? '…' : 'Search'}
          </button>
        </div>

        {songResults.map((track) => (
          <div key={track.id} className="track-card">
            {track.image && <img src={track.image} alt="" />}
            <div className="track-info">
              <strong>{track.name}</strong>
              <span>{track.artist}</span>
            </div>
            <div className="track-actions">
              <button
                disabled={alreadyLikedTrack(track.id)}
                onClick={() =>
                  !alreadyLikedTrack(track.id) &&
                  setLikedTracks((p) => [...p, track])
                }
              >
                {alreadyLikedTrack(track.id) ? '✓ Liked' : '+ Like'}
              </button>
              <button
                disabled={alreadyDislikedTrack(track.id)}
                onClick={() =>
                  !alreadyDislikedTrack(track.id) &&
                  setDislikedTracks((p) => [...p, track])
                }
              >
                {alreadyDislikedTrack(track.id) ? '✓ Disliked' : '– Dislike'}
              </button>
            </div>
          </div>
        ))}

        {/* Manual entry */}
        <div className="input-row" style={{ marginTop: '0.5rem' }}>
          <input
            value={manualLike}
            onChange={(e) => setManualLike(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addManualLike()}
            placeholder="Or type a song name to like…"
          />
          <button onClick={addManualLike}>+ Like</button>
        </div>
        <div className="input-row">
          <input
            value={manualDislike}
            onChange={(e) => setManualDislike(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addManualDislike()}
            placeholder="Or type a song name to dislike…"
          />
          <button onClick={addManualDislike}>– Dislike</button>
        </div>
      </section>

      {/* ── ARTIST SEARCH ── */}
      <section>
        <h2>Search Artists</h2>
        <div className="input-row">
          <input
            value={artistSearch}
            onChange={(e) => setArtistSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchArtists()}
            placeholder="Search Spotify artists…"
          />
          <button onClick={searchArtists} disabled={artistSearching}>
            {artistSearching ? '…' : 'Search'}
          </button>
        </div>

        {artistResults.map((artist) => (
          <div key={artist.id} className="track-card">
            {artist.image && <img src={artist.image} alt="" />}
            <div className="track-info">
              <strong>{artist.name}</strong>
            </div>
            <div className="track-actions">
              <button
                disabled={alreadyLikedArtist(artist.name)}
                onClick={() =>
                  !alreadyLikedArtist(artist.name) &&
                  setLikedArtists((p) => [...p, artist.name])
                }
              >
                {alreadyLikedArtist(artist.name) ? '✓ Liked' : '+ Like'}
              </button>
              <button
                disabled={alreadyDislikedArtist(artist.name)}
                onClick={() =>
                  !alreadyDislikedArtist(artist.name) &&
                  setDislikedArtists((p) => [...p, artist.name])
                }
              >
                {alreadyDislikedArtist(artist.name) ? '✓ Disliked' : '– Dislike'}
              </button>
            </div>
          </div>
        ))}

        {/* Manual entry */}
        <div className="input-row" style={{ marginTop: '0.5rem' }}>
          <input
            value={manualLikeArtist}
            onChange={(e) => setManualLikeArtist(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addLikedArtist()}
            placeholder="Or type an artist to like…"
          />
          <button onClick={addLikedArtist}>+ Like</button>
        </div>
        <div className="input-row">
          <input
            value={manualDislikeArtist}
            onChange={(e) => setManualDislikeArtist(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addDislikedArtist()}
            placeholder="Or type an artist to dislike…"
          />
          <button onClick={addDislikedArtist}>– Dislike</button>
        </div>
      </section>

      {/* ── PREFERENCES SUMMARY ── */}
      <section>
        <h2>
          Your Preferences
          <button
            onClick={clearAll}
            style={{ marginLeft: '1rem', fontSize: '0.75rem' }}
          >
            Clear All
          </button>
        </h2>

        {likedTracks.length > 0 && (
          <div className="pref-group">
            <h3>✅ Liked Tracks</h3>
            {likedTracks.map((t) => (
              <span key={t.id} className="tag tag-like">
                {t.name}{t.artist ? ` — ${t.artist}` : ''}
                <button onClick={() => removeFromList(setLikedTracks, t.id)}>×</button>
              </span>
            ))}
          </div>
        )}

        {dislikedTracks.length > 0 && (
          <div className="pref-group">
            <h3>❌ Disliked Tracks</h3>
            {dislikedTracks.map((t) => (
              <span key={t.id} className="tag tag-dislike">
                {t.name}{t.artist ? ` — ${t.artist}` : ''}
                <button onClick={() => removeFromList(setDislikedTracks, t.id)}>×</button>
              </span>
            ))}
          </div>
        )}

        {likedArtists.length > 0 && (
          <div className="pref-group">
            <h3>✅ Liked Artists</h3>
            {likedArtists.map((a) => (
              <span key={a} className="tag tag-like">
                {a}
                <button onClick={() => removeFromList(setLikedArtists, a)}>×</button>
              </span>
            ))}
          </div>
        )}

        {dislikedArtists.length > 0 && (
          <div className="pref-group">
            <h3>❌ Disliked Artists</h3>
            {dislikedArtists.map((a) => (
              <span key={a} className="tag tag-dislike">
                {a}
                <button onClick={() => removeFromList(setDislikedArtists, a)}>×</button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* ── GENRES ── */}
      <section>
        <h2>Genres</h2>
        <div className="genre-grid">
          {['lofi', 'hiphop', 'rock', 'electronic', 'jazz', 'pop', 'r&b', 'classical'].map(
            (g) => (
              <label key={g} className={`genre-chip ${genres.includes(g) ? 'active' : ''}`}>
                <input
                  type="checkbox"
                  checked={genres.includes(g)}
                  onChange={() =>
                    setGenres((prev) =>
                      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]
                    )
                  }
                  style={{ display: 'none' }}
                />
                {g}
              </label>
            )
          )}
        </div>
      </section>

      {/* ── SONG COUNT ── */}
      <section>
        <h2>Number of Songs: {songCount}</h2>
        <input
          type="range"
          min="5"
          max="30"
          value={songCount}
          onChange={(e) => setSongCount(Number(e.target.value))}
        />
      </section>

      {/* ── CONTEXT ── */}
      <section>
        <h2>Listening Context (Optional)</h2>
        <input
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="e.g. studying, gym, late night drive"
          style={{ width: '100%' }}
        />
      </section>

      {/* ── GENERATE ── */}
      <button
        className="generate-btn"
        onClick={handleGeneratePlaylist}
        disabled={loadingPlaylist}
      >
        {loadingPlaylist ? 'Generating…' : '🎵 Generate Mix'}
      </button>

      {/* ── PLAYLIST ── */}
      {playlist.length > 0 && (
        <section>
          <h2>Generated Playlist</h2>
          {playlist.map((song, i) => (
            <div key={song.id || i} className="playlist-row">
              <span className="track-num">{i + 1}</span>
              <div>
                <strong>{song.name}</strong>
                {song.artist && <span> — {song.artist}</span>}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

export default App