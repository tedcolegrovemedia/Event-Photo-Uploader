import type { AppSettings, GalleryStatus, ValidationIssue } from '@eps/core';

/**
 * The single shape crossing the IPC boundary. Main owns it; preload re-exports
 * the types so the renderer stays typed without importing Node code.
 */

export interface PhotoView {
  id: string;
  filename: string;
  /** eps://thumb/<id>, or null until the thumbnail finishes generating. */
  thumbnailUrl: string | null;
  rotation: number;
  rejected: boolean;
  createdAt: string;
}

export interface GalleryView {
  id: string;
  code: string;
  status: GalleryStatus;
  error: string | null;
  attempts: number;
  photoCount: number;
  url: string;
  createdAt: string;
  publishedAt: string | null;
}

export interface AppState {
  settings: AppSettings;
  event: { name: string; slug: string };
  unassigned: PhotoView[];
  galleries: GalleryView[];
  watching: string | null;
  log: string[];
}

export type SaveResult =
  | { ok: true; issues: never[] }
  | { ok: false; issues: ValidationIssue[] };

export interface TestResult {
  ok: boolean;
  message: string;
}

export interface QrResult {
  url: string;
  dataUrl: string;
}
