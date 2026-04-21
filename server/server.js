import 'dotenv/config'

import express from 'express'
import cors from 'cors'
import { GoogleGenerativeAI } from '@google/generative-ai'


const app = express()
app.use(cors())
app.use(express.json())

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' })

// ─────────────────────────────────────────────
// RETRY HELPER (handles 429 rate limits)
// ─────────────────────────────────────────────

async function retryWithBackoff(fn, retries = 3, delayMs = 20000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const is429 = err.message?.includes('429') || err.message?.includes('Too Many Requests')
      if (is429 && attempt < retries) {
        const wait = delayMs * (attempt + 1)
        console.warn(`Rate limited (429). Retrying in ${wait / 1000}s... (attempt ${attempt + 1}/${retries})`)
        await new Promise((r) => setTimeout(r, wait))
      } else {
        throw err
      }
    }
  }
}

// ─────────────────────────────────────────────
// SPOTIFY HELPERS
// ─────────────────────────────────────────────

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
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
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
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  const data = await response.json()

  if (!response.ok) {
    console.error('SPOTIFY GET ERROR:', data)
    throw new Error(`Spotify GET failed: ${response.status}`)
  }

  return data
}

// ─────────────────────────────────────────────
// DATA MAPPERS
// ─────────────────────────────────────────────

function mapTrack(track) {
  return {
    id: track.id,
    name: track.name,
    artist: track.artists.map((a) => a.name).join(', '),
    image: track.album?.images?.[0]?.url || '',
  }
}

function mapArtist(artist) {
  return {
    id: artist.id,
    name: artist.name,
    image: artist.images?.[0]?.url || '',
    genres: artist.genres || [],
    popularity: artist.popularity || 0,
  }
}

// ─────────────────────────────────────────────
// SEARCH TRACKS
// ─────────────────────────────────────────────

