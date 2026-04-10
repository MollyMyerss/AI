import { useState } from 'react'
import './App.css'

function App() {
  const [query, setQuery] = useState('')
  const [tracks, setTracks] = useState([])
  const [selectedTrack, setSelectedTrack] = useState(null)
  const [playlist, setPlaylist] = useState([])
  const [loadingPlaylist, setLoadingPlaylist] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const handleSearch = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setPlaylist([])
    setSelectedTrack(null)

    if (!query.trim()) return

    try {
      const response = await fetch(
        `http://localhost:3001/api/search?q=${encodeURIComponent(query)}`
      )

      if (!response.ok) {
        throw new Error('Search request failed')
      }

      const data = await response.json()
      setTracks(data.tracks || [])
    } catch (error) {
      console.error('Search failed:', error)
      setError('Search failed. Please try again.')
    }
  }

  const handleUseSong = async (track) => {
    setError('')
    setMessage('')
    setSelectedTrack(track)
    setLoadingPlaylist(true)

    try {
      const res = await fetch('http://localhost:3001/api/generate-playlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ seedTrack: track }),
      })

      if (!res.ok) {
        throw new Error(`Playlist request failed with status ${res.status}`)
      }

      const data = await res.json()
      console.log('playlist response:', data)

      if (data.playlist && data.playlist.length > 0) {
        setPlaylist(data.playlist)
        setMessage(`Generated ${data.playlist.length} songs`)
      } else {
        setPlaylist([])
        setMessage('No playlist songs were returned')
      }
    } catch (error) {
      console.error('Generate playlist failed:', error)
      setError('Could not generate playlist.')
      setPlaylist([])
    } finally {
      setLoadingPlaylist(false)
    }
  }

  return (
    <div className="app">
      <header className="hero">
        <h1>AI DJ</h1>
        <p>Create smart playlists based on a song you choose.</p>
      </header>

      <form className="search-form" onSubmit={handleSearch}>
        <input
          type="text"
          placeholder="Search for a song or artist"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit">Search</button>
      </form>

      {error && <p>{error}</p>}
      {message && <p>{message}</p>}
      {loadingPlaylist && <p>Generating playlist...</p>}

      {selectedTrack && (
        <div className="selected-track">
          <h2>Selected Seed Song</h2>
          <p>
            <strong>{selectedTrack.name}</strong> by {selectedTrack.artist}
          </p>
        </div>
      )}

      <section className="results">
        <h2>Results</h2>

        {tracks.length === 0 ? (
          <p>No songs yet. Search to begin.</p>
        ) : (
          <div className="track-list">
            {tracks.map((track) => (
              <div key={track.id} className="track-card">
                {track.image && <img src={track.image} alt={track.name} />}

                <div className="track-info">
                  <h3>{track.name}</h3>
                  <p>{track.artist}</p>
                </div>

                <button
                  onClick={() => handleUseSong(track)}
                  disabled={loadingPlaylist}
                >
                  {loadingPlaylist && selectedTrack?.id === track.id
                    ? 'Generating...'
                    : 'Use This Song'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="playlist">
        <h2>Generated Playlist</h2>

        {playlist.length === 0 ? (
          <p>No playlist generated yet.</p>
        ) : (
          <div className="track-list">
            {playlist.map((song, index) => (
              <div key={`${song.name}-${index}`} className="track-card">
                {song.image && <img src={song.image} alt={song.name} />}

                <div className="track-info">
                  <h3>{index + 1}. {song.name}</h3>
                  <p>{song.artist}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default App