// One place to import the UI library from.
// Preact is a 4 KB React-compatible library; htm lets us write JSX-like
// markup in plain JavaScript (no build step):  html`<div class="card">${x}</div>`
import { h, render, Fragment, createContext } from '../../vendor/preact.module.js';
import htm from '../../vendor/htm.module.js';

export { h, render, Fragment, createContext };
export {
  useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, useReducer, useContext,
} from '../../vendor/hooks.module.js';

export const html = htm.bind(h);