app.get('/api/search', async (req, res) => {
  const { q, type } = req.query

  if (!q) return res.json({ tracks: [], artists: [] })

  try {
    const accessToken = await getSpotifyToken()

    if (type === 'artist') {
      const data = await spotifyGet(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=artist&limit=8`,
        accessToken
      )
      return res.json({ artists: (data.artists?.items || []).map(mapArtist) })
    }

    const data = await spotifyGet(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=8`,
      accessToken
    )
    return res.json({ tracks: (data.tracks?.items || []).map(mapTrack) })
  } catch (err) {
    console.error('SEARCH ERROR:', err.message)
    return res.status(500).json({ error: 'Search failed' })
  }
})

// ─────────────────────────────────────────────
// SEARCH ARTISTS
// ─────────────────────────────────────────────

app.get('/api/search-artists', async (req, res) => {
  const { q } = req.query

  if (!q) return res.json({ artists: [] })

  try {
    const accessToken = await getSpotifyToken()

    const data = await spotifyGet(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=artist&limit=8`,
      accessToken
    )

    return res.json({ artists: (data.artists?.items || []).map(mapArtist) })
  } catch (err) {
    console.error('ARTIST SEARCH ERROR:', err.message)
    return res.status(500).json({ error: 'Artist search failed' })
  }
})

// ─────────────────────────────────────────────
// GENERATE PLAYLIST (GEMINI + SPOTIFY)
// ─────────────────────────────────────────────

app.post('/api/generate-playlist', async (req, res) => {
  const { preferences } = req.body

  if (!preferences) {
    return res.status(400).json({ error: 'Missing preferences' })
  }

  const {
    likedTracks = [],
    dislikedTracks = [],
    likedArtists = [],
    dislikedArtists = [],
    genres = [],
    songCount = 12,
    context = '',
  } = preferences

  console.log('GENERATING PLAYLIST:', {
    likedTracks: likedTracks.length,
    dislikedTracks: dislikedTracks.length,
    likedArtists: likedArtists.length,
    dislikedArtists: dislikedArtists.length,
    genres,
    songCount,
    context,
  })

  try {
    const accessToken = await getSpotifyToken()

    const likedTracksText =
      likedTracks.length > 0
        ? likedTracks.map((t) => `  - "${t.name}"${t.artist ? ` by ${t.artist}` : ''}`).join('\n')
        : '  None'

    const dislikedTracksText =
      dislikedTracks.length > 0
        ? dislikedTracks.map((t) => `  - "${t.name}"${t.artist ? ` by ${t.artist}` : ''}`).join('\n')
        : '  None'

    const likedArtistsText =
      likedArtists.length > 0 ? `  ${likedArtists.join(', ')}` : '  None'

    const dislikedArtistsText =
      dislikedArtists.length > 0 ? `  ${dislikedArtists.join(', ')}` : '  None'

    const genresText =
      genres.length > 0 ? `  ${genres.join(', ')}` : '  No preference'

    const contextText = context ? `  ${context}` : '  General listening'

    const prompt = `You are an expert AI DJ creating a personalized playlist.

USER PREFERENCES:

Songs they love (use these as strong signals for style, mood, and genre):
${likedTracksText}

Songs they dislike (NEVER include these or anything very similar):
${dislikedTracksText}

Artists they love (prioritize these artists and similar ones):
${likedArtistsText}

Artists they dislike (NEVER include these artists):
${dislikedArtistsText}

Preferred genres:
${genresText}

Listening context / mood:
${contextText}

INSTRUCTIONS:
- Recommend exactly ${songCount} songs.
- Heavily weight the liked songs and artists when deciding style and vibe.
- Never include any disliked songs or artists.
- Vary the selection — don't pick 5 songs from the same artist.
- Songs must actually exist on Spotify.
- If context is provided (e.g. "gym", "studying", "late night drive"), match the energy accordingly.
- Return ONLY a raw JSON array with no markdown, no explanation, no code fences.

FORMAT (return exactly this, nothing else):
[
  { "name": "Song Title", "artist": "Artist Name" },
  { "name": "Song Title", "artist": "Artist Name" }
]`

    // Wrap in retry so 429s wait and retry instead of crashing
    const result = await retryWithBackoff(() => model.generateContent(prompt))
    const text = result.response.text().trim()

    console.log('GEMINI RAW RESPONSE (first 300 chars):', text.slice(0, 300))

    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    const match = cleaned.match(/\[[\s\S]*\]/)
    if (!match) {
      console.error('No JSON array found in Gemini response:', text)
      throw new Error('Invalid AI response — no JSON array found')
    }

    let aiSongs = []
    try {
      aiSongs = JSON.parse(match[0])
    } catch (err) {
      console.error('JSON parse error:', err.message)
      throw new Error('AI returned invalid JSON')
    }

    console.log(`GEMINI returned ${aiSongs.length} songs`)

    const playlist = []
    const seenIds = new Set()

    for (const song of aiSongs) {
      if (playlist.length >= songCount) break
      if (!song.name || !song.artist) continue

      try {
        const searchData = await spotifyGet(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(
            `track:${song.name} artist:${song.artist}`
          )}&type=track&limit=3`,
          accessToken
        )

        for (const item of searchData.tracks?.items || []) {
          if (seenIds.has(item.id)) continue

          const itemArtists = item.artists.map((a) => a.name.toLowerCase())
          const isDisliked = dislikedArtists.some((da) =>
            itemArtists.includes(da.toLowerCase())
          )
          if (isDisliked) continue

          playlist.push(mapTrack(item))
          seenIds.add(item.id)
          break
        }
      } catch (err) {
        console.warn(`Could not resolve "${song.name}" by ${song.artist}:`, err.message)
      }
    }

    console.log(`RESOLVED ${playlist.length} tracks from Spotify`)

    // Fallback: fill remaining slots
    if (playlist.length < songCount) {
      const needed = songCount - playlist.length
      const seedQuery = likedArtists[0] || likedTracks[0]?.artist || genres[0] || 'popular'

      console.log(`FALLBACK: fetching ${needed} more with seed "${seedQuery}"`)

      try {
        const fallback = await spotifyGet(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(seedQuery)}&type=track&limit=${needed * 2}`,
          accessToken
        )

        for (const item of fallback.tracks?.items || []) {
          if (playlist.length >= songCount) break
          if (seenIds.has(item.id)) continue

          const itemArtists = item.artists.map((a) => a.name.toLowerCase())
          const isDisliked = dislikedArtists.some((da) =>
            itemArtists.includes(da.toLowerCase())
          )
          if (isDisliked) continue

          playlist.push(mapTrack(item))
          seenIds.add(item.id)
        }
      } catch (err) {
        console.warn('Fallback search failed:', err.message)
      }
    }

    console.log(`FINAL PLAYLIST: ${playlist.length} tracks`)
    return res.json({ playlist })
  } catch (error) {
    console.error('GENERATE ROUTE ERROR:', error.message)

    // Surface rate limit errors clearly to the frontend
    if (error.message?.includes('429') || error.message?.includes('Too Many Requests')) {
      return res.status(429).json({
        error: 'AI rate limit reached. Please wait a minute and try again.',
        details: error.message,
      })
    }

    return res.status(500).json({
      error: 'Playlist generation failed',
      details: error.message,
    })
  }
})

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────

app.listen(3001, () => {
  console.log('SERVER RUNNING ON 3001')
})