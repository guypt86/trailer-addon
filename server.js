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

// Helper: get movie title from TMDB
async function getTitleFromTmdb(tmdbId) {
  try {
    if (!TMDB_API_KEY) return null;
    const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const resp = await axios.get(url);
    return resp.data.title || null;
  } catch (e) {
    console.error('TMDB title lookup failed:', e.message);
    return null;
  }
}

// Helper: get video ID from YouTube search
async function getYouTubeVideoId(searchQuery) {
  try {
    // Encode the search query
    const encodedQuery = encodeURIComponent(searchQuery);

    // Make a request to YouTube's search page
    const response = await axios.get(
      `https://www.youtube.com/results?search_query=${encodedQuery}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      }
    );

    // Extract video ID using regex
    const videoIdMatch = response.data.match(/\{"videoId":"([^"]+)"\}/);
    if (videoIdMatch && videoIdMatch[1]) {
      return videoIdMatch[1];
    }

    return null;
  } catch (error) {
    console.error('YouTube search failed:', error.message);
    return null;
  }
}

// Stream endpoint for trailer
app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    console.log(`Received stream request for ${type} with ID: ${id}`);

    // Support both movies and series
    if (type !== 'movie' && type !== 'series') {
      return res.status(400).json({ error: 'Invalid request' });
    }

    let imdbId = null;
    let searchQuery = null;

    if (id.startsWith('tt')) {
      imdbId = id;
      searchQuery = `${imdbId} official trailer`;
    } else if (id.startsWith('tmdb:')) {
      const tmdbId = id.replace('tmdb:', '');
      imdbId = await getImdbIdFromTmdb(tmdbId);
      if (imdbId) {
        searchQuery = `${imdbId} official trailer`;
        console.log(`TMDB id ${tmdbId} resolved to IMDb id ${imdbId}`);
      } else {
        // fallback: try to get title from TMDB
        const title = await getTitleFromTmdb(tmdbId);
        if (title) {
          searchQuery = `${title} official trailer`;
          console.log(`TMDB id ${tmdbId} fallback to title: ${title}`);
        }
      }
    } else {
      // fallback: just use the id as title
      searchQuery = `${id} official trailer`;
      console.log(`Unknown id format, fallback to: ${searchQuery}`);
    }

    if (!searchQuery) {
      return res.json({ streams: [] });
    }

    console.log('YouTube search query:', searchQuery);
    const videoId = await getYouTubeVideoId(searchQuery);
    console.log('YouTube videoId found:', videoId);

    if (!videoId) {
      return res.json({ streams: [] });
    }

    const streams = [
      {
        name: 'Trailer',
        title: 'Trailer',
        type: 'Trailer',
        ytId: videoId,
        source: 'YouTube',
        behaviorHints: {
          bingeGroup: `trailer-${videoId}`,
          notWebReady: false,
        },
      },
    ];

    console.log('Returning streams:', JSON.stringify(streams, null, 2));
    res.json({ streams });
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
