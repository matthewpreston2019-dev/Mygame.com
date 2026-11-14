/**
 * True in the hosted single-page build (`npm run build:web`). That host blocks
 * file downloads and the Web Share API, so those actions use alternatives.
 */
export const HOSTED_PAGE = import.meta.env.VITE_TARGET === 'artifact'
