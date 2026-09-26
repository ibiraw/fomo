/**
 * @file main.tsx
 * @description Single-file build of the site (Vite + vite-plugin-singlefile) for hosts that serve one page,
 *              such as a Claude artifact. Renders the same components as the Next.js app.
 * @author Reborn1987
 */

import { createRoot } from 'react-dom/client';

import Home from '@/app/page';
import { Splash } from '@/components/site/Splash';

import './single.css';

createRoot(document.getElementById('root')!).render(
  <>
    <Splash />
    <Home />
  </>,
);
