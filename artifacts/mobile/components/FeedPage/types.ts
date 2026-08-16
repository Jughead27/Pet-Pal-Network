import type { FeedPost } from '@workspace/api-client-react';

// ─── Pop state ────────────────────────────────────────────────────────────────

export interface Pop {
  id: number;
  word: string;
  /** Accent color — coral for boop, gold for treat. */
  color: string;
  rotation: number;
  right: number;
  bottom: number;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CommentSheetConfig {
  postId: string;
  onCommentPosted: () => void;
}

export interface FeedPageProps {
  post: FeedPost;
  /** Exact rendered height of the pager container — used for full-bleed sizing. */
  height: number;
  reducedMotion: boolean;
  onOpenCommentSheet: (config: CommentSheetConfig) => void;
}
