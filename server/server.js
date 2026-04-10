import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json())

async function getSpotifyToken() {
  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' +
        Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
    }),
  })

  const tokenData = await tokenResponse.json()

  if (!tokenResponse.ok || !tokenData.access_token) {
    console.error('TOKEN ERROR:', tokenData)
    throw new Error('Could not get Spotify token')
  }

  return tokenData.access_token
}

async function spotifyGet(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  const data = await response.json()

  if (!response.ok) {
    console.error('SPOTIFY GET ERROR:', data)
    throw new Error(`Spotify GET failed: ${response.status}`)
  }

  return data
}

function mapTrack(track) {
  return {
    id: track.id,
    name: track.name,
    artist: track.artists.map((artist) => artist.name).join(', '),
    artistIds: track.artists.map((artist) => artist.id),
    album: track.album?.name || '',
    image: track.album?.images?.[0]?.url || '',
    popularity: track.popularity || 0,
    releaseDate: track.album?.release_date || '',
  }
}

function mapArtist(artist) {
  return {
    id: artist.id,
    name: artist.name,
    genres: artist.genres || [],
    popularity: artist.popularity || 0,
  }
}

function normalize(text) {
  return (text || '').toLowerCase().trim()
}

function mainArtist(text) {
  return normalize(text).split(',')[0].trim()
}

