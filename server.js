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

// Helper: get trailer from Apple Trailers
async function getAppleTrailer(movieName) {
  try {
    const url = `https://trailers.apple.com/api/v1/movies?q=${encodeURIComponent(
      movieName
    )}`;
    const response = await axios.get(url);
    const movies = response.data.movies;
    if (movies && movies.length > 0) {
      const trailer = movies[0].trailers[0];
      return trailer.hlsUrl; // קישור HLS
    }
    return null;
  } catch (error) {
    console.error('Failed to get Apple trailer:', error);
    return null;
  }
}

// Helper: get movie name from TMDB
async function getMovieNameFromTmdb(tmdbId) {
  try {
    if (!TMDB_API_KEY) return null;
    const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const resp = await axios.get(url);
    return resp.data.title || null;
  } catch (e) {
    console.error('TMDB movie name lookup failed:', e.message);
    return null;
  }
}

// Helper: get trailer from Vimeo
async function getVimeoTrailer(movieName) {
  try {
    const url = `https://api.vimeo.com/videos?query=${encodeURIComponent(
      movieName
    )}&filter=trailer`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${process.env.VIMEO_API_KEY}`,
      },
    });
    const videos = response.data.data;
    if (videos && videos.length > 0) {
      const video = videos[0];
      // Try to get direct mp4 file
      if (video.files && video.files.length > 0) {
        const mp4 = video.files.find((f) => f.type === 'video/mp4');
        if (mp4 && mp4.link) return mp4.link;
      }
      // Try to get HLS (m3u8) link
      if (video.play && video.play.hls && video.play.hls.link) {
        return video.play.hls.link;
      }
      // Fallback: regular Vimeo page link (not supported by Infuse)
      return video.link;
    }
    return null;
  } catch (error) {
    console.error('Failed to get Vimeo trailer:', error);
    return null;
  }
}

// Helper: normalize movie name for Apple Trailers
function normalizeMovieName(movieName) {
  return movieName
    .replace(/[^\w\s]/g, '') // הסרת תווים מיוחדים
    .replace(/\s+/g, ' ') // הסרת רווחים כפולים
    .trim()
    .toLowerCase();
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

    // Get movie name from TMDB
    const movieName = await getMovieNameFromTmdb(tmdbId);
    if (!movieName) {
      console.log('Could not get movie name from TMDB');
      return res.json({ streams: [] });
    }

    // Try Apple Trailers with normalized name
    const normalizedName = normalizeMovieName(movieName);
    const appleUrl = await getAppleTrailer(normalizedName);
    if (appleUrl) {
      const streams = [
        {
          name: 'Trailer (Apple)',
          title: 'Official Trailer',
          url: appleUrl,
          type: 'trailer',
          source: 'apple',
          behaviorHints: {
            bingeGroup: 'trailer',
          },
        },
      ];
      console.log(
        'Returning Apple trailer stream:',
        JSON.stringify(streams, null, 2)
      );
      return res.json({ streams });
    }

    // Fallback to Vimeo
    const vimeoUrl = await getVimeoTrailer(movieName);
    if (vimeoUrl) {
      const streams = [
        {
          name: 'Trailer (Vimeo)',
          title: 'Official Trailer',
          url: vimeoUrl,
          type: 'trailer',
          source: 'vimeo',
          behaviorHints: {
            bingeGroup: 'trailer',
          },
        },
      ];
      console.log(
        'Returning Vimeo trailer stream:',
        JSON.stringify(streams, null, 2)
      );
      return res.json({ streams });
    }

    console.log('No trailer found from Apple or Vimeo');
    return res.json({ streams: [] });
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
