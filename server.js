require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 10000;

// YouTube API setup
const youtube = google.youtube('v3');

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

// Meta endpoint
app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    console.log(`Received request for ${type} with ID: ${id}`);

    if (!process.env.YOUTUBE_API_KEY) {
      console.error('YouTube API key is not set');
      return res
        .status(500)
        .json({ error: 'YouTube API key is not configured' });
    }

    if (type !== 'movie' || !id.startsWith('tt')) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    console.log('Searching for trailer on YouTube...');
    // Search for trailer on YouTube
    const searchResponse = await youtube.search.list({
      part: 'snippet',
      q: `${id} official trailer`,
      type: 'video',
      maxResults: 1,
      key: process.env.YOUTUBE_API_KEY,
    });

    const videoId = searchResponse.data.items[0]?.id.videoId;

    if (!videoId) {
      console.log('No trailer found');
      return res.status(404).json({ error: 'Trailer not found' });
    }

    console.log(`Found video ID: ${videoId}`);
    // Get video details
    const videoResponse = await youtube.videos.list({
      part: 'snippet',
      id: videoId,
      key: process.env.YOUTUBE_API_KEY,
    });

    const video = videoResponse.data.items[0];

    // Construct meta response
    const meta = {
      id: id,
      type: 'movie',
      name: video.snippet.title,
      trailer: `https://www.youtube.com/watch?v=${videoId}`,
      poster: video.snippet.thumbnails.high.url,
    };

    console.log('Successfully returning meta data');
    res.json({ meta });
  } catch (error) {
    console.error('Detailed error:', {
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

// Stream endpoint for trailer
app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    console.log(`Received stream request for ${type} with ID: ${id}`);

    if (!process.env.YOUTUBE_API_KEY) {
      console.error('YouTube API key is not set');
      return res
        .status(500)
        .json({ error: 'YouTube API key is not configured' });
    }

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
    // Search for trailer on YouTube
    const searchResponse = await youtube.search.list({
      part: 'snippet',
      q: searchQuery,
      type: 'video',
      maxResults: 1,
      key: process.env.YOUTUBE_API_KEY,
    });

    const videoId = searchResponse.data.items[0]?.id.videoId;
    console.log('YouTube videoId found:', videoId);

    if (!videoId) {
      return res.json({ streams: [] });
    }

    // Return multiple trailer streams with different approaches
    const streams = [
      {
        title: 'Trailer',
        ytId: videoId,
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
  res.json({
    status: 'ok',
    youtube_api_key: process.env.YOUTUBE_API_KEY
      ? 'configured'
      : 'not configured',
  });
});

// Error handling for server startup
const server = app
  .listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(
      'YouTube API Key status:',
      process.env.YOUTUBE_API_KEY ? 'configured' : 'not configured'
    );
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
