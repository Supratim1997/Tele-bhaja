import React, { useEffect } from 'react';
import Player from './Player.js';
import type { MediaItem } from '../../shared/types.js';
import { api } from '../lib/api.js';

interface MoviePlayerModalProps {
  movie: MediaItem;
  onClose: () => void;
}

const MoviePlayerModal: React.FC<MoviePlayerModalProps> = ({ movie, onClose }) => {
  // Prevent body scroll when player open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const src = movie.needsTranscode
    ? api.stream.movieUrl(movie.id, true)
    : api.stream.movieUrl(movie.id);

  return (
    <div
      id="movie-player-modal"
      className="fixed inset-0 z-50 bg-black animate-fade-in"
    >
      <Player
        src={src}
        title={movie.title}
        mediaType="movie"
        mediaId={movie.id}
        audioTracks={movie.audioTracks}
        subtitleTracks={movie.subtitleTracks}
        needsTranscode={movie.needsTranscode}
        mimeType={movie.mimeType}
        onClose={onClose}
      />
    </div>
  );
};

export default MoviePlayerModal;
