import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from "react-router-dom";
import './index.css';
// Class-gated: inert unless <body> carries .brand-devspace, so importing it
// unconditionally costs the stock build nothing but a couple of KB.
import './themes/devspace.css';
import App from './app/App';
import { IS_DEVSPACE } from './config';
import reportWebVitals from './reportWebVitals';

/**
 * Apply the Dev Space identity.
 *
 * This has to happen in JS rather than in index.html: index.html is a
 * build-time template (%PUBLIC_URL%), and REACT_APP_BRAND is a RUNTIME value
 * injected by docker/generate-env.sh — so the same image can serve either
 * brand. The trade-off is a brief flash of the stock title on a cold load.
 */
function applyBrand() {
  if (!IS_DEVSPACE) return;

  document.body.classList.add('brand-devspace');
  document.title = 'DEV SPACE';

  const icon = document.querySelector('link[rel="icon"]');
  if (icon) icon.href = `${process.env.PUBLIC_URL}/devspace.svg`;

  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', '#9B2226');
}

applyBrand();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