function dedupeById(items) {
  const seen = new Set()
  return items.filter((item) => {
    if (!item.id || seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function dedupeByNameArtist(items) {
  const seen = new Set()
  return items.filter((item) => {
    const key = `${normalize(item.name)}__${mainArtist(item.artist)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getYear(releaseDate) {
  if (!releaseDate) return null
  const year = parseInt(releaseDate.slice(0, 4), 10)
  return Number.isNaN(year) ? null : year
}

function getEra(year) {
  if (!year) return null
  if (year < 1980) return '70s'
  if (year < 1990) return '80s'
  if (year < 2000) return '90s'
  if (year < 2010) return '2000s'
  if (year < 2020) return '2010s'
  return '2020s'
}

function genreBucket(genres = []) {
  const joined = genres.map(normalize).join(' ')

  if (joined.includes('dance pop') || joined.includes('electropop') || joined.includes('pop')) return 'pop'
  if (joined.includes('classic rock') || joined.includes('album rock') || joined.includes('rock')) return 'rock'
  if (joined.includes('hip hop') || joined.includes('rap') || joined.includes('trap')) return 'hiphop'
  if (joined.includes('indie') || joined.includes('alternative')) return 'indie'
  if (joined.includes('r&b') || joined.includes('soul')) return 'rnb'
  if (joined.includes('edm') || joined.includes('house') || joined.includes('electronic')) return 'electronic'
  if (joined.includes('country')) return 'country'

  return 'other'
}

function scoreTrack(track, seedProfile) {
  const candidateArtist = mainArtist(track.artist)
  const candidateName = normalize(track.name)
  const candidateYear = getYear(track.releaseDate)
  const candidateEra = getEra(candidateYear)

  let score = 0

  if (candidateArtist === seedProfile.seedArtist) {
    score -= 25
  } else {
    score += 20
  }

  const sameTitle =
    candidateName === seedProfile.seedName ||
    candidateName.includes(seedProfile.seedName) ||
    seedProfile.seedName.includes(candidateName)

  if (sameTitle) score -= 40

  if (candidateEra && seedProfile.era && candidateEra === seedProfile.era) {
    score += 20
  }

  const popularityGap = Math.abs((track.popularity || 0) - (seedProfile.popularity || 0))
  score += Math.max(0, 20 - popularityGap / 3)

  score += track.popularity * 0.2

  return score
}

app.get('/', (req, res) => {
  res.send('Server running')
})

app.get('/api/search', async (req, res) => {
  const query = req.query.q

  if (!query) {
    return res.status(400).json({ error: 'Missing search query' })
  }

  try {
    const accessToken = await getSpotifyToken()

    const data = await spotifyGet(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`,
      accessToken
    )

    const tracks = (data.tracks?.items || []).map(mapTrack)
    res.json({ tracks })
  } catch (error) {
    console.error('SEARCH ROUTE ERROR:', error.message)
    res.status(500).json({ error: 'Spotify search failed', details: error.message })
  }
})

app.post('/api/generate-playlist', async (req, res) => {
  const { seedTrack } = req.body

  if (!seedTrack || !seedTrack.name || !seedTrack.artist) {
    return res.status(400).json({ error: 'Missing seed track info' })
  }

  try {
    const accessToken = await getSpotifyToken()

    let seedGenres = []
    let seedArtistTopTracks = []
    let similarArtists = []

    const seedArtistId = seedTrack.artistIds?.[0]
    const seedArtist = mainArtist(seedTrack.artist)

    // 1. Get seed artist genres
    if (seedArtistId) {
      try {
        const artistData = await spotifyGet(
          `https://api.spotify.com/v1/artists/${seedArtistId}`,
          accessToken
        )
        seedGenres = artistData.genres || []
      } catch (error) {
        console.log('Artist lookup failed:', error.message)
      }

      // 2. Get seed artist top tracks
      try {
        const topTracksData = await spotifyGet(
          `https://api.spotify.com/v1/artists/${seedArtistId}/top-tracks?market=US`,
          accessToken
        )
        seedArtistTopTracks = (topTracksData.tracks || []).map(mapTrack)
      } catch (error) {
        console.log('Seed top tracks failed:', error.message)
      }
    }

    // 3. Search for artists in the same genres
    const artistQueries = new Set()

    for (const genre of seedGenres.slice(0, 3)) {
      artistQueries.add(`genre:"${genre}"`)
      artistQueries.add(genre)
    }

    // backup if no genres found
    if (artistQueries.size === 0) {
      artistQueries.add(seedTrack.artist)
    }

    for (const query of artistQueries) {
      try {
        const artistSearchData = await spotifyGet(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=artist&limit=10`,
          accessToken
        )

        const foundArtists = (artistSearchData.artists?.items || [])
          .map(mapArtist)
          .filter((artist) => mainArtist(artist.name) !== seedArtist)

        similarArtists.push(...foundArtists)
      } catch (error) {
        console.log(`Artist search failed for "${query}":`, error.message)
      }
    }

    similarArtists = dedupeById(similarArtists).slice(0, 8)

    // 4. Get top tracks from those artists
    let candidateTracks = [...seedArtistTopTracks]

    for (const artist of similarArtists) {
      try {
        const topTracksData = await spotifyGet(
          `https://api.spotify.com/v1/artists/${artist.id}/top-tracks?market=US`,
          accessToken
        )

        const tracks = (topTracksData.tracks || []).map(mapTrack)
        candidateTracks.push(...tracks)
      } catch (error) {
        console.log(`Top tracks failed for ${artist.name}:`, error.message)
      }
    }

    // 5. Emergency fallback: broad search by seed artist if too few tracks
    if (candidateTracks.length < 8) {
      try {
        const fallbackData = await spotifyGet(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(seedTrack.artist)}&type=track&limit=10`,
          accessToken
        )
        candidateTracks.push(...(fallbackData.tracks?.items || []).map(mapTrack))
      } catch (error) {
        console.log('Fallback track search failed:', error.message)
      }
    }

    // 6. Clean up
    candidateTracks = dedupeById(candidateTracks)
    candidateTracks = dedupeByNameArtist(candidateTracks)
    candidateTracks = candidateTracks.filter((track) => track.id !== seedTrack.id)

    // 7. Light scoring only
    const scored = candidateTracks
      .map((track) => {
        const artist = mainArtist(track.artist)
        let score = 0

        if (artist === seedArtist) score += 5
        else score += 20

        score += (track.popularity || 0) * 0.35

        return {
          ...track,
          score,
        }
      })
      .sort((a, b) => b.score - a.score)

    // 8. Build final playlist
    const finalPlaylist = [
      {
        id: seedTrack.id,
        name: seedTrack.name,
        artist: seedTrack.artist,
        image: seedTrack.image || '',
        score: 100,
      },
    ]

    const artistCounts = {}
    artistCounts[seedArtist] = 1

    for (const track of scored) {
      const artist = mainArtist(track.artist)
      const count = artistCounts[artist] || 0

      // allow max 2 songs per artist total
      if (count >= 2) continue

      finalPlaylist.push({
        id: track.id,
        name: track.name,
        artist: track.artist,
        image: track.image,
        score: Math.round(track.score || track.popularity || 50),
      })

      artistCounts[artist] = count + 1

      if (finalPlaylist.length === 12) break
    }

    // 9. Absolute fallback if still too short
    if (finalPlaylist.length < 4) {
      const fallback = [...seedArtistTopTracks]
        .map(mapTrack)
        .filter((track) => track.id !== seedTrack.id)
        .slice(0, 5)

      for (const track of fallback) {
        if (finalPlaylist.find((song) => song.id === track.id)) continue

        finalPlaylist.push({
          id: track.id,
          name: track.name,
          artist: track.artist,
          image: track.image,
          score: track.popularity || 50,
        })

        if (finalPlaylist.length === 8) break
      }
    }

    res.json({
      playlist: finalPlaylist,
      seedGenres,
      similarArtists: similarArtists.map((artist) => artist.name),
    })
  } catch (error) {
    console.error('GENERATE ROUTE ERROR:', error.message)
    res.status(500).json({
      error: 'Playlist generation failed',
      details: error.message,
    })
  }
})

app.listen(3001, () => {
  console.log('SERVER RUNNING ON 3001')
})