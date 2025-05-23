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

    // Only support movies
    if (type !== 'movie') {
      return res
        .status(400)
        .json({ error: 'Only movie trailers are supported' });
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

    // Get direct video URLs from Piped API
    try {
      console.log('Fetching streams from video providers...');

      // Try multiple instances
      const instances = [
        // Piped instances
        'https://pipedapi.syncpundit.io',
        'https://api-piped.mha.fi',
        'https://piped-api.garudalinux.org',
        // Invidious instances
        'https://invidious.snopyta.org',
        'https://yt.artemislena.eu',
        'https://invidious.flokinet.to',
        'https://invidious.privacydev.net',
      ];

      const responses = await Promise.allSettled(
        instances.map(async (instance) => {
          try {
            // Different URL format for Invidious
            const isInvidious =
              instance.includes('invidious') ||
              instance.includes('yt.artemislena');
            const url = isInvidious
              ? `${instance}/api/v1/videos/${videoId}`
              : `${instance}/streams/${videoId}`;

            const response = await axios.get(url, {
              timeout: 5000,
              validateStatus: (status) => status === 200,
            });

            return { instance, isInvidious, data: response.data };
          } catch (error) {
            console.error(`Error from ${instance}:`, error.message);
            return null;
          }
        })
      );

      console.log(
        'Raw responses:',
        responses.map((r) => ({
          status: r.status,
          instance:
            r.status === 'fulfilled' && r.value ? r.value.instance : null,
          hasData:
            r.status === 'fulfilled' && r.value && r.value.data ? 'yes' : 'no',
        }))
      );

      const streams = [];

      // Process responses
      for (const response of responses) {
        if (
          response.status !== 'fulfilled' ||
          !response.value ||
          !response.value.data
        )
          continue;

        const { instance, isInvidious, data } = response.value;

        try {
          if (isInvidious) {
            // Handle Invidious response format
            const formats = data.formatStreams || [];
            const hd = formats.find(
              (f) => f.quality === '720p' || f.quality === '480p'
            );

            if (hd && hd.url) {
              streams.push({
                name: `Trailer (${hd.quality})`,
                title: 'Official Trailer',
                url: hd.url,
                type: 'trailer',
                source: 'youtube',
                behaviorHints: {
                  notWebReady: true,
                  bingeGroup: 'trailer',
                },
              });
            }
          } else {
            // Handle Piped response format
            const videoStreams = data.videoStreams || [];
            const hd = videoStreams.find(
              (s) => s.quality === '720p' || s.quality === '480p'
            );

            if (hd && hd.url) {
              streams.push({
                name: `Trailer (${hd.quality})`,
                title: 'Official Trailer',
                url: hd.url,
                type: 'trailer',
                source: 'youtube',
                behaviorHints: {
                  notWebReady: true,
                  bingeGroup: 'trailer',
                },
              });
            }
          }
        } catch (error) {
          console.error(
            `Error processing response from ${instance}:`,
            error.message
          );
        }
      }

      console.log('Final streams count:', streams.length);
      if (streams.length > 0) {
        console.log('Returning streams:', JSON.stringify(streams, null, 2));
        return res.json({ streams });
      } else {
        console.log('No valid streams found from any instance');
        return res.json({ streams: [] });
      }
    } catch (error) {
      console.error('Failed to get video streams:', error.message);
      return res.json({ streams: [] });
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
