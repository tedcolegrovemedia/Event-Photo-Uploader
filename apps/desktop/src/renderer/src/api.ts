import type { EpsApi } from '../../preload';

declare global {
  interface Window {
    eps: EpsApi;
  }
}

export const eps = window.eps;

export type {
  AppState,
  GalleryView,
  PhotoView,
  QrResult,
  SaveResult,
  TestResult,
} from '../../main/contract';
