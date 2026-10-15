
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const Screen = new URLSearchParams(window.location.search).get('demo') === 'note-logic'
  ? React.lazy(() => import('./components/ReviewPracticeDemo'))
  : App;
root.render(
  <React.StrictMode>
    <React.Suspense fallback={<div className="p-8 text-slate-500">불러오는 중</div>}><Screen /></React.Suspense>
  </React.StrictMode>
);
