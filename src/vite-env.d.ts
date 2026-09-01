/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute URL of the leaderboard endpoint.
   *
   * Left unset for the build that ships to the host serving the API, where the
   * default relative path is correct and simpler. Set it for any build served
   * from somewhere else — GitHub Pages is static and has no PHP, so that build
   * has to be told where the board actually lives or it will show an
   * unreachable board to everybody.
   */
  readonly VITE_LEADERBOARD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
