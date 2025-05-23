require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 10000;

// Middleware to parse JSON
app.use(express.json());

// Add CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );
  next();
});

// Root endpoint - serve manifest.json
app.get('/', (req, res) => {
  try {
    const manifestPath = path.join(__dirname, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    res.json(manifest);
  } catch (error) {
    console.error('Error serving manifest:', error);
    res.status(500).json({ error: 'Failed to serve manifest' });
  }
});

// Serve manifest.json
app.get('/manifest.json', (req, res) => {
  try {
    const manifestPath = path.join(__dirname, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    res.json(manifest);
  } catch (error) {
    console.error('Error serving manifest:', error);
    res.status(500).json({ error: 'Failed to serve manifest' });
  }
});

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';

// Helper: get IMDb id from TMDB
async function getImdbIdFromTmdb(tmdbId) {
  try {
    if (!TMDB_API_KEY) return null;
    const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const resp = await axios.get(url);
    return resp.data.imdb_id || null;
  } catch (e) {
    console.error('TMDB lookup failed:', e.message);
    return null;
  }
}

// Helper: get TMDB ID from IMDb ID
async function getTmdbIdFromImdb(imdbId) {
  try {
    if (!TMDB_API_KEY) return null;
    const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
    const resp = await axios.get(url);
    return resp.data.movie_results[0]?.id || null;
  } catch (e) {
    console.error('TMDB lookup failed:', e.message);
    return null;
  }
}

// Helper: get trailer from TMDB
async function getTrailerFromTmdb(tmdbId) {
  try {
    if (!TMDB_API_KEY) return null;
    const url = `https://api.themoviedb.org/3/movie/${tmdbId}/videos?api_key=${TMDB_API_KEY}`;
    const resp = await axios.get(url);

    // First try to find an official trailer
    const trailer = resp.data.results.find(
      (video) =>
        video.type === 'Trailer' &&
        video.site === 'YouTube' &&
        (video.official || video.name.toLowerCase().includes('official'))
    );

    // If no official trailer, get any trailer
    if (!trailer) {
      const anyTrailer = resp.data.results.find(
        (video) => video.type === 'Trailer' && video.site === 'YouTube'
      );
      if (anyTrailer) return anyTrailer.key;
    } else {
      return trailer.key;
    }

    return null;
  } catch (e) {
    console.error('TMDB videos lookup failed:', e.message);
    return null;
  }
}

// Stream endpoint for trailer
app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    console.log(`Received stream request for ${type} with ID: ${id}`);

    if (!TMDB_API_KEY) {
      console.error('TMDB API key is not set');
      return res.status(500).json({ error: 'TMDB API key is not configured' });
    }

    // Support both movies and series
    if (type !== 'movie' && type !== 'series') {
      return res.status(400).json({ error: 'Invalid request' });
    }

    let tmdbId = null;

    if (id.startsWith('tt')) {
      // Convert IMDb ID to TMDB ID
      tmdbId = await getTmdbIdFromImdb(id);
      console.log(`IMDb id ${id} resolved to TMDB id ${tmdbId}`);
    } else if (id.startsWith('tmdb:')) {
      tmdbId = id.replace('tmdb:', '');
      console.log(`Using TMDB id ${tmdbId}`);
    }

    if (!tmdbId) {
      console.log('Could not resolve TMDB ID');
      return res.json({ streams: [] });
    }

    // Get trailer from TMDB
    const videoId = await getTrailerFromTmdb(tmdbId);
    console.log('YouTube videoId found:', videoId);

    if (!videoId) {
      return res.json({ streams: [] });
    }

    // Get direct stream URLs from Piped
    try {
      const pipedResponse = await axios.get(
        `https://pipedapi.kavin.rocks/streams/${videoId}`
      );
      const { hls, videoStreams = [] } = pipedResponse.data;

      const streams = [];

      // Add HLS stream first (best for iOS)
      if (hls) {
        streams.push({
          name: 'Trailer (Adaptive)',
          title: 'Trailer HLS',
          url: hls,
          type: 'trailer',
          source: 'youtube',
          behaviorHints: {
            notWebReady: false,
            bingeGroup: `trailer-${videoId}`,
            ios_supports: true,
          },
        });
      }

      // Filter and sort streams by quality
      const sortedStreams = videoStreams
        .filter(
          (stream) =>
            // Only include iOS-compatible formats
            (stream.format === 'MPEG_4' || stream.format === 'MP4') &&
            // Include streams with quality info
            stream.quality &&
            // Ensure URL is HTTPS (required for iOS)
            stream.url.startsWith('https://')
        )
        .sort((a, b) => {
          const getQualityNumber = (q) => parseInt(q.replace('p', '')) || 0;
          return getQualityNumber(b.quality) - getQualityNumber(a.quality);
        });

      // Add direct MP4 streams
      sortedStreams.forEach((stream) => {
        streams.push({
          name: `Trailer (${stream.quality})`,
          title: `Trailer ${stream.quality}`,
          url: stream.url,
          type: 'trailer',
          source: 'youtube',
          behaviorHints: {
            notWebReady: false,
            bingeGroup: `trailer-${videoId}`,
            ios_supports: true,
          },
        });
      });

      if (streams.length === 0) {
        // Fallback to Piped web player URL
        streams.push({
          name: 'Trailer (Web)',
          title: 'Trailer',
          url: `https://piped.kavin.rocks/watch?v=${videoId}`,
          type: 'trailer',
          source: 'youtube',
          behaviorHints: {
            notWebReady: false,
            ios_supports: true,
          },
        });
      }

      console.log('Returning streams:', JSON.stringify(streams, null, 2));
      res.json({ streams });
    } catch (error) {
      console.error('Failed to get direct streams:', error.message);
      // Fallback to basic stream
      const streams = [
        {
          name: 'Trailer',
          title: 'Trailer',
          url: `https://piped.kavin.rocks/watch?v=${videoId}`,
          type: 'trailer',
          source: 'youtube',
          behaviorHints: {
            notWebReady: false,
            ios_supports: true,
          },
        },
      ];
      res.json({ streams });
    }
  } catch (error) {
    console.error('Detailed error (stream):', {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    res.status(500).json({
      error: 'Internal server error',
      details: error.message,
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Error handling for server startup
const server = app
  .listen(port, () => {
    console.log(`Server running on port ${port}`);
  })
  .on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Port ${port} is already in use. Please try a different port by setting the PORT environment variable.`
      );
      process.exit(1);
    } else {
      console.error('Error starting server:', err);
      process.exit(1);
    }
  });
